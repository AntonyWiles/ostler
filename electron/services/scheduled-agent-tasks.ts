import type {
  HarnessTask,
  PlanningActor,
  PlanningScheduledQueueOutcome,
  PlanningWorkItem,
  WatchedProject
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'
import type { PlanningService } from './planning-service'
import { scheduledQueueText } from './inbox-sources'

/** How the hourly check is named in an occurrence's activity when it moves it to Ready. */
const SCHEDULE_ACTOR: PlanningActor = { kind: 'system' }

export interface ScheduledQueueDeps {
  planning: PlanningService
  getProjects(): WatchedProject[]
  /** `features.agents`: Settings › Agents is on. */
  agentsOn(): boolean
  /** The tasks in a project's agent queue, to see whether one is already queued or running. */
  queuedTasks(project: WatchedProject): HarnessTask[]
  /**
   * Queues the work item on the one queue path, as the Board does, marked
   * as queued by its schedule. Throws with the reason when it cannot.
   */
  queue(project: WatchedProject, workItemId: string): void
  now?(): number
}

export interface ScheduledQueueResult {
  workItemId: string
  projectId: string
  outcome: PlanningScheduledQueueOutcome
}

/**
 * Scheduled agent tasks (N9.7, N65): on start and with every hourly check,
 * each open occurrence of a repeat that goes to agents, whose start date (or
 * due date) is today or earlier, is queued for agents once, through the same
 * path as queuing from the Board. The outcome is recorded on the occurrence
 * in the database, so a restart or days missed while Ostler was closed catch
 * it up once and never queue it twice. When it cannot be queued (agents off,
 * no linked folder, already queued or running, or refused) the occurrence
 * stays an ordinary task the person can queue, and the Inbox says why. It is
 * never queued later on its own: the Inbox note offers Queue it now
 * (`queueScheduledTaskNow`). Whether queued work starts by itself is the
 * project's auto-dispatch.
 */
export function queueDueScheduledTasks(
  deps: ScheduledQueueDeps,
  today: string = todayIsoDate()
): ScheduledQueueResult[] {
  // A project this PC only views (D9) is not queued here: nothing it queues could be recorded.
  const projects = deps
    .getProjects()
    .filter((project) => project.enabled && !deps.planning.isViewerProject(project.id))
  if (projects.length === 0) return []
  const byId = new Map(projects.map((project) => [project.id, project]))
  const now = deps.now ?? Date.now
  const results: ScheduledQueueResult[] = []
  for (const item of deps.planning.dueScheduledOccurrences([...byId.keys()], today)) {
    const project = byId.get(item.projectId)
    if (!project) continue
    try {
      const { outcome, note } = queueOne(deps, project, item)
      if (deps.planning.recordScheduledQueue(item.id, outcome, now(), note))
        results.push({ workItemId: item.id, projectId: project.id, outcome })
    } catch (error) {
      console.error(`Queuing scheduled task ${item.id} failed:`, error)
    }
  }
  return results
}

/**
 * Queue it now, from the Inbox note of an occurrence its schedule could not
 * queue: the person's click, on the same path and with the same checks as
 * the schedule's own queuing. Queued, the note says so; refused, the note
 * says why as it stands now, and the error carries the same plain reason.
 */
export function queueScheduledTaskNow(
  deps: ScheduledQueueDeps,
  workItemId: string,
  actor: PlanningActor
): PlanningWorkItem {
  const item = deps.planning.getWorkItem(workItemId)
  const outcome = item.scheduledQueue?.outcome
  if (!outcome || outcome === 'queued') throw new Error(t('errors:scheduledAgentTasks.notWaiting'))
  const project = deps
    .getProjects()
    .find((candidate) => candidate.id === item.projectId && candidate.enabled)
  if (!project) throw new Error(t('errors:scheduledAgentTasks.projectOff'))
  const now = deps.now ?? Date.now
  const result = queueOne(deps, project, item, actor)
  if (result.outcome === 'queued') {
    deps.planning.replaceScheduledQueue(item.id, 'queued', now(), null)
    return deps.planning.getWorkItem(item.id)
  }
  // The note keeps its place in the Inbox and says why as it stands now.
  deps.planning.replaceScheduledQueue(
    item.id,
    result.outcome,
    item.scheduledQueue?.at ?? now(),
    result.note
  )
  throw new Error(scheduledQueueText(result.outcome, result.note))
}

function queueOne(
  deps: ScheduledQueueDeps,
  project: WatchedProject,
  item: PlanningWorkItem,
  actor: PlanningActor = SCHEDULE_ACTOR
): { outcome: PlanningScheduledQueueOutcome; note: string | null } {
  if (!deps.agentsOn()) return { outcome: 'agentsOff', note: null }
  if (projectFolder(project) === null) return { outcome: 'noFolder', note: null }
  if (item.linkedHarnessTaskId) {
    const task = deps
      .queuedTasks(project)
      .find((candidate) => candidate.id === item.linkedHarnessTaskId)
    if (task && (task.status === 'pending' || task.status === 'claimed'))
      return { outcome: 'alreadyQueued', note: null }
  }
  try {
    // A new occurrence waits in Backlog; only Ready work can be queued.
    if (item.status === 'backlog') deps.planning.updateWorkItem(item.id, { status: 'ready' }, actor)
    deps.queue(project, item.id)
    return { outcome: 'queued', note: null }
  } catch (error) {
    return { outcome: 'refused', note: error instanceof Error ? error.message : String(error) }
  }
}
