import { v4 as uuidv4 } from 'uuid'
import type {
  FocusChange,
  FocusChoice,
  FocusEvent,
  FocusSettings,
  FocusState,
  TimerStart
} from '@shared/ostler-api'
import { FOCUS_MAX_MINUTES, FOCUS_MIN_MINUTES } from '@shared/ostler-api'
import { countdownEnd, isFocusMinutes, msLeft } from '@shared/focus'
import { Refusal } from '@shared/refusal'
import type { TimeTracking } from './time-tracking'

export interface FocusDependencies {
  /** R2.3's one timer: focus starts and stops it, never an entry of its own. */
  time: Pick<TimeTracking, 'startTimer' | 'stopTimer' | 'timerState'>
  settings(): FocusSettings
  /** Saves the length used, the default next time. */
  rememberLength(minutes: number): void
  now?: () => number
  /** Calls `run` after `ms`; injected so tests drive the clock. */
  schedule?: (run: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

/**
 * Focus (N3.5, N29): one countdown at a time on a task's timer, held in
 * memory only, so closing Ostler ends it and the timer follows R2.3's question
 * at the next start. Every surface (the window, the tray, the automation API)
 * goes through this service.
 *
 * Time left is always computed from the stored end: the scheduled check only
 * says when to look, so a laptop that slept wakes to the right time, or to
 * the end. While the countdown runs, `holdsNotifications` tells the
 * notification gate to hold desktop notifications, as quiet hours do.
 */
export class FocusService {
  private focus: FocusState | null = null
  private handle: unknown = null
  private listener: ((change: FocusChange) => void) | null = null
  private readonly now: () => number
  private readonly schedule: (run: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void

  constructor(private readonly deps: FocusDependencies) {
    this.now = deps.now ?? (() => Date.now())
    this.schedule =
      deps.schedule ??
      ((run, ms) => {
        const timer = setTimeout(run, ms)
        timer.unref?.()
        return timer
      })
    this.cancel = deps.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout))
  }

  /** Told after every change: the window, the tray and the end's notification. */
  setChangedListener(listener: ((change: FocusChange) => void) | null): void {
    this.listener = listener
  }

  /** The focus now, after catching up with the clock. */
  get(): FocusState | null {
    this.check()
    return this.focus
  }

  /** True while a focus counts down: desktop notifications wait (Inbox items still arrive). */
  holdsNotifications(now = this.now()): boolean {
    return this.focus?.phase === 'focus' && now < this.focus.endsAt
  }

  /**
   * Starts a focus: the task's timer through R2.3 (so a running timer stops,
   * and the result names it for undo) and the countdown. A focus already
   * running ends first: one at a time.
   */
  start(
    projectId: string,
    workItemId: string,
    minutes: unknown
  ): { focus: FocusState; timer: TimerStart } {
    if (!isFocusMinutes(minutes))
      throw new Refusal(
        `Focus lasts a whole number of minutes from ${FOCUS_MIN_MINUTES} to ${FOCUS_MAX_MINUTES}`
      )
    const previous = this.focus
    // Cleared first, so the timer's own change does not read as "stopped elsewhere".
    this.set(null)
    let timer: TimerStart
    try {
      timer = this.deps.time.startTimer(projectId, workItemId, this.now())
    } catch (error) {
      this.set(previous)
      throw error
    }
    const startedAt = timer.started.startedAt
    const focus: FocusState = {
      id: uuidv4(),
      projectId,
      workItemId,
      workItemTitle: timer.started.workItemTitle,
      entryId: timer.started.id,
      minutes,
      startedAt,
      endsAt: startedAt + minutes * 60_000,
      phase: 'focus',
      breakEndsAt: null
    }
    this.set(focus)
    try {
      this.deps.rememberLength(minutes)
    } catch (error) {
      console.error('Could not save the focus length:', error)
    }
    this.emit('started', focus.id)
    return { focus, timer }
  }

  /**
   * Stops the focus. While it counts down, or after it ended, the task's
   * timer stops too (now, or at the moment focus ended if that has passed);
   * on a break, the break ends.
   */
  stop(): FocusState | null {
    const focus = this.get()
    if (!focus) return null
    this.set(null)
    if (focus.phase !== 'break' && this.timerIsFocus(focus))
      this.deps.time.stopTimer(Math.min(this.now(), focus.endsAt))
    this.emit('ended', focus.id)
    return null
  }

  /**
   * The person's answer once focus ended: a break (the timer stops at the
   * moment focus ended and the break counts down), keep going (the timer
   * runs on with no countdown) or stop (the timer stops at the moment focus ended).
   */
  choose(choice: FocusChoice): FocusState | null {
    const focus = this.get()
    if (!focus || focus.phase !== 'ended') throw new Refusal('No focus has ended to choose for')
    if (choice === 'keep') {
      this.set(null)
      this.emit('ended', focus.id)
      return null
    }
    const timing = this.timerIsFocus(focus)
    // The new state first, so the timer's own change does not end it again.
    const next: FocusState | null =
      choice === 'stop'
        ? null
        : {
            ...focus,
            phase: 'break',
            breakEndsAt: this.now() + this.deps.settings().breakMinutes * 60_000
          }
    this.set(next)
    if (timing) this.deps.time.stopTimer(focus.endsAt)
    this.emit(next ? 'break' : 'ended', focus.id)
    return next
  }

  /** The timer changed anywhere (R2.3): a stopped or switched timer ends the focus. */
  timerChanged(): void {
    const focus = this.focus
    if (!focus || focus.phase === 'break') return
    if (this.timerIsFocus(focus)) return
    this.set(null)
    this.emit('ended', focus.id)
  }

  /** Catches up with the clock: the end of a focus, or of its break. */
  check(): void {
    const focus = this.focus
    if (!focus) return
    const end = countdownEnd(focus)
    if (end === null || this.now() < end) return
    if (focus.phase === 'focus') {
      this.set({ ...focus, phase: 'ended' })
      this.emit('finished', focus.id)
    } else {
      this.set(null)
      this.emit('break-over', focus.id)
    }
  }

  /** On quit: nothing more is scheduled. The focus itself is never saved. */
  dispose(): void {
    this.set(null)
  }

  private timerIsFocus(focus: FocusState): boolean {
    return this.deps.time.timerState().running?.id === focus.entryId
  }

  private set(focus: FocusState | null): void {
    this.focus = focus
    if (this.handle !== null) this.cancel(this.handle)
    this.handle = null
    const end = focus ? countdownEnd(focus) : null
    if (end !== null)
      this.handle = this.schedule(
        () => {
          this.handle = null
          this.check()
          // A timer that fired a moment early looks again.
          if (this.focus && this.handle === null) this.set(this.focus)
        },
        msLeft(end, this.now())
      )
  }

  private emit(event: FocusEvent, focusId: string): void {
    try {
      this.listener?.({ focus: this.focus, event, focusId })
    } catch (error) {
      console.error('Focus change listener failed:', error)
    }
  }
}
