import type Database from 'better-sqlite3'
import type {
  PlanningDependencyLink,
  CreatePlanningMilestoneInput,
  CreatePlanningWorkItemInput,
  PlanningActor,
  PlanningChangeField,
  PlanningMilestone,
  PlanningWorkItem
} from '@shared/ostler-api'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import {
  currentRoundStart,
  followingRoundStart,
  latestDueRoundStart,
  normalizeMilestoneRepeat,
  roundEnd,
  roundName,
  shiftRoundDate,
  type MilestoneRoundPreview
} from '@shared/milestone-rounds'
import { normalizeRule, type RecurrenceRule } from '@shared/recurrence'
import { Refusal } from '@shared/refusal'
import { taskCopyInput } from './task-copy'

/** How the hourly check is named in a round's activity. */
const SCHEDULE_ACTOR: PlanningActor = { kind: 'system' }

export interface MilestoneRoundsDependencies {
  requireMilestone(milestoneId: string): PlanningMilestone
  requireProject(projectId: string): void
  /** The project's tasks that are not in the recycle bin, live and archived, in order. */
  keptTasks(projectId: string): PlanningWorkItem[]
  createMilestone(projectId: string, input: CreatePlanningMilestoneInput): PlanningMilestone
  createWorkItem(
    projectId: string,
    input: CreatePlanningWorkItemInput,
    actor: PlanningActor
  ): PlanningWorkItem
  replaceDependencies(
    workItemId: string,
    links: ReadonlyArray<string | PlanningDependencyLink>
  ): void
  recordChange(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    field: PlanningChangeField,
    from: unknown,
    to: unknown,
    actor: PlanningActor,
    at: number
  ): void
  requireActor(actor: PlanningActor): PlanningActor
  changed(projectId: string): void
  getProjectIds(): string[]
}

/** The schedule columns of a milestone row. */
export interface RoundColumns {
  repeat_rule: string | null
  repeat_length_days: number | null
  repeat_next_start: string | null
  repeat_on: number
  round_start: string | null
  previous_round_id: string | null
}

/** A row's round fields as `PlanningMilestone` carries them: left out when not set. */
export function roundFields(row: Partial<RoundColumns>): Partial<PlanningMilestone> {
  const fields: Partial<PlanningMilestone> = {}
  if (row.repeat_rule && row.repeat_length_days && row.repeat_next_start) {
    try {
      fields.repeat = {
        rule: normalizeRule(JSON.parse(row.repeat_rule) as unknown),
        lengthDays: row.repeat_length_days,
        nextStart: row.repeat_next_start,
        on: row.repeat_on === 1
      }
    } catch {
      // A rule this build cannot read repeats no more.
    }
  }
  if (row.previous_round_id) fields.previousRoundId = row.previous_round_id
  if (row.round_start) fields.roundStart = row.round_start
  return fields
}

/**
 * Repeating rounds (N5.7a, N42). Repeat this round sets a milestone's
 * schedule; the next round is made at once (Start next round now) or by the
 * check at start and every hour on its start date. Making it is one
 * transaction: a milestone named after the series and the round, and a fresh
 * copy of every task of the round that is not in the recycle bin and does
 * not repeat by itself, through the same copying code as Copy task.
 */
export class MilestoneRounds {
  constructor(
    private readonly db: Database.Database,
    private readonly deps: MilestoneRoundsDependencies
  ) {}

  /** The day a round started: its own, or worked out from its tasks and target date. */
  private startOf(milestone: PlanningMilestone): string {
    const tasks = this.deps
      .keptTasks(milestone.projectId)
      .filter((task) => task.milestoneId === milestone.id)
    return currentRoundStart(
      milestone,
      tasks.flatMap((task) => [task.startDate, task.targetDate]),
      todayIsoDate()
    )
  }

  /** A later round made from this one, if any. */
  private laterRound(milestoneId: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM planning_milestones WHERE previous_round_id = ? LIMIT 1')
      .get(milestoneId) as { id: string } | undefined
    return row?.id ?? null
  }

  /** Repeat this round: sets (or changes) the schedule, and turns it on. */
  setRepeat(milestoneId: string, input: unknown): PlanningMilestone {
    const milestone = this.deps.requireMilestone(milestoneId)
    this.deps.requireProject(milestone.projectId)
    if (this.laterRound(milestone.id)) throw new Refusal(t('errors:rounds.notLatest'))
    const checked = normalizeMilestoneRepeat(input)
    const start = this.startOf(milestone)
    if (checked.nextStart <= start) throw new Refusal(t('errors:rounds.nextStartTooEarly'))
    this.db
      .prepare(
        `UPDATE planning_milestones
         SET repeat_rule = ?, repeat_length_days = ?, repeat_next_start = ?, repeat_on = 1,
             round_start = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(checked.rule),
        checked.lengthDays,
        checked.nextStart,
        start,
        Date.now(),
        milestone.id
      )
    this.deps.changed(milestone.projectId)
    return this.deps.requireMilestone(milestone.id)
  }

  /** Stop repeating: the schedule turns off and stays, with every earlier round. */
  stopRepeating(milestoneId: string): PlanningMilestone {
    const milestone = this.deps.requireMilestone(milestoneId)
    this.deps.requireProject(milestone.projectId)
    if (!milestone.repeat) throw new Refusal(t('errors:rounds.notRepeating'))
    this.db
      .prepare('UPDATE planning_milestones SET repeat_on = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), milestone.id)
    this.deps.changed(milestone.projectId)
    return this.deps.requireMilestone(milestone.id)
  }

  /** The first round's name: every round of the series is named after it. */
  private seriesName(milestone: PlanningMilestone): string {
    let current = milestone
    const seen = new Set([current.id])
    while (current.previousRoundId && !seen.has(current.previousRoundId)) {
      seen.add(current.previousRoundId)
      try {
        current = this.deps.requireMilestone(current.previousRoundId)
      } catch {
        break
      }
    }
    return current.name
  }

  /** The tasks a new round copies, and the repeating ones it leaves to repeat by themselves. */
  private roundTasks(milestone: PlanningMilestone): {
    copied: PlanningWorkItem[]
    repeating: number
  } {
    const tasks = this.deps
      .keptTasks(milestone.projectId)
      .filter((task) => task.milestoneId === milestone.id)
    const copied = tasks.filter((task) => !task.recurring)
    return { copied, repeating: tasks.length - copied.length }
  }

  /** What the next round would be with this schedule (the dialog's preview). */
  preview(milestoneId: string, input: unknown): MilestoneRoundPreview {
    const milestone = this.deps.requireMilestone(milestoneId)
    this.deps.requireProject(milestone.projectId)
    const checked = normalizeMilestoneRepeat(input)
    const { copied, repeating } = this.roundTasks(milestone)
    return {
      name: roundName(this.seriesName(milestone), checked.rule, checked.nextStart),
      start: checked.nextStart,
      end: roundEnd(checked.nextStart, checked.lengthDays),
      taskCount: copied.length,
      repeatingCount: repeating
    }
  }

  /**
   * Start next round now: makes the next round, starting on the schedule's
   * next start (`start` overrides it when catching up), and moves the
   * schedule to it. Returns the new round.
   */
  startNextRound(
    milestoneId: string,
    actor: PlanningActor,
    options: { start?: string; bySchedule?: boolean } = {}
  ): PlanningMilestone {
    const milestone = this.deps.requireMilestone(milestoneId)
    this.deps.requireProject(milestone.projectId)
    const who = this.deps.requireActor(actor)
    const repeat = milestone.repeat
    if (!repeat || !repeat.on) throw new Refusal(t('errors:rounds.notRepeating'))
    if (this.laterRound(milestone.id)) throw new Refusal(t('errors:rounds.notLatest'))
    const start = options.start ?? repeat.nextStart
    const fromStart = this.startOf(milestone)
    const name = roundName(this.seriesName(milestone), repeat.rule, start)
    const now = Date.now()
    const created = this.db.transaction(() => {
      const round = this.deps.createMilestone(milestone.projectId, {
        goalId: milestone.goalId,
        name,
        outcome: milestone.outcome,
        targetDate: roundEnd(start, repeat.lengthDays),
        successCriteria: milestone.successCriteria
      })
      this.db
        .prepare(
          `UPDATE planning_milestones
           SET repeat_rule = ?, repeat_length_days = ?, repeat_next_start = ?, repeat_on = 1,
               round_start = ?, previous_round_id = ?, round_started_by_schedule_at = ?
           WHERE id = ?`
        )
        .run(
          JSON.stringify(repeat.rule),
          repeat.lengthDays,
          followingRoundStart(repeat.rule, start),
          start,
          milestone.id,
          options.bySchedule ? now : null,
          round.id
        )
      // The schedule moves on: the earlier round keeps its start and its tasks.
      this.db
        .prepare(
          `UPDATE planning_milestones
           SET repeat_rule = NULL, repeat_length_days = NULL, repeat_next_start = NULL,
               repeat_on = 0, round_start = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(fromStart, now, milestone.id)
      this.copyTasks(milestone, round, repeat.rule, fromStart, start, who)
      return round
    })()
    this.deps.changed(milestone.projectId)
    return this.deps.requireMilestone(created.id)
  }

  /**
   * Copies the round's tasks into the new one, in their order: through
   * Copy task's copying code, without "(copy)" or a "copied from" link,
   * dates moved on, then subtasks under their copied parents and waits-on
   * links between the copies. Each copy records the task it came from.
   */
  private copyTasks(
    from: PlanningMilestone,
    to: PlanningMilestone,
    rule: RecurrenceRule,
    fromStart: string,
    toStart: string,
    who: PlanningActor
  ): void {
    const { copied } = this.roundTasks(from)
    const shiftDate = (value: string) => shiftRoundDate(value, fromStart, toStart, rule)
    const copies = new Map<string, PlanningWorkItem>()
    for (const source of copied) {
      copies.set(
        source.id,
        this.deps.createWorkItem(
          from.projectId,
          taskCopyInput(source, { title: source.title, milestoneId: to.id, shiftDate }),
          who
        )
      )
    }
    const recordSource = this.db.prepare(
      'UPDATE planning_work_items SET round_source_id = ? WHERE id = ?'
    )
    const placeUnder = this.db.prepare(
      `UPDATE planning_work_items
       SET parent_work_item_id = ?, subtask_phase_number = ?, subtask_phase_name = ?
       WHERE id = ?`
    )
    const at = Date.now()
    for (const source of copied) {
      const copy = copies.get(source.id)!
      recordSource.run(source.id, copy.id)
      const parent = source.parentWorkItemId ? copies.get(source.parentWorkItemId) : undefined
      if (parent)
        placeUnder.run(parent.id, source.subtaskPhaseNumber, source.subtaskPhaseName, copy.id)
      // Each copied link keeps its type and lag (N7.2a).
      const waitsOn = dependencyLinksOf(source).flatMap((link) => {
        const copied = copies.get(link.id)
        return copied ? [{ ...link, id: copied.id }] : []
      })
      if (waitsOn.length > 0) this.deps.replaceDependencies(copy.id, waitsOn)
      this.deps.recordChange(copy, 'round', undefined, { id: to.id, name: to.name }, who, at)
    }
  }

  /**
   * The check at start and every hour: makes each round that is due. Ostler
   * closed through several start dates makes only the latest one. A round
   * that cannot be made waits for the next check.
   */
  startDueRounds(
    projectIds: string[] = this.deps.getProjectIds(),
    today: string = todayIsoDate()
  ): PlanningMilestone[] {
    if (projectIds.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT id, repeat_rule, repeat_next_start FROM planning_milestones
         WHERE repeat_on = 1 AND repeat_next_start IS NOT NULL AND repeat_next_start <= ?
           AND project_id IN (${projectIds.map(() => '?').join(', ')})`
      )
      .all(today, ...projectIds) as {
      id: string
      repeat_rule: string
      repeat_next_start: string
    }[]
    const made: PlanningMilestone[] = []
    for (const row of rows) {
      try {
        const rule = normalizeRule(JSON.parse(row.repeat_rule) as unknown)
        const start = latestDueRoundStart(rule, row.repeat_next_start, today)
        if (!start) continue
        made.push(this.startNextRound(row.id, SCHEDULE_ACTOR, { start, bySchedule: true }))
      } catch (error) {
        console.error(`Starting the next round of milestone ${row.id} failed:`, error)
      }
    }
    return made
  }

  /** Puts a project file's or template's schedule and series on a milestone it made. */
  importRound(
    milestoneId: string,
    input: {
      repeat?: { rule: RecurrenceRule; lengthDays: number; nextStart: string; on: boolean } | null
      previousRoundId?: string | null
      roundStart?: string | null
    }
  ): void {
    const repeat = input.repeat
      ? { ...normalizeMilestoneRepeat(input.repeat), on: input.repeat.on }
      : null
    this.db
      .prepare(
        `UPDATE planning_milestones
         SET repeat_rule = ?, repeat_length_days = ?, repeat_next_start = ?, repeat_on = ?,
             round_start = ?, previous_round_id = ?
         WHERE id = ?`
      )
      .run(
        repeat ? JSON.stringify(repeat.rule) : null,
        repeat?.lengthDays ?? null,
        repeat?.nextStart ?? null,
        repeat?.on ? 1 : 0,
        input.roundStart ?? null,
        input.previousRoundId ?? null,
        milestoneId
      )
  }

  /** Puts a project file's "copied in a round from" on a task it made. */
  importRoundSource(workItemId: string, sourceId: string): void {
    this.db
      .prepare('UPDATE planning_work_items SET round_source_id = ? WHERE id = ?')
      .run(sourceId, workItemId)
  }
}
