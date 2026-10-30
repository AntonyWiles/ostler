import type { NavigateRequest, PinView } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { countdownWords, shortCountdownTitle } from '@shared/planning/countdown'
import type { PersonWorkingDays } from '@shared/planning/working-days'

/**
 * Countdowns in the tray menu and the jump list (N5.2b, N37), as data: each
 * is the countdown's words and the deep link of its item. The words come
 * from the one function Home and the automation API use, with the title
 * shortened for the narrow menu.
 */
export interface CountdownEntry {
  pinId: string
  label: string
  request: NavigateRequest
}

/** The entries for the countdowns, in pin order. Gone or undated pins are left out. */
export function countdownEntries(
  pins: readonly PinView[],
  today: string,
  workingDays: PersonWorkingDays
): CountdownEntry[] {
  const entries: CountdownEntry[] = []
  for (const pin of pins) {
    if (!pin.countdown || !pin.exists || !pin.date || pin.title === null) continue
    if (pin.kind !== 'task' && pin.kind !== 'milestone' && pin.kind !== 'personal-goal') continue
    entries.push({
      pinId: pin.id,
      label: countdownWords(
        { title: shortCountdownTitle(pin.title), date: pin.date, done: pin.done === true },
        today,
        workingDays
      ),
      request:
        pin.kind === 'task'
          ? { kind: 'task', projectId: pin.projectId, taskId: pin.targetId }
          : pin.kind === 'milestone'
            ? { kind: 'milestone', projectId: pin.projectId, id: pin.targetId }
            : { kind: 'personal-goal', id: pin.targetId }
    })
  }
  return entries
}

/** How often main looks whether the local date has changed. */
export const COUNTDOWN_CHECK_MS = 60_000

export interface CountdownWatchOptions {
  now: () => Date
  /** The entries as they are for `today`. */
  read: (today: string) => CountdownEntry[]
  /** Shows new entries in the tray and the jump list. */
  apply: (entries: CountdownEntry[]) => void
}

/**
 * Keeps the tray's and the jump list's countdowns current: read again when
 * pins or their items change (`refresh`), and when the local date has
 * changed (`tick`, once a minute and at resume from sleep). Entries are
 * applied only when they differ from those shown, so Windows rebuilds the
 * jump list no more often than a countdown's words change.
 */
export class CountdownWatch {
  private today: string
  private shownKey: string | null = null
  private shown: CountdownEntry[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: CountdownWatchOptions) {
    this.today = todayIsoDate(options.now())
  }

  get entries(): CountdownEntry[] {
    return this.shown
  }

  /** Reads the countdowns again; applies them when they changed. Returns whether they did. */
  refresh(): boolean {
    this.today = todayIsoDate(this.options.now())
    let entries: CountdownEntry[]
    try {
      entries = this.options.read(this.today)
    } catch {
      return false
    }
    const key = JSON.stringify(entries)
    if (key === this.shownKey) return false
    this.shownKey = key
    this.shown = entries
    this.options.apply(entries)
    return true
  }

  /** Reads again only when the local date has changed since the last read. */
  tick(): boolean {
    if (todayIsoDate(this.options.now()) === this.today) return false
    return this.refresh()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), COUNTDOWN_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
