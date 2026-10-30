import type {
  Person,
  PlanningMilestone,
  PlanningSubproject,
  PlanningWorkItem,
  TimelineOverviewProject
} from '../ostler-api'
import { isoWeekday, shiftIsoDate } from '../dates'
import { groupProjectsByArea, type ProjectArea } from '../project-areas'
import { taskTimelineBar } from './timeline'
import { buildTimelineRows, type TimelineRow } from './timeline-rows'

/**
 * The Timeline across projects (N5.4): which projects it shows, and the weeks
 * where milestones from different projects meet. Pure, so the view, the print
 * page and the tests share one rule.
 */

/** Which projects the Timeline across projects shows. */
export type TimelineOverviewFilter =
  { kind: 'all' } | { kind: 'area'; areaId: string } | { kind: 'chosen'; projectIds: string[] }

/** The projects `filter` keeps, in their order. An area of null means No area. */
export function filterOverviewProjects<T extends { id: string; areaId?: string | null }>(
  projects: readonly T[],
  filter: TimelineOverviewFilter
): T[] {
  if (filter.kind === 'all') return [...projects]
  if (filter.kind === 'area') return projects.filter((project) => project.areaId === filter.areaId)
  const chosen = new Set(filter.projectIds)
  return projects.filter((project) => chosen.has(project.id))
}

/** A milestone in a week where milestones meet. */
export interface MeetingMilestone {
  projectId: string
  milestoneId: string
  name: string
  targetDate: string
}

/** A week holding milestones from two or more projects. */
export interface MeetingWeek {
  /** The week's first and last day, `YYYY-MM-DD`. */
  start: string
  end: string
  milestones: MeetingMilestone[]
  /** How many projects the milestones come from: always 2 or more. */
  projectCount: number
}

/** The first day of the week holding `date`; `weekStart` is 0 for Sunday to 6 for Saturday. */
export function weekStartOf(date: string, weekStart: number): string {
  return shiftIsoDate(date, -((isoWeekday(date) - weekStart + 7) % 7))
}

/**
 * The weeks where milestones from different projects meet, by date. One
 * project with two milestones in a week is not a meeting: it takes two
 * projects. Milestones are listed by date, then name.
 */
export function meetingWeeks(
  projects: readonly Pick<TimelineOverviewProject, 'projectId' | 'milestones'>[],
  weekStart: number
): MeetingWeek[] {
  const weeks = new Map<string, MeetingMilestone[]>()
  for (const project of projects)
    for (const milestone of project.milestones) {
      const start = weekStartOf(milestone.targetDate, weekStart)
      const list = weeks.get(start) ?? []
      list.push({
        projectId: project.projectId,
        milestoneId: milestone.id,
        name: milestone.name,
        targetDate: milestone.targetDate
      })
      weeks.set(start, list)
    }
  const result: MeetingWeek[] = []
  for (const [start, milestones] of weeks) {
    const projectCount = new Set(milestones.map((milestone) => milestone.projectId)).size
    if (projectCount < 2) continue
    milestones.sort(
      (a, b) => a.targetDate.localeCompare(b.targetDate) || a.name.localeCompare(b.name)
    )
    result.push({ start, end: shiftIsoDate(start, 6), milestones, projectCount })
  }
  return result.sort((a, b) => a.start.localeCompare(b.start))
}

/** An opened project's plan, read once when its row opened. */
export interface OpenedProjectPlan {
  /** Its tasks to draw: the caller leaves out done ones, as the project Timeline does. */
  items: readonly PlanningWorkItem[]
  milestones: readonly PlanningMilestone[]
  /** Its sub-projects (shown as workstreams), archived ones included; left out when it has none. */
  subprojects?: readonly PlanningSubproject[]
}

/** A row on the Timeline across projects. */
export type TimelineOverviewRow<P> =
  | {
      kind: 'area'
      id: string
      /** The area, or null for No area. */
      area: ProjectArea | null
    }
  | {
      kind: 'project'
      id: string
      project: P
      /** Its milestones and date span; null until the first read. */
      entry: TimelineOverviewProject | null
      open: boolean
    }
  | {
      kind: 'subproject'
      /** The project's rows prefix, `sub:`, and the sub-project's id. */
      id: string
      projectId: string
      subproject: PlanningSubproject
      /** Its rows are shown; false when it is folded. */
      open: boolean
    }
  | {
      kind: 'note'
      id: string
      projectId: string
      /** An opened project still reading, or one with nothing dated to show. */
      note: 'loading' | 'empty'
    }
  | {
      kind: 'task'
      /** The project's id, `:`, and the project Timeline's row id. */
      id: string
      projectId: string
      row: TimelineRow
    }

/** The prefix an opened project's rows carry, so rows from two projects never share an id. */
export function openedRowPrefix(projectId: string): string {
  return `${projectId}:`
}

/** The id a sub-project's row carries, and the prefix on the ids of the rows under it. */
export function subprojectRowId(projectId: string, subprojectId: string): string {
  return `${openedRowPrefix(projectId)}sub:${subprojectId}`
}

/**
 * Every row of the Timeline across projects: one per project, in areas when
 * there are any (N5.1's one grouping; empty areas left out), and under an
 * opened project its dated tasks grouped by milestone, built by the project
 * Timeline's own `buildTimelineRows`. A project opened but not read yet shows
 * a loading row.
 */
export function buildTimelineOverviewRows<P extends { id: string; areaId?: string | null }>(input: {
  projects: readonly P[]
  areas: readonly ProjectArea[]
  overview: readonly TimelineOverviewProject[] | null
  /** The opened projects: their plan, or null while it is read. */
  opened: ReadonlyMap<string, OpenedProjectPlan | null>
  people: ReadonlyMap<string, Person>
  /** The ids of sub-projects folded shut. */
  collapsedSubprojects?: ReadonlySet<string>
}): TimelineOverviewRow<P>[] {
  const entries = new Map((input.overview ?? []).map((entry) => [entry.projectId, entry]))
  const rows: TimelineOverviewRow<P>[] = []
  const groups = groupProjectsByArea(input.projects, input.areas).filter(
    (group) => group.projects.length > 0
  )
  for (const group of groups) {
    if (input.areas.length > 0)
      rows.push({ kind: 'area', id: `area:${group.area?.id ?? 'none'}`, area: group.area })
    for (const project of group.projects) {
      const open = input.opened.has(project.id)
      rows.push({
        kind: 'project',
        id: `project:${project.id}`,
        project,
        entry: entries.get(project.id) ?? null,
        open
      })
      if (!open) continue
      const plan = input.opened.get(project.id)
      const prefix = openedRowPrefix(project.id)
      if (!plan) {
        rows.push({ kind: 'note', id: `${prefix}loading`, projectId: project.id, note: 'loading' })
        continue
      }
      const dated = plan.items.filter((item) => taskTimelineBar(item) !== null)
      // A project's live sub-projects are rows of their own under it (D15); work in none
      // of them, or in an archived one, stays on the project's own rows.
      const live = (plan.subprojects ?? []).filter((sub) => sub.archivedAt === null)
      const liveIds = new Set(live.map((sub) => sub.id))
      const inSub = (subprojectId: string | null | undefined) =>
        subprojectId != null && liveIds.has(subprojectId)
      const section = (
        items: readonly PlanningWorkItem[],
        milestones: readonly PlanningMilestone[],
        idPrefix: string
      ): TimelineRow[] =>
        buildTimelineRows(items, {
          groupBy: 'milestone',
          collapsed: new Set(),
          milestones,
          people: input.people
        }).map((row) => (idPrefix ? { ...row, id: `${idPrefix}${row.id}` } : row))
      const own = section(
        dated.filter((item) => !inSub(item.subprojectId)),
        plan.milestones.filter((milestone) => !inSub(milestone.subprojectId)),
        ''
      )
      const subs = live.flatMap((sub) => {
        const id = subprojectRowId(project.id, sub.id)
        const inner = section(
          dated.filter((item) => item.subprojectId === sub.id),
          plan.milestones.filter((milestone) => milestone.subprojectId === sub.id),
          `sub:${sub.id}:`
        )
        if (inner.length === 0) return []
        const open = !input.collapsedSubprojects?.has(sub.id)
        const head: TimelineOverviewRow<P> = {
          kind: 'subproject',
          id,
          projectId: project.id,
          subproject: sub,
          open
        }
        return [
          head,
          ...(open
            ? inner.map((row): TimelineOverviewRow<P> => ({
                kind: 'task',
                id: `${prefix}${row.id}`,
                projectId: project.id,
                row
              }))
            : [])
        ]
      })
      if (own.length === 0 && subs.length === 0)
        rows.push({ kind: 'note', id: `${prefix}empty`, projectId: project.id, note: 'empty' })
      for (const row of own)
        rows.push({ kind: 'task', id: `${prefix}${row.id}`, projectId: project.id, row })
      rows.push(...subs)
    }
  }
  return rows
}
