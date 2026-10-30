import type {
  CreatePlanningWorkItemInput,
  PlanningWorkItem,
  WatchedProject
} from '@shared/ostler-api'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import { isEntityId } from '@shared/deep-link'
import {
  TEXT_TASKS_MAX_SUGGESTIONS,
  TEXT_TASKS_MAX_TEXT,
  type AddTasksFromTextInput,
  type TasksFromTextDraft,
  type TasksFromTextRequest
} from '@shared/tasks-from-text'
import { t } from '@shared/i18n'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { LibraryService } from '../services/library-service'
import type { PeopleService } from '../services/people-service'
import type { PlanningService } from '../services/planning-service'
import { preparePhoto } from '../services/photo-for-ai'
import { handleApi } from './handle-ipc'

export interface TasksFromTextHandlerDependencies {
  aiPlanningService: AIPlanningService
  planningService: PlanningService
  peopleService: PeopleService
  libraryService: LibraryService
  getProject(projectId: string): WatchedProject
  notifyPlanningChanged(project: WatchedProject): void
}

/**
 * Tasks from text or a photo (N4.1a). Finding sends only the person's text
 * and photo through Ostler AI and creates nothing; adding creates the ticked
 * tasks through the normal create path as `ai-approved`, in one transaction.
 * Not in the automation API: Ostler AI features are not there, and an external
 * agent creates tasks itself with `POST /work-items`.
 */
export function registerTasksFromTextHandlers({
  aiPlanningService,
  planningService,
  peopleService,
  libraryService,
  getProject,
  notifyPlanningChanged
}: TasksFromTextHandlerDependencies): void {
  handleApi(
    'findTasksFromText',
    async (_event, projectId: string, request: TasksFromTextRequest) => {
      const project = getProject(projectId)
      const text = typeof request?.text === 'string' ? request.text : ''
      if (text.length > TEXT_TASKS_MAX_TEXT) {
        throw new Error(t('errors:tasksFromText.textTooLong', { max: TEXT_TASKS_MAX_TEXT }))
      }
      const photo = request?.photo ? preparePhoto(request.photo).forAi : null
      if (!text.trim() && !photo) throw new Error(t('errors:tasksFromText.nothingToRead'))
      const today = isIsoDate(request?.today) ? request.today : todayIsoDate()
      const weekStart =
        Number.isInteger(request?.weekStart) && request.weekStart >= 0 && request.weekStart <= 6
          ? request.weekStart
          : 1
      return aiPlanningService.findTasksFromText(
        project.id,
        { text, photo, today, weekStart },
        peopleService.offeredIn(project.id).map((person) => ({
          id: person.id,
          name: person.name,
          initials: person.initials,
          isMe: person.isMe
        }))
      ) satisfies Promise<TasksFromTextDraft>
    }
  )

  handleApi(
    'addTasksFromText',
    async (
      _event,
      projectId: string,
      input: AddTasksFromTextInput
    ): Promise<PlanningWorkItem[]> => {
      const project = getProject(projectId)
      const tasks = Array.isArray(input?.tasks) ? input.tasks : []
      if (tasks.length === 0) throw new Error(t('errors:tasksFromText.noTasks'))
      if (tasks.length > TEXT_TASKS_MAX_SUGGESTIONS) {
        throw new Error(t('errors:tasksFromText.tooManyTasks', { max: TEXT_TASKS_MAX_SUGGESTIONS }))
      }
      if (typeof input.draftId !== 'string' || !isEntityId(input.draftId)) {
        throw new Error(t('errors:tasksFromText.badDraft'))
      }
      const kept = input.keepPhoto
        ? (await libraryService.importFiles(project.id, [preparePhoto(input.keepPhoto).keep]))[0]
            ?.item
        : null
      const rows: CreatePlanningWorkItemInput[] = tasks.map((task) => {
        const description = typeof task?.description === 'string' ? task.description.trim() : ''
        const photoLine = kept ? t('tasks:tasksFromText.photoLine', { title: kept.title }) : ''
        return {
          title: typeof task?.title === 'string' ? task.title : '',
          description: [description, photoLine].filter(Boolean).join('\n\n'),
          targetDate: isIsoDate(task?.dueDate) ? task.dueDate : null,
          assigneeId: typeof task?.assigneeId === 'string' ? task.assigneeId : null,
          acceptanceCriteria: Array.isArray(task?.checklist)
            ? task.checklist.filter((item): item is string => typeof item === 'string')
            : [],
          // A quick capture: To triage when the project asks (N4.3a).
          capture: 'text'
        }
      })
      const created = planningService.createAIApprovedWorkItems(project.id, rows, {
        ...planningService.humanActor(),
        draftId: input.draftId
      })
      if (kept) {
        for (const item of created) {
          libraryService.attachToWorkItem(project.id, item.id, kept.id, 'human')
        }
      }
      notifyPlanningChanged(project)
      return created
    }
  )
}
