import {
  isIsoDate,
  isoDaysBetween,
  isoWeekday,
  parseIsoDate,
  shiftIsoDate,
  toIsoDate
} from './dates'
import { isProjectInPlay } from './project-stages'
import { t } from './i18n'

/**
 * Status updates (N5.5, N40): the person's own judgement of how a project is
 * going, On track, At risk or Off track, with a short Markdown note. The
 * latest shows on the Overview and on Home's cards; the rest are the
 * project's diary. Health is the person's word: nothing here computes it, and
 * nothing computed (the cards' health badge, the charts) reads it.
 *
 * The optional reminder to post one lives on the project in `config.json`
 * (config migration 29): off, weekly or fortnightly, on a weekday.
 */

export const STATUS_UPDATE_HEALTHS = ['on-track', 'at-risk', 'off-track'] as const
export type StatusUpdateHealth = (typeof STATUS_UPDATE_HEALTHS)[number]

/** The longest note, in characters. */
export const MAX_STATUS_UPDATE_NOTE = 2000

/** Who posted an update: the person, or the automation API (activity's actor kinds). */
export type StatusUpdateAuthorKind = 'human' | 'automation'

export interface StatusUpdate {
  id: string
  projectId: string
  health: StatusUpdateHealth
  /** Markdown, shown through the app's sanitised rendering. */
  note: string
  authorKind: StatusUpdateAuthorKind
  /** The person, for `human`. */
  authorPersonId: string | null
  /** The author, already named: "Alex", "Automation API". */
  authorName: string
  postedAt: number
  /** When it was last edited, or null. */
  editedAt: number | null
}

export interface StatusUpdateInput {
  health: StatusUpdateHealth
  note: string
}

/** What Draft from activity suggests (N5.5): it fills the dialog; nothing is posted. */
export interface StatusUpdateDraft {
  /** Null when the answer named no health it knows: the person picks. */
  health: StatusUpdateHealth | null
  note: string
  /** How many activity entries it was drafted from. */
  changes: number
  /** The start of the window it read: the last update, or two weeks ago. */
  since: number
}

/** "On track", "At risk", "Off track": the one wording every surface shows. */
export function statusUpdateHealthLabel(health: StatusUpdateHealth): string {
  switch (health) {
    case 'on-track':
      return t('projects:statusUpdates.health.onTrack')
    case 'at-risk':
      return t('projects:statusUpdates.health.atRisk')
    case 'off-track':
      return t('projects:statusUpdates.health.offTrack')
  }
}

export function isStatusUpdateHealth(value: unknown): value is StatusUpdateHealth {
  return typeof value === 'string' && (STATUS_UPDATE_HEALTHS as readonly string[]).includes(value)
}

/** A health and note a caller sent: the one validation every surface uses (throws). */
export function parseStatusUpdateInput(value: unknown): StatusUpdateInput {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  if (!isStatusUpdateHealth(raw.health)) {
    throw new Error(`health must be one of ${STATUS_UPDATE_HEALTHS.join(', ')}`)
  }
  if (typeof raw.note !== 'string') throw new Error('note must be text')
  const note = raw.note.trim()
  if (note.length > MAX_STATUS_UPDATE_NOTE) {
    throw new Error(`A status update's note can be at most ${MAX_STATUS_UPDATE_NOTE} characters`)
  }
  return { health: raw.health, note }
}

// ─── The reminder ───────────────────────────────────────────────────────────

export const UPDATE_REMINDER_CADENCES = ['off', 'weekly', 'fortnightly'] as const
export type UpdateReminderCadence = (typeof UPDATE_REMINDER_CADENCES)[number]

export interface UpdateReminder {
  cadence: UpdateReminderCadence
  /** 0 for Sunday to 6 for Saturday. */
  weekday: number
  /**
   * The day the reminder was set (`YYYY-MM-DD`), or null while it is off. No
   * reminder falls before it, and fortnights count from the first weekday on
   * or after it.
   */
  since: string | null
}

export const DEFAULT_UPDATE_REMINDER: UpdateReminder = { cadence: 'off', weekday: 1, since: null }

const INTERVAL_DAYS: Record<Exclude<UpdateReminderCadence, 'off'>, number> = {
  weekly: 7,
  fortnightly: 14
}

/** With no reminder, an update older than this reads as old. */
const OLD_WITHOUT_REMINDER_DAYS = 30
const DAY_MS = 86_400_000

function isWeekdayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

/** A stored reminder, or the default (off) for anything this version does not know. */
export function normalizeUpdateReminder(value: unknown): UpdateReminder {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const cadence = (UPDATE_REMINDER_CADENCES as readonly unknown[]).includes(raw.cadence)
    ? (raw.cadence as UpdateReminderCadence)
    : 'off'
  return {
    cadence,
    weekday: isWeekdayNumber(raw.weekday) ? raw.weekday : DEFAULT_UPDATE_REMINDER.weekday,
    since: cadence !== 'off' && isIsoDate(raw.since) ? raw.since : null
  }
}

/**
 * A reminder a caller asked to set (throws on a bad cadence or weekday).
 * Turning it on, or changing it, starts it today (`since`).
 */
export function parseUpdateReminder(
  value: unknown,
  previous: UpdateReminder,
  today: string
): UpdateReminder {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const cadence = raw.cadence === undefined ? previous.cadence : raw.cadence
  if (!(UPDATE_REMINDER_CADENCES as readonly unknown[]).includes(cadence)) {
    throw new Error(`cadence must be one of ${UPDATE_REMINDER_CADENCES.join(', ')}`)
  }
  const weekday = raw.weekday === undefined ? previous.weekday : raw.weekday
  if (!isWeekdayNumber(weekday)) {
    throw new Error('weekday must be a whole number from 0 (Sunday) to 6 (Saturday)')
  }
  const next = { cadence: cadence as UpdateReminderCadence, weekday }
  if (next.cadence === 'off') return { ...next, since: null }
  const unchanged =
    previous.cadence === next.cadence && previous.weekday === next.weekday && previous.since
  return { ...next, since: unchanged ? previous.since : today }
}

/** Days between reminders, or null while it is off. */
export function reminderIntervalDays(reminder: UpdateReminder): number | null {
  return reminder.cadence === 'off' ? null : INTERVAL_DAYS[reminder.cadence]
}

/**
 * The latest reminder day on or before `today` (`YYYY-MM-DD`), or null: the
 * reminder is off, or its first day has not come yet.
 */
export function lastReminderDay(reminder: UpdateReminder, today: string): string | null {
  const interval = reminderIntervalDays(reminder)
  if (interval === null || !reminder.since) return null
  const first = shiftIsoDate(
    reminder.since,
    (reminder.weekday - isoWeekday(reminder.since) + 7) % 7
  )
  const gone = isoDaysBetween(first, today)
  if (gone < 0) return null
  return shiftIsoDate(first, gone - (gone % interval))
}

/**
 * Whether the project's reminder is due now: its day has come and nothing was
 * posted since it began. On hold, Done and archived projects get none (N38).
 */
export function updateReminderDue(
  project: { enabled: boolean; stage?: unknown; updateReminder?: unknown },
  latestPostedAt: number | null,
  now: number
): string | null {
  if (!isProjectInPlay(project)) return null
  const day = lastReminderDay(
    normalizeUpdateReminder(project.updateReminder),
    toIsoDate(new Date(now))
  )
  if (day === null) return null
  const start = parseIsoDate(day)!.getTime()
  if (latestPostedAt !== null && latestPostedAt >= start) return null
  return day
}

export type UpdateFreshness =
  | { kind: 'none' }
  | { kind: 'fresh' }
  /** Older than twice the reminder's interval, or a month without one. */
  | { kind: 'old'; weeks: number }

/** Whether a project's latest update is missing, recent or old. */
export function updateFreshness(
  latest: { postedAt: number } | null,
  reminder: unknown,
  now: number
): UpdateFreshness {
  if (!latest) return { kind: 'none' }
  const interval = reminderIntervalDays(normalizeUpdateReminder(reminder))
  const limit = interval === null ? OLD_WITHOUT_REMINDER_DAYS : interval * 2
  const age = now - latest.postedAt
  if (age <= limit * DAY_MS) return { kind: 'fresh' }
  return { kind: 'old', weeks: Math.floor(age / (7 * DAY_MS)) }
}

/** Two weeks: how far back Draft from activity reads when there is no update yet. */
export const STATUS_DRAFT_WINDOW_MS = 14 * DAY_MS

/** At most this many activity entries go to Ostler AI for a draft (the latest). */
export const STATUS_DRAFT_MAX_ENTRIES = 150

/**
 * Ostler AI's answer to Draft from activity: `{ health, note }` as JSON,
 * possibly fenced. A health it does not know reads as null (the person picks);
 * a note is cut to the limit. Null when there is no usable note.
 */
export function parseStatusDraftAnswer(
  response: string
): { health: StatusUpdateHealth | null; note: string } | null {
  const stripped = response
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end < start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, MAX_STATUS_UPDATE_NOTE) : ''
  if (!note) return null
  return { health: isStatusUpdateHealth(raw.health) ? raw.health : null, note }
}
