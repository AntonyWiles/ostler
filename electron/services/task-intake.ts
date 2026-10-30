import type {
  CreatePlanningWorkItemInput,
  HarnessTask,
  PlanningActor,
  PlanningPriority,
  PlanningWorkItem,
  WatchedProject,
  WorkItemAttachment
} from '@shared/ostler-api'
import { doneWhenSection } from '@shared/agent-plan-briefing'
import type { AgentRunChoice } from '@shared/agent-model'
import { requireProjectFolder } from '@shared/project-folder'
import { hiddenQueueRefusal } from '@shared/planning/show-from'
import { todayIsoDate } from '@shared/dates'
import { projectAgentsPlanFirst, resolvePlanFirst } from '@shared/plan-first'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'

/**
 * `queueWorkItemForHarness` bound to the app's planning and harness services,
 * with the work item's attachments filled in: what the IPC handlers queue with.
 */
export type QueueWorkItemForHarness = (
  project: WatchedProject,
  workItemId: string,
  options?: { allowUnmetDependencies?: boolean; runChoice?: AgentRunChoice }
) => { workItem: PlanningWorkItem; task: HarnessTask }

/**
 * Reserves a harness handoff for a planning work item and adds/reprioritizes
 * its queue entry. The one queueing path for the desktop app, the dispatcher
 * and the automation API, so none of them can skip a check the others make.
 */
export function queueWorkItemForHarness(
  planning: PlanningService,
  harness: HarnessService,
  project: WatchedProject,
  workItemId: string,
  options: {
    allowUnmetDependencies?: boolean
    /** The work item's agent-visible attachments, listed in the task text. */
    attachments?: WorkItemAttachment[]
    /** The model and effort for this run (D42), already validated; left out, the default. */
    runChoice?: AgentRunChoice
    /**
     * Run playbook (N9.6b): the playbook the task came from, and its extra
     * instructions, added to the task's details under "Playbook instructions".
     */
    playbook?: QueuedPlaybook
    /** Queued by its repeat's schedule (N9.7): its cards say "Scheduled". */
    scheduled?: boolean
  } = {}
): { workItem: PlanningWorkItem; task: HarnessTask } {
  const sourceItem = planning.getWorkItem(workItemId)
  if (sourceItem.projectId !== project.id)
    throw new Error('Planning work item belongs to another project')
  // Agents work in a copy of the project's folder; without one there is
  // nothing for queued work to run in.
  requireProjectFolder(project, 'Queuing a task for an agent')
  if (sourceItem.deletedAt) throw new Error('This item is in the recycle bin; restore it first')
  if (sourceItem.archivedAt) throw new Error('This item is archived; bring it back first')
  // A task in Someday or hidden until later is not for now (N1.1a). Today is
  // this PC's local date, the same day the person sees.
  const hidden = hiddenQueueRefusal(sourceItem, todayIsoDate())
  if (hidden) throw new Error(hidden)
  const workItem = planning.prepareHarnessHandoff(project.id, workItemId, {
    allowUnmetDependencies: options.allowUnmetDependencies
  })
  const taskId = workItem.linkedHarnessTaskId
  if (!taskId) throw new Error('Planning work item handoff reservation failed')
  const existing = harness.getState(project).taskQueue.find((task) => task.id === taskId)
  if (existing?.status === 'cancelled') {
    throw new Error('Cancelled execution must return to Ready before it can be queued again')
  }
  const task = existing
    ? harness.setTaskPriority(project, existing.id, workItem.priority, workItem.id)
    : harness.addTask(
        project,
        workItem.title,
        formatPlanningTaskDetails(
          workItem,
          options.attachments,
          planning.taskTypes.nameOf(workItem.typeId),
          options.playbook?.instructions
        ),
        taskId,
        workItem.priority,
        workItem.id,
        workItem.autoQueue
      )
  let queued = applyTaskPlanFirst(harness, project, workItem, task)
  if (options.runChoice) queued = harness.setTaskRunModel(project, queued.id, options.runChoice)
  if (options.playbook)
    queued = harness.setTaskPlaybook(project, queued.id, {
      templateId: options.playbook.templateId,
      name: options.playbook.name
    })
  if (options.scheduled) queued = harness.setTaskScheduled(project, queued.id)
  return { workItem, task: queued }
}

/** The playbook a task is queued from (N9.6b). */
export interface QueuedPlaybook {
  templateId: string
  name: string
  /** The person's words about this task; empty for none. */
  instructions: string
}

/**
 * Plan first (N9.3b): sets a queued task's `planFirst` from its work item's
 * own choice, else the project's Agents plan first. Every path that queues a
 * work item calls this, so the rule is the same for each. A task no longer
 * waiting in the queue keeps what it had.
 */
export function applyTaskPlanFirst(
  harness: HarnessService,
  project: WatchedProject,
  workItem: PlanningWorkItem,
  task: HarnessTask
): HarnessTask {
  if (task.status !== 'pending') return task
  const want = resolvePlanFirst(workItem.planFirst, projectAgentsPlanFirst(project))
  if ((task.planFirst === true) === want) return task
  return harness.setTaskPlanFirst(project, task.id, want)
}

/**
 * Queues a new piece of work given only a title. Every queued task is backed
 * by a planning work item, because the Board only draws work items: a bare
 * harness task was real work that no view could show. This creates a Ready
 * item and queues it through the same path as any other.
 */
export function queueNewTask(
  planning: PlanningService,
  harness: HarnessService,
  project: WatchedProject,
  input: {
    title: string
    details?: string
    priority?: PlanningPriority
    /** The model and effort for this run (D42), already validated. */
    runChoice?: AgentRunChoice
  },
  actor: PlanningActor
): { workItem: PlanningWorkItem; task: HarnessTask } {
  // Checked before the work item is created, so a refusal leaves nothing behind.
  requireProjectFolder(project, 'Queuing a task for an agent')
  const item = planning.createWorkItem(
    project.id,
    {
      title: input.title,
      description: input.details ?? '',
      priority: input.priority ?? 'medium',
      status: 'ready'
    } as CreatePlanningWorkItemInput,
    actor,
    'human'
  )
  return queueWorkItemForHarness(planning, harness, project, item.id, {
    runChoice: input.runChoice
  })
}

/**
 * The one place a work item's task text is built. `attachments` are the work
 * item's agent-visible library attachments (`LibraryService.agentAttachments`);
 * every coding session reads the files themselves through
 * `resolveTaskAttachments`: an embedded one as copies, an external one over HTTP.
 */
export function formatPlanningTaskDetails(
  item: PlanningWorkItem,
  attachments: WorkItemAttachment[] = [],
  /** The task's type name (N2.7a), the same for embedded and external agents. */
  typeName: string | null = null,
  /** Run playbook's extra instructions (N9.6b): the person's words about this task. */
  playbookInstructions = ''
): string {
  const sections = [item.description]
  sections.push(doneWhenSection(item.acceptanceCriteria))
  if (typeName) sections.push(`Type: ${typeName}`)
  if (item.targetDate) sections.push(`Target date: ${item.targetDate}`)
  if (playbookInstructions.trim())
    sections.push(`Playbook instructions:
${playbookInstructions.trim()}`)
  if (attachments.length > 0) {
    const lines = attachments.map(({ item: attached }) => {
      const summary = attached.summary.replace(/\s+/g, ' ').trim()
      return `- ${attached.kind}: "${attached.title}" (library id ${attached.id})${summary ? ` -- ${summary}` : ''}`
    })
    sections.push(
      `Attached reference files (read-only):\n${lines.join('\n')}\nEmbedded sessions: see OSTLER_TASK_ATTACHMENTS.md. Harness sessions: GET /tasks/<taskId>/attachments.`
    )
  }
  sections.push(`Ostler planning work item: ${item.id}`)
  return sections.filter(Boolean).join('\n\n')
}
