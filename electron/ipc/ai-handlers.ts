import type { BrowserWindow } from 'electron'
import type { QueueWorkItemForHarness } from '../services/task-intake'
import { handleApi } from './handle-ipc'
import { stripProposalBlocks, type AIHaltState, type WatchedProject } from '@shared/ostler-api'
import type { ConfigStore } from '../config-store'
import { isAiHalted, setAiHalted } from '../services/ai-halt'
import { activeAiRequestCount } from '../services/ai-provider'
import type { EventDatabase } from '../services/event-database'
import { libraryItemIds, type LibraryAiReader } from '../services/library-ai-parts'
import type { OpenCodeRunnerService } from '../services/opencode-runner-service'
import type { PlanningService } from '../services/planning-service'
import type { TaskReviewService } from '../services/task-review-service'
import type { ProjectAiSettingsService } from '../services/project-ai-settings'
import { normalizeConnectionDraft } from '../services/ai-access'
import { findLocalAiProvider } from '../services/ai-local-detect'
import { aiPreset } from '@shared/ai-presets'
import { openExternalUrl } from '../app/security'
import { projectFolderRef } from '../services/project-files'
import { t } from '@shared/i18n'
export interface AiHandlerDependencies {
  dataDir: string
  configStore: ConfigStore
  database: EventDatabase
  planningService: PlanningService
  /** The notes chat reads the library through its one gate and builder. */
  libraryService: LibraryAiReader
  taskReviewService: TaskReviewService
  openCodeRunnerService: OpenCodeRunnerService
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  queueWorkItemForHarness: QueueWorkItemForHarness
  notifyHarnessState(project: WatchedProject): void
  /** The project's AI profile. */
  projectAiSettings: ProjectAiSettingsService
  /** The emergency stop, shared with the tray's Stop all AI (P8.2). */
  stopAllAi(): Promise<AIHaltState>
}
/** Registers reporting-only AI chat, improvement review, and task-review IPC. */
export function registerAiHandlers({
  dataDir,
  configStore,
  database,
  planningService,
  libraryService,
  taskReviewService,
  getMainWindow,
  getProject,
  queueWorkItemForHarness,
  notifyHarnessState,
  projectAiSettings,
  stopAllAi
}: AiHandlerDependencies): void {
  let aiServiceInstance: import('../services/ai-service').AIService | null = null
  const getAiService = async () => {
    if (!aiServiceInstance) {
      const { AIService } = await import('../services/ai-service')
      aiServiceInstance = new AIService(
        () => configStore.get(),
        database,
        getMainWindow()!,
        // Read-only titles and statuses, so the project chat can avoid proposing
        // what is already tracked. It never receives a way to write.
        (projectId) => ({
          goals: planningService.listGoals(projectId).map((goal) => goal.title),
          milestones: planningService.listMilestones(projectId).map((milestone) => milestone.name),
          workItems: planningService
            .listWorkItems(projectId)
            .map((item) => ({ title: item.title, status: item.status }))
        }),
        () => libraryService,
        // Only a registered project's own folder, read only (`project-files.ts`).
        (projectId) => {
          try {
            return projectFolderRef(getProject(projectId))
          } catch {
            return null
          }
        },
        (projectId) => projectAiSettings.profile(projectId)
      )
    }
    return aiServiceInstance
  }
  let projectNotesService: import('../services/project-notes-service').ProjectNotesService | null =
    null // --- AI Chat ---
  handleApi(
    'sendMessage',
    async (
      _event,
      conversationId: string,
      message: string,
      projectScope: string | null,
      selectedItemIds?: string[]
    ) => {
      if (projectScope) getProject(projectScope)
      const aiService = await getAiService()
      await aiService.sendMessage(
        conversationId,
        message,
        projectScope,
        libraryItemIds(selectedItemIds)
      )
      return undefined
    }
  )
  handleApi('getConversations', async () => {
    return database.getConversations()
  })
  handleApi('getConversation', async (_event, id: string) => {
    return database.getConversation(id)
  })
  handleApi(
    'createConversation',
    async (_event, title?: string, projectId: string | null = null) => {
      if (projectId) {
        getProject(projectId)
      }
      const aiService = await getAiService()
      const conv = await aiService.createConversation(title, projectId)
      return conv
    }
  )
  handleApi('saveProjectStatusNote', async (_event, projectId: string, content: string) => {
    const project = getProject(projectId)
    if (!projectNotesService) {
      const { ProjectNotesService } = await import('../services/project-notes-service')
      projectNotesService = new ProjectNotesService(dataDir)
    }
    // Proposal blocks are machine-readable UI directives, not status text.
    const note = stripProposalBlocks(content)
    if (!note.trim()) throw new Error(t('errors:aiHandlers.thereNoStatusText'))
    const path = projectNotesService.saveStatusNote(project, note)
    // The latest approved response is also the project's visible current
    // status. The complete dated history remains in status.md.
    configStore.updateProject(projectId, { notes: note.trim() })
    return path
  })
  handleApi('deleteConversation', async (_event, id: string) => {
    database.deleteConversation(id)
    return undefined
  })
  handleApi('testAIConnection', async (_event, draft?: unknown) => {
    const aiService = await getAiService()
    return aiService.testConnection(normalizeConnectionDraft(draft))
  })
  // "Find it" in the guided setup: one local preset's one default address.
  handleApi('findLocalAI', async (_event, presetId: unknown) => {
    if (typeof presetId !== 'string') throw new Error(t('errors:aiHandlers.chooseLocalProvider'))
    return findLocalAiProvider(presetId)
  })
  // The link comes from the preset, never from the renderer, and is https only.
  handleApi('openAIProviderPage', async (_event, presetId: unknown) => {
    const preset = typeof presetId === 'string' ? aiPreset(presetId) : null
    if (!preset?.docsUrl.startsWith('https://')) throw new Error('That provider has no page')
    await openExternalUrl(preset.docsUrl)
    return undefined
  })
  handleApi('getProjectAISettings', async (_event, projectId: string) => {
    getProject(projectId)
    return projectAiSettings.get(projectId)
  })
  handleApi('updateProjectAISettings', async (_event, projectId: string, updates: unknown) => {
    getProject(projectId)
    if (!updates || typeof updates !== 'object') throw new Error('Nothing to change')
    return projectAiSettings.update(projectId, updates as Record<string, unknown>)
  })
  // --- Emergency stop ---
  handleApi('emergencyStopAI', () => stopAllAi())
  handleApi('resumeAI', async (): Promise<AIHaltState> => {
    setAiHalted(false)
    return { halted: false }
  })
  handleApi('getAIHaltState', async (): Promise<AIHaltState> => ({
    halted: isAiHalted(),
    activeRequests: activeAiRequestCount()
  }))
  handleApi('listAIModels', async (_event, draft?: unknown) => {
    const aiService = await getAiService()
    return aiService.listModels(normalizeConnectionDraft(draft))
  })
  handleApi('getAIModelEffortSupport', async (_event, draft?: unknown) => {
    const aiService = await getAiService()
    return aiService.modelEffortSupport(normalizeConnectionDraft(draft))
  })
  // --- AI Task Review ---
  handleApi('getTaskReviews', async (_event, workItemId: string) => {
    const item = planningService.getWorkItem(workItemId)
    return taskReviewService.getHistory(item.projectId, workItemId)
  })
  handleApi('refreshTaskReview', async (_event, projectId: string, workItemId: string) => {
    const project = getProject(projectId)
    const item = planningService.getWorkItem(workItemId)
    if (item.projectId !== projectId) throw new Error('That task belongs to a different project.')
    return await taskReviewService.refresh(project, item, 'manual')
  })
  handleApi(
    'annotateTaskReview',
    async (_event, reviewId: string, workItemId: string, humanComment: string) => {
      const item = planningService.getWorkItem(workItemId)
      return taskReviewService.annotate(item.projectId, workItemId, reviewId, humanComment)
    }
  )
  handleApi('acceptTaskReview', async (_event, reviewId: string, workItemId: string) => {
    const item = planningService.getWorkItem(workItemId)
    return taskReviewService.accept(item.projectId, workItemId, reviewId)
  })
  handleApi('dismissTaskReview', async (_event, reviewId: string, workItemId: string) => {
    const item = planningService.getWorkItem(workItemId)
    return taskReviewService.dismiss(item.projectId, workItemId, reviewId)
  })
  handleApi(
    'resolveTaskReview',
    async (_event, reviewId: string, workItemId: string, includeComment: boolean) => {
      const item = planningService.getWorkItem(workItemId)
      const project = getProject(item.projectId)
      const result = await taskReviewService.resolve(
        item.projectId,
        workItemId,
        reviewId,
        includeComment
      )
      const queued = queueWorkItemForHarness(project, result.createdWorkItem.id)
      notifyHarnessState(project)
      return { review: result.review, createdWorkItem: queued.workItem }
    }
  )
}
