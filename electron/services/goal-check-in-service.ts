import type Database from 'better-sqlite3'
import type { GoalCheckInResult, PlanningActor, PlanningGoal } from '@shared/ostler-api'
import {
  parseGoalCheckInInput,
  sortCheckIns,
  type GoalCheckIn,
  type GoalCheckInInput
} from '@shared/goal-measures'
import { isIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'

interface CheckInRow {
  goal_id: string
  project_id: string
  date: string
  value: number
  note: string
  recorded_at: number
  recorded_by_kind: 'human' | 'automation'
  recorded_by_person_id: string | null
}

/**
 * Goals' check-ins (N5.6a, N41). The desktop app and the automation API both
 * write through here, so the panel, Home, the activity feed (which reads this
 * table) and the project file see the same readings. One per goal and day: a
 * second that day replaces the first, and the result carries the first so
 * Undo can put it back. A person records as `human` (Me); the automation API
 * as `automation`.
 */
export class GoalCheckInService {
  constructor(
    private readonly db: Database.Database,
    /** The goal, refused when it is unknown or its project is not one Ostler has on. */
    private readonly requireGoal: (goalId: string) => PlanningGoal,
    private readonly changed: (projectId: string) => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  /** A goal's check-ins, oldest first. */
  list(goalId: unknown): GoalCheckIn[] {
    const goal = this.goal(goalId)
    const rows = this.db
      .prepare('SELECT * FROM goal_check_ins WHERE goal_id = ? ORDER BY date')
      .all(goal.id) as CheckInRow[]
    return rows.map(toCheckIn)
  }

  /** Every check-in of a project's goals, by goal id, oldest first: one call for a view. */
  listForProject(projectId: string): Record<string, GoalCheckIn[]> {
    return this.listForProjects([projectId])
  }

  /** The same for many projects at once (Home's cards). Callers pass known projects only. */
  listForProjects(projectIds: string[]): Record<string, GoalCheckIn[]> {
    if (projectIds.length === 0) return {}
    const rows = this.db
      .prepare(
        `SELECT * FROM goal_check_ins WHERE project_id IN (SELECT value FROM json_each(?))
         ORDER BY date`
      )
      .all(JSON.stringify(projectIds)) as CheckInRow[]
    const result: Record<string, GoalCheckIn[]> = {}
    for (const row of rows) (result[row.goal_id] ??= []).push(toCheckIn(row))
    return result
  }

  /** Records a reading; one already on that day is replaced and returned. */
  record(goalId: unknown, input: GoalCheckInInput | unknown, actor: PlanningActor) {
    const goal = this.goal(goalId)
    const parsed = this.parse(input)
    const by = recorderOf(actor)
    const replaced = this.find(goal.id, parsed.date)
    this.write(goal, { ...parsed, recordedAt: this.now() }, by)
    this.changed(goal.projectId)
    return { checkIn: this.find(goal.id, parsed.date)!, replaced } satisfies GoalCheckInResult
  }

  /** Removes the day's check-in and returns it, for Undo (`restore`). */
  delete(goalId: unknown, date: unknown): GoalCheckIn {
    const goal = this.goal(goalId)
    if (!isIsoDate(date)) throw new Refusal('Check-in not found')
    const existing = this.find(goal.id, date)
    if (!existing) throw new Refusal('Check-in not found')
    this.db.prepare('DELETE FROM goal_check_ins WHERE goal_id = ? AND date = ?').run(goal.id, date)
    this.changed(goal.projectId)
    return existing
  }

  /**
   * Puts a check-in back as it was, its time included (Undo of a delete or a
   * replacement). It replaces whatever that day has now.
   */
  restore(goalId: unknown, checkIn: unknown, actor: PlanningActor): GoalCheckIn {
    const goal = this.goal(goalId)
    const parsed = this.parse(checkIn)
    const at = (checkIn as { recordedAt?: unknown }).recordedAt
    const recordedAt = typeof at === 'number' && Number.isFinite(at) ? at : this.now()
    this.write(goal, { ...parsed, recordedAt }, recorderOf(actor))
    this.changed(goal.projectId)
    return this.find(goal.id, parsed.date)!
  }

  /** Writes check-ins from a project file into a new goal, keeping their times. */
  importCheckIns(
    goalId: string,
    checkIns: Array<{ date: string; value: number; note: string; recordedAt: number }>
  ): void {
    const goal = this.goal(goalId)
    for (const checkIn of sortCheckIns(checkIns)) {
      this.write(goal, checkIn, { kind: 'human', personId: null })
    }
  }

  private write(
    goal: PlanningGoal,
    checkIn: { date: string; value: number; note: string; recordedAt: number },
    by: { kind: 'human' | 'automation'; personId: string | null }
  ): void {
    this.db
      .prepare(
        `INSERT INTO goal_check_ins
           (goal_id, project_id, date, value, note, recorded_at, recorded_by_kind, recorded_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (goal_id, date) DO UPDATE SET
           value = excluded.value, note = excluded.note, recorded_at = excluded.recorded_at,
           recorded_by_kind = excluded.recorded_by_kind,
           recorded_by_person_id = excluded.recorded_by_person_id`
      )
      .run(
        goal.id,
        goal.projectId,
        checkIn.date,
        checkIn.value,
        checkIn.note,
        checkIn.recordedAt,
        by.kind,
        by.personId
      )
  }

  private find(goalId: string, date: string): GoalCheckIn | null {
    const row = this.db
      .prepare('SELECT * FROM goal_check_ins WHERE goal_id = ? AND date = ?')
      .get(goalId, date) as CheckInRow | undefined
    return row ? toCheckIn(row) : null
  }

  private goal(goalId: unknown): PlanningGoal {
    if (typeof goalId !== 'string') throw new Refusal('Planning goal not found')
    return this.requireGoal(goalId)
  }

  private parse(input: unknown) {
    try {
      return parseGoalCheckInInput(input)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }
}

function toCheckIn(row: CheckInRow): GoalCheckIn {
  return {
    goalId: row.goal_id,
    projectId: row.project_id,
    date: row.date,
    value: row.value,
    note: row.note,
    recordedAt: row.recorded_at
  }
}

/** Check-ins are recorded by a person or the automation API; any other actor is refused. */
function recorderOf(actor: PlanningActor): {
  kind: 'human' | 'automation'
  personId: string | null
} {
  if (actor.kind === 'human') return { kind: 'human', personId: actor.personId ?? null }
  if (actor.kind === 'automation') return { kind: 'automation', personId: null }
  throw new Refusal('Only a person or the automation API records check-ins')
}
