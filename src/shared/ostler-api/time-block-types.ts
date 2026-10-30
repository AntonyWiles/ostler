import type { PlanningWorkItemStatus } from './planning-types'

// ─── Time blocks (N3.4a, decision N28) ──────────────────────────────────────

/**
 * Time put aside for a task: a local date and a wall-clock start and length,
 * so a 09:00 block stays at 09:00 across a clock change. A plan, never a time
 * entry (R2.3). Personal planning: it does not travel in the project file.
 */
export interface TimeBlock {
  id: string
  projectId: string
  workItemId: string
  /** The person's local date, `YYYY-MM-DD`. */
  date: string
  /** Minutes after local midnight, 0 to 1425. */
  startMinute: number
  /** 15 to 1440; never past midnight. */
  lengthMinutes: number
  createdAt: number
  /** The task's title and status when read, so a block draws without another call. */
  title: string
  status: PlanningWorkItemStatus
}

/** Blocks from `from` to `to` (inclusive, `YYYY-MM-DD`), in one query. */
export interface TimeBlocksQuery {
  from: string
  to: string
  /** Only this project's blocks; leave out for every enabled project. */
  projectId?: string
  /** Only this task's blocks. */
  workItemId?: string
}

export interface CreateTimeBlockInput {
  workItemId: string
  date: string
  startMinute: number
  /** Leave out for the task's estimate in hours (else an hour), cut at midnight. */
  lengthMinutes?: number
}

export interface UpdateTimeBlockInput {
  date?: string
  startMinute?: number
  lengthMinutes?: number
}

// ─── Blocks that move (N3.4b, decision N28) ─────────────────────────────────

/** A block's place: a local date, a start and a length, in minutes. */
export interface BlockTime {
  date: string
  startMinute: number
  lengthMinutes: number
}

/** The moment a plan was worked out from, as the person's wall clock read it. */
export interface PlanMoment {
  date: string
  minute: number
}

/** One block's move to the next free time; `to` is null when none is free within 14 days. */
export interface BlockMove {
  blockId: string
  projectId: string
  workItemId: string
  title: string
  from: BlockTime
  to: BlockTime | null
}

/** Where blocks would go, changing nothing. Only block times: never the events they avoid. */
export interface BlockMovePlan {
  now: PlanMoment
  moves: BlockMove[]
}

/** A piece of a task placed by Fill my day. `parts` is 1 when the task is whole. */
export interface FillDayPiece extends BlockTime {
  projectId: string
  workItemId: string
  title: string
  part: number
  parts: number
}

/** Fill my day's preview: My day's unfinished tasks placed into the day's free time. */
export interface FillDayPlan {
  date: string
  now: PlanMoment
  /** Why nothing was placed: a day off (with its name) or not a working day. */
  closed: { kind: 'dayOff'; name: string } | { kind: 'notWorking' } | null
  pieces: FillDayPiece[]
  notPlaced: { projectId: string; workItemId: string; title: string; minutes: number }[]
  /** Tasks already blocked that day for all their estimate. */
  alreadyBlocked: string[]
}

/**
 * What applying a plan did. When time moved on since the preview (a time it
 * showed has passed), nothing changes: `applied` is false and `plan` is the
 * plan worked out again, to show before trying once more.
 */
export interface PlanApplyResult<TPlan> {
  applied: boolean
  /** The blocks as they are now: moved, or made. */
  blocks: TimeBlock[]
  /** For undo of moves: each moved block's place before. */
  previous: (BlockTime & { blockId: string })[]
  plan: TPlan | null
}
