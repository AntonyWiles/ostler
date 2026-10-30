import {
  API_CHANNELS,
  type ApiInvokeMethod,
  type ApiProjectArgs,
  type ApiValue
} from '@shared/ostler-api/api-channels'
import type { QueueWorkItemForHarness } from '../services/task-intake'
import { handleIpc, projectIpcHandlers, handleApi } from './handle-ipc'
import { copyPromptWithSecrets } from './agent-prompt-handlers'
import { syncAgentWorkItemStatus } from '../services/agent-status-sync'
import { updateWorkItemThroughQueue } from '../services/queue-exit'
import { buildHarnessSessionPrompt } from '@shared/agent-prompts'
import { projectFolder } from '@shared/project-folder'
import { agentColumnsLocked } from '@shared/board-columns'
import { Refusal } from '@shared/refusal'
import { clipForModel, perRecordBudget } from '@shared/ai-evidence'
import { milestoneHealth, milestoneOverdue } from '@shared/planning/health'
import { todayIsoDate } from '@shared/dates'
import { taskTypeOf, typeShowsField } from '@shared/task-type-fields'
import type {
  UpdatePlanningColumnSettingsInput,
  PlanningChecklistDetailInput,
  AIDecisionApproval,
  AIDraftSource,
  AINextTaskApproval,
  AIPlanningSuggestionApproval,
  CreatePlanningDecisionInput,
  CreatePlanningGoalInput,
  CreatePlanningMilestoneInput,
  CreatePlanningIterationInput,
  CreatePlanningSubprojectInput,
  UpdatePlanningSubprojectInput,
  CreatePlanningTaskTypeInput,
  PlanningTaskTypeDeletion,
  UpdatePlanningTaskTypeInput,
  CreatePlanningRuleInput,
  PlanningRuleDeletion,
  UpdatePlanningRuleInput,
  PlanningIterationCarryOver,
  PlanningIterationDeletion,
  UpdatePlanningIterationInput,
  CreatePlanningWorkItemInput,
  PlanningHarnessHandoff,
  PlanningLabelDeletion,
  CreatePlanningFieldInput,
  PlanningFieldDeletion,
  AiFieldFillInput,
  AiFieldFillUndo,
  UpdatePlanningFieldInput,
  ActivityQuery,
  PlanningComment,
  PlanningWorkItemScope,
  PlanningWorkItemStatus,
  UpdatePlanningDecisionInput,
  UpdatePlanningGoalInput,
  UpdatePlanningMilestoneInput,
  UpdatePlanningWorkItemInput,
  PlanningWorkItemPlacement,
  RunPlaybookInput,
  WorkItemAttachment,
  SaveTaskTemplateFromWorkItemInput,
  TaskTemplateDeletion,
  TaskTemplateOverrides,
  UpdateTaskTemplateInput,
  WatchedProject
} from '@shared/ostler-api'
import type { ConfigStore } from '../config-store'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { EventDatabase } from '../services/event-database'
import type { GitReaderService } from '../services/git-reader'
import type { HarnessService } from '../services/harness-service'
import type { PlanningService } from '../services/planning-service'
import { batchRowsFrom, checkWorkItemBatch, createWorkItemBatch } from '../services/planning-batch'
import { approvedAttachmentIds, libraryItemIds } from '../services/library-ai-parts'
import {
  archiveWorkItem,
  closeAsWontDo,
  markAsDuplicate,
  deleteWorkItem,
  deleteWorkItemForever,
  wontDoOptions
} from '../services/planning-deletion'
import { buildReadinessReport } from '../../src/shared/planning-readiness'
import { t } from '@shared/i18n'
import { validateAgentRunChoice } from '../services/agent-run-model'
import { checkTemplateBodyAgent, runPlaybook, validatePlaybookAgent } from '../services/playbooks'
import { queryLiveLists } from '../services/live-lists'
export interface PlanningHandlerDependencies {
  configStore: ConfigStore
  database: EventDatabase
  aiPlanningService: AIPlanningService
  gitReader: GitReaderService
  harnessService: HarnessService
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  queueWorkItemForHarness: QueueWorkItemForHarness
  /** A work item's agent-visible attachments, as every queue path lists them. */
  agentAttachmentsFor?(projectId: string, workItemId: string): WorkItemAttachment[]
  notifyHarnessState(project: WatchedProject): void
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'planning': the Board reloads. */
  notifyPlanningChanged(project: WatchedProject): void
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
/** Registers planning CRUD, planning AI, readiness, and agent-handoff IPC. */
export function registerPlanningHandlers({
  configStore,
  database,
  aiPlanningService,
  gitReader,
  harnessService,
  planningService,
  getProject,
  queueWorkItemForHarness,
  agentAttachmentsFor,
  notifyHarnessState,
  notifyPlanningChanged,
  recordWorkItemSources,
  recordWorkItemAttachments
}: PlanningHandlerDependencies): void {
  // Resolving the project is the access check on every one of these channels,
  // so it is done by the wrapper rather than left to each handler to remember.
  const { projectApi, mutatingApi } = projectIpcHandlers(getProject, notifyHarnessState)
  // Every change made from the desktop app is the human's, and the human is Me (P5.2).
  const human = () => planningService.humanActor()
  // A record's project, through getProject, so finding it is also the access check.
  const workItemProject = (workItemId: string) =>
    getProject(planningService.getWorkItem(workItemId).projectId)
  const goalProject = (goalId: string) => getProject(planningService.getGoal(goalId).projectId)
  const commentProject = (commentId: string) =>
    getProject(planningService.getComment(commentId).projectId)

  projectApi('getPlanningGoals', (project) => planningService.listGoals(project.id))
  projectApi('createPlanningGoal', (project, input: CreatePlanningGoalInput) =>
    planningService.createGoal(project.id, input)
  )
  handleApi(
    'updatePlanningGoal',
    async (_event, goalId: string, updates: UpdatePlanningGoalInput) => {
      return planningService.updateGoal(goalId, updates)
    }
  )
  handleApi('deletePlanningGoal', async (_event, goalId: string) => {
    goalProject(goalId)
    planningService.deleteGoal(goalId)
    return undefined
  })
  projectApi('getPlanningMilestones', (project) => planningService.listMilestones(project.id))
  projectApi('createPlanningMilestone', (project, input: CreatePlanningMilestoneInput) =>
    planningService.createMilestone(project.id, input)
  )
  handleApi(
    'updatePlanningMilestone',
    async (_event, milestoneId: string, updates: UpdatePlanningMilestoneInput) => {
      return planningService.updateMilestone(milestoneId, updates)
    }
  )
  handleApi(
    'deletePlanningMilestone',
    async (_event, milestoneId: string, options?: { detachTasks?: boolean }) => {
      // deleteMilestone resolves the milestone and checks its project is still
      // registered. Archived tasks are left without it; live ones too once
      // the person confirmed (`detachTasks`), else it refuses.
      planningService.deleteMilestone(milestoneId, { detachTasks: options?.detachTasks === true })
      return undefined
    }
  )
  // Repeating rounds (N5.7a): the service resolves the milestone and checks its project.
  handleApi('setMilestoneRepeat', async (_event, milestoneId: string, input: unknown) =>
    input === null
      ? planningService.rounds.stopRepeating(milestoneId)
      : planningService.rounds.setRepeat(milestoneId, input)
  )
  handleApi('previewMilestoneRound', async (_event, milestoneId: string, input: unknown) =>
    planningService.rounds.preview(milestoneId, input)
  )
  handleApi('startNextMilestoneRound', async (_event, milestoneId: string) =>
    planningService.rounds.startNextRound(milestoneId, human())
  )
  // Iterations (R6.1): the service resolves each id and checks its project.
  projectApi('getPlanningIterations', (project) => planningService.iterations.list(project.id))
  projectApi('createPlanningIteration', (project, input: CreatePlanningIterationInput) =>
    planningService.iterations.create(project.id, input)
  )
  handleApi(
    'updatePlanningIteration',
    (_event, iterationId: string, updates: UpdatePlanningIterationInput) =>
      planningService.iterations.update(iterationId, updates)
  )
  handleApi('startPlanningIteration', (_event, iterationId: string) =>
    planningService.iterations.start(iterationId)
  )
  handleApi(
    'finishPlanningIteration',
    (_event, iterationId: string, carryOver: PlanningIterationCarryOver) =>
      planningService.iterations.finish(iterationId, carryOver, planningService.humanActor())
  )
  handleApi('deletePlanningIteration', (_event, iterationId: string) =>
    planningService.iterations.delete(iterationId)
  )
  handleApi('restorePlanningIteration', (_event, deletion: PlanningIterationDeletion) =>
    planningService.iterations.restore(deletion)
  )
  // Task types (N2.7a): the service resolves each id and checks its project.
  projectApi('getPlanningTaskTypes', (project) => planningService.taskTypes.list(project.id))
  projectApi('createPlanningTaskType', (project, input: CreatePlanningTaskTypeInput) =>
    planningService.taskTypes.create(project.id, input)
  )
  handleApi(
    'updatePlanningTaskType',
    (_event, typeId: string, updates: UpdatePlanningTaskTypeInput) =>
      planningService.taskTypes.update(typeId, updates)
  )
  projectApi('reorderPlanningTaskTypes', (project, typeIds: string[]) =>
    planningService.taskTypes.reorder(project.id, typeIds)
  )
  handleApi('deletePlanningTaskType', (_event, typeId: string) =>
    planningService.taskTypes.delete(typeId)
  )
  handleApi('restorePlanningTaskType', (_event, deletion: PlanningTaskTypeDeletion) =>
    planningService.taskTypes.restore(deletion)
  )
  // Workstreams (sub-projects): the service resolves each id and checks its project.
  projectApi('listSubprojects', (project) => planningService.subprojects.list(project.id))
  projectApi('createSubproject', (project, input: CreatePlanningSubprojectInput) =>
    planningService.subprojects.create(project.id, {
      ...input,
      color: input?.color ?? project.color
    })
  )
  handleApi('updateSubproject', (_event, id: string, input: UpdatePlanningSubprojectInput) =>
    planningService.subprojects.update(id, input)
  )
  handleApi('moveSubproject', (_event, id: string, direction: -1 | 1) =>
    planningService.subprojects.move(id, direction)
  )
  handleApi('archiveSubproject', (_event, id: string, archived: boolean) =>
    planningService.subprojects.archive(id, archived)
  )
  handleApi('deleteSubproject', (_event, id: string) => planningService.subprojects.delete(id))
  // Rules (R6.2): the service resolves each id and checks its project.
  projectApi('getPlanningRules', (project) => planningService.rules.list(project.id))
  projectApi('createPlanningRule', (project, input: CreatePlanningRuleInput) =>
    planningService.rules.create(project.id, input)
  )
  handleApi('updatePlanningRule', (_event, ruleId: string, updates: UpdatePlanningRuleInput) =>
    planningService.rules.update(ruleId, updates)
  )
  handleApi('deletePlanningRule', (_event, ruleId: string) => planningService.rules.delete(ruleId))
  handleApi('restorePlanningRule', (_event, deletion: PlanningRuleDeletion) =>
    planningService.rules.restore(deletion)
  )
  projectApi(
    'previewPlanningRule',
    (project, rule: Pick<CreatePlanningRuleInput, 'conditions' | 'actions'>, workItemId: string) =>
      planningService.rules.preview(project.id, rule, workItemId)
  )
  // The views get the planned tasks: a task in To triage counts nowhere (N4.3a).
  projectApi('getPlanningWorkItems', (project, scope?: PlanningWorkItemScope) =>
    planningService.listWorkItems(
      project.id,
      scope === 'archived' || scope === 'deleted' || scope === 'triage' ? scope : 'planned'
    )
  )
  handleApi('getPlanningWorkItemMetrics', async (_event, workItemId: string) => {
    return planningService.getWorkItemMetrics(workItemId)
  })
  projectApi('getWorkItemCommits', (project, workItemId: string) =>
    planningService.commitLinks.listForWorkItem(project.id, workItemId)
  )
  projectApi('getPlanningProjectWorkItemMetrics', (project) =>
    planningService.getProjectWorkItemMetrics(project.id)
  )
  handleApi('getPlanningStatusTransitions', async (_event, workItemId: string) => {
    return planningService.listStatusTransitions(workItemId)
  })
  projectApi('getPlanningLatestStatusChanges', (project) =>
    planningService.latestStatusChanges(project.id)
  )
  handleApi('getPlanningMilestoneMetrics', async (_event, milestoneId: string) => {
    return planningService.getMilestoneMetrics(milestoneId)
  })
  handleApi('getPlanningReadiness', async (_event, milestoneId: string) => {
    const milestone = configStore
      .get()
      .projects.flatMap((project) => planningService.listMilestones(project.id))
      .find((candidate) => candidate.id === milestoneId)
    if (!milestone) throw new Error(t('errors:planningHandlers.milestoneWasNotFound'))
    const items = planningService
      .listWorkItems(milestone.projectId)
      .filter((item) => item.milestoneId === milestoneId)
    const harness = harnessService.getState(getProject(milestone.projectId))
    const git = await gitReader.getState(
      milestone.projectId,
      projectFolder(getProject(milestone.projectId)),
      configStore.get().git.maxCommitsToFetch
    )
    const metrics = new Map(
      items.map((item) => [item.id, planningService.getWorkItemMetrics(item.id)])
    )
    return buildReadinessReport(milestoneId, {
      items,
      metrics,
      reviewCount: harness.reviewSessions.length,
      pendingQuestionCount: harness.questions.filter((question) => question.status === 'pending')
        .length,
      gitDirty:
        git.workingTreeStatus.modified +
          git.workingTreeStatus.untracked +
          git.workingTreeStatus.staged >
        0,
      gitConflicted: git.workingTreeStatus.conflicted
    })
  })
  projectApi('getPlanningProjectMetrics', (project) =>
    planningService.getProjectMetrics(project.id)
  )
  // Quick add and other surfaces create tasks outside the Board, so tell it.
  projectApi('createPlanningWorkItem', (project, input: CreatePlanningWorkItemInput) => {
    const workItem = planningService.createWorkItem(project.id, input, human())
    notifyPlanningChanged(project)
    return workItem
  })
  // Task templates (N2.1): the service checks every id, scope and body.
  const templates = planningService.taskTemplates
  projectApi('getTaskTemplates', (project) => templates.listForProject(project.id))
  handleApi('getAllTaskTemplates', () => templates.listAll())
  // A playbook's model and effort (N9.6b) are checked as Settings checks them.
  const scopeProject = (projectId: string | null) =>
    projectId === null ? null : getProject(projectId)
  handleApi(
    'saveTaskTemplateFromWorkItem',
    async (_event, workItemId: string, input: SaveTaskTemplateFromWorkItemInput) => {
      if (input?.agent !== undefined) {
        const item = planningService.getWorkItem(workItemId)
        await validatePlaybookAgent(
          configStore.get(),
          input.scope === 'every' ? null : getProject(item.projectId),
          input.agent
        )
      }
      return templates.saveFromWorkItem(workItemId, input)
    }
  )
  handleApi(
    'updateTaskTemplate',
    async (_event, templateId: string, updates: UpdateTaskTemplateInput) => {
      if (updates?.body !== undefined) {
        const scope =
          updates.projectId === undefined ? templates.get(templateId).projectId : updates.projectId
        await checkTemplateBodyAgent(
          () => configStore.get(),
          typeof scope === 'string' ? scopeProject(scope) : null,
          updates.body
        )
      }
      return templates.update(templateId, updates)
    }
  )
  handleApi('deleteTaskTemplate', (_event, templateId: string) => templates.delete(templateId))
  handleApi('restoreTaskTemplate', (_event, deletion: TaskTemplateDeletion) =>
    templates.restore(deletion)
  )
  projectApi(
    'useTaskTemplate',
    (project, templateId: string, overrides?: TaskTemplateOverrides) => {
      const made = templates.use(project.id, templateId, human(), overrides ?? {})
      notifyPlanningChanged(project)
      return made
    }
  )
  // Run playbook (N9.6b): makes the task and queues it, through N2.1's function and the queue path.
  mutatingApi('runPlaybook', async (project, templateId: string, input?: RunPlaybookInput) => {
    const run = await runPlaybook(
      {
        config: configStore.get(),
        planning: planningService,
        harness: harnessService,
        actor: human(),
        attachmentsFor: agentAttachmentsFor
      },
      project,
      templateId,
      input ?? {}
    )
    notifyPlanningChanged(project)
    return run
  })
  // A whole plan from the plan grid: one transaction, refused as a whole.
  projectApi('createPlanningWorkItemBatch', (project, rows: unknown) => {
    const workItems = createWorkItemBatch(planningService, project.id, batchRowsFrom(rows), human())
    notifyPlanningChanged(project)
    return workItems
  })
  projectApi('checkPlanningWorkItemBatch', (project, rows: unknown) =>
    checkWorkItemBatch(planningService, project.id, batchRowsFrom(rows), human())
  )
  handleApi(
    'updatePlanningWorkItem',
    async (_event, workItemId: string, updates: UpdatePlanningWorkItemInput) => {
      const linkedBefore = planningService.getWorkItem(workItemId).linkedHarnessTaskId
      // A queued task's move out of Ready or into Someday goes through the queue.
      const workItem = linkedBefore
        ? updateWorkItemThroughQueue(
            planningService,
            harnessService,
            workItemProject(workItemId),
            workItemId,
            updates,
            human()
          )
        : planningService.updateWorkItem(workItemId, updates, human())
      if (linkedBefore && (updates.status !== undefined || workItem.leftQueue))
        notifyHarnessState(getProject(workItem.projectId))
      if (updates.priority && workItem.linkedHarnessTaskId) {
        const project = getProject(workItem.projectId)
        const linkedTask = harnessService
          .getState(project)
          .taskQueue.find((task) => task.id === workItem.linkedHarnessTaskId)
        if (linkedTask && linkedTask.status !== 'cancelled') {
          harnessService.setTaskPriority(project, linkedTask.id, updates.priority, workItem.id)
          notifyHarnessState(project)
        }
      }
      // Eagerly re-evaluate the dispatch queue instead of waiting for the next
      // poll tick — a status flip to 'done' may unblock other plan tasks now.
      if (updates.status === 'done') {
        try {
          notifyHarnessState(getProject(workItem.projectId))
        } catch {
          // Project may not have active harness monitoring; dispatch still
          // gets picked up on the next poll tick.
        }
      }
      return workItem
    }
  )
  // A drop on the Board or List, or Alt and an arrow key: one row written (D31).
  handleApi(
    'movePlanningWorkItem',
    async (_event, workItemId: string, placement: PlanningWorkItemPlacement) => {
      if (typeof workItemId !== 'string' || !placement || typeof placement !== 'object')
        throw new Refusal('A task and where it goes are required')
      const current = planningService.getWorkItem(workItemId)
      const { status, ...place } = placement
      // A move to another column is a status change: through the queue's rule.
      const workItem =
        current.linkedHarnessTaskId && status !== undefined
          ? updateWorkItemThroughQueue(
              planningService,
              harnessService,
              getProject(current.projectId),
              workItemId,
              { status },
              human(),
              (updates) =>
                planningService.moveWorkItemInOrder(
                  workItemId,
                  { ...place, ...(updates.status !== undefined ? { status: updates.status } : {}) },
                  human()
                )
            )
          : planningService.moveWorkItemInOrder(workItemId, placement, human())
      if (current.linkedHarnessTaskId && status !== undefined)
        notifyHarnessState(getProject(workItem.projectId))
      if (placement.status === 'done') {
        try {
          notifyHarnessState(getProject(workItem.projectId))
        } catch {
          // As for an update: dispatch picks it up on the next poll tick.
        }
      }
      return workItem
    }
  )
  handleApi('deletePlanningWorkItem', async (_event, workItemId: string) => {
    const project = workItemProject(workItemId)
    const { clearedHandoff } = deleteWorkItem(
      planningService,
      harnessService,
      project,
      workItemId,
      human()
    )
    if (clearedHandoff) notifyHarnessState(project)
    return undefined
  })
  handleApi(
    'setPlanningChecklistItemChecked',
    async (_event, workItemId: string, criterionText: string, checked: boolean) => {
      workItemProject(workItemId)
      return planningService.setChecklistItemChecked(workItemId, criterionText, checked, human())
    }
  )
  handleApi(
    'setPlanningChecklistItemDetails',
    async (
      _event,
      workItemId: string,
      criterionText: string,
      details: PlanningChecklistDetailInput
    ) => {
      workItemProject(workItemId)
      return planningService.setChecklistItemDetails(workItemId, criterionText, details, human())
    }
  )
  handleApi(
    'renamePlanningChecklistItem',
    async (_event, workItemId: string, from: string, to: string) => {
      workItemProject(workItemId)
      return planningService.renameChecklistItem(workItemId, from, to, human())
    }
  )
  projectApi('getPlanningLabels', (project) => planningService.listProjectLabels(project.id))
  // Label changes reach tasks the Board may be showing, so each one tells it.
  const labelIpc = <M extends ApiInvokeMethod>(
    method: M,
    handler: (project: WatchedProject, ...args: ApiProjectArgs<M>) => ApiValue<M>
  ) =>
    projectApi(method, (project, ...args) => {
      const value = handler(project, ...args)
      notifyPlanningChanged(project)
      return value
    })
  labelIpc('setPlanningLabelColor', (project, name: string, color: string) =>
    planningService.setLabelColor(project.id, name, color)
  )
  labelIpc('renamePlanningLabel', (project, from: string, to: string) =>
    planningService.renameLabel(project.id, from, to, human())
  )
  labelIpc('deletePlanningLabel', (project, name: string) =>
    planningService.deleteLabel(project.id, name, human())
  )
  labelIpc('restorePlanningLabel', (project, deletion: PlanningLabelDeletion) =>
    planningService.restoreLabel(project.id, deletion, human())
  )
  // Custom fields (R2.2): a change reaches every task view, so each one tells it.
  projectApi('getPlanningFields', (project) => planningService.listFields(project.id))
  labelIpc('createPlanningField', (project, input: CreatePlanningFieldInput) =>
    planningService.createField(project.id, input)
  )
  labelIpc('updatePlanningField', (project, fieldId: string, input: UpdatePlanningFieldInput) =>
    planningService.updateField(project.id, fieldId, input)
  )
  labelIpc('reorderPlanningFields', (project, fieldIds: string[]) =>
    planningService.reorderFields(project.id, fieldIds)
  )
  labelIpc('deletePlanningField', (project, fieldId: string) =>
    planningService.deleteField(project.id, fieldId)
  )
  labelIpc('restorePlanningField', (project, deletion: PlanningFieldDeletion) =>
    planningService.restoreField(project.id, deletion)
  )
  // AI fields (N8.4, N58 choice A). Suggest passes the AI gate first and
  // saves nothing; the field and task are read after it. Apply is the
  // person's Fill with AI: it saves the suggestions and makes no AI call.
  projectApi('suggestAiFieldValue', (project, workItemId: unknown, fieldId: unknown) =>
    aiPlanningService.suggestAiFieldValue(project.id, () => {
      if (typeof workItemId !== 'string' || typeof fieldId !== 'string')
        throw new Error('Send a task id and a field id')
      const item = planningService.getWorkItem(workItemId)
      if (item.projectId !== project.id)
        throw new Error('That task belongs to a different project.')
      const field = planningService.getField(project.id, fieldId)
      const type = taskTypeOf(planningService.taskTypes.list(project.id), item.typeId)
      if (!typeShowsField(type, field.id))
        throw new Error(t('errors:aiFields.hiddenByType', { name: field.name }))
      return { field, item }
    })
  )
  labelIpc(
    'applyAiFieldFills',
    (project, fieldId: string, fills: AiFieldFillInput[], options?: unknown) =>
      planningService.applyAiFieldFills(project.id, fieldId, fills, {
        replacePersonValues:
          (options as { replacePersonValues?: unknown } | undefined)?.replacePersonValues === true
      })
  )
  labelIpc('restoreAiFieldFills', (project, undo: AiFieldFillUndo) =>
    planningService.restoreAiFieldFills(project.id, undo)
  )
  handleApi('archivePlanningWorkItem', async (_event, workItemId: string) =>
    archiveWorkItem(
      planningService,
      harnessService,
      workItemProject(workItemId),
      workItemId,
      human()
    )
  )
  handleApi(
    'closePlanningWorkItemAsWontDo',
    async (_event, workItemId: string, options: unknown) => {
      const project = workItemProject(workItemId)
      const result = closeAsWontDo(
        planningService,
        harnessService,
        project,
        workItemId,
        human(),
        wontDoOptions(options)
      )
      if (result.cancelledTask) notifyHarnessState(project)
      return result
    }
  )
  handleApi('unarchivePlanningWorkItem', async (_event, workItemId: string) => {
    workItemProject(workItemId)
    return planningService.unarchiveWorkItem(workItemId, human())
  })
  handleApi('restorePlanningWorkItem', async (_event, workItemId: string) => {
    workItemProject(workItemId)
    return planningService.restoreWorkItem(workItemId, human())
  })
  handleApi('deletePlanningWorkItemForever', async (_event, workItemId: string) => {
    deleteWorkItemForever(planningService, workItemProject(workItemId), workItemId, human())
    return undefined
  })
  // ─── Description history (N2.6) ───
  handleApi('getPlanningDescriptionVersions', async (_event, workItemId: string) => {
    workItemProject(workItemId)
    return planningService.listDescriptionVersions(workItemId)
  })
  handleApi(
    'restorePlanningDescriptionVersion',
    async (_event, workItemId: string, versionId: unknown) => {
      workItemProject(workItemId)
      return planningService.restoreDescriptionVersion(workItemId, versionId, human())
    }
  )
  // ─── Links in texts and backlinks (N4.4a) ───
  handleApi('resolveItemLinks', async (_event, refs: unknown) =>
    planningService.resolveItemLinks(refs)
  )
  handleApi('getLinkedFrom', async (_event, kind: unknown, id: unknown) =>
    planningService.listLinkedFrom(kind, id)
  )
  // ─── Live lists in notes (N4.4c) ───
  projectApi('queryLiveLists', (project, blocks: unknown) =>
    queryLiveLists(planningService, project.id, blocks, harnessService.getState(project))
  )
  // ─── Links between tasks (N2.4) ───
  handleApi('getPlanningWorkItemLinks', async (_event, workItemId: string) => {
    workItemProject(workItemId)
    return planningService.listWorkItemLinks(workItemId)
  })
  handleApi(
    'addPlanningWorkItemLink',
    async (_event, workItemId: string, toWorkItemId: unknown, kind: unknown) => {
      workItemProject(workItemId)
      return planningService.addWorkItemLink(workItemId, toWorkItemId, kind, human())
    }
  )
  handleApi('removePlanningWorkItemLink', async (_event, workItemId: string, linkId: unknown) => {
    workItemProject(workItemId)
    planningService.removeWorkItemLink(workItemId, linkId, human())
    return undefined
  })
  handleApi(
    'markPlanningWorkItemDuplicate',
    async (_event, workItemId: string, originalId: unknown) => {
      const project = workItemProject(workItemId)
      const result = markAsDuplicate(
        planningService,
        harnessService,
        project,
        workItemId,
        originalId,
        human()
      )
      if (result.cancelledTask) notifyHarnessState(project)
      return result
    }
  )
  handleApi('copyPlanningWorkItem', async (_event, workItemId: string) => {
    workItemProject(workItemId)
    return planningService.copyWorkItem(workItemId, human())
  })
  // ─── Comments and activity (P5.2) ───
  projectApi('getPlanningActivity', (project, workItemId: string, query?: ActivityQuery) =>
    planningService.listActivity(project.id, workItemId, query ?? {})
  )
  projectApi('getPlanningProjectActivity', (project, query?: ActivityQuery) =>
    planningService.listProjectActivity(project.id, query ?? {})
  )
  projectApi('getPlanningCommentCounts', (project) => planningService.commentCounts(project.id))
  // A comment changes a card's count, so each write tells the Board.
  const commentIpc = (
    method:
      | 'addPlanningComment'
      | 'updatePlanningComment'
      | 'deletePlanningComment'
      | 'pinPlanningComment'
      | 'restorePlanningComment',
    write: (id: string, body: string) => PlanningComment,
    projectOf: (id: string) => WatchedProject
  ) =>
    handleIpc(API_CHANNELS[method], async (_event, id: string, body: string) => {
      const project = projectOf(id)
      const comment = write(id, body)
      notifyPlanningChanged(project)
      return comment
    })
  commentIpc(
    'addPlanningComment',
    (workItemId, body) => planningService.addComment(workItemId, body, human()),
    workItemProject
  )
  commentIpc(
    'updatePlanningComment',
    (commentId, body) => planningService.updateComment(commentId, body, human()),
    commentProject
  )
  commentIpc(
    'deletePlanningComment',
    (commentId) => planningService.deleteComment(commentId, human()),
    commentProject
  )
  commentIpc(
    'pinPlanningComment',
    (commentId, pinned) =>
      planningService.pinComment(commentId, (pinned as unknown) === true, human()),
    commentProject
  )
  commentIpc(
    'restorePlanningComment',
    (commentId) => planningService.restoreComment(commentId, human()),
    commentProject
  )
  projectApi('getPlanningDecisions', (project) => planningService.listDecisions(project.id))
  projectApi('createPlanningDecision', (project, input: CreatePlanningDecisionInput) =>
    planningService.createDecision(project.id, input)
  )
  handleApi(
    'updatePlanningDecision',
    async (_event, decisionId: string, updates: UpdatePlanningDecisionInput) => {
      return planningService.updateDecision(decisionId, updates)
    }
  )
  handleApi('deletePlanningDecision', async (_event, decisionId: string) => {
    planningService.deleteDecision(decisionId)
    return undefined
  })
  projectApi('getPlanningWipLimits', (project) => planningService.getWipLimits(project.id))
  projectApi(
    'setPlanningWipLimit',
    (project, status: PlanningWorkItemStatus, limit: number | null) =>
      planningService.setWipLimit(project.id, status, limit)
  )
  handleApi('getPlanningColumnSettings', () => planningService.columns.all())
  projectApi('updatePlanningColumnSettings', (project, change: UpdatePlanningColumnSettingsInput) =>
    planningService.columns.update(project.id, change, {
      agentsLocked: agentColumnsLocked(
        configStore.get().harness.enabled,
        projectFolder(project) !== null
      )
    })
  )
  mutatingApi('queuePlanningWorkItem', async (project, workItemId: string, runChoice?: unknown) =>
    // Queuing is not starting: work joins the queue now and every claim path
    // re-checks its dependencies before an agent is given it. A model chosen
    // for this run is checked as the automation API checks it (D42).
    queueWorkItemForHarness(project, workItemId, {
      allowUnmetDependencies: true,
      ...(runChoice !== undefined && runChoice !== null
        ? { runChoice: await validateAgentRunChoice(configStore.get(), project, runChoice) }
        : {})
    })
  )
  mutatingApi('queuePlanningWorkItems', (project, workItemIds: string[]) => {
    const projectId = project.id
    const requested = Array.isArray(workItemIds) ? [...new Set(workItemIds)] : []
    // Everything Ready is queued now, including work whose dependencies are
    // still open: the queue is the waiting room. Ordering it dependencies
    // first means the release order is already correct, and every claim path
    // re-checks eligibility, so nothing starts early.
    const ordered = planningService.orderWorkItemsForQueue(projectId, requested)
    const orderedIds = new Set(ordered.map((item) => item.id))
    const queued: PlanningHarnessHandoff[] = []
    const skipped: { workItemId: string; title: string; reason: string }[] = []
    for (const item of ordered) {
      try {
        queued.push(queueWorkItemForHarness(project, item.id, { allowUnmetDependencies: true }))
      } catch (error) {
        skipped.push({
          workItemId: item.id,
          title: item.title,
          reason:
            error instanceof Error ? error.message : t('errors:planningHandlers.couldNotQueued')
        })
      }
    }
    for (const workItemId of requested) {
      if (orderedIds.has(workItemId)) continue
      try {
        const item = planningService.getWorkItem(workItemId)
        if (item.projectId !== projectId) continue
        if (item.linkedHarnessTaskId) continue
        skipped.push({
          workItemId,
          title: item.title,
          reason: t('errors:planningHandlers.onlyReadyWorkCan')
        })
      } catch {
        // A work item that vanished between selection and queueing is not
        // worth reporting as a failure.
      }
    }
    return { queued, skipped }
  })
  // Copy for an external agent (§2.3): claims the task for a new session in
  // the task's copy, and copies that session's own password. Built and copied
  // here so the password never reaches the renderer.
  handleApi('copyPlanningAgentHandoff', async (_event, projectId: string, workItemId: string) => {
    const project = getProject(projectId)
    const item = planningService.getWorkItem(workItemId)
    if (item.projectId !== projectId) throw new Error('That task belongs to a different project.')
    if (!item.linkedHarnessTaskId)
      throw new Error(t('errors:planningHandlers.queueTaskAgentBefore'))
    const task = harnessService
      .getState(project)
      .taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
    if (!task || task.status === 'cancelled')
      throw new Error(t('errors:planningHandlers.agentRunTaskNo'))
    if (task.status !== 'pending' || task.claimedBy)
      throw new Error(t('errors:planningHandlers.linkedTaskHasAlready'))
    const session = await harnessService.startSessionForTask(project, task.id)
    syncAgentWorkItemStatus(planningService, projectId, task.id, 'active')
    notifyHarnessState(project)
    notifyPlanningChanged(project)
    const prompt = buildHarnessSessionPrompt(configStore.get().harness.port, project.id, session, {
      title: task.title,
      details: task.details ?? null
    })
    return copyPromptWithSecrets(prompt, [session.token])
  })
  projectApi('breakDownPlanningGoal', (project, goalId: string, selectedItemIds?: string[]) => {
    const goal = planningService.getGoal(goalId)
    if (goal.projectId !== project.id) throw new Error('Planning goal belongs to another project')
    return aiPlanningService.breakDownGoal(
      project.id,
      project.name,
      goal,
      planningService.listWorkItems(project.id),
      libraryItemIds(selectedItemIds)
    )
  })
  // The work item drawer's AI re-draft. Its handler went missing with the
  // AI Review removal; the drawer and preload still call it.
  handleApi(
    'improvePlanningWorkItem',
    async (_event, projectId: string, workItemId: string, selectedItemIds?: string[]) => {
      const project = getProject(projectId)
      const item = planningService.getWorkItem(workItemId)
      if (item.projectId !== projectId) {
        throw new Error('That task belongs to a different project.')
      }
      return await aiPlanningService.improveWorkItem(
        projectId,
        project.name,
        item,
        planningService.listWorkItems(projectId),
        libraryItemIds(selectedItemIds)
      )
    }
  )
  handleApi(
    'approveAIPlanningDraft',
    async (
      _event,
      projectId: string,
      goalId: string,
      suggestions: AIPlanningSuggestionApproval[]
    ) => {
      getProject(projectId)
      const goal = planningService.getGoal(goalId)
      if (goal.projectId !== projectId) throw new Error('Planning goal belongs to another project')
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error(t('errors:planningHandlers.selectLeastOneAi'))
      }
      const draft = aiPlanningService.getDraft(projectId, goalId)
      const indices = suggestions.map((suggestion) => suggestion.suggestionIndex)
      if (
        indices.length > draft.suggestions.length ||
        new Set(indices).size !== indices.length ||
        indices.some(
          (index) => !Number.isInteger(index) || index < 0 || index >= draft.suggestions.length
        )
      ) {
        throw new Error('Invalid AI planning suggestion selection')
      }
      const created = planningService.createAIApprovedWorkItems(
        projectId,
        suggestions.map((suggestion) => {
          return {
            title: suggestion.title,
            description: suggestion.description,
            priority: suggestion.priority,
            acceptanceCriteria: suggestion.acceptanceCriteria,
            labels: ['ai-draft']
          }
        }),
        // The human approved it; the draft is named in the change's metadata.
        { ...human(), draftId: `${goalId}:${draft.generatedAt}` }
      )
      recordWorkItemSources(
        projectId,
        created.map((item) => item.id),
        draft.sources
      )
      recordWorkItemAttachments(
        projectId,
        created.map((item, index) => ({
          workItemId: item.id,
          itemIds: approvedAttachmentIds(
            draft.suggestions[suggestions[index].suggestionIndex].attachments,
            suggestions[index].attachments
          )
        }))
      )
      return created
    }
  )
  handleApi(
    'reviewAIMilestone',
    async (_event, projectId: string, milestoneId: string, selectedItemIds?: string[]) => {
      const project = getProject(projectId)
      // The AI gate before any evidence is gathered.
      aiPlanningService.assertAiAvailable(projectId)
      const milestone = planningService
        .listMilestones(projectId)
        .find((candidate) => candidate.id === milestoneId)
      if (!milestone) throw new Error(t('errors:planningHandlers.milestoneWasNotFound'))
      const linkedItems = planningService
        .listWorkItems(projectId)
        .filter((item) => item.milestoneId === milestoneId)
        .slice(0, 100)
      const goal = milestone.goalId
        ? planningService.listGoals(projectId).find((entry) => entry.id === milestone.goalId)
        : undefined
      // Bounded, milestone-scoped evidence only: the advisory is about this
      // milestone, and a wider dump would invite comment on the whole project.
      // Descriptions share one budget, so a milestone with one task sends that
      // task whole rather than a fixed slice of it.
      const descriptionLimit = perRecordBudget(linkedItems.length, 24000, 800, 6000)
      const today = todayIsoDate()
      const doneCount = linkedItems.filter((item) => item.status === 'done').length
      // The same rule as the card's badge, so the review never contradicts it.
      const health = milestoneHealth({
        linkedCount: linkedItems.length,
        blockedCount: linkedItems.filter((item) => item.status === 'blocked').length,
        overdue: milestoneOverdue(milestone, today),
        doneCount,
        open: milestone.status !== 'complete' && milestone.status !== 'archived'
      }).health
      const evidence = {
        milestone: {
          name: milestone.name,
          outcome: clipForModel(milestone.outcome, 1200),
          status: milestone.status,
          targetDate: milestone.targetDate,
          successCriteria: milestone.successCriteria.slice(0, 10)
        },
        goal: goal ? { title: goal.title, outcome: clipForModel(goal.outcome, 1200) } : null,
        today,
        linkedWorkDone: `${doneCount} of ${linkedItems.length}`,
        readyToClose: health === 'ready-to-close',
        linkedWorkItems: linkedItems.map(
          ({
            id,
            title,
            description,
            status,
            priority,
            acceptanceCriteria,
            labels,
            updatedAt
          }) => ({
            id,
            title,
            description: clipForModel(description, descriptionLimit),
            status,
            priority,
            acceptanceCriteria: acceptanceCriteria.slice(0, 10),
            labels: labels.slice(0, 10),
            updatedAt
          })
        )
      }
      return await aiPlanningService.reviewMilestone(
        projectId,
        project.name,
        milestoneId,
        milestone.name,
        evidence,
        libraryItemIds(selectedItemIds),
        health === 'ready-to-close'
      )
    }
  )
  projectApi('getAIMilestoneAdvisory', (project, milestoneId: string) =>
    aiPlanningService.getMilestoneAdvisory(project.id, milestoneId)
  )
  handleApi('draftAIDecision', async (_event, projectId: string, workItemId?: string) => {
    const project = getProject(projectId)
    aiPlanningService.assertAiAvailable(projectId)
    const windowDays = 14
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000
    const targetWorkItem = workItemId ? planningService.getWorkItem(workItemId) : null
    if (targetWorkItem && targetWorkItem.projectId !== projectId) {
      throw new Error('Planning work item belongs to another project')
    }
    const gitCommits = database
      .getGitEvents(projectId, 30)
      .filter((commit) => Date.parse(commit.date) >= since)
      .slice(0, 15)
    const recentWorkItems = planningService.listWorkItems(projectId).slice(0, 50)
    const evidence = {
      projectName: project.name,
      projectNotes: project.notes || '',
      targetWorkItem: targetWorkItem
        ? {
            id: targetWorkItem.id,
            title: targetWorkItem.title,
            description: targetWorkItem.description,
            status: targetWorkItem.status,
            priority: targetWorkItem.priority,
            acceptanceCriteria: targetWorkItem.acceptanceCriteria
          }
        : null,
      existingDecisions: planningService
        .listDecisions(projectId)
        .slice(0, 20)
        .map(({ id, title, decision, date }) => ({ id, title, decision, date })),
      planningSummary: {
        goals: planningService
          .listGoals(projectId)
          .slice(0, 15)
          .map(({ id, title, outcome }) => ({ id, title, outcome })),
        milestones: planningService
          .listMilestones(projectId)
          .slice(0, 15)
          .map(({ id, name, outcome }) => ({ id, name, outcome })),
        recentWorkItems: recentWorkItems.map(({ id, title, status, priority }) => ({
          id,
          title,
          status,
          priority
        }))
      },
      recentActivity: {
        fileChanges: database.getEventStats(projectId, windowDays * 24 * 60 * 60 * 1000)
          .totalEvents,
        recentCommits: gitCommits.map((c) => ({ hash: c.abbreviatedHash, message: c.message }))
      }
    }
    // The draft may link only the tasks the model was shown.
    const shownWorkItemIds = [
      ...(targetWorkItem ? [targetWorkItem.id] : []),
      ...recentWorkItems.map((item) => item.id)
    ]
    return await aiPlanningService.draftDecision(
      projectId,
      project.name,
      evidence,
      shownWorkItemIds
    )
  })
  mutatingApi('approveAIDecision', (project, draftId: string, approval: AIDecisionApproval) => {
    const draft = aiPlanningService.getDecisionDraft(project.id, draftId)
    if (draft.projectId !== project.id) {
      throw new Error('AI decision draft belongs to another project')
    }
    return planningService.createDecision(project.id, approval, 'ai-approved')
  })
  handleApi(
    'generateAINextTasks',
    async (_event, projectId: string, selectedItemIds?: string[]) => {
      const project = getProject(projectId)
      // The AI gate before any evidence is gathered.
      aiPlanningService.assertAiAvailable(projectId)
      const windowDays = 14
      const since = Date.now() - windowDays * 24 * 60 * 60 * 1000
      const goals = planningService.listGoals(projectId).slice(0, 25)
      const milestones = planningService.listMilestones(projectId).slice(0, 25)
      const workItems = planningService.listWorkItems(projectId).slice(0, 100)
      const watchEvents = database.getRecentEvents({ projectId, since, limit: 50 })
      const gitCommits = database
        .getGitEvents(projectId, 40)
        .filter((commit) => Date.parse(commit.date) >= since)
        .slice(0, 20)
      const harnessEvents = database
        .getHarnessEvents(projectId, 80)
        .filter((event) => event.timestamp >= since)
        .slice(0, 40)
      const watchStats = database.getEventStats(projectId, windowDays * 24 * 60 * 60 * 1000)
      return await aiPlanningService.generateNextTasks(
        projectId,
        project.name,
        {
          planningGoals: goals.map(({ id, title, outcome, status }) => ({
            id,
            title,
            outcome: clipForModel(outcome, 1200),
            status
          })),
          planningMilestones: milestones.map(
            ({ id, name, outcome, status, targetDate, successCriteria }) => ({
              id,
              name,
              outcome: clipForModel(outcome, 1200),
              status,
              targetDate,
              successCriteria: successCriteria.slice(0, 10)
            })
          ),
          planningWorkItems: workItems.map(
            ({
              id,
              title,
              description,
              status,
              priority,
              labels,
              acceptanceCriteria,
              milestoneId,
              updatedAt
            }) => ({
              id,
              title,
              description: clipForModel(description, 800),
              status,
              priority,
              labels: labels.slice(0, 10),
              acceptanceCriteria: acceptanceCriteria.slice(0, 10),
              milestoneId,
              updatedAt
            })
          ),
          recentWatchEvents: watchEvents.map(({ timestamp, type, relativePath, category }) => ({
            timestamp,
            type,
            relativePath: relativePath.slice(0, 500),
            category
          })),
          recentGitCommits: gitCommits.map(
            ({ abbreviatedHash, message, date, filesChanged, insertions, deletions }) => ({
              abbreviatedHash,
              message: message.slice(0, 500),
              date,
              filesChanged,
              insertions,
              deletions
            })
          ),
          recentHarnessEvents: harnessEvents.map((event) => ({
            timestamp: event.timestamp,
            eventType: event.event_type,
            agentTitle: event.agent_title.slice(0, 200),
            details: event.details.slice(0, 500)
          })),
          watchStats: {
            totalEvents: watchStats.totalEvents,
            eventsByCategory: watchStats.eventsByCategory,
            eventsByType: watchStats.eventsByType,
            hotFiles: watchStats.hotFiles.map(({ path, count }) => ({
              path: path.slice(0, 500),
              count
            }))
          }
        },
        {
          goals: goals.length,
          milestones: milestones.length,
          workItems: workItems.length,
          watchEvents: watchEvents.length,
          gitCommits: gitCommits.length,
          harnessEvents: harnessEvents.length,
          windowDays
        },
        libraryItemIds(selectedItemIds)
      )
    }
  )
  handleApi(
    'approveAINextTasks',
    async (_event, projectId: string, draftId: string, suggestions: AINextTaskApproval[]) => {
      getProject(projectId)
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error(t('errors:planningHandlers.selectLeastOneAi2'))
      }
      const draft = aiPlanningService.getNextTasksDraft(projectId, draftId)
      const indices = suggestions.map((suggestion) => suggestion.suggestionIndex)
      if (
        suggestions.length > 5 ||
        new Set(indices).size !== indices.length ||
        indices.some(
          (index) => !Number.isInteger(index) || index < 0 || index >= draft.suggestions.length
        )
      ) {
        throw new Error('Invalid AI next-task suggestion selection')
      }
      if (suggestions.some(({ status }) => status !== 'backlog' && status !== 'ready')) {
        throw new Error(t('errors:planningHandlers.aiNextTasksMust'))
      }
      // Approving the same draft again returns what it already added.
      const existingApproval = planningService.listWorkItemsFromDraft(projectId, draft.draftId)
      if (existingApproval.length > 0) {
        return existingApproval
      }
      const created = planningService.createAIApprovedWorkItems(
        projectId,
        suggestions.map((suggestion) => ({
          title: suggestion.title,
          description: suggestion.description,
          priority: suggestion.priority,
          acceptanceCriteria: suggestion.acceptanceCriteria,
          milestoneId: suggestion.milestoneId,
          status: suggestion.status
        })),
        { ...human(), draftId: draft.draftId }
      )
      recordWorkItemSources(
        projectId,
        created.map((item) => item.id),
        draft.sources
      )
      recordWorkItemAttachments(
        projectId,
        created.map((item, index) => ({
          workItemId: item.id,
          itemIds: approvedAttachmentIds(
            draft.suggestions[suggestions[index].suggestionIndex].attachments,
            suggestions[index].attachments
          )
        }))
      )
      return created
    }
  )
  handleApi(
    'generateAIProjectBrief',
    async (_event, projectId: string, selectedItemIds?: string[]) => {
      const project = getProject(projectId)
      // The AI gate before any evidence is gathered.
      aiPlanningService.assertAiAvailable(projectId)
      const goals = planningService.listGoals(projectId)
      const milestones = planningService.listMilestones(projectId)
      const workItems = planningService.listWorkItems(projectId)
      const harness = harnessService.getState(project)
      return await aiPlanningService.generateProjectBrief(
        projectId,
        project.name,
        {
          goals: goals.slice(0, 25).map(({ title, outcome, status }) => ({
            title,
            outcome,
            status
          })),
          milestones: milestones.slice(0, 25).map(({ name, outcome, status, targetDate }) => ({
            name,
            outcome,
            status,
            targetDate
          })),
          workItems: workItems.slice(0, 100).map(({ title, status, priority, targetDate }) => ({
            title,
            status,
            priority,
            targetDate
          })),
          execution: {
            activeSessions: harness.activeSessions.length,
            workspacesAwaitingReview: harness.reviewSessions.length,
            pendingTasks: harness.taskQueue.filter((task) => task.status === 'pending').length,
            unansweredQuestions: harness.questions.filter(
              (question) => question.status === 'pending'
            ).length
          },
          // An existing folder's history is the project before any planning
          // exists in Ostler: without it a newly added project reads as empty.
          projectNotes: project.notes || '',
          recentCommits: database.getGitEvents(projectId, 40).map((commit) => ({
            hash: commit.abbreviatedHash,
            date: commit.date,
            message: commit.message
          }))
        },
        libraryItemIds(selectedItemIds)
      )
    }
  )
  projectApi('getAIProjectBrief', (project) => aiPlanningService.getProjectBrief(project.id))
  projectApi(
    'reviewAIProjectBriefAction',
    (project, actionId: string, reviewStatus: 'approved' | 'rejected', reviewNotes: string) => {
      if (reviewStatus !== 'approved' && reviewStatus !== 'rejected')
        throw new Error('Invalid review status')
      return aiPlanningService.updateProjectBriefActionReview(
        project.id,
        actionId,
        reviewStatus,
        reviewNotes
      )
    }
  )
  projectApi('regenerateAIProjectBriefAction', (project, actionId: string, reviewNotes: string) =>
    aiPlanningService.regenerateProjectBriefAction(project.id, project.name, actionId, reviewNotes)
  )
  handleApi(
    'recordAIProjectBriefActionCreation',
    async (
      _event,
      projectId: string,
      actionId: string,
      type: 'goal' | 'milestone' | 'work-item',
      recordId: string
    ) => {
      getProject(projectId)
      const recordProjectId =
        type === 'goal'
          ? planningService.getGoal(recordId).projectId
          : type === 'milestone'
            ? planningService.listMilestones(projectId).find((item) => item.id === recordId)
                ?.projectId
            : planningService.getWorkItem(recordId).projectId
      if (recordProjectId !== projectId)
        throw new Error(t('errors:planningHandlers.createdPlanningRecordWas'))
      return aiPlanningService.recordProjectBriefActionCreation(projectId, actionId, type, recordId)
    }
  )
  handleApi(
    'undoAIProjectBriefActionCreation',
    async (_event, projectId: string, actionId: string) => {
      const project = getProject(projectId)
      const brief = aiPlanningService.getProjectBrief(projectId)
      const action = brief?.nextActions.find((candidate) => candidate.id === actionId)
      if (!action?.creation) throw new Error(t('errors:planningHandlers.recommendationHasNotBeen'))
      const { type, recordId } = action.creation
      if (type === 'goal') {
        if (planningService.getGoal(recordId).projectId !== projectId)
          throw new Error(t('errors:planningHandlers.createdGoalWasNot'))
        planningService.deleteGoal(recordId)
      } else if (type === 'milestone') {
        const milestone = planningService
          .listMilestones(projectId)
          .find((candidate) => candidate.id === recordId)
        if (!milestone) throw new Error(t('errors:planningHandlers.createdMilestoneWasNot'))
        planningService.deleteMilestone(recordId)
      } else {
        if (planningService.getWorkItem(recordId).projectId !== projectId)
          throw new Error(t('errors:planningHandlers.createdTaskWasNot'))
        // Undoing a creation, so any agent work it already spawned is cancelled
        // rather than left blocking the delete.
        const { clearedHandoff } = deleteWorkItem(
          planningService,
          harnessService,
          project,
          recordId,
          human(),
          { cancelActiveWork: true, permanent: true }
        )
        if (clearedHandoff) notifyHarnessState(project)
      }
      return aiPlanningService.clearProjectBriefActionCreation(projectId, actionId)
    }
  )
}
