/**
 * Time tracking on the phone: the desktop's own `TimeTracking` over the phone's database, so a
 * timer started or an entry logged here is the row the PC writes (`planning_time_entries`, which
 * syncs per project). One timer runs at a time on this device; starting one stops the other, as
 * on the PC.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { TimeEntry, TimerStart } from '@shared/ostler-api'
import { shiftIsoDate, toIsoDate } from '@shared/dates'
import { TimeTracking } from '../../../electron/services/time-tracking'
import { guarded, type EditDb } from './edits'
import { projects, type QueryDb } from './queries'

type Db = EditDb & QueryDb

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

function projectIds(db: QueryDb): string[] {
  return projects(db).map((project) => project.id)
}

function tracker(db: Db): TimeTracking {
  return new TimeTracking(db as unknown as Database.Database, {
    requireProject: (projectId) => {
      if (!projectIds(db).includes(projectId)) throw new Error('Unknown project')
    },
    meId: () => meId(db),
    personExists: (personId) => !!db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId),
    changed: () => {}
  })
}

export interface TaskTime {
  /** The task's entries, the newest first. */
  entries: TimeEntry[]
  /** Seconds in finished entries. */
  loggedSeconds: number
  /** The running timer, when it is on this task. */
  running: TimeEntry | null
}

/** A task's time: its entries, the total, and the timer when it runs on this task. */
export function taskTime(db: Db, taskId: string): TaskTime {
  const time = tracker(db)
  const entries = time.listForWorkItem(taskId).reverse()
  const running = time.timerState().running
  return {
    entries,
    loggedSeconds: entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
    running: running?.workItemId === taskId ? running : null
  }
}

/** The timer running on this phone's database now, on any task, or null. */
export function runningTimer(db: Db): TimeEntry | null {
  try {
    return tracker(db).timerState().running
  } catch {
    return null
  }
}

/** Starts a timer on a task for Me; one already running stops now. */
export function startTimer(db: Db, projectId: string, taskId: string): TimerStart {
  return guarded(() => tracker(db).startTimer(projectId, taskId))
}

/** Stops the running timer; null when none ran. */
export function stopTimer(db: Db): TimeEntry | null {
  return guarded(() => tracker(db).stopTimer())
}

/** Undoes a start: its entry goes, and the timer it stopped runs on. */
export function undoTimerStart(db: Db, start: TimerStart): void {
  guarded(() => void tracker(db).undoStart(start.started.id, start.stopped?.id ?? null))
}

/** Logs time by hand on a task, for Me: `minutes` on `day` (YYYY-MM-DD), starting at 9:00. */
export function logTime(
  db: Db,
  projectId: string,
  taskId: string,
  minutes: number,
  day: string,
  note = ''
): TimeEntry {
  const [year, month, date] = day.split('-').map(Number)
  const startedAt = new Date(year, month - 1, date, 9, 0).getTime()
  return guarded(() =>
    tracker(db).create(projectId, {
      workItemId: taskId,
      startedAt,
      durationSeconds: Math.round(minutes * 60),
      note
    })
  )
}

/** Deletes an entry; the result is what `restoreTimeEntry` puts back. */
export function deleteTimeEntry(db: Db, projectId: string, entryId: string): TimeEntry {
  return guarded(() => tracker(db).delete(projectId, entryId))
}

export function restoreTimeEntry(db: Db, entry: TimeEntry): void {
  guarded(() => void tracker(db).restore(entry.projectId, entry))
}

export interface TimesheetDay {
  day: string
  entries: TimeEntry[]
  seconds: number
}

export interface Timesheet {
  /** The Monday the week starts on. */
  weekStart: string
  days: TimesheetDay[]
  seconds: number
  /** Seconds per project in the week, the most first. */
  byProject: { projectId: string; seconds: number }[]
}

/** The Monday on or before `day`. */
export function weekStartOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const weekday = new Date(year, month - 1, date).getDay()
  return shiftIsoDate(day, -((weekday + 6) % 7))
}

/**
 * Me's time in the week from `weekStart`, by day, as the PC's Timesheet counts it: an entry belongs
 * to the local day it started on; a running timer counts up to `now`.
 */
export function timesheet(db: Db, weekStart: string, now = Date.now()): Timesheet {
  const [year, month, date] = weekStart.split('-').map(Number)
  const from = new Date(year, month - 1, date).getTime()
  const to = new Date(year, month - 1, date + 7).getTime()
  const me = meId(db)
  const entries = tracker(db).list(
    me === null ? { from, to } : { from, to, personId: me },
    projectIds(db)
  )
  const seconds = (entry: TimeEntry) =>
    entry.durationSeconds ?? Math.max(0, Math.floor((now - entry.startedAt) / 1000))
  const days: TimesheetDay[] = Array.from({ length: 7 }, (_, index) => ({
    day: shiftIsoDate(weekStart, index),
    entries: [],
    seconds: 0
  }))
  const byProject = new Map<string, number>()
  for (const entry of entries) {
    const day = days.find((candidate) => candidate.day === toIsoDate(new Date(entry.startedAt)))
    if (!day) continue
    day.entries.push(entry)
    day.seconds += seconds(entry)
    byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + seconds(entry))
  }
  return {
    weekStart,
    days,
    seconds: days.reduce((sum, day) => sum + day.seconds, 0),
    byProject: [...byProject.entries()]
      .map(([projectId, total]) => ({ projectId, seconds: total }))
      .sort((a, b) => b.seconds - a.seconds)
  }
}

/** "1:05" for 65 minutes; "0:00" for nothing. Seconds are dropped. */
export function hoursAndMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
