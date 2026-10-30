/**
 * Focus (N3.5, N29): a countdown on a task's timer. The settings live in
 * `notifications.focus`; the focus itself lives in main's memory only, so
 * closing Ostler ends it.
 */

/** Settings › Notifications › Focus. Config migration 35 writes the defaults. */
export interface FocusSettings {
  /** The lengths offered when focus starts, in minutes, each 5 to 180. */
  lengths: number[]
  /** The break offered at the end, in minutes, 1 to 60. */
  breakMinutes: number
  /** A soft chime at the end of a focus and of a break. */
  chime: boolean
  /** The length used last, the default next time. */
  lastMinutes: number
}

export const FOCUS_MIN_MINUTES = 5
export const FOCUS_MAX_MINUTES = 180
export const FOCUS_BREAK_MIN_MINUTES = 1
export const FOCUS_BREAK_MAX_MINUTES = 60
/** At most this many lengths are offered. */
export const FOCUS_MAX_LENGTHS = 4

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  lengths: [25, 50],
  breakMinutes: 5,
  chime: true,
  lastMinutes: 25
}

/**
 * `focus` while the countdown runs; `ended` once it reached its end and the
 * person has not chosen yet (the timer keeps running); `break` while the
 * break counts down (the timer stopped when focus ended).
 */
export type FocusPhase = 'focus' | 'ended' | 'break'

export interface FocusState {
  id: string
  projectId: string
  workItemId: string
  workItemTitle: string
  /** The timer's entry this focus started. */
  entryId: string
  minutes: number
  startedAt: number
  /** Time left is always `endsAt - now`, never counted in memory. */
  endsAt: number
  phase: FocusPhase
  /** While on a break, when it ends. */
  breakEndsAt: number | null
}

/** What happened: `finished` and `break-over` chime; `ended` means the focus went away. */
export type FocusEvent = 'started' | 'finished' | 'break' | 'break-over' | 'ended'

export interface FocusChange {
  /** The focus now, or null. */
  focus: FocusState | null
  event: FocusEvent
  /** The focus the event is about (after `break-over` or `ended`, the one that went). */
  focusId: string
}

/** The three answers when a focus ends. */
export type FocusChoice = 'break' | 'keep' | 'stop'
