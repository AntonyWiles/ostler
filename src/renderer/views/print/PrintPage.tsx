import { currentIteration } from '@shared/planning/iterations'
import type { TaskContactMarks } from '@shared/contacts'
import { useEffect, useState } from 'react'
import type {
  PlanningColumnSettings,
  PlanningFieldDefinition,
  Person,
  PlanningGoal,
  PlanningIteration,
  PlanningMilestone,
  PlanningWorkItem,
  RendererProject,
  SavedViewConfig
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { taskCellText, taskCsvHeader } from '@shared/export/task-csv'
import {
  fieldColumnId,
  fieldComparer,
  groupTasks,
  listComparers,
  nestSubtasks,
  type ListTreeRow
} from '@shared/planning/list'
import { timelineBarSpan } from '@shared/planning/timeline'
import { describeCondition, EMPTY_TASK_FILTER, normalizeTaskFilter } from '@shared/task-filter'
import { TASK_STATUSES, taskStatusLabel } from '@shared/task-labels'
import { formatDate } from '@shared/format'
import type { PrintRoute } from '@shared/print-route'
import { applyTaskFilters } from '../../hooks/useTaskFilters'
import { sortRows, type RowComparer } from '../../ui/data-table-sort'
import {
  isListColumnShown,
  normalizeListSettings,
  withFieldColumns
} from '../planning/list/list-settings'
import { normalizeTimelineSettings } from '../planning/timeline/timeline-settings'
import { buildTimelineRows } from '../planning/timeline/timeline-rows'
import './PrintPage.css'
import { t } from '@shared/i18n'

const VIEW_NAMES = {
  get list() {
    return t('navigation:views.list.label')
  },
  get overview() {
    return t('navigation:views.overview.label')
  },
  get timeline() {
    return t('navigation:views.timeline.label')
  },
  get shopping() {
    return t('navigation:views.shopping.label')
  }
}

interface PrintData {
  project: RendererProject
  items: PlanningWorkItem[]
  milestones: PlanningMilestone[]
  goals: PlanningGoal[]
  people: Person[]
  commentCounts: Record<string, number>
  /** The contacts each task names (N6.5), for a Contact filter. */
  taskContacts: TaskContactMarks
  /** Contact names by id, for a Contact filter's words. */
  contactNames: Record<string, string>
  config: SavedViewConfig | null
  /** The project's custom fields (R2.2), for their columns, groups and filter words. */
  fields: PlanningFieldDefinition[]
  /** The project's column names and hidden columns (R2.4). */
  columns: PlanningColumnSettings | null
  /** The project's iterations (R6.1), for iteration filters. */
  iterations: PlanningIteration[]
}

async function unwrap<T>(call: Promise<{ ok: true; value: T } | { ok: false; error: string }>) {
  const result = await call
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Tells main the page is ready to print (or failed), on `<html>`. */
function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

/**
 * The print route (P6.1): a project's List, Overview or Timeline drawn in
 * full for paper or PDF, in the light theme, with no virtualisation and no
 * controls. A header names the project, the view, its filter and the date.
 * Main loads it in an offscreen window and waits for `data-print-ready`.
 */
export function PrintPage({ route }: { route: PrintRoute }) {
  const [data, setData] = useState<PrintData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const api = window.ostlerAPI
        const projects = await unwrap(api.getProjects())
        const project = projects.find((entry) => entry.id === route.projectId)
        if (!project) throw new Error(t('views:printPage.projectNotFound'))
        const [
          items,
          milestones,
          goals,
          people,
          commentCounts,
          saved,
          fields,
          columns,
          iterations,
          taskContacts,
          contacts
        ] = await Promise.all([
          unwrap(api.getPlanningWorkItems(project.id)),
          unwrap(api.getPlanningMilestones(project.id)),
          unwrap(api.getPlanningGoals(project.id)),
          unwrap(api.getPeople({ includeArchived: true })),
          unwrap(api.getPlanningCommentCounts(project.id)),
          route.view === 'overview' || route.view === 'shopping' || route.config
            ? Promise.resolve(null)
            : unwrap(api.getDefaultSavedView(project.id, route.view)),
          unwrap(api.getPlanningFields(project.id)),
          // Standard words if the column settings cannot be read.
          api.getPlanningColumnSettings().then((result) => (result.ok ? result.value : {})),
          typeof api.getPlanningIterations === 'function'
            ? api
                .getPlanningIterations(project.id)
                .then((result) => (result.ok ? result.value : []))
            : Promise.resolve([]),
          typeof api.projectTaskContacts === 'function'
            ? api.projectTaskContacts(project.id).then((result) => (result.ok ? result.value : {}))
            : Promise.resolve({}),
          typeof api.listContacts === 'function'
            ? api.listContacts().then((result) => (result.ok ? result.value : []))
            : Promise.resolve([])
        ])
        setData({
          project,
          items,
          milestones,
          goals,
          people,
          commentCounts,
          taskContacts,
          contactNames: Object.fromEntries(contacts.map((contact) => [contact.id, contact.name])),
          config: route.config ?? saved?.config ?? null,
          fields,
          columns: columns[project.id] ?? null,
          iterations
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        markReady('error')
      }
    })()
  }, [route])

  // Every row is on the page once the data has rendered.
  useEffect(() => {
    if (!data) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [data])

  if (error) return <p role="alert">{error}</p>
  if (!data) return null

  const personName = (id: string | null) =>
    (id && data.people.find((person) => person.id === id)?.name) || ''
  const milestoneName = (id: string | null) =>
    (id && data.milestones.find((milestone) => milestone.id === id)?.name) || ''
  const filter = normalizeTaskFilter(data.config?.filter ?? EMPTY_TASK_FILTER)
  const query = typeof data.config?.query === 'string' ? data.config.query : ''
  // The Timeline hides done work until "Show done" is ticked; the List shows it unless hidden.
  const hideDone =
    route.view === 'timeline'
      ? data.config?.options?.hideDone !== false
      : data.config?.options?.hideDone === true
  const filterWords = [
    ...filter.conditions.map((condition) =>
      describeCondition(condition, {
        person: (id) => personName(id) || undefined,
        milestone: (id) => milestoneName(id) || undefined,
        goal: (id) => data.goals.find((goal) => goal.id === id)?.title,
        iteration: (id) => data.iterations.find((iteration) => iteration.id === id)?.name,
        customField: (id) => data.fields.find((field) => field.id === id),
        contact: (id) => data.contactNames[id],
        columns: data.columns
      })
    ),
    ...(query ? [t('views:printPage.matching', { query })] : []),
    ...(hideDone ? [t('views:printPage.doneHidden')] : [])
  ]
  const me = data.people.find((person) => person.isMe)?.id ?? null
  const shown =
    route.view === 'overview'
      ? data.items
      : applyTaskFilters(
          data.items,
          { filter, query, hideDone },
          {
            projectedStatus: (item) => item.status,
            goalIdForItem: (item) =>
              data.milestones.find((milestone) => milestone.id === item.milestoneId)?.goalId ??
              null,
            commentCounts: data.commentCounts,
            taskContacts: data.taskContacts,
            meId: me,
            currentIterationId: currentIteration(data.iterations, todayIsoDate())?.id ?? null
          }
        )

  return (
    <div className="print-page">
      <header className="print-page__header">
        <h1>{data.project.name}</h1>
        <p>
          {t('views:printPage.subtitle', {
            view: VIEW_NAMES[route.view],
            count: shown.length,
            date: formatDate(Date.now())
          })}
        </p>
        {route.view !== 'overview' && (
          <p className="print-page__filter">
            {filterWords.length > 0
              ? filter.match === 'any' && filter.conditions.length > 1
                ? t('views:printPage.anyOf', { conditions: filterWords.join('; ') })
                : filterWords.join('; ')
              : t('views:printPage.allTasks')}
          </p>
        )}
      </header>
      {route.view === 'list' && (
        <PrintList
          data={data}
          items={shown}
          personName={personName}
          milestoneName={milestoneName}
        />
      )}
      {route.view === 'timeline' && <PrintTimeline data={data} items={shown} />}
      {route.view === 'overview' && (
        <PrintOverview data={data} personName={personName} milestoneName={milestoneName} />
      )}
      <footer className="print-page__footer">{t('views:printPage.printed')}</footer>
    </div>
  )
}

function PrintList({
  data,
  items,
  personName,
  milestoneName
}: {
  data: PrintData
  items: PlanningWorkItem[]
  personName: (id: string | null) => string
  milestoneName: (id: string | null) => string
}) {
  const settings = withFieldColumns(normalizeListSettings(data.config?.options ?? {}), data.fields)
  const columns = settings.columns
    .filter((column) => isListColumnShown(column, Boolean(data.project.taskPrefix)))
    .map((column) => column.id)
  const sorting = listComparers({
    status: (item) => item.status,
    personName,
    milestoneName,
    commentCount: (id) => data.commentCounts[id] ?? 0
  })
  const fieldSorting = Object.fromEntries(
    data.fields.map((field) => [fieldColumnId(field.id), fieldComparer(field)])
  )
  const comparers = Object.fromEntries(
    Object.entries({ ...sorting, ...fieldSorting }).map(([id, { compare, isEmpty }]) => [
      id,
      {
        compare: (a: PlanningWorkItem, b: PlanningWorkItem) => compare(a, b),
        isEmpty
      } satisfies RowComparer<PlanningWorkItem>
    ])
  )
  const order = (rows: PlanningWorkItem[]) => sortRows(rows, settings.sort, comparers)
  // The printout is not given the project's workstreams, so it does not group by them.
  const groupBy = settings.groupBy === 'subproject' ? 'none' : settings.groupBy
  const groups = groupTasks(items, groupBy, {
    projectedStatus: (item) => item.status,
    milestones: data.milestones,
    people: data.people,
    fields: data.fields,
    columns: data.columns
  })
  const context = {
    personName: (id: string) => personName(id) || null,
    milestoneName: (id: string) => milestoneName(id) || null,
    commentCount: (id: string) => data.commentCounts[id] ?? 0,
    estimateUnit: data.project.estimateUnit ?? 'points',
    fields: data.fields,
    columns: data.columns
  }
  const grouped = groupBy !== 'none'
  return (
    <table className="print-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {taskCsvHeader(column, context)}
            </th>
          ))}
        </tr>
      </thead>
      {groups
        .filter((group) => !grouped || group.items.length > 0)
        .map((group) => (
          <tbody key={group.key}>
            {grouped && (
              <tr className="print-table__group">
                <th colSpan={columns.length} scope="rowgroup">
                  {`${group.label} (${group.items.length})`}
                </th>
              </tr>
            )}
            {nestSubtasks(group.items, order, new Set()).map((row: ListTreeRow) => (
              <tr key={row.item.id}>
                {columns.map((column) => (
                  <td
                    key={column}
                    style={
                      column === 'title' && row.depth > 0
                        ? {
                            paddingInlineStart: `calc(var(--space-400) * ${row.depth + 0.5})`
                          }
                        : undefined
                    }
                  >
                    {column === 'checklist'
                      ? checklistText(row.item)
                      : taskCellText(row.item, column, context)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
    </table>
  )
}

function checklistText(item: PlanningWorkItem): string {
  if (item.acceptanceCriteria.length === 0) return ''
  const ticked = item.acceptanceCriteria.filter((text) => item.checkedCriteria.includes(text))
  return `${ticked.length}/${item.acceptanceCriteria.length}`
}

function PrintTimeline({ data, items }: { data: PrintData; items: PlanningWorkItem[] }) {
  const settings = normalizeTimelineSettings(data.config?.options ?? {})
  const rows = buildTimelineRows(items, {
    groupBy: settings.groupBy,
    collapsed: new Set(),
    milestones: data.milestones,
    people: new Map(data.people.map((person) => [person.id, person]))
  })
  const spans = rows.flatMap((row) =>
    row.kind === 'task' && row.bar ? [timelineBarSpan(row.bar)] : []
  )
  const first = spans.reduce((min, span) => (span.start < min ? span.start : min), todayIsoDate())
  const last = spans.reduce((max, span) => (span.end > max ? span.end : max), todayIsoDate())
  const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
  const total = Math.max(1, dayOf(last) - dayOf(first) + 1)
  const percent = (iso: string) => ((dayOf(iso) - dayOf(first)) / total) * 100
  return (
    <>
      <p className="print-page__range">{t('views:printPage.to', { first, last })}</p>
      <table className="print-table print-timeline">
        <thead>
          <tr>
            <th scope="col">{t('views:printPage.task')}</th>
            <th scope="col">{t('views:printPage.dates')}</th>
            <th scope="col" className="print-timeline__track-head">
              {t('views:printPage.schedule')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === 'group' ? (
              <tr key={row.id} className="print-table__group">
                <th colSpan={3} scope="rowgroup">{`${row.label} (${row.count})`}</th>
              </tr>
            ) : (
              <tr key={row.id}>
                <td>{row.item.title}</td>
                <td className="print-timeline__dates">
                  {row.bar
                    ? (() => {
                        const span = timelineBarSpan(row.bar)
                        return span.start === span.end ? span.start : `${span.start} – ${span.end}`
                      })()
                    : t('views:printPage.noDates')}
                </td>
                <td className="print-timeline__track">
                  {row.bar &&
                    (() => {
                      const span = timelineBarSpan(row.bar)
                      return (
                        <span
                          className={`print-timeline__bar is-${row.item.status}`}
                          style={{
                            insetInlineStart: `${percent(span.start)}%`,
                            width: `max(var(--space-100), ${((dayOf(span.end) - dayOf(span.start) + 1) / total) * 100}%)`
                          }}
                        />
                      )
                    })()}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </>
  )
}

function PrintOverview({
  data,
  personName,
  milestoneName
}: {
  data: PrintData
  personName: (id: string | null) => string
  milestoneName: (id: string | null) => string
}) {
  const today = todayIsoDate()
  const open = data.items.filter((item) => item.status !== 'done')
  const overdue = open.filter((item) => item.targetDate !== null && item.targetDate < today)
  const done = data.items.length - open.length
  return (
    <>
      <dl className="print-stats">
        <div>
          <dt>{t('views:printPage.open')}</dt>
          <dd>{open.length}</dd>
        </div>
        <div>
          <dt>{t('views:printPage.done')}</dt>
          <dd>{done}</dd>
        </div>
        <div>
          <dt>{t('views:printPage.overdue')}</dt>
          <dd>{overdue.length}</dd>
        </div>
        <div>
          <dt>{t('views:printPage.milestones')}</dt>
          <dd>{data.milestones.length}</dd>
        </div>
      </dl>
      {data.milestones.length > 0 && (
        <section>
          <h2>{t('views:printPage.milestones')}</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">{t('views:printPage.milestone')}</th>
                <th scope="col">{t('views:printPage.target')}</th>
                <th scope="col">{t('views:printPage.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {data.milestones.map((milestone) => {
                const tasks = data.items.filter((item) => item.milestoneId === milestone.id)
                const finished = tasks.filter((item) => item.status === 'done').length
                return (
                  <tr key={milestone.id}>
                    <td>{milestone.name}</td>
                    <td>{milestone.targetDate ?? ''}</td>
                    <td>{t('views:printPage.tasksDone', { count: tasks.length, finished })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
      {TASK_STATUSES.filter((status) => status !== 'done').map((status) => {
        const tasks = data.items.filter((item) => item.status === status)
        if (tasks.length === 0) return null
        return (
          <section key={status}>
            <h2>{`${taskStatusLabel(status, data.columns)} (${tasks.length})`}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">{t('views:printPage.task')}</th>
                  <th scope="col">{t('views:printPage.assignee')}</th>
                  <th scope="col">{t('views:printPage.due')}</th>
                  <th scope="col">{t('views:printPage.milestone')}</th>
                </tr>
              </thead>
              <tbody>
                {tasks
                  .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>{personName(item.assigneeId)}</td>
                      <td>{item.targetDate ?? ''}</td>
                      <td>{milestoneName(item.milestoneId)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </>
  )
}
