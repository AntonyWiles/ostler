import type { CreatePlanningWorkItemInput, LibraryItem, WatchedProject } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { isIsoDate } from '@shared/dates'
import { itemLinkUrl } from '@shared/item-links'
import {
  isTaskableLine,
  LINE_TASKS_MAX,
  noteLines,
  rewriteLinesAsLinks,
  type MakeLineTasksInput,
  type MakeLineTasksResult,
  type UndoLineTasksInput
} from '@shared/note-line-tasks'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { LibraryService } from '../services/library-service'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface LineTasksHandlerDependencies {
  planningService: PlanningService
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
  notifyPlanningChanged(project: WatchedProject): void
  notifyLibraryChanged(project: WatchedProject): void
}

const WRITTEN_KINDS = new Set(['note', 'brief', 'guide'])

/**
 * Make a task from a line (N4.4b), in one step: the tasks are created (one
 * transaction), the lines that made them become links to them, the note is
 * saved as a new revision (which keeps N4.4a's link index), and the note is
 * recorded as each task's source at that revision. The text is rewritten as
 * the person selected in it; a note whose revision moved on is refused.
 * Shared by the IPC handler and its tests.
 */
export function makeLineTasks(
  planningService: PlanningService,
  libraryService: LibraryService,
  projectId: string,
  input: MakeLineTasksInput
): MakeLineTasksResult {
  const note = libraryService.getItem(projectId, input?.itemId)
  if (!WRITTEN_KINDS.has(note.kind)) throw new Refusal(t('errors:lineTasks.notWritten'))
  if (input.revision !== note.revision || typeof input.body !== 'string') {
    throw new Refusal(t('errors:lineTasks.noteChanged'))
  }
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  if (tasks.length === 0) throw new Refusal(t('errors:lineTasks.nothingToMake'))
  if (tasks.length > LINE_TASKS_MAX) {
    throw new Refusal(t('errors:lineTasks.tooMany', { max: LINE_TASKS_MAX }))
  }
  const lines = noteLines(input.body)
  const seen = new Set<number>()
  for (const task of tasks) {
    const line = task?.line
    if (
      !Number.isInteger(line) ||
      line < 0 ||
      line >= lines.length ||
      seen.has(line) ||
      !isTaskableLine(lines[line])
    ) {
      throw new Refusal(t('errors:lineTasks.badLine'))
    }
    seen.add(line)
  }
  const rows: CreatePlanningWorkItemInput[] = tasks.map((task) => ({
    title: typeof task.title === 'string' ? task.title : '',
    description: typeof task.description === 'string' ? task.description : '',
    labels: Array.isArray(task.labels)
      ? task.labels.filter((label): label is string => typeof label === 'string')
      : [],
    assigneeId: typeof task.assigneeId === 'string' ? task.assigneeId : null,
    targetDate: isIsoDate(task.dueDate) ? task.dueDate : null,
    ...(typeof task.priority === 'string' ? { priority: task.priority } : {})
  }))
  const created = planningService.createWorkItemsTogether(
    projectId,
    rows,
    planningService.humanActor()
  )
  const body = rewriteLinesAsLinks(
    input.body,
    created.map((task, index) => ({
      line: tasks[index].line,
      url: itemLinkUrl({ kind: 'task', projectId, id: task.id }, BRAND.urlScheme)
    }))
  )
  let item
  try {
    item = libraryService.updateItem(projectId, note.id, { body })
  } catch (error) {
    // The note could not be saved: take the tasks back, so nothing is half done.
    planningService.deleteWorkItemsTogether(
      created.map((task) => task.id),
      planningService.humanActor()
    )
    throw error
  }
  for (const task of created) libraryService.addWorkItemSource(projectId, task.id, note.id)
  return { taskIds: created.map((task) => task.id), item }
}

/**
 * The one undo for Make a task: the tasks it made are deleted (they were
 * just made, so not to the recycle bin) and the note's text before is saved
 * back. Refused, changing nothing, if the note was saved again since.
 */
export function undoLineTasks(
  planningService: PlanningService,
  libraryService: LibraryService,
  projectId: string,
  input: UndoLineTasksInput
): LibraryItem {
  const note = libraryService.getItem(projectId, input?.itemId)
  if (input.revision !== note.revision || typeof input.body !== 'string') {
    throw new Refusal(t('errors:lineTasks.cannotUndo'))
  }
  const taskIds = Array.isArray(input.taskIds) ? input.taskIds : []
  const owned = taskIds.filter((id) => {
    try {
      return typeof id === 'string' && planningService.getWorkItem(id).projectId === projectId
    } catch {
      return false
    }
  })
  planningService.deleteWorkItemsTogether(owned, planningService.humanActor())
  return libraryService.updateItem(projectId, note.id, { body: input.body })
}

/**
 * Not in the automation API: an external agent does the same with
 * `POST /work-items` and the Library routes (docs/automation-api/library.md).
 */
export function registerLineTasksHandlers({
  planningService,
  libraryService,
  getProject,
  notifyPlanningChanged,
  notifyLibraryChanged
}: LineTasksHandlerDependencies): void {
  handleApi('makeLineTasks', async (_event, projectId: string, input: MakeLineTasksInput) => {
    const project = getProject(projectId)
    const result = makeLineTasks(planningService, libraryService, project.id, input)
    notifyPlanningChanged(project)
    notifyLibraryChanged(project)
    return result
  })
  handleApi('undoLineTasks', async (_event, projectId: string, input: UndoLineTasksInput) => {
    const project = getProject(projectId)
    const item = undoLineTasks(planningService, libraryService, project.id, input)
    notifyPlanningChanged(project)
    notifyLibraryChanged(project)
    return item
  })
}
