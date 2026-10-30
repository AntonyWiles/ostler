import { projectIpcHandlers, handleApi } from './handle-ipc'
import type {
  AIDraftSource,
  AIMasterPlanApproval,
  AIPlanTaskNode,
  AITaskSplitApproval,
  PlanningVerificationStatus,
  PlanningWorkItem,
  WatchedProject
} from '@shared/ostler-api'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { TaskSplitJobService } from '../services/task-split-job-service'
import type { HarnessService } from '../services/harness-service'
import type { PlanningService } from '../services/planning-service'
import { approvedAttachmentIds, libraryItemIds } from '../services/library-ai-parts'
import { applyTaskPlanFirst } from '../services/task-intake'
import { t } from '@shared/i18n'

export interface PlanningWorkflowHandlerDependencies {
  aiPlanningService: AIPlanningService
  taskSplitJobService: TaskSplitJobService
  harnessService: HarnessService
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  formatPlanningTaskDetails(item: PlanningWorkItem): string
  notifyHarnessState(project: WatchedProject): void
  /** Links created work items to the library items their draft was written from. */
  recordWorkItemSources(
    projectId: string,
    workItemIds: string[],
    sources: AIDraftSource[] | undefined
  ): void
  /** Attaches the library items an approved draft proposed for each task's agent, as `ostler-ai`. */
  recordWorkItemAttachments(
    projectId: string,
    entries: { workItemId: string; itemIds: string[] | undefined }[]
  ): void
}
/** Registers multi-step plan generation, blocker, and verification workflows. */
export function registerPlanningWorkflowHandlers({
  aiPlanningService,
  taskSplitJobService,
  harnessService,
  planningService,
  getProject,
  formatPlanningTaskDetails,
  notifyHarnessState,
  recordWorkItemSources,
  recordWorkItemAttachments
}: PlanningWorkflowHandlerDependencies): void {
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyHarnessState)

  projectApi('proposeAIGoalFromLibrary', (project, selectedItemIds?: string[]) =>
    aiPlanningService.proposeGoalFromLibrary(
      project.id,
      project.name,
      planningService.listGoals(project.id),
      libraryItemIds(selectedItemIds)
    )
  )
  projectApi('generateAIMasterPlan', (project, goalId: string, selectedItemIds?: string[]) => {
    const goal = planningService.getGoal(goalId)
    if (goal.projectId !== project.id) throw new Error('Planning goal belongs to another project')
    return aiPlanningService.draftMasterPlan(
      project.id,
      project.name,
      goal,
      planningService.listWorkItems(project.id),
      libraryItemIds(selectedItemIds)
    )
  })
  projectApi(
    'approveAIMasterPlan',
    (project, goalId: string, draftId: string, approval: AIMasterPlanApproval) => {
      const draft = aiPlanningService.getMasterPlanDraft(project.id, draftId)
      if (draft.goalId !== goalId) throw new Error('AI master plan draft belongs to another goal')
      const includedPhases = approval.phases.filter((phase) => phase.included)
      if (includedPhases.length === 0)
        throw new Error(t('errors:planningWorkflowHandlers.approveLeastOnePhase'))
      // Persist the approval: the split re-reads the stored draft, so without this
      // the human's edits and unchecked phases were silently ignored and the plan
      // was split from the AI's original, unapproved phase list.
      const approved = {
        ...draft,
        summary: approval.summary,
        auditFindings: approval.auditFindings,
        nonNegotiableRules: approval.nonNegotiableRules,
        phases: includedPhases.map(({ code, name, objective }) => ({ code, name, objective }))
      }
      aiPlanningService.saveMasterPlanDraft(approved)
      return approved
    }
  )
  projectApi(
    'startAITaskSplit',
    (project, goalId: string, masterPlanDraftId: string, selectedItemIds?: string[]) => {
      // The split calls the model in the background: refuse now, not later.
      aiPlanningService.assertAiAvailable(project.id)
      const masterPlan = aiPlanningService.getMasterPlanDraft(project.id, masterPlanDraftId)
      if (masterPlan.goalId !== goalId)
        throw new Error('AI master plan draft belongs to another goal')
      // Returns as soon as the job is registered; the phases run in the background.
      return taskSplitJobService.start({
        projectId: project.id,
        projectName: project.name,
        goalId,
        masterPlanDraftId,
        summary: masterPlan.summary,
        rules: masterPlan.nonNegotiableRules,
        phases: masterPlan.phases,
        selectedItemIds: libraryItemIds(selectedItemIds)
      })
    }
  )
  projectApi('getAITaskSplitJob', (project, goalId: string) =>
    taskSplitJobService.getJob(project.id, goalId)
  )
  handleApi('retryAITaskSplitPhase', async (_event, jobId: string, phaseCode: string) =>
    taskSplitJobService.retryPhase(jobId, phaseCode)
  )
  handleApi('cancelAITaskSplit', async (_event, jobId: string) => taskSplitJobService.cancel(jobId))
  projectApi('getAITaskSplitDraft', (project, draftId: string) =>
    aiPlanningService.getTaskSplitDraft(project.id, draftId)
  )
  mutatingApi(
    'createAgentPlanTasks',
    (
      project,
      goalId: string,
      taskSplitDraftId: string,
      milestoneId: string | null,
      approval: AITaskSplitApproval
    ) => {
      const projectId = project.id
      const draft = aiPlanningService.getTaskSplitDraft(projectId, taskSplitDraftId)
      if (draft.goalId !== goalId) throw new Error('AI task split draft belongs to another goal')
      const includedCodes = new Set(
        approval.nodes.filter((node) => node.included).map((node) => node.code)
      )
      const editByCode = new Map(approval.nodes.map((node) => [node.code, node]))
      const applyApproval = (node: AIPlanTaskNode): AIPlanTaskNode | null => {
        if (!includedCodes.has(node.code)) return null
        const edit = editByCode.get(node.code)
        const subtasks = node.subtasks
          .map((child) => applyApproval(child))
          .filter((child): child is AIPlanTaskNode => child !== null)
        return {
          ...node,
          title: edit?.title ?? node.title,
          context: edit?.context ?? node.context,
          task: edit?.task ?? node.task,
          constraints: edit?.constraints ?? node.constraints,
          acceptanceCriteria: edit?.acceptanceCriteria ?? node.acceptanceCriteria,
          outOfScope: edit?.outOfScope ?? node.outOfScope,
          preconditions: edit?.preconditions ?? node.preconditions,
          references: edit?.references ?? node.references,
          deliverables: edit?.deliverables ?? node.deliverables,
          // A relies-on reference to a rejected (unchecked) node is dropped, not created dangling.
          reliesOn: (edit?.reliesOn ?? node.reliesOn).filter((code) => includedCodes.has(code)),
          priority: edit?.priority ?? node.priority,
          // Only what the draft proposed, less what the human unticked.
          attachments: approvedAttachmentIds(node.attachments, edit?.attachments),
          subtasks
        }
      }
      const phases = draft.phases
        .map((phase) => ({
          code: phase.code,
          name: phase.name,
          tasks: phase.tasks
            .map((task) => applyApproval(task))
            .filter((task): task is AIPlanTaskNode => task !== null)
        }))
        .filter((phase) => phase.tasks.length > 0)
      // A replayed approval returns the earlier items; their sources stay as linked then.
      const replay = planningService.listWorkItemsFromDraft(projectId, taskSplitDraftId).length > 0
      // The approved master plan's rules travel into every task's text (D8).
      let planRules: string[] = []
      try {
        planRules = aiPlanningService.getMasterPlanDraft(
          projectId,
          draft.masterPlanDraftId
        ).nonNegotiableRules
      } catch {
        planRules = []
      }
      const created = planningService.createAgentPlanTasks(
        projectId,
        milestoneId,
        phases,
        { ...planningService.humanActor(), draftId: taskSplitDraftId },
        planRules
      )
      if (!replay) {
        recordWorkItemSources(
          projectId,
          created.map((item) => item.id),
          draft.sources
        )
        // Before queueing, so each task's text lists its attachments from the start.
        const attachmentsByCode = new Map<string, string[] | undefined>()
        const collect = (node: AIPlanTaskNode): void => {
          attachmentsByCode.set(node.code, node.attachments)
          node.subtasks.forEach(collect)
        }
        phases.forEach((phase) => phase.tasks.forEach(collect))
        recordWorkItemAttachments(
          projectId,
          created.map((item) => ({
            workItemId: item.id,
            itemIds: attachmentsByCode.get(item.taskCode)
          }))
        )
      }
      // Queue every leaf node (no children) whose dependencies are already
      // satisfied. Parent/container nodes are never queued directly.
      for (const item of created) {
        if (item.status !== 'ready' || item.linkedHarnessTaskId) continue
        if (!planningService.isWorkItemEligibleForDispatch(projectId, item.id)) continue
        try {
          const handedOff = planningService.prepareHarnessHandoff(projectId, item.id)
          const taskId = handedOff.linkedHarnessTaskId
          if (!taskId) continue
          const task = harnessService.addTask(
            project,
            handedOff.title,
            formatPlanningTaskDetails(handedOff),
            taskId,
            handedOff.priority,
            handedOff.id,
            handedOff.autoQueue
          )
          applyTaskPlanFirst(harnessService, project, handedOff, task)
        } catch (error) {
          console.error(`Failed to auto-queue agent plan task ${item.id}:`, error)
        }
      }
      return created.map((item) => planningService.getWorkItem(item.id))
    }
  )
  projectApi('listOpenBlockers', (project) => planningService.listOpenBlockers(project.id))
  handleApi(
    'reportBlocker',
    async (_event, workItemId: string, description: string, resolutionOptions: string[]) => {
      return planningService.reportBlocker(workItemId, description, 'human', resolutionOptions)
    }
  )
  handleApi('resolveBlocker', async (_event, blockerId: string, choice: string, note: string) => {
    const blocker = planningService.resolveBlocker(blockerId, choice, note, 'human')
    const item = planningService.getWorkItem(blocker.workItemId)
    try {
      notifyHarnessState(getProject(item.projectId))
    } catch {
      // Project may not have active harness monitoring; dispatch still
      // gets picked up on the next poll tick.
    }
    return blocker
  })
  handleApi('reviewTaskStatus', async (_event, projectId: string, workItemIds: string[]) => {
    const project = getProject(projectId)
    // The AI gate before any evidence is gathered.
    aiPlanningService.assertAiAvailable(projectId)
    if (!Array.isArray(workItemIds) || workItemIds.length === 0) {
      throw new Error(t('errors:planningWorkflowHandlers.chooseLeastOneTask'))
    }
    const items = workItemIds.slice(0, 20).map((workItemId) => {
      const item = planningService.getWorkItem(workItemId)
      if (item.projectId !== projectId) throw new Error('That task belongs to a different project.')
      let sessionEvidence = ''
      if (item.linkedHarnessTaskId) {
        const task = harnessService
          .getState(project)
          .taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
        const sessionId = task?.claimedBy
        if (sessionId) {
          try {
            sessionEvidence = harnessService
              .getSessionTranscript(project, sessionId)
              .map((entry) => `[${entry.role}] ${entry.content}`)
              .join('\n')
              .slice(0, 12000)
          } catch {
            sessionEvidence = ''
          }
        }
      }
      const blockers = planningService
        .listBlockersForWorkItem(workItemId)
        .map((blocker) => `${blocker.status}: ${blocker.description}`)
      return {
        workItemId: item.id,
        title: item.title,
        status: item.status,
        verificationStatus: item.verificationStatus,
        sessionEvidence,
        blockers
      }
    })
    return await aiPlanningService.reviewTaskStatus(projectId, items)
  })
  handleApi(
    'acceptTaskStatusReview',
    async (
      _event,
      workItemId: string,
      verificationStatus: PlanningVerificationStatus,
      verificationNotes: string
    ) => {
      return planningService.updateVerification(
        workItemId,
        {
          verificationStatus,
          verifiedBy: 'ai-review',
          verificationNotes
        },
        planningService.humanActor()
      )
    }
  )
}
