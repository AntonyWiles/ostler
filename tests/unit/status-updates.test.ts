import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { statusUpdateReminderSource } from '../../electron/services/status-update-reminder'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import type { WatchedProject } from '../../src/shared/ostler-api'
import {
  lastReminderDay,
  MAX_STATUS_UPDATE_NOTE,
  normalizeUpdateReminder,
  parseUpdateReminder,
  updateFreshness,
  updateReminderDue,
  type UpdateReminder
} from '../../src/shared/status-updates'
import { buildShareReport } from '../../src/shared/export/share-report'
import { useTempDir } from '../helpers/temp-dir'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const DAY = 86_400_000
/** Monday 12 October 2026, 10:00 local. */
const MONDAY = new Date(2026, 9, 12, 10, 0).getTime()

describe('status updates (N5.5)', () => {
  const tempDir = useTempDir('ostler-status-updates-')
  let dbPath: string
  let planning: PlanningService
  let now: number

  beforeEach(async () => {
    dbPath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(dbPath, () => [P1, P2])
    now = MONDAY
    // The service's clock, for posting times.
    ;(planning.statusUpdates as unknown as { now: () => number }).now = () => now
  })

  afterEach(() => {
    planning.close()
  })

  const updates = () => planning.statusUpdates
  const me = () => planning.humanActor()

  it('tells the team when an update is posted or a milestone is done, from any surface', () => {
    const events: unknown[] = []
    planning.onTeamEvent((event) => events.push(event))
    updates().post(P1, { health: 'at-risk', note: 'Supplier late' }, { kind: 'automation' })
    const milestone = planning.createMilestone(P1, { name: 'Beta', outcome: 'Ten testers' })
    planning.updateMilestone(milestone.id, { status: 'complete' })
    planning.updateMilestone(milestone.id, { name: 'Beta 1' })
    expect(events).toEqual([
      {
        kind: 'statusUpdate',
        projectId: P1,
        title: expect.stringMatching(/At risk|atRisk/),
        text: 'Supplier late'
      },
      {
        kind: 'milestoneDone',
        projectId: P1,
        title: expect.stringMatching(/Beta/),
        text: 'Ten testers'
      }
    ])
  })

  it('posts, lists newest first, and records an activity entry worded like the feed', () => {
    const first = updates().post(P1, { health: 'on-track', note: '  Going well  ' }, me())
    now += 1000
    const second = updates().post(P1, { health: 'at-risk', note: '' }, { kind: 'automation' })
    expect(first.note).toBe('Going well')
    expect(
      updates()
        .list(P1)
        .map((update) => update.id)
    ).toEqual([second.id, first.id])
    expect(updates().latest(P1)?.health).toBe('at-risk')
    expect(second).toMatchObject({ authorKind: 'automation', authorName: 'Automation API' })
    expect(updates().list(P2)).toEqual([])

    const feed = planning.listProjectActivity(P1).entries
    expect(feed.map((entry) => entry.kind)).toEqual(['status-update', 'status-update'])
    expect(feed[0]).toMatchObject({
      workItemId: '',
      summary: 'Automation API posted a status update: At risk'
    })
  })

  it('edits and deletes with undo, keeping the author and time', () => {
    const posted = updates().post(P1, { health: 'on-track', note: 'Fine' }, me())
    now += DAY
    const { before, after } = updates().edit(posted.id, { health: 'off-track', note: 'Not fine' })
    expect(before).toMatchObject({ health: 'on-track', note: 'Fine', editedAt: null })
    expect(after).toMatchObject({ health: 'off-track', postedAt: MONDAY, editedAt: MONDAY + DAY })
    expect(updates().revert(posted.id, before)).toMatchObject({
      health: 'on-track',
      editedAt: null
    })

    updates().delete(posted.id)
    expect(updates().list(P1)).toEqual([])
    expect(planning.listProjectActivity(P1).entries).toEqual([])
    expect(() => updates().get(posted.id)).toThrow('Status update not found')
    expect(updates().restore(posted.id).note).toBe('Fine')
    expect(updates().list(P1)).toHaveLength(1)
  })

  it('holds the note to 2,000 characters and the health to the three words', () => {
    const limit = 'x'.repeat(MAX_STATUS_UPDATE_NOTE)
    expect(updates().post(P1, { health: 'on-track', note: limit }, me()).note).toHaveLength(2000)
    expect(() => updates().post(P1, { health: 'on-track', note: `${limit}x` }, me())).toThrow(
      /at most 2000/
    )
    expect(() => updates().post(P1, { health: 'green', note: '' }, me())).toThrow(/health/)
    expect(() => updates().post('nope', { health: 'on-track', note: '' }, me())).toThrow(
      'Project not found'
    )
    expect(() =>
      updates().post(P1, { health: 'on-track', note: '' }, { kind: 'ostler-ai' })
    ).toThrow(/person or the automation API/)
  })

  it('gives the latest of every project in one read, and removing a project removes its updates', () => {
    updates().post(P1, { health: 'on-track', note: 'a' }, me())
    now += 1
    const latest = updates().post(P1, { health: 'at-risk', note: 'b' }, me())
    const other = updates().post(P2, { health: 'off-track', note: 'c' }, me())
    const all = updates().latestFor([P1, P2, 'unknown'])
    expect(Object.keys(all).sort()).toEqual([P1, P2].sort())
    expect(all[P1].id).toBe(latest.id)
    const db = new Database(dbPath)
    try {
      deleteProjectRows(db, P1)
    } finally {
      db.close()
    }
    expect(updates().list(P1)).toEqual([])
    expect(updates().latest(P2)?.id).toBe(other.id)
  })

  describe('the reminder in the Inbox', () => {
    const project = (
      reminder: Partial<UpdateReminder>,
      extra: Partial<WatchedProject> = {}
    ): WatchedProject =>
      ({
        id: P1,
        name: 'Website',
        path: null,
        color: '#fff',
        enabled: true,
        stage: 'active',
        updateReminder: { cadence: 'weekly', weekday: 1, since: '2026-10-01', ...reminder },
        ...extra
      }) as WatchedProject

    const items = (watched: WatchedProject) =>
      statusUpdateReminderSource(
        updates(),
        () => [watched],
        () => now
      )()

    it('shows "Time for a status update · Website" on its weekday, opening the project', () => {
      const [item] = items(project({}))
      expect(item).toMatchObject({
        key: `statusupdate:${P1}:2026-10-12`,
        kind: 'statusUpdate',
        title: 'Time for a status update · Website',
        projectId: P1,
        taskId: null
      })
      // Tuesday, still nothing posted: the same item stays.
      now = MONDAY + DAY
      expect(items(project({}))[0].key).toBe(`statusupdate:${P1}:2026-10-12`)
    })

    it('is not there after a fresh update, before its first day, or while off', () => {
      updates().post(P1, { health: 'on-track', note: '' }, me())
      expect(items(project({}))).toEqual([])
      // A Wednesday reminder: Monday's update came after its day, so it counts.
      expect(items(project({ weekday: 3 }))).toEqual([])
      expect(items(project({ since: '2026-10-13' }))).toEqual([])
      expect(items(project({ cadence: 'off' }))).toEqual([])
    })

    it('gives On hold, Done and archived projects no reminder', () => {
      expect(items(project({}, { stage: 'on-hold' }))).toEqual([])
      expect(items(project({}, { stage: 'done' }))).toEqual([])
      expect(items(project({}, { enabled: false }))).toEqual([])
      expect(items(project({}, { stage: 'planning' }))).toHaveLength(1)
    })
  })

  describe('the migration', () => {
    it('adds status_updates to a version 34 database and keeps its tasks', async () => {
      const file = path.join(tempDir(), 'old.db')
      const options = { backupDir: path.join(tempDir(), 'backups'), appVersion: 'test' }
      await migrateOstlerDatabase(
        file,
        options,
        MIGRATIONS.filter((migration) => migration.version <= 34)
      )
      const before = new Database(file)
      before
        .prepare(
          "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
        )
        .run()
      before.close()
      const result = await migrateOstlerDatabase(file, options, MIGRATIONS)
      expect(result.from).toBe(34)
      expect(result.to).toBe(LATEST_SCHEMA_VERSION)
      const db = new Database(file)
      try {
        expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([
          { title: 'Kept' }
        ])
        const insert = db.prepare(
          "INSERT INTO status_updates (id, project_id, health, note, author_kind, posted_at) VALUES (?, 'p1', ?, ?, 'human', 1)"
        )
        insert.run('a', 'on-track', 'Fine')
        expect(() => insert.run('b', 'green', '')).toThrow(/CHECK/)
        expect(() => insert.run('c', 'at-risk', 'x'.repeat(2001))).toThrow(/CHECK/)
      } finally {
        db.close()
      }
    })
  })
})

describe('the status update rules (N5.5)', () => {
  const reminder = (value: Partial<UpdateReminder>) =>
    normalizeUpdateReminder({ cadence: 'weekly', weekday: 1, since: '2026-10-01', ...value })

  it('finds the latest reminder day, weekly and fortnightly', () => {
    expect(lastReminderDay(reminder({}), '2026-10-12')).toBe('2026-10-12')
    expect(lastReminderDay(reminder({}), '2026-10-11')).toBe('2026-10-05')
    expect(lastReminderDay(reminder({}), '2026-10-04')).toBeNull()
    const fortnightly = reminder({ cadence: 'fortnightly' })
    // The first Monday on or after 1 October is the 5th, then every 14 days.
    expect(lastReminderDay(fortnightly, '2026-10-12')).toBe('2026-10-05')
    expect(lastReminderDay(fortnightly, '2026-10-19')).toBe('2026-10-19')
    expect(lastReminderDay(reminder({ cadence: 'off' }), '2026-10-12')).toBeNull()
  })

  it('is due only for a project in play with nothing posted since the day began', () => {
    const project = { enabled: true, stage: 'active', updateReminder: reminder({}) }
    const dayStart = new Date(2026, 9, 12).getTime()
    expect(updateReminderDue(project, null, MONDAY)).toBe('2026-10-12')
    expect(updateReminderDue(project, dayStart - 1, MONDAY)).toBe('2026-10-12')
    expect(updateReminderDue(project, dayStart, MONDAY)).toBeNull()
    expect(updateReminderDue({ ...project, stage: 'done' }, null, MONDAY)).toBeNull()
  })

  it('says an update is old past twice the interval, or a month without a reminder', () => {
    const latest = (daysAgo: number) => ({ postedAt: MONDAY - daysAgo * DAY })
    expect(updateFreshness(null, reminder({}), MONDAY)).toEqual({ kind: 'none' })
    expect(updateFreshness(latest(14), reminder({}), MONDAY)).toEqual({ kind: 'fresh' })
    expect(updateFreshness(latest(15), reminder({}), MONDAY)).toEqual({ kind: 'old', weeks: 2 })
    const fortnightly = reminder({ cadence: 'fortnightly' })
    expect(updateFreshness(latest(27), fortnightly, MONDAY)).toEqual({ kind: 'fresh' })
    expect(updateFreshness(latest(30), undefined, MONDAY)).toEqual({ kind: 'fresh' })
    expect(updateFreshness(latest(35), undefined, MONDAY)).toEqual({ kind: 'old', weeks: 5 })
  })

  it('checks a reminder a caller sets, and starts it on the day it is set', () => {
    const off = normalizeUpdateReminder(undefined)
    expect(off).toEqual({ cadence: 'off', weekday: 1, since: null })
    const on = parseUpdateReminder({ cadence: 'weekly', weekday: 5 }, off, '2026-10-17')
    expect(on).toEqual({ cadence: 'weekly', weekday: 5, since: '2026-10-17' })
    expect(parseUpdateReminder({ weekday: 5 }, on, '2026-10-20').since).toBe('2026-10-17')
    expect(parseUpdateReminder({ weekday: 2 }, on, '2026-10-20').since).toBe('2026-10-20')
    expect(parseUpdateReminder({ cadence: 'off' }, on, '2026-10-20').since).toBeNull()
    expect(() => parseUpdateReminder({ cadence: 'daily' }, off, '2026-10-17')).toThrow(/cadence/)
    expect(() => parseUpdateReminder({ weekday: 7 }, off, '2026-10-17')).toThrow(/weekday/)
  })
})

describe('the shareable report with a status update (N5.5)', () => {
  const input = (statusUpdate: boolean) => ({
    project: { name: 'Website' },
    keyNumbers: {
      open: 0,
      doneInRange: 0,
      overdueNow: 0,
      dueNext7Days: 0
    } as never,
    tasks: [],
    milestones: [],
    decisions: [],
    personName: () => null,
    options: { statusUpdate },
    now: MONDAY,
    renderMarkdown: (markdown: string) => `<p>${markdown}</p>`,
    statusUpdate: {
      id: 'u1',
      projectId: P1,
      health: 'at-risk' as const,
      note: 'Review slipped',
      authorKind: 'human' as const,
      authorPersonId: null,
      authorName: 'Alex',
      postedAt: MONDAY,
      editedAt: null
    }
  })

  it('shows the latest update only when the option is on', () => {
    const without = buildShareReport(input(false))
    expect(without).not.toContain('Review slipped')
    const withIt = buildShareReport(input(true))
    expect(withIt).toContain('<h2>Status</h2>')
    expect(withIt).toContain('At risk')
    expect(withIt).toContain('<p>Review slipped</p>')
    expect(withIt).toContain('Alex')
  })
})
