import type Database from 'better-sqlite3'
import type {
  PlanningMilestoneStatus,
  TimelineOverviewProject,
  WatchedProject
} from '@shared/ostler-api'

interface OverviewRow {
  kind: 'milestone' | 'span'
  project_id: string
  id: string | null
  name: string | null
  status: string | null
  first_date: string | null
  last_date: string | null
}

/**
 * The Timeline across projects' first draw (N5.4): every one of `projects`'
 * dated milestones (archived ones left out) and the first and last day of its dated live tasks, in one
 * query. Tasks themselves are read only for the rows a person opens, through
 * the project's own planning calls. Every project gets an entry, dated or not,
 * so the list of projects is complete; they come back in `projects`' order.
 */
export function queryTimelineOverview(
  db: Database.Database,
  projects: readonly WatchedProject[]
): TimelineOverviewProject[] {
  if (projects.length === 0) return []
  const ids = projects.map((project) => project.id)
  const marks = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT 'milestone' AS kind, project_id, id, name, status,
              target_date AS first_date, target_date AS last_date
       FROM planning_milestones
       WHERE project_id IN (${marks}) AND target_date IS NOT NULL AND target_date <> ''
         AND status <> 'archived'
       UNION ALL
       SELECT 'span' AS kind, project_id, NULL, NULL, NULL,
              MIN(COALESCE(start_date, target_date)), MAX(COALESCE(target_date, start_date))
       FROM planning_work_items
       WHERE project_id IN (${marks}) AND archived_at IS NULL AND deleted_at IS NULL
         AND in_triage = 0 AND COALESCE(start_date, target_date) IS NOT NULL
       GROUP BY project_id
       ORDER BY first_date, name`
    )
    .all(...ids, ...ids) as OverviewRow[]
  const byId = new Map<string, TimelineOverviewProject>(
    ids.map((projectId) => [
      projectId,
      { projectId, milestones: [], firstDate: null, lastDate: null }
    ])
  )
  for (const row of rows) {
    const entry = byId.get(row.project_id)
    if (!entry) continue
    if (row.kind === 'span') {
      entry.firstDate = row.first_date
      entry.lastDate = row.last_date
    } else if (row.id && row.first_date) {
      entry.milestones.push({
        id: row.id,
        name: row.name ?? '',
        targetDate: row.first_date,
        status: row.status as PlanningMilestoneStatus
      })
    }
  }
  return [...byId.values()]
}
