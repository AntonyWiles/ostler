import type {
  PlanningColumnSettings,
  PlanningMilestone,
  PlanningWorkItem,
  TimeBlock
} from '../ostler-api'
import { blockInstants } from '../planning/time-blocks'
import { BRAND } from '../brand'
import { deepLinkFor } from '../deep-link'
import { isIsoDate, shiftIsoDate } from '../dates'
import { taskColumnLabel } from '../task-labels'
import { t } from '../i18n'

/*
 * A project's due dates as a calendar file (R4.1, D37): an iCalendar
 * (RFC 5545) `.ics` the person imports into Outlook, Google Calendar or any
 * other calendar. Exported on demand, never a live feed. The one writer: the
 * Calendar's "Export to calendar file…", the command palette and
 * `GET /export?format=ics` all call it.
 *
 * Every event is all-day: a task's due date, or the span from its start date
 * to its due date, and a dated milestone. `DTEND` is exclusive (the day
 * after). UIDs come from the record's id and a domain derived from the brand,
 * so importing a newer file again updates events instead of doubling them in
 * clients that honour UIDs.
 *
 * With "Include time blocks" (N3.4a), each time block is a timed event in
 * UTC, computed from its wall-clock time in the person's zone when exported.
 */

export interface CalendarFileOptions {
  /** Finished tasks and milestones too (default false). */
  includeFinished?: boolean
  /** Time blocks too, as timed events (default false). */
  includeBlocks?: boolean
}

export interface CalendarFileInput {
  project: { id: string; name: string }
  tasks: readonly PlanningWorkItem[]
  milestones: readonly PlanningMilestone[]
  personName: (personId: string) => string | null
  options?: CalendarFileOptions
  /** The project's column names (R2.4), for each task's status line. */
  columns?: PlanningColumnSettings | null
  /** For `DTSTAMP`. */
  now: number
  /** The project's time blocks (N3.4a), written only with `includeBlocks`. */
  blocks?: readonly TimeBlock[]
  /** The person's IANA zone, for a block's wall-clock time; defaults to the system's. */
  timeZone?: string
}

/** The domain every UID ends with, from the brand's link scheme. */
export const CALENDAR_UID_DOMAIN = `${BRAND.urlScheme}.local`

const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75

/** TEXT as RFC 5545 §3.3.11 writes it: backslash, semicolon, comma and new lines escaped. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Folds a content line at 75 octets (RFC 5545 §3.1): CRLF and one space
 * before each continuation, never inside a UTF-8 character.
 */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ''
  let octets = 0
  for (const char of line) {
    const size = utf8Octets(char)
    // A continuation's leading space counts towards its 75.
    const limit = out.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1
    if (octets + size > limit) {
      out.push(current)
      current = ''
      octets = 0
    }
    current += char
    octets += size
  }
  out.push(current)
  return out.join(`${CRLF} `)
}

/** How many octets one character takes in UTF-8. */
function utf8Octets(char: string): number {
  const code = char.codePointAt(0)!
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
}

/** `YYYY-MM-DD` as a `VALUE=DATE`: `YYYYMMDD`. */
const icsDate = (iso: string) => iso.replace(/-/g, '')

/** A UTC date-time for `DTSTAMP`: `YYYYMMDDTHHMMSSZ`. */
export function icsTimestamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** The stable UID of a task's or milestone's event. */
export function calendarUid(kind: 'task' | 'milestone' | 'block', id: string): string {
  return `${kind}-${id}@${CALENDAR_UID_DOMAIN}`
}

function allDayEvent(input: {
  uid: string
  stamp: string
  start: string
  end: string
  summary: string
  description: string
  url: string
}): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${input.stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(input.start)}`,
    // Exclusive: the day after the last day.
    `DTEND;VALUE=DATE:${icsDate(shiftIsoDate(input.end, 1))}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    `URL:${input.url}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  ]
}

/** The calendar file's text, and how many events it holds. */
export function buildCalendarFile(input: CalendarFileInput): { text: string; eventCount: number } {
  const includeFinished = input.options?.includeFinished === true
  const stamp = icsTimestamp(input.now)
  const scheme = BRAND.urlScheme
  const projectLine = t('data:calendarFile.project', { name: input.project.name })
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escapeIcsText(BRAND.publisher)}//${escapeIcsText(BRAND.fullName)}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(input.project.name)}`
  ]
  let eventCount = 0

  const tasks = input.tasks
    .filter((task) => isIsoDate(task.targetDate))
    .filter((task) => includeFinished || task.status !== 'done')
    .sort((a, b) => a.targetDate!.localeCompare(b.targetDate!) || a.createdAt - b.createdAt)
  for (const task of tasks) {
    const due = task.targetDate!
    const start = isIsoDate(task.startDate) && task.startDate <= due ? task.startDate : due
    const assignee = task.assigneeId ? input.personName(task.assigneeId) : null
    const url = deepLinkFor({ kind: 'task', projectId: input.project.id, taskId: task.id }, scheme)
    const description = [
      projectLine,
      t('data:calendarFile.status', { status: taskColumnLabel(task, input.columns) }),
      assignee
        ? t('data:calendarFile.assignee', { name: assignee })
        : t('data:calendarFile.unassigned'),
      url
    ].join('\n')
    lines.push(
      ...allDayEvent({
        uid: calendarUid('task', task.id),
        stamp,
        start,
        end: due,
        summary: task.title,
        description,
        url
      })
    )
    eventCount++
  }

  const milestones = input.milestones
    .filter((milestone) => isIsoDate(milestone.targetDate))
    .filter(
      (milestone) =>
        includeFinished || (milestone.status !== 'complete' && milestone.status !== 'archived')
    )
  for (const milestone of milestones) {
    const url = deepLinkFor(
      { kind: 'project', projectId: input.project.id, view: 'calendar' },
      scheme
    )
    const description = [
      projectLine,
      t('data:calendarFile.status', {
        status: t(`tasks:milestoneCard.${milestone.status}`)
      }),
      url
    ].join('\n')
    lines.push(
      ...allDayEvent({
        uid: calendarUid('milestone', milestone.id),
        stamp,
        start: milestone.targetDate!,
        end: milestone.targetDate!,
        summary: t('data:calendarFile.milestone', { name: milestone.name }),
        description,
        url
      })
    )
    eventCount++
  }

  if (input.options?.includeBlocks === true) {
    const zone = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    const blocks = [...(input.blocks ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute
    )
    for (const block of blocks) {
      const { start, end } = blockInstants(block.date, block.startMinute, block.lengthMinutes, zone)
      const url = deepLinkFor(
        { kind: 'task', projectId: input.project.id, taskId: block.workItemId },
        scheme
      )
      lines.push(
        'BEGIN:VEVENT',
        `UID:${calendarUid('block', block.id)}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsTimestamp(start)}`,
        `DTEND:${icsTimestamp(end)}`,
        `SUMMARY:${escapeIcsText(block.title)}`,
        `DESCRIPTION:${escapeIcsText([projectLine, url].join('\n'))}`,
        `URL:${url}`,
        'END:VEVENT'
      )
      eventCount++
    }
  }

  lines.push('END:VCALENDAR')
  return { text: lines.map(foldIcsLine).join(CRLF) + CRLF, eventCount }
}
