import type Database from 'better-sqlite3'
import type {
  BlockMove,
  BlockMovePlan,
  BlockTime,
  CalendarOccurrence,
  DayOff,
  FillDayPlan,
  Person,
  PlanApplyResult,
  PlanMoment,
  TimeBlock,
  WorkingHours
} from '@shared/ostler-api'
import { compareIsoDates, isIsoDate, shiftIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  FREE_SLOT_SEARCH_DAYS,
  estimateMinutes,
  fillDay,
  isBlockPassed,
  nextFreeSlot,
  quarterUp,
  wallMoment,
  type BusyBlock,
  type FreeTimeContext
} from '@shared/planning/free-time'
import { workingMinutes } from '@shared/planning/time-blocks'
import type { MyDayService } from './my-day-service'
import type { TimeBlockService } from './time-block-service'

/**
 * Blocks that move (N3.4b, decision N28): Move to the next free time and
 * Fill my day, through `free-time.ts`, the one rule. The app's IPC and the
 * automation API both come here. Nothing here runs by itself: every plan and
 * every apply starts with a person's click or a caller's request. Taken time
 * is every enabled project's blocks and the shown outside calendars' timed
 * events; a plan returns block times only, never the events.
 */

/** The most blocks one Move them may move. */
const MAX_MOVES = 100

export interface BlockMoveServiceDependencies {
  db: Database.Database
  timeBlocks: TimeBlockService
  myDay: MyDayService
  getWorkingHours(): WorkingHours
  /** Me: whose working days and leave count. */
  getMe(): Pick<Person, 'id' | 'workingDays'> | null
  getDaysOff(): readonly DayOff[]
  /** Shown outside calendars' occurrences in a range (N3.3a); none when left out. */
  getEvents?(from: string, to: string): readonly CalendarOccurrence[]
  /** The clock; tests pass their own. */
  now?(): Date
}

/** Whether a time a plan showed has passed by `now`. */
function startsBefore(time: Pick<BlockTime, 'date' | 'startMinute'>, now: PlanMoment): boolean {
  const order = compareIsoDates(time.date, now.date)
  return order < 0 || (order === 0 && time.startMinute < quarterUp(now.minute))
}

export class BlockMoveService {
  constructor(private readonly deps: BlockMoveServiceDependencies) {}

  private moment(): PlanMoment {
    return wallMoment(this.deps.now?.() ?? new Date())
  }

  /** What counts as taken from `from` to `to`: every enabled project's blocks, and events. */
  private context(from: string, to: string): FreeTimeContext & { blocks: TimeBlock[] } {
    const me = this.deps.getMe()
    let events: readonly CalendarOccurrence[] = []
    try {
      events = this.deps.getEvents?.(from, to) ?? []
    } catch (error) {
      console.error('Could not read outside calendars for free time:', error)
    }
    return {
      workingHours: workingMinutes(this.deps.getWorkingHours()),
      workingDays: me?.workingDays,
      personId: me?.id ?? null,
      daysOff: this.deps.getDaysOff(),
      events,
      blocks: this.deps.timeBlocks.list({ from, to })
    }
  }

  /**
   * Where each block would go: the next free time from now that is as long
   * as it is, each move taking its time before the next is placed. Changes
   * nothing. `projectId` keeps the blocks to that project's.
   */
  planMoves(blockIds: unknown, projectId?: string, now = this.moment()): BlockMovePlan {
    if (!Array.isArray(blockIds) || blockIds.length === 0 || blockIds.length > MAX_MOVES)
      throw new Refusal(`Send from 1 to ${MAX_MOVES} time block ids`)
    const blocks = [...new Set(blockIds)].map((id) =>
      this.deps.timeBlocks.get(id as string, projectId)
    )
    const context = this.context(now.date, shiftIsoDate(now.date, FREE_SLOT_SEARCH_DAYS))
    const moving = new Set(blocks.map((block) => block.id))
    const taken: BusyBlock[] = [...context.blocks]
    const moves: BlockMove[] = blocks.map((block) => {
      const slot = nextFreeSlot(block.lengthMinutes, now, {
        ...context,
        blocks: taken,
        ignoreBlockIds: moving
      })
      const to = slot ? { ...slot, lengthMinutes: block.lengthMinutes } : null
      if (to) taken.push({ id: `${block.id}:planned`, ...to })
      return {
        blockId: block.id,
        projectId: block.projectId,
        workItemId: block.workItemId,
        title: block.title,
        from: {
          date: block.date,
          startMinute: block.startMinute,
          lengthMinutes: block.lengthMinutes
        },
        to
      }
    })
    return { now, moves }
  }

  /**
   * Moves blocks where a plan said, in one transaction. When a time it
   * showed has passed, nothing moves and the plan comes back worked out
   * again. Events are not checked again: the preview is what is applied.
   */
  applyMoves(
    plan: BlockMovePlan,
    projectId?: string,
    now = this.moment()
  ): PlanApplyResult<BlockMovePlan> {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.moves))
      throw new Refusal('Send the plan to apply')
    const moves = plan.moves.filter((move) => move && move.to)
    if (moves.some((move) => startsBefore(move.to!, now))) {
      return {
        applied: false,
        blocks: [],
        previous: [],
        plan: this.planMoves(
          plan.moves.map((move) => move.blockId),
          projectId,
          now
        )
      }
    }
    const blocks: TimeBlock[] = []
    const previous: PlanApplyResult<BlockMovePlan>['previous'] = []
    this.deps.db.transaction(() => {
      for (const move of moves) {
        const current = this.deps.timeBlocks.get(move.blockId, projectId)
        previous.push({
          blockId: current.id,
          date: current.date,
          startMinute: current.startMinute,
          lengthMinutes: current.lengthMinutes
        })
        blocks.push(
          this.deps.timeBlocks.update(
            current.id,
            {
              date: move.to!.date,
              startMinute: move.to!.startMinute,
              lengthMinutes: move.to!.lengthMinutes
            },
            projectId
          )
        )
      }
    })()
    return { applied: true, blocks, previous, plan: null }
  }

  /** Move to the next free time: one block, planned and moved at once. */
  moveToFree(blockId: string, projectId?: string, now = this.moment()) {
    const plan = this.planMoves([blockId], projectId, now)
    if (!plan.moves[0].to) throw new Refusal('No free time in the next 14 days')
    return this.applyMoves(plan, projectId, now)
  }

  /** The blocks whose time has passed while their task is open, from `days` days back to now. */
  passed(projectId?: string, now = this.moment(), days = 7): TimeBlock[] {
    return this.deps.timeBlocks
      .list({ from: shiftIsoDate(now.date, -days), to: now.date, projectId })
      .filter((block) => isBlockPassed(block, now))
  }

  /**
   * Fill my day's preview: `date`'s My day tasks that are not done, in
   * order, placed into its free time from now. Changes nothing.
   */
  planFill(date: unknown, projectId?: string, now = this.moment()): FillDayPlan {
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    const tasks = this.deps.myDay.list(date, projectId).filter((task) => task.status !== 'done')
    const context = this.context(date, date)
    const blocked = new Map<string, number>()
    for (const block of context.blocks)
      blocked.set(block.workItemId, (blocked.get(block.workItemId) ?? 0) + block.lengthMinutes)
    const result = fillDay(
      tasks.map((task) => ({
        id: task.id,
        estimateMinutes:
          task.estimateUnit === 'hours' && typeof task.estimate === 'number' && task.estimate > 0
            ? estimateMinutes(task.estimate, 'hours')
            : null,
        blockedMinutes: blocked.get(task.id) ?? 0
      })),
      date,
      now,
      context
    )
    const byId = new Map(tasks.map((task) => [task.id, task]))
    return {
      date,
      now,
      closed: result.closed,
      pieces: result.pieces.map((piece) => {
        const task = byId.get(piece.workItemId)!
        return { ...piece, date, projectId: task.projectId, title: task.title }
      }),
      notPlaced: result.notPlaced.map((entry) => {
        const task = byId.get(entry.workItemId)!
        return { ...entry, projectId: task.projectId, title: task.title }
      }),
      alreadyBlocked: result.alreadyBlocked
    }
  }

  /**
   * Places them: makes the plan's blocks in one transaction. When a time it
   * showed has passed, or its "now" is another day, nothing is made and the
   * plan comes back worked out again.
   */
  applyFill(
    plan: FillDayPlan,
    projectId?: string,
    now = this.moment()
  ): PlanApplyResult<FillDayPlan> {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.pieces) || !plan.now)
      throw new Refusal('Send the plan to apply')
    const stale =
      plan.now.date !== now.date || plan.pieces.some((piece) => startsBefore(piece, now))
    if (stale) {
      return {
        applied: false,
        blocks: [],
        previous: [],
        plan: this.planFill(plan.date, projectId, now)
      }
    }
    const blocks: TimeBlock[] = []
    this.deps.db.transaction(() => {
      for (const piece of plan.pieces) {
        blocks.push(
          this.deps.timeBlocks.create(
            {
              workItemId: piece.workItemId,
              date: piece.date,
              startMinute: piece.startMinute,
              lengthMinutes: piece.lengthMinutes
            },
            projectId
          )
        )
      }
    })()
    return { applied: true, blocks, previous: [], plan: null }
  }
}
