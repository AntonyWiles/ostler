import type { KeyboardEvent, ReactNode } from 'react'
import type {
  PlanningDependencyLink,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { dependencyConflictWords } from '../dependency-link-words'
import { formatIsoDate, parseIsoDate } from '@shared/dates'
import {
  editTaskDates,
  taskTimelineBar,
  timelineBarSpan,
  type TaskDateChange,
  type TimelineEdit
} from '@shared/planning/timeline'
import type { TimelineBarSpec } from '../../../ui'
import type { TimelineRow } from './timeline-rows'
import { t } from '@shared/i18n'

/**
 * How a Timeline draws and moves its bars, shared by the project Timeline
 * (P5.5) and the Timeline across projects (N5.4) so the two cannot drift: the
 * bars a row holds, a task's bar and a milestone's diamond, what a bar says to
 * assistive tech, and the keyboard and drag edits.
 */

/** A bar on the timeline: a task's dates, or a milestone's target date. */
export type TimelineEntryBar = TimelineBarSpec &
  (
    | { kind: 'task'; item: PlanningWorkItem }
    | { kind: 'milestone'; name: string; milestoneId: string }
  )

/** "Thu 15 Oct 2026". */
export function longDate(date: string): string {
  return formatIsoDate(date, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

/** Checklist progress from 0 to 1; a done task is full. */
export function progressOf(item: PlanningWorkItem, done: boolean): number {
  if (done) return 1
  const total = item.acceptanceCriteria.length
  if (total === 0) return 0
  const ticked = item.acceptanceCriteria.filter((text) => item.checkedCriteria.includes(text))
  return ticked.length / total
}

/**
 * The bars each row holds: a milestone group's diamond on its target date,
 * a dated task's bar. `prefix` keeps ids apart when rows from several
 * projects share one grid.
 */
export function timelineEntryBars(
  rows: readonly TimelineRow[],
  prefix = ''
): Map<string, TimelineEntryBar[]> {
  const map = new Map<string, TimelineEntryBar[]>()
  for (const row of rows) {
    if (row.kind === 'group') {
      const date = row.milestone?.targetDate
      if (date && parseIsoDate(date))
        map.set(`${prefix}${row.id}`, [
          {
            id: `milestone:${row.milestone!.id}`,
            start: date,
            end: date,
            shape: 'milestone',
            kind: 'milestone',
            name: row.milestone!.name,
            milestoneId: row.milestone!.id
          }
        ])
      continue
    }
    if (!row.bar) continue
    const span = timelineBarSpan(row.bar)
    map.set(`${prefix}${row.id}`, [
      {
        id: row.item.id,
        ...span,
        shape: row.bar.kind === 'start' ? 'start' : 'bar',
        editable: true,
        kind: 'task',
        item: row.item
      }
    ])
  }
  return map
}

/**
 * What a conflict says, in words: the tooltip, the bar's name and the table.
 * A link with a type or lag (N7.2a) says what it asks for instead.
 */
export function conflictText(
  dependencyTitle: string,
  link?: Partial<Pick<PlanningDependencyLink, 'type' | 'lagDays'>>
): string {
  return (
    dependencyConflictWords(dependencyTitle, link) ??
    t('views:timelineView.startsBeforeDue', { dependencyTitle })
  )
}

/** A milestone's name and date, for its diamond. */
export function milestoneBarLabel(name: string, date: string): string {
  return t('views:timelineView.milestone', { barName: name, longDate: longDate(date) })
}

/**
 * What a task's bar says: its title, status, dates and checklist progress,
 * then whatever the view adds (slack, conflicts).
 */
export function taskBarLabel(
  item: PlanningWorkItem,
  statusLabel: string,
  status: PlanningWorkItemStatus,
  extra: readonly string[] = []
): string {
  const shape = taskTimelineBar(item)!
  const when =
    shape.kind === 'start'
      ? t('views:timelineView.startsNoDueDate', { longDate: longDate(shape.start) })
      : shape.hasStart
        ? t('views:timelineView.to', {
            longDate: longDate(shape.start),
            longDate2: longDate(shape.end)
          })
        : t('views:timelineView.due', { longDate: longDate(shape.end) })
  const total = item.acceptanceCriteria.length
  const progress =
    total > 0 && status !== 'done'
      ? t('views:timelineView.checklistItemsDone', {
          round: Math.round(progressOf(item, false) * total),
          total
        })
      : null
  return [item.title, statusLabel, when, progress, ...extra].filter(Boolean).join(', ')
}

/** A milestone's diamond, centred in its day. */
export function MilestoneDiamond({
  box,
  label
}: {
  box: { width: number; height: number }
  label: string
}) {
  const mid = box.height / 2
  const size = 7
  const cx = box.width / 2
  return (
    <polygon
      className="timeline-diamond"
      points={`${cx},${mid - size} ${cx + size},${mid} ${cx},${mid + size} ${cx - size},${mid}`}
    >
      <title>{label}</title>
    </polygon>
  )
}

/** A task's bar: a track with its checklist progress, or a fading start for a task with no due date. */
export function TaskBar({
  bar,
  box,
  status,
  conflict = false,
  critical = false,
  active = false,
  tooltip
}: {
  bar: TimelineEntryBar & { kind: 'task' }
  box: { width: number; height: number }
  status: PlanningWorkItemStatus
  conflict?: boolean
  critical?: boolean
  active?: boolean
  /** A `<title>`, when the view wants one. */
  tooltip?: ReactNode
}) {
  const done = status === 'done'
  const top = 8
  const height = box.height - 16
  if (bar.shape === 'start') {
    const gradient = `timeline-fade-${bar.item.id}`
    return (
      <g
        className={`timeline-bar timeline-bar--${status}${done ? ' is-done' : ''}${critical ? ' is-critical' : ''}`}
      >
        {tooltip}
        <defs>
          <linearGradient id={gradient}>
            <stop offset="0" className="timeline-bar__fade-from" />
            <stop offset="1" className="timeline-bar__fade-to" />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={top}
          width={box.width * 6}
          height={height}
          fill={`url(#${gradient})`}
          rx={4}
        />
        <rect
          className="timeline-bar__marker"
          x={0}
          y={top - 2}
          width={3}
          height={height + 4}
          rx={1}
        />
        {critical && (
          <rect
            className="timeline-bar__critical"
            x={-2}
            y={top - 3}
            width={7}
            height={height + 6}
            rx={2}
          />
        )}
      </g>
    )
  }
  const progress = progressOf(bar.item, done)
  return (
    <g
      className={[
        'timeline-bar',
        `timeline-bar--${status}`,
        done && 'is-done',
        conflict && 'has-conflict',
        critical && 'is-critical',
        active && 'is-active'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {tooltip}
      <rect
        className="timeline-bar__track"
        x={0}
        y={top}
        width={box.width}
        height={height}
        rx={4}
      />
      {progress > 0 && (
        <rect
          className="timeline-bar__progress"
          x={0}
          y={top}
          width={box.width * progress}
          height={height}
          rx={4}
        />
      )}
      {critical && (
        <rect
          className="timeline-bar__critical"
          x={-2}
          y={top - 2}
          width={box.width + 4}
          height={height + 4}
          rx={5}
        />
      )}
    </g>
  )
}

/**
 * Alt with the arrow keys on a focused bar: Alt moves it a day, Ctrl+Alt
 * its start, Shift+Alt its end. Null for any other key.
 */
export function keyboardBarEdit(
  event: KeyboardEvent<SVGGElement>
): { kind: TimelineEdit; days: number } | null {
  if (!event.altKey || event.metaKey) return null
  const days = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (days === 0) return null
  return { kind: event.shiftKey ? 'due' : event.ctrlKey ? 'start' : 'move', days }
}

/**
 * A task's dates moved on a Timeline: the one rule (`editTaskDates`) works out
 * the change, and the project's `rescheduleWorkItem` saves it with its undo.
 */
export function rescheduleOnTimeline(
  reschedule: (item: PlanningWorkItem, change: TaskDateChange) => Promise<boolean>,
  item: PlanningWorkItem,
  kind: TimelineEdit,
  days: number
): Promise<boolean> {
  const change = editTaskDates(item, kind, days)
  if (!change) return Promise.resolve(false)
  return reschedule(item, change)
}
