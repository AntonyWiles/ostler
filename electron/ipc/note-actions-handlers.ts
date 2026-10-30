import type {
  CreatePlanningDecisionInput,
  CreatePlanningWorkItemInput,
  WatchedProject
} from '@shared/ostler-api'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import { isEntityId } from '@shared/deep-link'
import {
  markAlreadyTasks,
  NOTE_ACTIONS_MAX_DECISIONS,
  type AddNoteActionsInput,
  type AddNoteActionsResult,
  type NoteActionsDraft,
  type NoteActionsRequest
} from '@shared/note-actions'
import { TEXT_TASKS_MAX_SUGGESTIONS } from '@shared/tasks-from-text'
import { t } from '@shared/i18n'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { LibraryService } from '../services/library-service'
import type { PeopleService } from '../services/people-service'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface NoteActionsHandlerDependencies {
  aiPlanningService: AIPlanningService
  planningService: PlanningService
  peopleService: PeopleService
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
  notifyPlanningChanged(project: WatchedProject): void
  notifyLibraryChanged(project: WatchedProject): void
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Adds what the person ticked from one note: the tasks and decisions in one
 * transaction, then the note recorded as each task's source at its current
 * revision. Each decision's context starts by naming the note, and links the
 * tasks made in the same step. Shared by the IPC handler and its tests.
 */
export function addNoteActions(
  planningService: PlanningService,
  libraryService: LibraryService,
  projectId: string,
  input: AddNoteActionsInput
): AddNoteActionsResult {
  if (typeof input?.draftId !== 'string' || !isEntityId(input.draftId)) {
    throw new Error(t('errors:tasksFromText.badDraft'))
  }
  const note = libraryService.getItem(projectId, input.itemId)
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  const decisions = Array.isArray(input.decisions) ? input.decisions : []
  if (tasks.length === 0 && decisions.length === 0) {
    throw new Error(t('errors:noteActions.nothingTicked'))
  }
  if (tasks.length > TEXT_TASKS_MAX_SUGGESTIONS || decisions.length > NOTE_ACTIONS_MAX_DECISIONS) {
    throw new Error(
      t('errors:noteActions.tooMany', {
        tasks: TEXT_TASKS_MAX_SUGGESTIONS,
        decisions: NOTE_ACTIONS_MAX_DECISIONS
      })
    )
  }
  const taskRows: CreatePlanningWorkItemInput[] = tasks.map((task) => ({
    title: typeof task?.title === 'string' ? task.title : '',
    description: text(task?.description),
    targetDate: isIsoDate(task?.dueDate) ? task.dueDate : null,
    assigneeId: typeof task?.assigneeId === 'string' ? task.assigneeId : null,
    acceptanceCriteria: Array.isArray(task?.checklist)
      ? task.checklist.filter((item): item is string => typeof item === 'string')
      : []
  }))
  const fromNote = t('tasks:noteActions.fromNote', { title: note.title })
  const decisionRows: CreatePlanningDecisionInput[] = decisions.map((decision) => ({
    title: typeof decision?.title === 'string' ? decision.title : '',
    decision: typeof decision?.decision === 'string' ? decision.decision : '',
    context: [fromNote, text(decision?.context)].filter(Boolean).join('\n\n'),
    date: todayIsoDate()
  }))
  const created = planningService.createAIApprovedTasksAndDecisions(
    projectId,
    taskRows,
    decisionRows,
    { ...planningService.humanActor(), draftId: input.draftId }
  )
  for (const task of created.tasks) {
    libraryService.addWorkItemSource(projectId, task.id, note.id)
  }
  return {
    taskIds: created.tasks.map((task) => task.id),
    decisionIds: created.decisions.map((decision) => decision.id)
  }
}

/**
 * Find actions and decisions (N4.1b). Finding sends one AI-readable Library
 * note through Ostler AI and creates nothing; adding creates the ticked tasks
 * and decisions. Not in the automation API: Ostler AI features are not there,
 * and an external agent reads notes through the Library routes and creates
 * tasks and decisions itself.
 */
export function registerNoteActionsHandlers({
  aiPlanningService,
  planningService,
  peopleService,
  libraryService,
  getProject,
  notifyPlanningChanged,
  notifyLibraryChanged
}: NoteActionsHandlerDependencies): void {
  handleApi(
    'findNoteActions',
    async (_event, projectId: string, request: NoteActionsRequest): Promise<NoteActionsDraft> => {
      const project = getProject(projectId)
      const today = isIsoDate(request?.today) ? request.today : todayIsoDate()
      const weekStart =
        Number.isInteger(request?.weekStart) && request.weekStart >= 0 && request.weekStart <= 6
          ? request.weekStart
          : 1
      const draft = await aiPlanningService.findNoteActions(
        project.id,
        typeof request?.itemId === 'string' ? request.itemId : '',
        { today, weekStart },
        peopleService.offeredIn(project.id).map((person) => ({
          id: person.id,
          name: person.name,
          initials: person.initials,
          isMe: person.isMe
        }))
      )
      const existing = libraryService
        .listItemWorkItems(project.id, draft.itemId)
        .map((link) => ({ id: link.workItemId, title: link.workItemTitle }))
      return { ...draft, suggestions: markAlreadyTasks(draft.suggestions, existing) }
    }
  )

  handleApi('addNoteActions', async (_event, projectId: string, input: AddNoteActionsInput) => {
    const project = getProject(projectId)
    const result = addNoteActions(planningService, libraryService, project.id, input)
    notifyPlanningChanged(project)
    notifyLibraryChanged(project)
    return result
  })
}
