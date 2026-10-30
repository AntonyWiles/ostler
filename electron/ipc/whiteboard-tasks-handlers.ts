import type { CreatePlanningWorkItemInput, WatchedProject } from '@shared/ostler-api'
import { isIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { objectLinkTarget, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  isTaskableObject,
  WHITEBOARD_TASKS_MAX,
  type MakeWhiteboardTasksInput,
  type MakeWhiteboardTasksResult,
  type UndoWhiteboardTasksInput
} from '@shared/whiteboard/tasks'
import type { LibraryService } from '../services/library-service'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface WhiteboardTasksHandlerDependencies {
  planningService: PlanningService
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
  notifyPlanningChanged(project: WatchedProject): void
  notifyLibraryChanged(project: WatchedProject): void
}

/** Milestones a task can still go in: not complete or archived. */
const OPEN_MILESTONE = new Set(['planned', 'active'])

/**
 * Make tasks from whiteboard objects (plan `docs/plans/whiteboards/`, prompt
 * 13, D17), shaped like Make a task from a line: the drafts are checked
 * against the stored board (the editor saves first), the tasks are created
 * together, and the whiteboard is recorded as each task's source. The open
 * editor is the only writer of its objects, so it links them itself from the
 * answer. Shared by the IPC handler and its tests.
 */
export function makeWhiteboardTasks(
  planningService: PlanningService,
  libraryService: LibraryService,
  projectId: string,
  input: MakeWhiteboardTasksInput
): MakeWhiteboardTasksResult {
  const objects = libraryService.whiteboards.listObjects(projectId, input?.whiteboardId)
  const board = libraryService.getItem(projectId, input.whiteboardId)
  if (board.archivedAt) throw new Refusal(t('errors:whiteboard.tasks.archived'))
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  if (tasks.length === 0) throw new Refusal(t('errors:whiteboard.tasks.nothingToMake'))
  if (tasks.length > WHITEBOARD_TASKS_MAX) {
    throw new Refusal(t('errors:whiteboard.tasks.tooMany', { max: WHITEBOARD_TASKS_MAX }))
  }
  const byId = new Map(objects.map((object) => [object.id, object]))
  const seen = new Set<string>()
  for (const task of tasks) {
    const id = task?.objectId
    const object = typeof id === 'string' ? byId.get(id) : undefined
    if (!object || seen.has(object.id) || !isTaskableObject(object)) {
      throw new Refusal(t('errors:whiteboard.tasks.badObject'))
    }
    seen.add(object.id)
  }
  const milestoneId = input.milestoneId ?? null
  if (milestoneId !== null) {
    const open = planningService
      .listMilestones(projectId)
      .some((milestone) => milestone.id === milestoneId && OPEN_MILESTONE.has(milestone.status))
    if (!open) throw new Refusal(t('errors:whiteboard.tasks.badMilestone'))
  }
  const rows: CreatePlanningWorkItemInput[] = tasks.map((task) => ({
    title: typeof task.title === 'string' ? task.title : '',
    description: typeof task.description === 'string' ? task.description : '',
    labels: Array.isArray(task.labels)
      ? task.labels.filter((label): label is string => typeof label === 'string')
      : [],
    assigneeId: typeof task.assigneeId === 'string' ? task.assigneeId : null,
    targetDate: isIsoDate(task.dueDate) ? task.dueDate : null,
    milestoneId,
    ...(typeof task.priority === 'string' ? { priority: task.priority } : {})
  }))
  const created = planningService.createWorkItemsTogether(
    projectId,
    rows,
    planningService.humanActor()
  )
  for (const task of created) libraryService.addWorkItemSource(projectId, task.id, board.id)
  return {
    made: created.map((task, index) => ({ objectId: tasks[index].objectId, taskId: task.id }))
  }
}

/**
 * The one undo for Make tasks, which may come after the board was closed:
 * the given tasks that belong to the project are deleted (they were just
 * made, so not to the recycle bin), then every object of that whiteboard
 * whose link points at one of them loses its link, in one save. An open
 * editor takes the change in as any change made elsewhere. A board deleted
 * or archived since keeps its links, which then show a deleted item.
 */
export function undoWhiteboardTasks(
  planningService: PlanningService,
  libraryService: LibraryService,
  projectId: string,
  input: UndoWhiteboardTasksInput
): void {
  const taskIds = Array.isArray(input?.taskIds) ? input.taskIds : []
  const owned = taskIds.filter((id) => {
    try {
      return typeof id === 'string' && planningService.getWorkItem(id).projectId === projectId
    } catch {
      return false
    }
  })
  planningService.deleteWorkItemsTogether(owned, planningService.humanActor())

  let objects: WhiteboardObjectInput[]
  try {
    objects = libraryService.whiteboards.listObjects(projectId, input.whiteboardId)
    if (libraryService.getItem(projectId, input.whiteboardId).archivedAt) return
  } catch {
    return
  }
  const gone = new Set(owned)
  const unlinked = objects
    .filter((object) => {
      const target = objectLinkTarget(object)
      return (
        target !== null &&
        target.kind === 'task' &&
        target.projectId === projectId &&
        gone.has(target.id)
      )
    })
    .map((object) => ({ ...object, link: null }) as WhiteboardObjectInput)
  if (unlinked.length === 0) return
  libraryService.whiteboards.save(projectId, input.whiteboardId, { upserts: unlinked, deletes: [] })
}

/**
 * Not in the automation API: an external agent does the same with
 * `POST /work-items` and the Library routes, as for Make a task from a line.
 */
export function registerWhiteboardTasksHandlers({
  planningService,
  libraryService,
  getProject,
  notifyPlanningChanged,
  notifyLibraryChanged
}: WhiteboardTasksHandlerDependencies): void {
  handleApi(
    'makeWhiteboardTasks',
    async (_event, projectId: string, input: MakeWhiteboardTasksInput) => {
      const project = getProject(projectId)
      const result = makeWhiteboardTasks(planningService, libraryService, project.id, input)
      notifyPlanningChanged(project)
      notifyLibraryChanged(project)
      return result
    }
  )
  handleApi(
    'undoWhiteboardTasks',
    async (_event, projectId: string, input: UndoWhiteboardTasksInput) => {
      const project = getProject(projectId)
      undoWhiteboardTasks(planningService, libraryService, project.id, input)
      notifyPlanningChanged(project)
      notifyLibraryChanged(project)
    }
  )
}
