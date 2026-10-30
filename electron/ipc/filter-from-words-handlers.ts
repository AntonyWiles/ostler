import type { WatchedProject } from '@shared/ostler-api'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import {
  FILTER_WORDS_MAX_TEXT,
  type FilterFromWordsRequest,
  type FilterFromWordsResult,
  type FilterVocabulary
} from '@shared/filter-from-words'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  taskPriorityLabel,
  taskStatusLabel
} from '@shared/task-labels'
import { t } from '@shared/i18n'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { PeopleService } from '../services/people-service'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface FilterFromWordsHandlerDependencies {
  aiPlanningService: AIPlanningService
  planningService: PlanningService
  peopleService: PeopleService
  getProject(projectId: string): WatchedProject
}

/**
 * The project's names for Describe it (N8.1): statuses in the project's own
 * words, priorities, labels, milestones, goals, iterations, people and
 * contacts. Names only: nothing about a task.
 */
export function filterVocabulary(
  planningService: PlanningService,
  peopleService: PeopleService,
  projectId: string
): FilterVocabulary {
  const columns = planningService.columns.get(projectId)
  return {
    statuses: TASK_STATUSES.map((value) => ({ value, name: taskStatusLabel(value, columns) })),
    priorities: TASK_PRIORITIES.map((value) => ({ value, name: taskPriorityLabel(value) })),
    labels: planningService.listProjectLabels(projectId).map((label) => label.name),
    milestones: planningService
      .listMilestones(projectId)
      .map((milestone) => ({ id: milestone.id, name: milestone.name })),
    goals: planningService.listGoals(projectId).map((goal) => ({ id: goal.id, name: goal.title })),
    iterations: planningService.iterations
      .list(projectId)
      .map((iteration) => ({ id: iteration.id, name: iteration.name })),
    types: planningService.taskTypes
      .list(projectId)
      .map((type) => ({ id: type.id, name: type.name })),
    people: peopleService.offeredIn(projectId).map((person) => ({
      id: person.id,
      name: person.name,
      initials: person.initials,
      isMe: person.isMe
    })),
    contacts: planningService.contacts
      .list()
      .map((contact) => ({ id: contact.id, name: contact.name }))
  }
}

/**
 * Describe it (N8.1): a filter from the person's words, through Ostler AI.
 * Creates and stores nothing; the renderer puts the filter in the bar. Not in
 * the automation API: Ostler AI features are not there, and an external agent
 * builds filters itself from the field list in `HELP_ROUTES`.
 */
export function registerFilterFromWordsHandlers({
  aiPlanningService,
  planningService,
  peopleService,
  getProject
}: FilterFromWordsHandlerDependencies): void {
  handleApi(
    'filterFromWords',
    async (_event, projectId: string, request: FilterFromWordsRequest) => {
      const project = getProject(projectId)
      const text = typeof request?.text === 'string' ? request.text.trim() : ''
      if (!text) throw new Error(t('errors:filterFromWords.nothingToRead'))
      if (text.length > FILTER_WORDS_MAX_TEXT) {
        throw new Error(t('errors:filterFromWords.textTooLong', { max: FILTER_WORDS_MAX_TEXT }))
      }
      const today = isIsoDate(request?.today) ? request.today : todayIsoDate()
      const weekStart =
        Number.isInteger(request?.weekStart) && request.weekStart >= 0 && request.weekStart <= 6
          ? request.weekStart
          : 1
      return aiPlanningService.filterFromWords(
        project.id,
        { text, today, weekStart },
        filterVocabulary(planningService, peopleService, project.id)
      ) satisfies Promise<FilterFromWordsResult>
    }
  )
}
