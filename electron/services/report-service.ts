import type {
  HarnessProjectState,
  PlanningWorkItem,
  ProjectReport,
  ReportRange,
  RoundComparison,
  WatchedProject
} from '@shared/ostler-api'
import { projectWorkItemStatus } from '@shared/work-item-status'
import type { PlanningService } from './planning-service'
import { buildProjectReport, localIsoDate, parseReportRange } from './report-builder'
import { buildRoundComparison } from './round-comparison'

export interface ReportServiceDependencies {
  planning: PlanningService
  listPeople: () => ReadonlyArray<{ id: string; name: string }>
  /** The harness's view of the project, so linked tasks show the status the app shows. */
  harnessState?: (
    project: WatchedProject
  ) => Pick<HarnessProjectState, 'taskQueue' | 'reviewSessions'> | null
}

interface CacheEntry {
  fingerprint: string
  report: ProjectReport
}

/**
 * The project dashboard (P6.2): one report per project and range, for the
 * Overview and `GET /reports` alike. Reports are cached per project and range
 * and dropped as soon as anything they read changes. Rather than trust every
 * writer to announce itself, each request compares a cheap fingerprint of the
 * project's planning tables (and the day, the people and the harness's view):
 * any task, status, milestone or dependency write changes it.
 */
export class ReportService {
  private readonly cache = new Map<string, Map<ReportRange, CacheEntry>>()

  constructor(private readonly deps: ReportServiceDependencies) {}

  getReport(project: WatchedProject, rangeInput: unknown, now = Date.now()): ProjectReport {
    const range = parseReportRange(rangeInput)
    const fingerprint = this.fingerprint(project, now)
    let byRange = this.cache.get(project.id)
    if (byRange && [...byRange.values()].some((entry) => entry.fingerprint !== fingerprint)) {
      byRange.clear()
    }
    const cached = byRange?.get(range)
    if (cached && cached.fingerprint === fingerprint) return cached.report

    const report = this.build(project, range, now)
    if (!byRange) {
      byRange = new Map()
      this.cache.set(project.id, byRange)
    }
    byRange.set(range, { fingerprint, report })
    return report
  }

  /**
   * Compare rounds (N5.7b): the series `milestoneId` belongs to, from the
   * same tasks, statuses and history the report reads. Not cached: it is
   * asked for when the view opens.
   */
  getRoundComparison(
    project: WatchedProject,
    milestoneId: unknown,
    now = Date.now()
  ): RoundComparison {
    if (typeof milestoneId !== 'string' || !milestoneId) throw new Error('Choose a milestone')
    const { planning } = this.deps
    const harness = this.deps.harnessState?.(project) ?? null
    const shown = (item: PlanningWorkItem) => ({
      ...item,
      status: projectWorkItemStatus(item, harness)
    })
    return buildRoundComparison({
      projectId: project.id,
      milestoneId,
      milestones: planning.listMilestones(project.id),
      items: planning.listKeptWorkItemsForReports(project.id).map(shown),
      wontDo: planning
        .listWorkItems(project.id, 'archived')
        .filter((item) => item.resolution === 'wont-do')
        .map(shown),
      history: planning.listProjectStatusTransitions(project.id),
      timeEntries: planning.time.listForProject(project.id),
      now
    })
  }

  /** Drops a project's cached reports, such as when it is removed. */
  invalidate(projectId: string): void {
    this.cache.delete(projectId)
  }

  private build(project: WatchedProject, range: ReportRange, now: number): ProjectReport {
    const { planning } = this.deps
    const harness = this.deps.harnessState?.(project) ?? null
    const items = planning.listKeptWorkItemsForReports(project.id).map((item) => ({
      ...item,
      status: projectWorkItemStatus(item, harness)
    }))
    const iterations = planning.iterations.list(project.id)
    const active = iterations.find((iteration) => iteration.status === 'active')
    return buildProjectReport({
      projectId: project.id,
      range,
      items,
      history: planning.listProjectStatusTransitions(project.id),
      milestones: planning.listMilestones(project.id),
      people: this.deps.listPeople(),
      estimateUnit: project.estimateUnit ?? 'points',
      now,
      timeEntries: planning.time.listForProject(project.id),
      iterations,
      iterationJoinedAt: active ? planning.iterations.joinedAt(project.id, active.id) : undefined,
      taskTypes: planning.taskTypes.list(project.id)
    })
  }

  private fingerprint(project: WatchedProject, now: number): string {
    const db = this.deps.planning.database
    const items = db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(updated_at) AS updated, ' +
          'SUM(deleted_at IS NULL) AS kept, SUM(archived_at IS NULL) AS live ' +
          'FROM planning_work_items WHERE project_id = ?'
      )
      .get(project.id)
    const history = db
      .prepare(
        'SELECT MAX(history.sequence) AS last, COUNT(*) AS count FROM planning_status_history history ' +
          'JOIN planning_work_items item ON item.id = history.work_item_id WHERE item.project_id = ?'
      )
      .get(project.id)
    const milestones = db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(updated_at) AS updated FROM planning_milestones WHERE project_id = ?'
      )
      .get(project.id)
    const dependencies = db
      .prepare(
        'SELECT COUNT(*) AS count FROM planning_dependencies dependency ' +
          'JOIN planning_work_items item ON item.id = dependency.work_item_id WHERE item.project_id = ?'
      )
      .get(project.id)
    const people = db
      .prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS updated FROM people')
      .get()
    const time = db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(updated_at) AS updated, SUM(duration_seconds IS NULL) AS running ' +
          'FROM planning_time_entries WHERE project_id = ?'
      )
      .get(project.id)
    // Task types (N2.7b): the split by type reads their names, icons and colours.
    const taskTypes = db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(updated_at) AS updated FROM planning_task_types WHERE project_id = ?'
      )
      .get(project.id)
    const harness = this.deps.harnessState?.(project)
    const agentView = harness
      ? [
          ...harness.taskQueue.map(
            (task) => `${task.id}:${task.status}:${task.hold ? 1 : 0}:${task.copy?.state ?? ''}`
          ),
          ...harness.reviewSessions.map((session) => session.id)
        ].join(',')
      : ''
    return JSON.stringify([
      items,
      history,
      milestones,
      dependencies,
      people,
      time,
      taskTypes,
      this.deps.planning.iterations.fingerprint(project.id),
      agentView,
      project.estimateUnit ?? 'points',
      `${localIsoDate(now)}T${new Date(now).getHours()}`
    ])
  }
}
