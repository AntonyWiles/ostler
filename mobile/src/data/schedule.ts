/**
 * A project's schedule on the phone: its dated work in time order, a week at a time, as a reading
 * of the PC's Timeline. Overdue work comes first, then each week with the milestones and the tasks
 * due (or, without a due date, starting) in it. Done, archived, binned, won't do and To triage
 * tasks are left out, as on the Board.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import { shiftIsoDate } from '@shared/dates'
import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import type { QueryDb } from './queries'

export interface ScheduleTask {
  kind: 'task'
  id: string
  title: string
  status: PlanningWorkItemStatus
  startDate: string | null
  targetDate: string | null
  /** The day it is placed on: its due date, else its start. */
  day: string
  assigneeName: string | null
}

export interface ScheduleMilestone {
  kind: 'milestone'
  id: string
  name: string
  day: string
  done: number
  total: number
}

export type ScheduleEntry = ScheduleTask | ScheduleMilestone

export interface ScheduleWeek {
  /** The Monday of the week. */
  weekStart: string
  entries: ScheduleEntry[]
}

export interface Schedule {
  overdue: ScheduleTask[]
  weeks: ScheduleWeek[]
  /** Open tasks with no date at all, which the schedule cannot place. */
  undated: number
}

function mondayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const weekday = new Date(year, month - 1, date).getDay()
  return shiftIsoDate(day, -((weekday + 6) % 7))
}

/** The project's schedule from `today`, at most `weeks` weeks ahead. */
export function schedule(db: QueryDb, projectId: string, today: string, weeks = 12): Schedule {
  const last = shiftIsoDate(mondayOf(today), weeks * 7 - 1)
  const tasks = db
    .prepare(
      `SELECT w.id, w.title, w.status, w.start_date, w.target_date, p.name AS assignee_name
       FROM planning_work_items w LEFT JOIN people p ON p.id = w.assignee_id
       WHERE w.project_id = ? AND w.deleted_at IS NULL AND w.archived_at IS NULL
         AND w.resolution IS NULL AND w.in_triage = 0 AND w.someday = 0 AND w.status <> 'done'`
    )
    .all(projectId) as {
    id: string
    title: string
    status: PlanningWorkItemStatus
    start_date: string | null
    target_date: string | null
    assignee_name: string | null
  }[]
  const milestones = db
    .prepare(
      `SELECT m.id, m.name, m.target_date,
              COUNT(w.id) AS total,
              COALESCE(SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END), 0) AS done
       FROM planning_milestones m
       LEFT JOIN planning_work_items w ON w.milestone_id = m.id
         AND w.deleted_at IS NULL AND w.resolution IS NULL AND w.in_triage = 0
       WHERE m.project_id = ? AND m.status NOT IN ('complete', 'archived')
         AND m.target_date IS NOT NULL
       GROUP BY m.id`
    )
    .all(projectId) as {
    id: string
    name: string
    target_date: string
    total: number
    done: number
  }[]

  const overdue: ScheduleTask[] = []
  const byWeek = new Map<string, ScheduleEntry[]>()
  const place = (entry: ScheduleEntry) => {
    if (entry.day > last) return
    const week = entry.day < today ? mondayOf(today) : mondayOf(entry.day)
    const list = byWeek.get(week) ?? []
    list.push(entry)
    byWeek.set(week, list)
  }
  let undated = 0
  for (const row of tasks) {
    const day = row.target_date ?? row.start_date
    if (day === null) {
      undated += 1
      continue
    }
    const task: ScheduleTask = {
      kind: 'task',
      id: row.id,
      title: row.title,
      status: row.status,
      startDate: row.start_date,
      targetDate: row.target_date,
      day,
      assigneeName: row.assignee_name
    }
    if (row.target_date !== null && row.target_date < today) overdue.push(task)
    else if (day >= today || row.target_date === null) place(task)
  }
  for (const row of milestones) {
    place({
      kind: 'milestone',
      id: row.id,
      name: row.name,
      day: row.target_date,
      done: Number(row.done),
      total: Number(row.total)
    })
  }
  const order = (entry: ScheduleEntry) => `${entry.day}${entry.kind === 'milestone' ? '1' : '0'}`
  return {
    overdue: overdue.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title)),
    weeks: [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, entries]) => ({
        weekStart,
        entries: entries.sort((a, b) => order(a).localeCompare(order(b)))
      })),
    undated
  }
}
