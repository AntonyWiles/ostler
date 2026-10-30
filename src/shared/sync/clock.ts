/*
 * Hybrid logical clock for project sync: every change made on this PC gets a
 * stamp that orders it against changes from other PCs sharing the same project
 * (see docs/plans/integrations/shared-folder-sync.md). A stamp is the wall time
 * in milliseconds, a counter that orders stamps sharing a wall time, and the
 * device that made it, so plain string comparison gives the order. Pure: the
 * clock reads time through an injected function and nothing else.
 */

/** A clock stamp: `<wall ms, 15 digits>-<counter, 6 digits>-<device id>`. Plain string comparison orders stamps. */
export type ClockStamp = string

export interface ClockParts {
  /** Milliseconds since 1970, as the PC's clock read it (or later, after a remote stamp). */
  wall: number
  /** Orders stamps that share a wall time. */
  counter: number
  /** The device that made the stamp: a random id, never containing whitespace. */
  device: string
}

export const MAX_WALL = 999_999_999_999_999
export const MAX_COUNTER = 999_999

const STAMP_PATTERN = /^(\d{15})-(\d{6})-(\S+)$/

/** A new random device id for this PC. */
export function newDeviceId(): string {
  return crypto.randomUUID()
}

/** Writes the parts as a stamp. Throws `RangeError` for out-of-range or malformed parts. */
export function formatStamp(parts: ClockParts): ClockStamp {
  const { wall, counter, device } = parts
  if (!Number.isInteger(wall) || wall < 0 || wall > MAX_WALL) {
    throw new RangeError(`Clock wall time out of range: ${wall}`)
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`Clock counter out of range: ${counter}`)
  }
  if (device === '' || /\s/.test(device)) {
    throw new RangeError(`Clock device id must be non-empty with no whitespace: "${device}"`)
  }
  return String(wall).padStart(15, '0') + '-' + String(counter).padStart(6, '0') + '-' + device
}

/** Reads a stamp back into its parts. Throws `RangeError` when the text is not a stamp. */
export function parseStamp(stamp: ClockStamp): ClockParts {
  const match = STAMP_PATTERN.exec(stamp)
  if (!match) throw new RangeError(`Not a clock stamp: "${stamp}"`)
  return { wall: Number(match[1]), counter: Number(match[2]), device: match[3] }
}

/** Orders two stamps: -1 when `a` is earlier, 1 when later, 0 when the same. */
export function compareStamps(a: ClockStamp, b: ClockStamp): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Gives this PC's changes stamps that sort after everything the clock has seen. */
export class HybridClock {
  private readonly device: string
  private readonly now: () => number
  private lastParts: ClockParts | null

  constructor(device: string, now: () => number = Date.now, last: ClockStamp | null = null) {
    this.device = device
    this.now = now
    this.lastParts = last ? parseStamp(last) : null
  }

  /** The last stamp this clock gave or received, or null before the first. */
  get last(): ClockStamp | null {
    return this.lastParts ? formatStamp(this.lastParts) : null
  }

  /** A stamp for a change made on this PC. */
  tick(): ClockStamp {
    const pt = this.now()
    const last = this.lastParts
    let wall: number
    let counter: number
    if (!last) {
      wall = pt
      counter = 0
    } else {
      wall = Math.max(last.wall, pt)
      counter = wall === last.wall ? last.counter + 1 : 0
    }
    return this.store({ wall, counter, device: this.device })
  }

  /** Takes in a stamp from another PC, so later local stamps sort after it; returns the new local stamp. */
  receive(remote: ClockStamp): ClockStamp {
    const r = parseStamp(remote)
    const pt = this.now()
    const lw = this.lastParts?.wall ?? -1
    const lc = this.lastParts?.counter ?? -1
    const wall = Math.max(lw, r.wall, pt)
    let counter: number
    if (wall === lw && wall === r.wall) {
      counter = Math.max(lc, r.counter) + 1
    } else if (wall === lw) {
      counter = lc + 1
    } else if (wall === r.wall) {
      counter = r.counter + 1
    } else {
      counter = 0
    }
    return this.store({ wall, counter, device: this.device })
  }

  private store(parts: ClockParts): ClockStamp {
    const stamp = formatStamp(parts)
    this.lastParts = parts
    return stamp
  }
}
