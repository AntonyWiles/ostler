import type Database from 'better-sqlite3'
import type { Person, TeamOverviewQuery, TeamOverviewRow, WatchedProject } from '@shared/ostler-api'
import { shiftIsoDate } from '@shared/dates'
import { weekCapacityHours, workloadWeekStart } from '@shared/planning/workload'
import type { DayOffSpan } from '@shared/planning/working-days'

/** A day off or a shared away span with the person it belongs to (null: everyone). */
export type TeamAwaySpan = DayOffSpan

/** What the Team view reads besides tasks, so the rules stay testable without services. */
export interface TeamOverviewDeps {
  /** Everyone not archived: the address book and project people. */
  people(): Person[]
  /** The people in a team, or null when there is no such team. */
  teamMemberIds(teamId: string): string[] | null
  /** Away spans touching `from` to `through`: Me's days off, bank holidays, others' shared away. */
  awaySpans(from: string, through: string, projectIds: string[]): TeamAwaySpan[]
  /** People who are members of a shared project among `projectIds`. */
  sharedMemberIds(projectIds: string[]): string[]
}

const DAY_MS = 86_400_000
/** Started work not touched for this many days counts as stalled. */
const STALLED_DAYS = 7
/** Away spans starting within this many days are listed. */
const AWAY_AHEAD_DAYS = 14

function localMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

interface TaskRow {
  assignee_id: string
  project_id: string
  status: string
  target_date: string | null
  updated_at: number
  blocked: number
}

/**
 * The Team view's one call (team-leaders plan, D4): a row per person across the enabled
 * projects (or the chosen ones). One SQL query per measure, none per person: open work, logged
 * time, last activity, and (through `deps`) people, teams and away days. Done, archived, deleted
 * and triage tasks never count. Rows are sorted by name; with a team chosen only its members
 * (not archived) appear, otherwise anyone with an open task, time this week, or a place in a
 * shared project in scope.
 */
export function queryTeamOverview(
  db: Database.Database,
  projects: readonly WatchedProject[],
  query: TeamOverviewQuery,
  deps: TeamOverviewDeps
): TeamOverviewRow[] {
  const scope = (
    query.projectIds
      ? projects.filter((project) => query.projectIds!.includes(project.id))
      : projects
  ).map((project) => project.id)
  const people = deps.people().filter((person) => person.archivedAt === null)
  const byId = new Map(people.map((person) => [person.id, person]))

  const today = query.today
  const weekStart = workloadWeekStart(today)
  const weekEnd = shiftIsoDate(weekStart, 6)
  const startMs = localMidnight(weekStart)
  const endMs = localMidnight(shiftIsoDate(weekStart, 7))
  const stalledBefore = localMidnight(today) - STALLED_DAYS * DAY_MS

  const rows = new Map<string, TeamOverviewRow>()
  const rowFor = (personId: string): TeamOverviewRow => {
    let row = rows.get(personId)
    if (!row) {
      row = {
        personId,
        open: 0,
        overdue: 0,
        dueThisWeek: 0,
        blocked: 0,
        waitingForSignOff: 0,
        stalled: 0,
        hoursThisWeek: 0,
        capacityThisWeek: null,
        awayDays: [],
        lastActiveAt: null,
        projectIds: []
      }
      rows.set(personId, row)
    }
    return row
  }

  // Open work, per person: one query over the projects in scope.
  if (scope.length > 0) {
    const tasks = db
      .prepare(
        `SELECT w.assignee_id, w.project_id, w.status, w.target_date, w.updated_at,
                EXISTS (SELECT 1 FROM planning_blockers b
                        WHERE b.work_item_id = w.id AND b.status = 'open') AS blocked
         FROM planning_work_items w
         WHERE w.project_id IN (${scope.map(() => '?').join(', ')})
           AND w.assignee_id IS NOT NULL
           AND w.archived_at IS NULL AND w.deleted_at IS NULL AND w.status <> 'done'
           AND w.in_triage = 0`
      )
      .all(...scope) as TaskRow[]
    const projectsOf = new Map<string, Set<string>>()
    for (const task of tasks) {
      if (!byId.has(task.assignee_id)) continue
      const row = rowFor(task.assignee_id)
      row.open++
      if (task.target_date !== null) {
        if (task.target_date < today) row.overdue++
        if (task.target_date >= weekStart && task.target_date <= weekEnd) row.dueThisWeek++
      }
      if (task.blocked) row.blocked++
      if (task.status !== 'backlog' && task.status !== 'ready' && task.updated_at < stalledBefore)
        row.stalled++
      const set = projectsOf.get(task.assignee_id) ?? new Set<string>()
      set.add(task.project_id)
      projectsOf.set(task.assignee_id, set)
    }
    for (const [personId, set] of projectsOf) rowFor(personId).projectIds = [...set].sort()

    // Their open tasks that wait for someone's sign-off (prompt 17): one query, one count per task.
    const waiting = db
      .prepare(
        `SELECT w.assignee_id, COUNT(*) AS waiting
         FROM planning_work_items w
         WHERE w.project_id IN (${scope.map(() => '?').join(', ')})
           AND w.assignee_id IS NOT NULL
           AND w.archived_at IS NULL AND w.deleted_at IS NULL AND w.status <> 'done'
           AND w.in_triage = 0
           AND EXISTS (SELECT 1 FROM planning_sign_offs s
                       WHERE s.item_kind = 'task' AND s.item_id = w.id AND s.state = 'waiting')
         GROUP BY w.assignee_id`
      )
      .all(...scope) as { assignee_id: string; waiting: number }[]
    for (const entry of waiting) {
      if (byId.has(entry.assignee_id)) rowFor(entry.assignee_id).waitingForSignOff = entry.waiting
    }
  }

  // Time logged this week, in every project: finished entries only.
  const time = db
    .prepare(
      `SELECT person_id, SUM(duration_seconds) AS seconds FROM planning_time_entries
       WHERE person_id IS NOT NULL AND duration_seconds IS NOT NULL
         AND started_at >= ? AND started_at < ?
       GROUP BY person_id`
    )
    .all(startMs, endMs) as { person_id: string; seconds: number }[]
  for (const entry of time) {
    if (byId.has(entry.person_id) && entry.seconds > 0)
      rowFor(entry.person_id).hoursThisWeek = entry.seconds / 3600
  }

  // Last activity: a change to a task or a comment, whichever is later.
  const lastActive = new Map<string, number>()
  if (scope.length > 0) {
    const marks = scope.map(() => '?').join(', ')
    const activity = db
      .prepare(
        `SELECT person_id, MAX(at) AS at FROM (
           SELECT actor_person_id AS person_id, at FROM planning_field_changes
           WHERE actor_person_id IS NOT NULL AND project_id IN (${marks})
           UNION ALL
           SELECT author_person_id AS person_id, created_at AS at FROM planning_comments
           WHERE author_person_id IS NOT NULL AND deleted_at IS NULL AND project_id IN (${marks})
         ) GROUP BY person_id`
      )
      .all(...scope, ...scope) as { person_id: string; at: number }[]
    for (const entry of activity) {
      if (byId.has(entry.person_id)) lastActive.set(entry.person_id, entry.at)
    }
  }

  // Who is listed.
  let listed: Set<string>
  if (query.teamId) {
    listed = new Set((deps.teamMemberIds(query.teamId) ?? []).filter((id) => byId.has(id)))
  } else {
    listed = new Set(rows.keys())
    if (scope.length > 0)
      for (const id of deps.sharedMemberIds(scope)) if (byId.has(id)) listed.add(id)
  }

  // Away days and capacity, from one list of spans.
  const awayThrough = shiftIsoDate(today, AWAY_AHEAD_DAYS)
  const spans = deps.awaySpans(
    weekStart < today ? weekStart : today,
    weekEnd > awayThrough ? weekEnd : awayThrough,
    scope
  )

  const result: TeamOverviewRow[] = []
  for (const personId of listed) {
    const person = byId.get(personId)!
    const row = rowFor(personId)
    row.lastActiveAt = lastActive.get(personId) ?? null
    const capacity = weekCapacityHours(
      person.weeklyCapacityHours,
      weekStart,
      personId,
      person.workingDays,
      spans
    )
    row.capacityThisWeek = capacity ? capacity.hours : null
    const seen = new Set<string>()
    for (const span of spans) {
      if (span.personId !== personId) continue
      if (span.lastDate < today || span.firstDate > awayThrough) continue
      const key = `${span.firstDate}|${span.lastDate}`
      if (seen.has(key)) continue
      seen.add(key)
      row.awayDays.push({ firstDate: span.firstDate, lastDate: span.lastDate })
    }
    row.awayDays.sort(
      (a, b) => a.firstDate.localeCompare(b.firstDate) || a.lastDate.localeCompare(b.lastDate)
    )
    result.push(row)
  }
  result.sort((a, b) =>
    byId.get(a.personId)!.name.localeCompare(byId.get(b.personId)!.name, undefined, {
      sensitivity: 'base'
    })
  )
  return result
}

/** The deps read straight from the Ostler database, with people supplied by the caller. */
export function sqlTeamOverviewDeps(
  db: Database.Database,
  people: () => Person[]
): TeamOverviewDeps {
  return {
    people,
    teamMemberIds(teamId) {
      const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)
      if (!team) return null
      return (
        db.prepare('SELECT person_id FROM team_members WHERE team_id = ?').all(teamId) as {
          person_id: string
        }[]
      ).map((row) => row.person_id)
    },
    awaySpans(from, through, projectIds) {
      const own = db
        .prepare(
          `SELECT person_id, first_date, last_date, name FROM days_off
           WHERE last_date >= ? AND first_date <= ?`
        )
        .all(from, through) as {
        person_id: string | null
        first_date: string
        last_date: string
        name: string
      }[]
      const spans: TeamAwaySpan[] = own.map((row) => ({
        personId: row.person_id,
        firstDate: row.first_date,
        lastDate: row.last_date,
        name: row.name
      }))
      if (projectIds.length > 0) {
        const shared = db
          .prepare(
            `SELECT DISTINCT person_id, first_date, last_date FROM shared_away
             WHERE project_id IN (${projectIds.map(() => '?').join(', ')})
               AND last_date >= ? AND first_date <= ?`
          )
          .all(...projectIds, from, through) as {
          person_id: string
          first_date: string
          last_date: string
        }[]
        for (const row of shared)
          spans.push({
            personId: row.person_id,
            firstDate: row.first_date,
            lastDate: row.last_date,
            name: ''
          })
      }
      return spans
    },
    sharedMemberIds(projectIds) {
      if (projectIds.length === 0) return []
      return (
        db
          .prepare(
            `SELECT DISTINCT m.person_id FROM sync_shares s
             JOIN sync_members m ON m.share_id = s.share_id
             WHERE s.project_id IN (${projectIds.map(() => '?').join(', ')})
               AND m.person_id IS NOT NULL`
          )
          .all(...projectIds) as { person_id: string }[]
      ).map((row) => row.person_id)
    }
  }
}
