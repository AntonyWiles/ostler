import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxEntry, MyWork, TimeEntry } from '../../src/shared/ostler-api'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const {
  DEFAULT_NOTIFICATION_SETTINGS,
  SYNC_CALM,
  SYNC_PATIENCE_MS,
  newInboxItems,
  nextTimeOfDay,
  parseNotificationSettings,
  pendingReminders,
  planNotifications,
  syncAttention,
  timerNotification,
  todaySummary
} = await import('../../mobile/src/data/notifications')

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

function work(today: { id: string; title: string; reason?: string; status?: string }[]): MyWork {
  return {
    today: today.map((task) => ({ status: 'todo', ...task })),
    upcoming: [],
    myDay: [],
    leftOver: null
  } as unknown as MyWork
}

describe('notification settings', () => {
  it('defaults to everything on, the Today summary at 08:00', () => {
    expect(parseNotificationSettings(null)).toEqual({
      due: true,
      timer: true,
      inbox: true,
      today: true,
      todayTime: '08:00',
      sync: true
    })
  })

  it('keeps what was stored and repairs what is broken', () => {
    expect(parseNotificationSettings('{"inbox":false,"todayTime":"07:00"}')).toMatchObject({
      inbox: false,
      todayTime: '07:00',
      due: true
    })
    expect(parseNotificationSettings('{"todayTime":"25:00","due":"no"}')).toMatchObject({
      todayTime: '08:00',
      due: true
    })
    expect(parseNotificationSettings('not json')).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })
})

describe('nextTimeOfDay', () => {
  it("is today's time when it is still to come, else tomorrow's", () => {
    expect(nextTimeOfDay(at(16, 7, 30), '08:00')).toBe(at(16, 8))
    expect(nextTimeOfDay(at(16, 8), '08:00')).toBe(at(17, 8))
    expect(nextTimeOfDay(at(16, 21), '06:00')).toBe(at(17, 6))
  })
})

describe('todaySummary', () => {
  it('counts each open task once and names the first three', () => {
    const summary = todaySummary(
      work([
        { id: 'a', title: 'Paint fence', reason: 'overdue' },
        { id: 'b', title: 'Call plumber', reason: 'today' },
        { id: 'c', title: 'Buy tiles' },
        { id: 'd', title: 'Book skip' },
        { id: 'e', title: 'Done already', status: 'done' }
      ])
    )
    expect(summary).toEqual({
      title: 'Today: 4 tasks, 1 overdue',
      body: 'Paint fence, Call plumber, Buy tiles and 1 more'
    })
  })

  it('is null when there is nothing to do', () => {
    expect(todaySummary(work([]))).toBeNull()
    expect(todaySummary(work([{ id: 'a', title: 'Done', status: 'done' }]))).toBeNull()
  })
})

describe('reminders on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-notifications-')
  let db: Database.Database
  let late: string
  let soon: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    soon = planning.createWorkItem(PROJECT, { title: 'Soon', targetDate: '2026-10-16' }, human).id
    late = planning.createWorkItem(PROJECT, { title: 'Later', targetDate: '2026-10-20' }, human).id
    const gone = planning.createWorkItem(PROJECT, { title: 'Binned' }, human).id
    planning.close()
    db = new Database(path)
    // Only the reminders below: not the ones the PC plans from the due dates.
    db.prepare('DELETE FROM reminders').run()
    const add = db.prepare(
      `INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    add.run('r1', PROJECT, soon, at(16, 9), 'due', null)
    add.run('r2', PROJECT, late, at(18, 9), 'custom', null)
    add.run('r3', PROJECT, soon, at(15, 9), 'custom', at(15, 9)) // already delivered by the PC
    add.run('r4', PROJECT, soon, at(10, 9), 'custom', null) // in the past
    add.run('r5', PROJECT, gone, at(17, 9), 'custom', null)
    db.prepare('UPDATE planning_work_items SET deleted_at = 1 WHERE id = ?').run(gone)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('lists reminders still to go off on live tasks, the soonest first', () => {
    expect(pendingReminders(db as unknown as QueryDb, at(14, 10)).map((r) => r.id)).toEqual([
      'r1',
      'r2'
    ])
  })

  it('plans one notification per reminder and the Today summary', () => {
    const planned = planNotifications(
      db as unknown as QueryDb,
      DEFAULT_NOTIFICATION_SETTINGS,
      at(14, 10),
      {
        projectName: () => 'House',
        workFor: (day) => {
          expect(day).toBe('2026-10-15')
          return work([{ id: soon, title: 'Soon' }])
        }
      }
    )
    expect(planned.map((p) => [p.id, p.at, p.title, p.body])).toEqual([
      ['due:r1', at(16, 9), 'Soon', 'Due today · House'],
      ['due:r2', at(18, 9), 'Later', 'Due 2026-10-20 · House'],
      ['today', at(15, 8), 'Today: 1 task', 'Soon']
    ])
    expect(planned[0].target).toEqual({ taskId: soon, projectId: PROJECT })
    expect(planned[2].target).toEqual({ tab: 'myDay' })
  })

  it('plans nothing that is turned off', () => {
    const planned = planNotifications(
      db as unknown as QueryDb,
      { ...DEFAULT_NOTIFICATION_SETTINGS, due: false, today: false },
      at(14, 10),
      { projectName: () => '', workFor: () => work([{ id: late, title: 'Later' }]) }
    )
    expect(planned).toEqual([])
  })
})

describe('newInboxItems', () => {
  const item = (key: string, kind = 'mention', readAt: number | null = null) =>
    ({
      key,
      kind,
      title: key,
      body: '',
      projectId: null,
      taskId: null,
      createdAt: 1,
      readAt
    }) as InboxEntry

  it('only remembers on the first look', () => {
    expect(newInboxItems([item('a'), item('b')], null, DEFAULT_NOTIFICATION_SETTINGS)).toEqual({
      notify: [],
      seen: ['a', 'b']
    })
  })

  it('notifies unread items not seen before, except reminders that notify by themselves', () => {
    const { notify, seen } = newInboxItems(
      [item('c'), item('d', 'mention', 5), item('reminder:r1', 'reminder'), item('a')],
      ['a', 'old'],
      DEFAULT_NOTIFICATION_SETTINGS
    )
    expect(notify.map((entry) => entry.key)).toEqual(['c'])
    expect(seen).toEqual(['c', 'd', 'reminder:r1', 'a', 'old'])
  })

  it('tells of reminder items when reminders are off, and of nothing when the Inbox is off', () => {
    const items = [item('reminder:r1', 'reminder')]
    const settings = DEFAULT_NOTIFICATION_SETTINGS
    expect(newInboxItems(items, [], { ...settings, due: false }).notify).toHaveLength(1)
    expect(newInboxItems(items, [], { ...settings, due: false, inbox: false }).notify).toEqual([])
  })
})

describe('timerNotification', () => {
  it('names the task and the time so far', () => {
    const entry = {
      id: 'e1',
      projectId: PROJECT,
      workItemId: 'w1',
      workItemTitle: 'Paint fence',
      startedAt: at(16, 9)
    } as TimeEntry
    const shown = timerNotification(entry, at(16, 10, 5))
    expect(shown.title).toBe('Timer: Paint fence')
    expect(shown.body).toContain('1:05 so far')
    expect(shown.target).toEqual({ taskId: 'w1', projectId: PROJECT })
  })
})

describe('syncAttention', () => {
  it('tells once after sync has failed for a while, and clears when it works again', () => {
    let step = syncAttention(SYNC_CALM, true, 0)
    expect(step.notify).toBe(false)
    step = syncAttention(step.state, true, SYNC_PATIENCE_MS - 1)
    expect(step.notify).toBe(false)
    step = syncAttention(step.state, true, SYNC_PATIENCE_MS)
    expect(step.notify).toBe(true)
    step = syncAttention(step.state, true, SYNC_PATIENCE_MS * 2)
    expect(step.notify).toBe(false)
    step = syncAttention(step.state, false, SYNC_PATIENCE_MS * 3)
    expect(step).toEqual({ state: SYNC_CALM, notify: false, clear: true })
  })

  it('says nothing about a short blip', () => {
    const step = syncAttention(syncAttention(SYNC_CALM, true, 0).state, false, 1000)
    expect(step).toEqual({ state: SYNC_CALM, notify: false, clear: false })
  })
})
