import type {
  CalendarExportOptions,
  PlanningComment,
  PlanningWorkItem,
  ShareReportOptions,
  TaskCsvExportRequest,
  TimeEntryQuery,
  TimelineSlidesExportOptions,
  WatchedProject
} from '@shared/ostler-api'
import { buildCalendarFile } from '@shared/export/calendar-ics'
import {
  buildTimelinePptx,
  defaultSlideRange,
  validateSlideRange
} from '@shared/export/timeline-pptx'
import { buildTimelineRows } from '@shared/planning/timeline-rows'
import { todayIsoDate } from '@shared/dates'
import { buildShareReport, normalizeShareReportOptions } from '@shared/export/share-report'
import { allTaskCsvColumns, isTaskCsvColumn, tasksToCsv } from '@shared/export/task-csv'
import { timeEntriesToCsv } from '@shared/export/time-csv'
import { timeReportToCsv } from '@shared/export/time-report-csv'
import type { TimeReport } from '@shared/time/billing'
import { costsToCsv } from '@shared/export/costs-csv'
import type { CostQuery } from '@shared/money'
import { fieldIdOf } from '@shared/planning/list'
import type { PlanningService } from './planning-service'
import type { ReportService } from './report-service'
import { PeopleRepository } from './database/people-repository'
import { renderShareMarkdown } from './share-report-markdown'
import { queryTimeBlocks } from './time-block-service'

/**
 * Tasks as CSV (P6.1) for the List's "Export to CSV…", "Export all tasks"
 * and `GET /export?format=csv`: one builder over `tasksToCsv`, so every
 * surface writes the same file. Main resolves names itself; the renderer
 * sends only ids and column names.
 */
export function buildTasksCsv(
  planning: PlanningService,
  project: WatchedProject,
  request: TaskCsvExportRequest = {}
): { text: string; taskCount: number } {
  const live = planning.listWorkItems(project.id)
  let tasks: PlanningWorkItem[]
  if (Array.isArray(request?.taskIds)) {
    const byId = new Map(live.map((task) => [task.id, task]))
    tasks = request.taskIds.flatMap((id) => {
      const task = typeof id === 'string' ? byId.get(id) : undefined
      return task ? [task] : []
    })
  } else {
    tasks = [...live].sort((a, b) => a.createdAt - b.createdAt)
  }
  const fields = planning.listFields(project.id)
  const iterations = new Map(
    planning.iterations.list(project.id).map((iteration) => [iteration.id, iteration.name])
  )
  const types = new Map(planning.taskTypes.list(project.id).map((type) => [type.id, type.name]))
  const known = new Set(fields.map((field) => field.id))
  const columns = Array.isArray(request?.columns)
    ? [
        ...new Set(
          request.columns
            .filter(isTaskCsvColumn)
            // A column for a field the project no longer has is left out.
            .filter((column) => {
              const fieldId = fieldIdOf(column)
              return fieldId === null || known.has(fieldId)
            })
        )
      ]
    : allTaskCsvColumns(fields, { iterations: iterations.size > 0, types: types.size > 0 })
  const totals = planning.time.totals(project.id)
  // Export all tasks carries the time logged once the project has any (R2.3).
  if (!Array.isArray(request?.columns) && Object.keys(totals).length > 0) columns.push('timeLogged')
  // Edit in Excel (N2.8): the ID column first, so Bring changes back can match rows.
  if (request?.withIds === true) {
    const at = columns.indexOf('id')
    if (at >= 0) columns.splice(at, 1)
    columns.unshift('id')
  }
  if (columns.length === 0) throw new Error('Choose at least one column to export')

  const people = peopleNames(planning)
  const milestones = new Map(
    planning.listMilestones(project.id).map((milestone) => [milestone.id, milestone.name])
  )
  const comments = planning.commentCounts(project.id)
  const text = tasksToCsv(tasks, columns, {
    personName: (id) => people.get(id) ?? null,
    milestoneName: (id) => milestones.get(id) ?? null,
    iterationName: (id) => iterations.get(id) ?? null,
    typeName: (id) => types.get(id) ?? null,
    commentCount: (id) => comments[id] ?? 0,
    estimateUnit: project.estimateUnit ?? 'points',
    fields,
    timeLogged: (id) => totals[id] ?? 0,
    columns: planning.columns.get(project.id)
  })
  return { text, taskCount: tasks.length }
}

/**
 * Time entries as CSV (R2.3) for the Timesheet's Export CSV and
 * `GET /time-entries?format=csv`: entries that started in the range, in the
 * projects asked for (every known project by default), by one writer.
 */
export function buildTimeEntriesCsv(
  planning: PlanningService,
  projects: readonly WatchedProject[],
  query: TimeEntryQuery,
  now = Date.now()
): { text: string; entryCount: number } {
  const entries = planning.time.list(
    query,
    projects.map((project) => project.id)
  )
  const people = peopleNames(planning)
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const text = timeEntriesToCsv(entries, {
    projectName: (id) => names.get(id) ?? '',
    personName: (id) => people.get(id) ?? null,
    now
  })
  return { text, entryCount: entries.length }
}

/**
 * A project's Time report as CSV (N6.4) for the report's Export CSV and
 * `GET /time-report?format=csv`: the same report the view shows.
 */
export function buildTimeReportCsv(
  planning: PlanningService,
  projectId: string,
  from: unknown,
  to: unknown
): { text: string; report: TimeReport } {
  const report = planning.billing.report(projectId, from, to)
  const people = peopleNames(planning)
  return { text: timeReportToCsv(report, (id) => people.get(id) ?? null), report }
}

/**
 * A project's costs as CSV (N6.3a) for the Costs view's Export costs to CSV
 * and `GET /costs?format=csv`, with the same filters as the list.
 */
export function buildCostsCsv(
  planning: PlanningService,
  projectId: string,
  query: CostQuery = {}
): { text: string; costCount: number } {
  const costs = planning.costs.list(projectId, query)
  const { currency } = planning.costs.getBudget(projectId)
  const titles = new Map(
    (
      planning.database
        .prepare('SELECT id, title FROM planning_work_items WHERE project_id = ?')
        .all(projectId) as { id: string; title: string }[]
    ).map((row) => [row.id, row.title])
  )
  const milestones = new Map(
    planning.listMilestones(projectId).map((milestone) => [milestone.id, milestone.name])
  )
  const text = costsToCsv(costs, {
    currency,
    taskTitle: (id) => titles.get(id) ?? null,
    milestoneName: (id) => milestones.get(id) ?? null
  })
  return { text, costCount: costs.length }
}

/** Every live comment in the project, by task id, oldest first. */
function commentsByTask(
  planning: PlanningService,
  projectId: string
): Record<string, PlanningComment[]> {
  const result: Record<string, PlanningComment[]> = {}
  for (const task of planning.listWorkItems(projectId)) {
    const comments = planning.listComments(task.id)
    if (comments.length > 0) result[task.id] = comments
  }
  return result
}

function peopleNames(planning: PlanningService): Map<string, string> {
  return new Map(
    new PeopleRepository(planning.database).list(true).map((person) => [person.id, person.name])
  )
}

/**
 * Due dates as a calendar file (R4.1, D37) for "Export to calendar file…"
 * and `GET /export?format=ics`: one builder over `buildCalendarFile`.
 * Time blocks (N3.4a) only when asked, every one the project has.
 */
export function buildProjectCalendarFile(
  planning: PlanningService,
  project: WatchedProject,
  options: CalendarExportOptions = {},
  now = Date.now()
): { text: string; eventCount: number } {
  const people = peopleNames(planning)
  return buildCalendarFile({
    project,
    tasks: planning.listWorkItems(project.id),
    milestones: planning.listMilestones(project.id),
    personName: (id) => people.get(id) ?? null,
    columns: planning.columns.get(project.id),
    options: {
      includeFinished: options?.includeFinished === true,
      includeBlocks: options?.includeBlocks === true
    },
    blocks:
      options?.includeBlocks === true
        ? queryTimeBlocks(planning.database, [project.id], '0001-01-01', '9999-12-31')
        : [],
    now
  })
}

/**
 * The Timeline as PowerPoint slides (N7.6, N54) for "Export to PowerPoint
 * slide…" and `GET /export?format=pptx`: the Timeline's own rows
 * (`buildTimelineRows`) over its tasks, drawn by `buildTimelinePptx`.
 */
export function buildProjectTimelineSlides(
  planning: PlanningService,
  project: WatchedProject,
  options: TimelineSlidesExportOptions = {},
  now = Date.now()
): { bytes: Uint8Array; slideCount: number; undatedCount: number } {
  const zoom = options?.zoom ?? 'month'
  if (zoom !== 'week' && zoom !== 'month' && zoom !== 'quarter')
    throw new Error('zoom must be week, month or quarter')
  const groupBy = options?.groupBy ?? 'milestone'
  if (groupBy !== 'milestone' && groupBy !== 'assignee' && groupBy !== 'none')
    throw new Error('groupBy must be milestone, assignee or none')
  const live = planning.listWorkItems(project.id)
  let tasks: PlanningWorkItem[]
  if (Array.isArray(options?.taskIds)) {
    const wanted = new Set(options.taskIds.filter((id) => typeof id === 'string'))
    tasks = live.filter((task) => wanted.has(task.id))
  } else {
    tasks = options?.includeFinished === true ? live : live.filter((task) => task.status !== 'done')
  }
  const people = new Map(
    new PeopleRepository(planning.database).list(true).map((person) => [person.id, person])
  )
  const collapsed = new Set(
    Array.isArray(options?.collapsed)
      ? options.collapsed.filter((key) => typeof key === 'string')
      : []
  )
  const rows = buildTimelineRows(tasks, {
    groupBy,
    collapsed,
    milestones: planning.listMilestones(project.id),
    people
  })
  const today = todayIsoDate(new Date(now))
  const fallback = defaultSlideRange(rows, today)
  const from = options?.from ?? fallback.from
  const to = options?.to ?? fallback.to
  validateSlideRange(from, to)
  return buildTimelinePptx({
    projectName: project.name,
    projectColor: project.color,
    rows,
    from,
    to,
    zoom,
    today
  })
}

/**
 * The project as one web page (R4.1, D37) for "Share as a web page…" and
 * `GET /export?format=html`. The key numbers are the Overview's own (the
 * last 30 days); Library files are never included.
 */
export function buildProjectShareReport(
  planning: PlanningService,
  reports: ReportService,
  project: WatchedProject,
  options: ShareReportOptions = {},
  now = Date.now()
): string {
  const resolved = normalizeShareReportOptions(options)
  const people = peopleNames(planning)
  return buildShareReport({
    project,
    keyNumbers: reports.getReport(project, '30d', now).keyNumbers,
    tasks: planning.listWorkItems(project.id),
    milestones: planning.listMilestones(project.id),
    decisions: resolved.decisions ? planning.listDecisions(project.id) : [],
    goals: resolved.goals || resolved.milestoneDetails ? planning.listGoals(project.id) : [],
    goalCheckIns: resolved.goals ? planning.goalCheckIns.listForProject(project.id) : {},
    comments: resolved.comments ? commentsByTask(planning, project.id) : {},
    commentAuthor: (comment) =>
      comment.authorPersonId ? (people.get(comment.authorPersonId) ?? null) : null,
    statusUpdate: resolved.statusUpdate ? planning.statusUpdates.latest(project.id) : null,
    personName: (id) => people.get(id) ?? null,
    columns: planning.columns.get(project.id),
    options: resolved,
    now,
    renderMarkdown: renderShareMarkdown
  })
}
