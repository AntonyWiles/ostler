import { queueNewTask } from '../services/task-intake'
import { safeFileName } from '../app/file-names'
import { syncAgentWorkItemStatus } from '../services/agent-status-sync'
import { dialog, type BrowserWindow } from 'electron'
import { projectIpcHandlers, handleApi } from './handle-ipc'
import * as fs from 'node:fs'
import {
  type PlanningPriority,
  type PlanningWorkItemStatus,
  type HarnessTaskRejection,
  type ProjectHistoryFilter,
  type ProjectAutoDispatchConfig,
  type WatchedProject
} from '@shared/ostler-api'
import type { ConfigStore } from '../config-store'
import type { HarnessService } from '../services/harness-service'
import type { OpenCodeRunnerService } from '../services/opencode-runner-service'
import { embeddedFailureNote, embeddedRunPhase } from '../services/opencode-runner-service'
import type { PlanningService } from '../services/planning-service'
import {
  checkAgentRequirements,
  probeGitVersion,
  probeRuntime
} from '../services/agent-requirements'
import { toRendererProject, toRendererSession } from '@shared/renderer-config'
import type { LegacyAgentMigration } from '../services/harness/legacy-migration'
import { describeProjectSetup } from '../services/harness/workspace-setup'
import { t } from '@shared/i18n'
import { validateAgentRunChoice, validateRunAgainChoice } from '../services/agent-run-model'
import type { RunGuidanceService } from '../services/run-guidance'
import type { TaskPlansService } from '../services/task-plans-service'
export interface HarnessHandlerDependencies {
  configStore: ConfigStore
  harnessService: HarnessService
  openCodeRunnerService: OpenCodeRunnerService
  planningService: PlanningService
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  notifyHarnessState(project: WatchedProject): void
  runGuidance: RunGuidanceService
  legacyMigration: LegacyAgentMigration
  taskPlans: TaskPlansService
}
/** Registers the agent harness, workspace recovery, and dispatch-control IPC surface. */
export function registerHarnessHandlers({
  configStore,
  harnessService,
  openCodeRunnerService,
  planningService,
  getMainWindow,
  getProject,
  notifyHarnessState,
  runGuidance,
  legacyMigration,
  taskPlans
}: HarnessHandlerDependencies): void {
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyHarnessState)

  /** The planning work item a queued task was handed off from, if any. */
  const linkedWorkItem = (projectId: string, taskId: string) =>
    planningService.listWorkItems(projectId).find((item) => item.linkedHarnessTaskId === taskId) ??
    null

  /** The task a session was started for, durable across a failed run's release. */
  const sessionTaskId = (project: WatchedProject, sessionId: string): string | null => {
    const state = harnessService.getState(project)
    const session = [...state.activeSessions, ...state.reviewSessions].find(
      (item) => item.id === sessionId
    )
    if (session?.taskId) return session.taskId
    return state.taskQueue.find((task) => task.claimedBy === sessionId)?.id ?? null
  }

  /** Every task a session holds: one, or several when its agent went on to the next (§3.2). */
  const sessionTaskIds = (project: WatchedProject, sessionId: string): string[] => {
    const ids = new Set(
      harnessService
        .getState(project)
        .taskQueue.filter((task) => task.claimedBy === sessionId)
        .map((task) => task.id)
    )
    const own = sessionTaskId(project, sessionId)
    if (own) ids.add(own)
    return [...ids]
  }

  /**
   * Moves the planning work item in step with its agent task.
   *
   * Nothing did this before: the harness queue tracked execution correctly
   * while the work item's own `status` sat on whatever a human last set, so a
   * merged, shipped item still read `ready`. Everything derived from that
   * field -- completedCount, lead time, cycle time, throughput -- was
   * therefore permanently empty.
   */
  const syncLinkedWorkItem = (
    projectId: string,
    taskId: string | null,
    status: PlanningWorkItemStatus
  ): void => syncAgentWorkItemStatus(planningService, projectId, taskId, status)

  projectApi('getHarnessState', (project) => harnessService.getState(project))
  projectApi('describeProjectSetup', (project) => describeProjectSetup(project))
  // Start calls return the session without its token: the prompt that carries
  // it is built and copied by main (COPY_HARNESS_SESSION_PROMPT).
  mutatingApi('startHarnessTaskSession', async (project, taskId: string) => {
    const session = await harnessService.startSessionForTask(project, taskId)
    syncLinkedWorkItem(project.id, taskId, 'active')
    // The copy and its setup were ready before the session started (§2.1).
    return toRendererSession(session)
  })
  // Run: claims the task and starts the session in its copy exactly like
  // HARNESS_START_TASK_SESSION, then hands it to OpenCodeRunnerService.
  projectApi('startHarnessEmbeddedSession', async (project, taskId: string) => {
    const session = await harnessService.startEmbeddedSessionForTask(project, taskId)
    harnessService.touchSessionConnection(project, session.id)
    // Notified here rather than after the handler returns: the runner starts
    // driving the session below, so the renderer must already have the
    // connected state before that work begins.
    notifyHarnessState(project)
    const task = harnessService
      .getState(project)
      .taskQueue.find((item) => item.claimedBy === session.id)
    if (!task) throw new Error(t('errors:harnessHandlers.agentStartedButTask'))
    syncLinkedWorkItem(project.id, task.id, 'active')
    void openCodeRunnerService.start(project, session, task).catch((error) => {
      console.error(`Embedded session ${session.id} failed (${embeddedRunPhase(error)}):`, error)
      try {
        // failSession, not updateSession(done): `done` settles the task as
        // *complete*, so a run that crashed used to leave its task marked
        // finished and its work item looking delivered. Releasing it back to
        // pending is what the other two start paths already do.
        harnessService.failSession(project, session.id, embeddedFailureNote(error))
        // The run is over and the task is back in the queue; leaving the item
        // in `active` would show phantom work in flight on the board.
        syncLinkedWorkItem(project.id, task.id, 'ready')
      } finally {
        notifyHarnessState(project)
      }
    })
    return toRendererSession(session)
  })
  mutatingApi('updateHarnessSession', (project, sessionId: string, note: string, done: boolean) =>
    harnessService.updateSession(project, sessionId, note, done)
  )
  mutatingApi(
    'addHarnessTask',
    // Backed by a work item like every other task, so it shows on the Board.
    async (
      project,
      title: string,
      details: string,
      priority: PlanningPriority = 'medium',
      runChoice?: unknown
    ) => {
      // Checked before the work item is made, so a refused model leaves nothing.
      const choice =
        runChoice !== undefined && runChoice !== null
          ? await validateAgentRunChoice(configStore.get(), project, runChoice)
          : undefined
      return queueNewTask(
        planningService,
        harnessService,
        project,
        { title, details, priority, runChoice: choice },
        planningService.humanActor()
      ).task
    }
  )
  mutatingApi(
    'updateHarnessTask',
    (project, taskId: string, action: 'claim' | 'release' | 'complete', sessionId: string) =>
      harnessService.updateTask(project, taskId, action, sessionId)
  )
  projectApi('getHarnessReport', (project) => harnessService.getReport(project))
  mutatingApi('answerHarnessQuestion', (project, questionId: string, answer: string) => {
    const question = harnessService.answerQuestion(project, questionId, answer)
    openCodeRunnerService.onQuestionAnswered(question)
    return question
  })
  // Plan first (N9.3b): the Plan dialog reads and decides through the same
  // harness methods the automation API uses.
  projectApi('getHarnessSessionPlan', (project, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required')
    const state = harnessService.getState(project)
    const session = [...state.activeSessions, ...state.reviewSessions].find(
      (item) => item.id === sessionId
    )
    return {
      sessionId,
      title: session?.title ?? '',
      plan: harnessService.getSessionPlan(project, sessionId),
      history: taskPlans.listForSession(sessionId)
    }
  })
  mutatingApi('approveHarnessPlan', (project, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required')
    return harnessService.approvePlan(project, sessionId)
  })
  mutatingApi('requestHarnessPlanChanges', (project, sessionId: unknown, note: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('A session is required')
    return harnessService.requestPlanChanges(
      project,
      sessionId,
      typeof note === 'string' ? note : ''
    )
  })
  handleApi('listWorkItemPlans', async (_event, workItemId: unknown) => {
    if (typeof workItemId !== 'string' || !workItemId) throw new Error('A task is required')
    // Throws for an unknown task, as every work-item read does.
    planningService.getWorkItem(workItemId)
    return taskPlans.listForWorkItem(workItemId)
  })
  mutatingApi('sendHarnessGuidance', (project, sessionId: unknown, text: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof text !== 'string') {
      throw new Error('A session and a message are required')
    }
    return runGuidance.send(project, sessionId, text, 'app')
  })
  handleApi('generateAutomationToken', async (_event, projectId: string) =>
    toRendererProject(configStore.generateAutomationToken(projectId))
  )
  handleApi('revokeAutomationToken', async (_event, projectId: string) =>
    toRendererProject(configStore.revokeAutomationToken(projectId))
  )
  mutatingApi('cancelHarnessTask', (project, taskId: string) => {
    const linked = linkedWorkItem(project.id, taskId)
    const task = harnessService.cancelTask(project, taskId, linked?.id ?? null)
    const workItem = linked
      ? planningService.clearHarnessHandoff(project.id, linked.id, taskId)
      : null
    return { task, workItem }
  })
  mutatingApi('reorderHarnessTasks', (project, orderedTaskIds: string[]) =>
    harnessService.reorderPendingTasks(project, orderedTaskIds)
  )
  mutatingApi('setHarnessTaskPriority', (project, taskId: string, priority: PlanningPriority) => {
    const linked = linkedWorkItem(project.id, taskId)
    const task = harnessService.setTaskPriority(project, taskId, priority, linked?.id ?? null)
    const workItem = linked
      ? planningService.updateWorkItem(linked.id, { priority }, planningService.humanActor())
      : null
    return { task, workItem }
  })
  mutatingApi('setHarnessTaskAutoContinue', (project, taskId: string, enabled: boolean) => {
    const task = harnessService.setTaskAutoContinue(project, taskId, enabled)
    const linked = linkedWorkItem(project.id, taskId)
    const workItem = linked
      ? planningService.updateWorkItem(
          linked.id,
          { autoQueue: enabled },
          planningService.humanActor()
        )
      : null
    return { task, workItem }
  })
  // Stop (§3.3): the one override. The agent's process ends first, then its
  // work is kept and its task goes back to the queue.
  mutatingApi('stopHarnessSession', async (project, sessionId: string) => {
    const taskId = sessionTaskId(project, sessionId)
    if (openCodeRunnerService?.isRunning(sessionId)) {
      await openCodeRunnerService.stop(sessionId, 'Stopped by human.')
    }
    // A run waiting on its plan is cancelled at the plan (N9.3b).
    const session = await harnessService.stopRun(project, sessionId)
    const status = taskId ? harnessService.workItemStatusForTask(project, taskId) : null
    if (status) syncLinkedWorkItem(project.id, taskId, status)
    return session
  })
  projectApi('getHarnessSessionDiff', (project, sessionId: string) =>
    harnessService.getSessionDiff(project, sessionId)
  )
  mutatingApi(
    'applyHarnessTaskWork',
    async (project, sessionId: string, onCurrentVersion?: boolean) => {
      const taskIds = sessionTaskIds(project, sessionId)
      const result = await harnessService.applyTaskWork(
        project,
        sessionId,
        onCurrentVersion === true
      )
      for (const taskId of taskIds) {
        const status = harnessService.workItemStatusForTask(project, taskId)
        if (status) syncLinkedWorkItem(project.id, taskId, status)
      }
      return result
    }
  )
  mutatingApi('discardHarnessTaskWork', async (project, sessionId: string) => {
    const taskIds = sessionTaskIds(project, sessionId)
    const session = await harnessService.discardTaskWork(project, sessionId)
    // The task is back in the queue, so its item is un-started again -- unless
    // the task has already moved on.
    for (const taskId of taskIds) {
      const status = harnessService.workItemStatusForTask(project, taskId)
      if (status) syncLinkedWorkItem(project.id, taskId, status)
    }
    return session
  })
  mutatingApi(
    'sendBackHarnessTaskWork',
    async (
      project,
      sessionId: string,
      reason: string,
      disposition: HarnessTaskRejection['disposition'],
      runAgainWith?: unknown
    ) =>
      harnessService.sendBackTaskWork(
        project,
        sessionId,
        reason,
        disposition,
        await validateRunAgainChoice(configStore.get(), project, disposition, runAgainWith)
      )
  )
  mutatingApi('saveHarnessReviewDrafts', (project, sessionId: string, drafts: unknown) =>
    harnessService.saveReviewDrafts(project, sessionId, drafts)
  )
  mutatingApi('startHarnessReview', (project, sessionId: unknown) =>
    harnessService.startReview(project, requireIpcId(sessionId, 'session'))
  )
  mutatingApi(
    'dismissHarnessReviewFinding',
    (project, sessionId: unknown, findingId: unknown, dismissed: unknown) =>
      harnessService.dismissReviewFinding(
        project,
        requireIpcId(sessionId, 'session'),
        requireIpcId(findingId, 'finding'),
        dismissed !== false
      )
  )
  mutatingApi('bringBackHarnessTaskWork', async (project, sessionId: string) => {
    const session = await harnessService.bringBackTaskWork(project, sessionId)
    if (session.taskId) syncLinkedWorkItem(project.id, session.taskId, 'review')
    return session
  })
  projectApi('getProjectHistory', (project, filter?: ProjectHistoryFilter) =>
    harnessService.getProjectHistory(project, filter ?? {})
  )
  mutatingApi('undoHistoryEntries', (project, entryIds: unknown) => {
    if (!Array.isArray(entryIds) || entryIds.some((id) => typeof id !== 'string')) {
      throw new Error('Entries to undo are required')
    }
    return harnessService.undoHistoryEntries(project, entryIds as string[])
  })
  mutatingApi('restoreHistoryEntry', (project, entryId: string) =>
    harnessService.restoreToHistoryEntry(project, entryId)
  )
  handleApi('getAgentStorage', async () => legacyMigration.storageUsage())
  handleApi('removeLegacyAgentFiles', async () => {
    legacyMigration.removeLegacyFiles()
    return legacyMigration.storageUsage()
  })
  mutatingApi('retryLegacyMigration', async (project): Promise<void> => {
    await legacyMigration.migrateProject(project)
  })
  handleApi('checkAgentRequirements', async () =>
    checkAgentRequirements({
      gitVersion: probeGitVersion,
      runtimePresent: probeRuntime,
      getConfig: () => configStore.get()
    })
  )
  projectApi('listRecentAgentRuns', async (project) => harnessService.getRecentRuns(project))
  projectApi('getAgentRunHistory', async (project, filter: unknown) =>
    harnessService.getRunHistory(project, filter)
  )
  projectApi('getAgentUsage', async (project) => harnessService.getAgentUsage(project))
  projectApi('exportAgentRunHistory', async (project, filter: unknown) => {
    const text = await harnessService.getRunHistoryCsv(project, filter)
    const choice = await dialog.showSaveDialog(getMainWindow()!, {
      title: t('errors:runHistory.exportTitle'),
      defaultPath: `${safeFileName(t('errors:runHistory.exportFileName', { project: project.name }))}.csv`,
      filters: [{ name: 'CSV (comma separated)', extensions: ['csv'] }]
    })
    if (choice.canceled || !choice.filePath) return null
    const filePath = /\.csv$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.csv`
    fs.writeFileSync(filePath, text, 'utf8')
    return filePath
  })
  handleApi('getProjectAutoDispatchConfig', async (_event, projectId: string) =>
    configStore.getProjectAutoDispatchConfig(projectId)
  )
  mutatingApi(
    'updateProjectAutoDispatchConfig',
    (project, updates: Partial<ProjectAutoDispatchConfig>) =>
      configStore.updateProjectAutoDispatchConfig(project.id, updates)
  )
  mutatingApi('setHarnessTaskHold', (project, taskId: string, hold: boolean) =>
    harnessService.setTaskHold(project, taskId, hold)
  )
  mutatingApi('setHarnessTaskRunModel', async (project, taskId: string, choice: unknown) =>
    harnessService.setTaskRunModel(
      project,
      taskId,
      await validateAgentRunChoice(configStore.get(), project, choice)
    )
  )
  projectApi('getHarnessSessionTranscript', async (project, sessionId: string) => {
    const live = await openCodeRunnerService?.getLiveTranscript(sessionId)
    if (live && live.length > 0) {
      return live
    }
    return harnessService.getSessionTranscript(project, sessionId)
  })
}

/** An id the renderer sent: a non-empty string of at most 200 characters, else refused. */
function requireIpcId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value || value.length > 200) {
    throw new Error(`A ${what} is required`)
  }
  return value
}
