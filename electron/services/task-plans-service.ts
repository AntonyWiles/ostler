import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { HarnessPlan, TaskPlanRecord } from '@shared/ostler-api'

/**
 * Plans kept with their tasks (N9.3b, N61). The harness keeps only a run's
 * latest plan, on its session; this keeps every version an agent sent and
 * the person's decision on each, so the task's drawer can show the approved
 * plan and its history after the run has ended. Written only from the
 * harness's plan listener, so a plan sent or decided from any surface (the
 * app, the automation API, an embedded or external agent) is kept the same
 * way. One row per run and version.
 */

interface TaskPlanRow {
  id: string
  project_id: string
  work_item_id: string | null
  session_id: string
  task_id: string | null
  version: number
  steps: string
  files: string
  risks: string
  status: TaskPlanRecord['status']
  changes_note: string | null
  submitted_at: string
  decided_at: string | null
  changed_before_approval: string
}

/** Where a plan came from: the run and the task it was for. */
export interface TaskPlanSource {
  projectId: string
  sessionId: string
  taskId: string | null
  workItemId: string | null
}

function stringList(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function toRecord(row: TaskPlanRow): TaskPlanRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    version: row.version,
    steps: stringList(row.steps),
    files: stringList(row.files),
    risks: row.risks,
    status: row.status,
    changesNote: row.changes_note,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    changedBeforeApproval: stringList(row.changed_before_approval)
  }
}

export class TaskPlansService {
  constructor(private readonly db: Database.Database) {}

  /**
   * Keeps a plan version as it stands now: a new version adds a row, a
   * decision updates that version's row. A work item that no longer exists
   * is not linked, so the plan is still kept with its run.
   */
  record(source: TaskPlanSource, plan: HarnessPlan): TaskPlanRecord {
    const workItemId =
      source.workItemId &&
      this.db.prepare('SELECT 1 FROM planning_work_items WHERE id = ?').get(source.workItemId)
        ? source.workItemId
        : null
    this.db
      .prepare(
        `INSERT INTO task_plans
          (id, project_id, work_item_id, session_id, task_id, version, steps, files, risks,
           status, changes_note, submitted_at, decided_at, changed_before_approval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, version) DO UPDATE SET
           status = excluded.status,
           changes_note = excluded.changes_note,
           decided_at = excluded.decided_at,
           changed_before_approval = excluded.changed_before_approval,
           work_item_id = COALESCE(task_plans.work_item_id, excluded.work_item_id)`
      )
      .run(
        uuidv4(),
        source.projectId,
        workItemId,
        source.sessionId,
        source.taskId,
        plan.version,
        JSON.stringify(plan.steps),
        JSON.stringify(plan.files),
        plan.risks,
        plan.status,
        plan.changesNote,
        plan.submittedAt,
        plan.decidedAt,
        JSON.stringify(plan.changedBeforeApproval?.files ?? [])
      )
    const row = this.db
      .prepare('SELECT * FROM task_plans WHERE session_id = ? AND version = ?')
      .get(source.sessionId, plan.version) as TaskPlanRow
    return toRecord(row)
  }

  /** Every plan kept for a task, oldest first. */
  listForWorkItem(workItemId: string): TaskPlanRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM task_plans WHERE work_item_id = ? ORDER BY submitted_at ASC, version ASC'
      )
      .all(workItemId) as TaskPlanRow[]
    return rows.map(toRecord)
  }

  /** Every version one run sent, oldest first. */
  listForSession(sessionId: string): TaskPlanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM task_plans WHERE session_id = ? ORDER BY version ASC')
      .all(sessionId) as TaskPlanRow[]
    return rows.map(toRecord)
  }
}
