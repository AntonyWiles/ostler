import type {
  HarnessProjectState,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  SavedView
} from '@shared/ostler-api'
import {
  LIVE_LIST_MAX_BLOCKS,
  liveListMatches,
  LIVE_LIST_INFO,
  parseLiveListBlock,
  rewriteLiveListWords,
  type LiveListResult,
  type LiveListSpec
} from '@shared/live-list'
import { describeCondition, type FilterNames, type TaskFilter } from '@shared/task-filter'
import { TASK_STATUSES, taskStatusLabel } from '@shared/task-labels'
import { projectWorkItemStatus } from '@shared/work-item-status'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { PlanningService } from './planning-service'

/**
 * Live lists in notes (N4.4c): what each `ostler-tasks` block in one text
 * shows. The project's tasks, names and context are read once for the whole
 * text, and each block is one pass over them through `liveListMatches`, the
 * List's own filter code. Nothing is read per task.
 */
export function queryLiveLists(
  planning: PlanningService,
  projectId: string,
  blocks: unknown,
  harness: Pick<HarnessProjectState, 'taskQueue' | 'reviewSessions'> | null
): LiveListResult[] {
  if (!Array.isArray(blocks) || blocks.length > LIVE_LIST_MAX_BLOCKS)
    throw new Refusal(`Send a list of at most ${LIVE_LIST_MAX_BLOCKS} blocks`)
  const parsed = blocks.map((block) => parseLiveListBlock(block as string))
  if (parsed.every((entry) => !entry.ok)) return parsed.map(invalid)
  const items: PlanningWorkItem[] = planning.listWorkItems(projectId).map((item) => ({
    ...item,
    status: projectWorkItemStatus(item, harness)
  }))
  const context = planning.taskFilterContext(projectId)
  const words = liveListWords(planning, projectId)
  const people = new Map<string, string | null>()
  const personName = (id: string | null) => {
    if (!id) return null
    if (!people.has(id)) people.set(id, planning.personName(id))
    return people.get(id) ?? null
  }
  const views = new Map<string, SavedView>(
    planning.views.list(projectId).map((view) => [view.id, view])
  )
  return parsed.map((entry): LiveListResult => {
    if (!entry.ok) return invalid(entry)
    const { spec } = entry
    let filter: TaskFilter
    let query = ''
    let viewName: string | null = null
    if (spec.source.kind === 'view') {
      const view = views.get(spec.source.viewId)
      if (!view || view.isDefault)
        return { ok: false, reason: 'missingView', problem: t('library:liveList.missingView') }
      filter = view.config.filter
      query = view.config.query
      viewName = view.name
    } else {
      filter = spec.source.filter
    }
    const matching = liveListMatches(items, filter, query, context)
    const counts = new Map<PlanningWorkItemStatus, number>()
    for (const item of matching) counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
    return {
      ok: true,
      title: spec.title,
      words: words(viewName, filter, query),
      viewName,
      filter,
      query,
      total: matching.length,
      counts: TASK_STATUSES.filter((status) => counts.has(status)).map((status) => ({
        status,
        label: words.statusLabel(status),
        count: counts.get(status)!
      })),
      tasks: matching.slice(0, spec.limit).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        columnId: item.columnId ?? null,
        assigneeName: personName(item.assigneeId),
        targetDate: item.targetDate
      }))
    }
  })
}

function invalid(entry: { ok: false; problem: string } | { ok: true }): LiveListResult {
  return {
    ok: false,
    reason: 'invalid',
    problem: 'problem' in entry ? entry.problem : ''
  }
}

/**
 * A project's words for live lists: a block as one line ("Tasks where status
 * is In progress and label is design"), the line Ostler writes as the block's
 * `#` comment, and status names with the project's own column words.
 */
export function liveListWords(planning: PlanningService, projectId: string) {
  const columns = planning.columns.get(projectId)
  const milestones = planning.listMilestones(projectId)
  const goals = planning.listGoals(projectId)
  const iterations = planning.iterations.list(projectId)
  const types = planning.taskTypes.list(projectId)
  const fields = planning.listFields(projectId)
  const names: FilterNames = {
    person: (id) => planning.personName(id) ?? undefined,
    milestone: (id) => milestones.find((milestone) => milestone.id === id)?.name,
    goal: (id) => goals.find((goal) => goal.id === id)?.title,
    iteration: (id) => iterations.find((iteration) => iteration.id === id)?.name,
    taskType: (id) => types.find((type) => type.id === id)?.name,
    customField: (id) => fields.find((field) => field.id === id),
    columns
  }
  const describe = (viewName: string | null, filter: TaskFilter, query: string): string => {
    const parts = filter.conditions.map((condition) =>
      lowerFirst(describeCondition(condition, names))
    )
    if (query.trim()) parts.push(t('library:liveList.words.matching', { query: query.trim() }))
    const joiner = ` ${t(filter.match === 'any' ? 'library:liveList.words.or' : 'library:liveList.words.and')} `
    const conditions = parts.join(joiner)
    if (viewName !== null)
      return conditions
        ? t('library:liveList.words.viewWhere', { name: viewName, conditions })
        : t('library:liveList.words.view', { name: viewName })
    return conditions
      ? t('library:liveList.words.where', { conditions })
      : t('library:liveList.words.all')
  }
  return Object.assign(describe, {
    statusLabel: (status: PlanningWorkItemStatus) => lowerWord(taskStatusLabel(status, columns)),
    /** The `#` line for a block, or null for a view that is gone. */
    forSpec: (spec: LiveListSpec): string | null => {
      if (spec.source.kind === 'filter') return describe(null, spec.source.filter, '')
      const view = planning.views
        .list(projectId)
        .find((candidate) => candidate.id === (spec.source as { viewId: string }).viewId)
      if (!view || view.isDefault) return null
      return describe(view.name, view.config.filter, view.config.query)
    }
  })
}

/** "Status is …" to "status is …", for the middle of a sentence. */
function lowerFirst(text: string): string {
  return text ? lowerWord(text.split(' ')[0]) + text.slice(text.split(' ')[0].length) : text
}

/** A word in lower case, unless it is an acronym or a name written with capitals inside ("QA", "iOS"). */
function lowerWord(word: string): string {
  return /\p{Lu}/u.test(word.slice(1)) ? word : word.toLocaleLowerCase()
}

/**
 * A note's body with each live list's `#` words line written again (N4.4c),
 * as the Library saves it from any surface. Bodies with no block are returned
 * untouched, without reading anything.
 */
export function rewriteLiveListBody(
  planning: PlanningService,
  projectId: string,
  body: string
): string {
  if (!body.includes(LIVE_LIST_INFO)) return body
  const words = liveListWords(planning, projectId)
  return rewriteLiveListWords(body, words.forSpec)
}
