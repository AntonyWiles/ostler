import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { PlanningActor, PlanningGoal } from '@shared/ostler-api'
import {
  linkMismatch,
  goalProgress,
  parseGoalCheckInInput,
  parseGoalMeasure,
  type GoalMeasure,
  type LinkMismatch
} from '@shared/goal-measures'
import {
  MAX_PERSONAL_GOAL_OUTCOME_LENGTH,
  MAX_PERSONAL_GOAL_TITLE_LENGTH,
  PERSONAL_GOAL_STATUSES,
  personalGoalProgress,
  sortPersonalGoals,
  type CreatePersonalGoalInput,
  type DeletedPersonalGoal,
  type GoalCountsTowards,
  type LinkableProjectGoal,
  type PersonalGoal,
  type PersonalGoalCheckIn,
  type PersonalGoalLink,
  type PersonalGoalStatus,
  type PersonalGoalView,
  type SetCountsTowardsResult,
  type UpdatePersonalGoalInput
} from '@shared/personal-goals'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface MeasureColumns {
  measure_unit: string | null
  measure_start_value: number | null
  measure_target_value: number | null
  measure_start_date: string | null
  measure_target_date: string | null
  measure_direction: 'up' | 'down' | null
}

interface GoalRow extends MeasureColumns {
  id: string
  title: string
  outcome: string
  status: PersonalGoalStatus
  created_at: number
  updated_at: number
}

interface CheckInRow {
  personal_goal_id: string
  date: string
  value: number
  note: string
  recorded_at: number
}

interface LinkRow {
  goal_id: string
  project_id: string
  personal_goal_id: string
  created_at: number
}

interface ProjectGoalRow extends MeasureColumns {
  id: string
  project_id: string
  title: string
}

export interface PersonalGoalDeps {
  /** Every project Ostler knows: a link counts only while its project is one. */
  getProjectIds(): string[]
  /** A project goal, refused when it is unknown or its project is not one Ostler knows. */
  requireProjectGoal(goalId: string): PlanningGoal
  /** Something Home, pins or countdowns read changed. */
  changed(): void
  now?: () => number
}

/** A measure from its six columns: null unless every one is set. */
function measureOf(row: MeasureColumns): GoalMeasure | null {
  if (
    row.measure_direction === null ||
    row.measure_start_value === null ||
    row.measure_target_value === null ||
    row.measure_start_date === null ||
    row.measure_target_date === null
  )
    return null
  return {
    unit: row.measure_unit ?? '',
    startValue: row.measure_start_value,
    targetValue: row.measure_target_value,
    startDate: row.measure_start_date,
    targetDate: row.measure_target_date,
    direction: row.measure_direction
  }
}

/**
 * Goals of one's own (N5.6b, N41): outside any project, shared by every
 * project as people are. The desktop app and the automation API both write
 * through here. Their progress is N5.6a's one rule (`personalGoalProgress`):
 * the sum of the latest values of the project goals that count towards them,
 * or their own check-ins without any. Linking and unlinking a project goal
 * never changes either goal's check-ins.
 */
export class PersonalGoalService {
  private readonly now: () => number

  constructor(
    private readonly db: Database.Database,
    private readonly deps: PersonalGoalDeps
  ) {
    this.now = deps.now ?? Date.now
  }

  /** Every goal of one's own with its check-ins, links and progress: one call for the view. */
  list(today: string = todayIsoDate()): PersonalGoalView[] {
    const goals = (this.db.prepare('SELECT * FROM personal_goals').all() as GoalRow[]).map(toGoal)
    if (goals.length === 0) return []
    const checkIns = new Map<string, PersonalGoalCheckIn[]>()
    for (const row of this.db
      .prepare('SELECT * FROM personal_goal_check_ins ORDER BY date')
      .all() as CheckInRow[])
      checkIns.set(row.personal_goal_id, [
        ...(checkIns.get(row.personal_goal_id) ?? []),
        toCheckIn(row)
      ])
    const links = this.linksByGoal(goals.map((goal) => goal.id))
    return sortPersonalGoals(goals).map((goal) =>
      this.view(goal, checkIns.get(goal.id) ?? [], links.get(goal.id) ?? [], today)
    )
  }

  /** One goal of one's own as the view shows it. */
  get(id: unknown, today: string = todayIsoDate()): PersonalGoalView {
    const goal = this.require(id)
    return this.view(
      goal,
      this.checkInsOf(goal.id),
      this.linksByGoal([goal.id]).get(goal.id) ?? [],
      today
    )
  }

  create(input: CreatePersonalGoalInput | unknown): PersonalGoalView {
    const value = this.object(input)
    const now = this.now()
    const goal: PersonalGoal = {
      id: uuidv4(),
      title: this.title(value.title),
      outcome: this.outcome(value.outcome),
      status: 'active',
      measure: this.measure(value.measure),
      createdAt: now,
      updatedAt: now
    }
    this.insert(goal)
    this.deps.changed()
    return this.get(goal.id)
  }

  update(id: unknown, input: UpdatePersonalGoalInput | unknown): PersonalGoalView {
    const current = this.require(id)
    const value = this.object(input)
    if (value.status !== undefined && !PERSONAL_GOAL_STATUSES.includes(value.status as never))
      throw new Refusal(t('errors:personalGoals.statusInvalid'))
    const goal: PersonalGoal = {
      ...current,
      title: value.title === undefined ? current.title : this.title(value.title),
      outcome: value.outcome === undefined ? current.outcome : this.outcome(value.outcome),
      status: (value.status as PersonalGoalStatus | undefined) ?? current.status,
      measure: value.measure === undefined ? current.measure : this.measure(value.measure),
      updatedAt: this.now()
    }
    this.db
      .prepare(
        `UPDATE personal_goals SET title = ?, outcome = ?, status = ?, measure_unit = ?,
           measure_start_value = ?, measure_target_value = ?, measure_start_date = ?,
           measure_target_date = ?, measure_direction = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        goal.title,
        goal.outcome,
        goal.status,
        ...measureValues(goal.measure),
        goal.updatedAt,
        goal.id
      )
    this.deps.changed()
    return this.get(goal.id)
  }

  /**
   * Deletes a goal of one's own with its check-ins and links, and returns all
   * of it for Undo (`restore`). The project goals and their check-ins stay.
   */
  delete(id: unknown): DeletedPersonalGoal {
    const goal = this.require(id)
    const deleted: DeletedPersonalGoal = {
      goal,
      checkIns: this.checkInsOf(goal.id),
      links: (
        this.db
          .prepare(
            'SELECT * FROM personal_goal_links WHERE personal_goal_id = ? ORDER BY created_at'
          )
          .all(goal.id) as LinkRow[]
      ).map((row) => ({
        goalId: row.goal_id,
        projectId: row.project_id,
        createdAt: row.created_at
      }))
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM personal_goal_links WHERE personal_goal_id = ?').run(goal.id)
      this.db.prepare('DELETE FROM personal_goal_check_ins WHERE personal_goal_id = ?').run(goal.id)
      this.db.prepare('DELETE FROM personal_goals WHERE id = ?').run(goal.id)
    })()
    this.deps.changed()
    return deleted
  }

  /**
   * Puts a deleted goal back with its id, check-ins and links. A link whose
   * project goal has gone, or that now counts towards another goal, stays out.
   */
  restore(deleted: DeletedPersonalGoal | unknown): PersonalGoalView {
    const value = deleted as Partial<DeletedPersonalGoal> | null
    const goal = value?.goal
    if (!goal || typeof goal !== 'object' || typeof goal.id !== 'string')
      throw new Refusal(t('errors:personalGoals.restoreInvalid'))
    const exists = this.db.prepare('SELECT 1 FROM personal_goals WHERE id = ?').get(goal.id)
    if (exists) return this.get(goal.id)
    const restored: PersonalGoal = {
      id: goal.id,
      title: this.title(goal.title),
      outcome: this.outcome(goal.outcome),
      status: PERSONAL_GOAL_STATUSES.includes(goal.status) ? goal.status : 'active',
      measure: this.measure(goal.measure),
      createdAt: Number.isFinite(goal.createdAt) ? goal.createdAt : this.now(),
      updatedAt: this.now()
    }
    this.db.transaction(() => {
      this.insert(restored)
      for (const checkIn of Array.isArray(value?.checkIns) ? value.checkIns : []) {
        const parsed = this.parseCheckIn(checkIn)
        const at = (checkIn as { recordedAt?: unknown }).recordedAt
        this.writeCheckIn(
          restored.id,
          {
            ...parsed,
            recordedAt: typeof at === 'number' && Number.isFinite(at) ? at : this.now()
          },
          'human'
        )
      }
      for (const link of Array.isArray(value?.links) ? value.links : []) {
        if (typeof link?.goalId !== 'string') continue
        let projectGoal: PlanningGoal
        try {
          projectGoal = this.deps.requireProjectGoal(link.goalId)
        } catch {
          continue
        }
        this.db
          .prepare(
            `INSERT OR IGNORE INTO personal_goal_links (goal_id, project_id, personal_goal_id, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(
            projectGoal.id,
            projectGoal.projectId,
            restored.id,
            Number.isFinite(link.createdAt) ? link.createdAt : this.now()
          )
      }
    })()
    this.deps.changed()
    return this.get(restored.id)
  }

  /** A goal of one's own's check-ins, oldest first. */
  listCheckIns(id: unknown): PersonalGoalCheckIn[] {
    return this.checkInsOf(this.require(id).id)
  }

  /** Records a reading; one already on that day is replaced and returned, for Undo. */
  recordCheckIn(
    id: unknown,
    input: unknown,
    actor: PlanningActor
  ): { checkIn: PersonalGoalCheckIn; replaced: PersonalGoalCheckIn | null } {
    const goal = this.require(id)
    const parsed = this.parseCheckIn(input)
    const replaced = this.findCheckIn(goal.id, parsed.date)
    this.writeCheckIn(goal.id, { ...parsed, recordedAt: this.now() }, recorderOf(actor))
    this.deps.changed()
    return { checkIn: this.findCheckIn(goal.id, parsed.date)!, replaced }
  }

  /** Removes the day's check-in and returns it, for Undo (`restoreCheckIn`). */
  deleteCheckIn(id: unknown, date: unknown): PersonalGoalCheckIn {
    const goal = this.require(id)
    const existing = isIsoDate(date) ? this.findCheckIn(goal.id, date) : null
    if (!existing) throw new Refusal(t('errors:personalGoals.checkInNotFound'))
    this.db
      .prepare('DELETE FROM personal_goal_check_ins WHERE personal_goal_id = ? AND date = ?')
      .run(goal.id, existing.date)
    this.deps.changed()
    return existing
  }

  /** Puts a check-in back as it was, its time included; it replaces whatever that day has. */
  restoreCheckIn(id: unknown, checkIn: unknown, actor: PlanningActor): PersonalGoalCheckIn {
    const goal = this.require(id)
    const parsed = this.parseCheckIn(checkIn)
    const at = (checkIn as { recordedAt?: unknown }).recordedAt
    const recordedAt = typeof at === 'number' && Number.isFinite(at) ? at : this.now()
    this.writeCheckIn(goal.id, { ...parsed, recordedAt }, recorderOf(actor))
    this.deps.changed()
    return this.findCheckIn(goal.id, parsed.date)!
  }

  /**
   * Makes a project goal count towards a goal of one's own, or (null) towards
   * none. Both need a measure with the same unit and direction; anything else
   * is refused in words. Neither goal's check-ins change.
   */
  setCountsTowards(goalId: unknown, personalGoalId: unknown): SetCountsTowardsResult {
    if (typeof goalId !== 'string') throw new Refusal('Planning goal not found')
    const projectGoal = this.deps.requireProjectGoal(goalId)
    if (personalGoalId !== null && typeof personalGoalId !== 'string')
      throw new Refusal(t('errors:personalGoals.personalGoalIdInvalid'))
    const previous =
      (
        this.db
          .prepare('SELECT personal_goal_id FROM personal_goal_links WHERE goal_id = ?')
          .get(projectGoal.id) as { personal_goal_id: string } | undefined
      )?.personal_goal_id ?? null
    if (personalGoalId === null) {
      this.db.prepare('DELETE FROM personal_goal_links WHERE goal_id = ?').run(projectGoal.id)
    } else {
      const target = this.require(personalGoalId)
      const mismatch = linkMismatch(target.measure, projectGoal.measure ?? null)
      if (mismatch) throw new Refusal(mismatchMessage(mismatch, target, projectGoal))
      if (previous !== target.id)
        this.db
          .prepare(
            `INSERT INTO personal_goal_links (goal_id, project_id, personal_goal_id, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (goal_id) DO UPDATE SET personal_goal_id = excluded.personal_goal_id,
               project_id = excluded.project_id, created_at = excluded.created_at`
          )
          .run(projectGoal.id, projectGoal.projectId, target.id, this.now())
    }
    this.deps.changed()
    return { goalId: projectGoal.id, personalGoalId: personalGoalId as string | null, previous }
  }

  /** What each of a project's goals counts towards, by goal id: their cards, in one call. */
  countsTowardsForProject(projectId: string): Record<string, GoalCountsTowards> {
    const rows = this.db
      .prepare(
        `SELECT l.goal_id, l.personal_goal_id, p.title, p.measure_unit, p.measure_start_value,
           p.measure_target_value, p.measure_start_date, p.measure_target_date, p.measure_direction,
           g.measure_unit AS g_unit, g.measure_start_value AS g_start_value,
           g.measure_target_value AS g_target_value, g.measure_start_date AS g_start_date,
           g.measure_target_date AS g_target_date, g.measure_direction AS g_direction
         FROM personal_goal_links l
         JOIN personal_goals p ON p.id = l.personal_goal_id
         JOIN planning_goals g ON g.id = l.goal_id
         WHERE l.project_id = ?`
      )
      .all(projectId) as Array<
      MeasureColumns & {
        goal_id: string
        personal_goal_id: string
        title: string
        g_unit: string | null
        g_start_value: number | null
        g_target_value: number | null
        g_start_date: string | null
        g_target_date: string | null
        g_direction: 'up' | 'down' | null
      }
    >
    const result: Record<string, GoalCountsTowards> = {}
    for (const row of rows) {
      const own = measureOf({
        measure_unit: row.g_unit,
        measure_start_value: row.g_start_value,
        measure_target_value: row.g_target_value,
        measure_start_date: row.g_start_date,
        measure_target_date: row.g_target_date,
        measure_direction: row.g_direction
      })
      result[row.goal_id] = {
        goalId: row.goal_id,
        personalGoalId: row.personal_goal_id,
        title: row.title,
        counts: linkMismatch(measureOf(row), own) === null
      }
    }
    return result
  }

  /** Every project goal with a measure, across the projects Ostler knows: Add a project goal. */
  linkableProjectGoals(): LinkableProjectGoal[] {
    const known = this.deps.getProjectIds()
    if (known.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT g.*, l.personal_goal_id FROM planning_goals g
         LEFT JOIN personal_goal_links l ON l.goal_id = g.id
         WHERE g.project_id IN (SELECT value FROM json_each(?)) AND g.measure_direction IS NOT NULL
         ORDER BY g.title COLLATE NOCASE`
      )
      .all(JSON.stringify(known)) as Array<ProjectGoalRow & { personal_goal_id: string | null }>
    const result: LinkableProjectGoal[] = []
    for (const row of rows) {
      const measure = measureOf(row)
      if (!measure) continue
      result.push({
        goalId: row.id,
        projectId: row.project_id,
        title: row.title,
        measure,
        personalGoalId: row.personal_goal_id
      })
    }
    return result
  }

  /** A project goal was deleted: its link goes too (its check-ins went with it). */
  projectGoalDeleted(goalId: string): void {
    this.db.prepare('DELETE FROM personal_goal_links WHERE goal_id = ?').run(goalId)
  }

  private view(
    goal: PersonalGoal,
    checkIns: PersonalGoalCheckIn[],
    links: PersonalGoalLink[],
    today: string
  ): PersonalGoalView {
    const counting = links.flatMap((link) =>
      link.mismatch === null && link.measure
        ? [{ measure: link.measure, checkIns: this.projectCheckIns(link.goalId) }]
        : []
    )
    return {
      ...goal,
      checkIns,
      links,
      ...personalGoalProgress(goal.measure, checkIns, counting, today)
    }
  }

  /** The links of these goals, with each project goal's measure and latest value. */
  private linksByGoal(ids: string[]): Map<string, PersonalGoalLink[]> {
    const known = this.deps.getProjectIds()
    const rows = this.db
      .prepare(
        `SELECT l.goal_id, l.project_id, l.personal_goal_id, l.created_at, g.title,
           g.measure_unit, g.measure_start_value, g.measure_target_value, g.measure_start_date,
           g.measure_target_date, g.measure_direction
         FROM personal_goal_links l JOIN planning_goals g ON g.id = l.goal_id
         WHERE l.personal_goal_id IN (SELECT value FROM json_each(?))
           AND l.project_id IN (SELECT value FROM json_each(?))
         ORDER BY l.created_at, l.rowid`
      )
      .all(JSON.stringify(ids), JSON.stringify(known)) as Array<LinkRow & ProjectGoalRow>
    const targets = new Map(
      (
        this.db
          .prepare('SELECT * FROM personal_goals WHERE id IN (SELECT value FROM json_each(?))')
          .all(JSON.stringify(ids)) as GoalRow[]
      ).map((row) => [row.id, measureOf(row)])
    )
    const result = new Map<string, PersonalGoalLink[]>()
    for (const row of rows) {
      const measure = measureOf(row)
      const mismatch: LinkMismatch | null = linkMismatch(targets.get(row.personal_goal_id), measure)
      const latest = measure
        ? goalProgress(measure, this.projectCheckIns(row.goal_id), todayIsoDate()).latest
        : null
      result.set(row.personal_goal_id, [
        ...(result.get(row.personal_goal_id) ?? []),
        {
          goalId: row.goal_id,
          projectId: row.project_id,
          title: row.title,
          measure,
          latest,
          mismatch,
          createdAt: row.created_at
        }
      ])
    }
    return result
  }

  private projectCheckIns(goalId: string): { date: string; value: number }[] {
    return this.db
      .prepare('SELECT date, value FROM goal_check_ins WHERE goal_id = ? ORDER BY date')
      .all(goalId) as { date: string; value: number }[]
  }

  private checkInsOf(id: string): PersonalGoalCheckIn[] {
    return (
      this.db
        .prepare('SELECT * FROM personal_goal_check_ins WHERE personal_goal_id = ? ORDER BY date')
        .all(id) as CheckInRow[]
    ).map(toCheckIn)
  }

  private findCheckIn(id: string, date: string): PersonalGoalCheckIn | null {
    const row = this.db
      .prepare('SELECT * FROM personal_goal_check_ins WHERE personal_goal_id = ? AND date = ?')
      .get(id, date) as CheckInRow | undefined
    return row ? toCheckIn(row) : null
  }

  private writeCheckIn(
    id: string,
    checkIn: { date: string; value: number; note: string; recordedAt: number },
    by: 'human' | 'automation'
  ): void {
    this.db
      .prepare(
        `INSERT INTO personal_goal_check_ins (personal_goal_id, date, value, note, recorded_at, recorded_by_kind)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (personal_goal_id, date) DO UPDATE SET value = excluded.value,
           note = excluded.note, recorded_at = excluded.recorded_at,
           recorded_by_kind = excluded.recorded_by_kind`
      )
      .run(id, checkIn.date, checkIn.value, checkIn.note, checkIn.recordedAt, by)
  }

  private insert(goal: PersonalGoal): void {
    this.db
      .prepare(
        `INSERT INTO personal_goals (id, title, outcome, status, measure_unit, measure_start_value,
           measure_target_value, measure_start_date, measure_target_date, measure_direction,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        goal.id,
        goal.title,
        goal.outcome,
        goal.status,
        ...measureValues(goal.measure),
        goal.createdAt,
        goal.updatedAt
      )
  }

  private require(id: unknown): PersonalGoal {
    const row =
      typeof id === 'string'
        ? (this.db.prepare('SELECT * FROM personal_goals WHERE id = ?').get(id) as
            GoalRow | undefined)
        : undefined
    if (!row) throw new Refusal(t('errors:personalGoals.notFound'))
    return toGoal(row)
  }

  private object(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Refusal(t('errors:personalGoals.inputInvalid'))
    return input as Record<string, unknown>
  }

  private title(value: unknown): string {
    if (typeof value !== 'string')
      throw new Refusal(t('errors:personalGoals.fieldText', { field: 'title' }))
    const title = value.trim()
    if (!title) throw new Refusal(t('errors:personalGoals.needsTitle'))
    if (title.length > MAX_PERSONAL_GOAL_TITLE_LENGTH)
      throw new Refusal(
        t('errors:personalGoals.fieldTooLong', {
          field: 'title',
          max: MAX_PERSONAL_GOAL_TITLE_LENGTH
        })
      )
    return title
  }

  private outcome(value: unknown): string {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string')
      throw new Refusal(t('errors:personalGoals.fieldText', { field: 'outcome' }))
    const outcome = value.trim()
    if (outcome.length > MAX_PERSONAL_GOAL_OUTCOME_LENGTH)
      throw new Refusal(
        t('errors:personalGoals.fieldTooLong', {
          field: 'outcome',
          max: MAX_PERSONAL_GOAL_OUTCOME_LENGTH
        })
      )
    return outcome
  }

  private measure(value: unknown): GoalMeasure | null {
    if (value === undefined || value === null) return null
    try {
      return parseGoalMeasure(value)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }

  private parseCheckIn(input: unknown) {
    try {
      return parseGoalCheckInInput(input)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }
}

function measureValues(measure: GoalMeasure | null) {
  return [
    measure?.unit ?? null,
    measure?.startValue ?? null,
    measure?.targetValue ?? null,
    measure?.startDate ?? null,
    measure?.targetDate ?? null,
    measure?.direction ?? null
  ] as const
}

function toGoal(row: GoalRow): PersonalGoal {
  return {
    id: row.id,
    title: row.title,
    outcome: row.outcome,
    status: row.status,
    measure: measureOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toCheckIn(row: CheckInRow): PersonalGoalCheckIn {
  return {
    personalGoalId: row.personal_goal_id,
    date: row.date,
    value: row.value,
    note: row.note,
    recordedAt: row.recorded_at
  }
}

function recorderOf(actor: PlanningActor): 'human' | 'automation' {
  if (actor.kind === 'human' || actor.kind === 'automation') return actor.kind
  throw new Refusal(t('errors:personalGoals.recorderInvalid'))
}

/** The plain words for a link that cannot be made. */
function mismatchMessage(mismatch: LinkMismatch, target: PersonalGoal, goal: PlanningGoal): string {
  const unit = (value: string) => value.trim() || t('errors:personalGoals.noUnit')
  switch (mismatch) {
    case 'no-measure':
      return t('errors:personalGoals.noMeasure', { title: goal.title })
    case 'no-target-measure':
      return t('errors:personalGoals.noTargetMeasure', { title: target.title })
    case 'unit':
      return t('errors:personalGoals.unitDiffers', {
        goal: target.title,
        goalUnit: unit(target.measure!.unit),
        title: goal.title,
        unit: unit(goal.measure!.unit)
      })
    case 'direction':
      return t('errors:personalGoals.directionDiffers', { goal: target.title, title: goal.title })
  }
}
