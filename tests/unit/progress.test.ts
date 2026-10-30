import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Person, WatchedProject } from '../../src/shared/ostler-api'
import { PlanningService } from '../../electron/services/planning-service'
import {
  ProgressService,
  queryFinishedTasks,
  trackedTime
} from '../../electron/services/progress-service'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import {
  buildYearInReview,
  homeProgress,
  progressWeeks,
  weekStartOf,
  workingDayStreak
} from '../../src/shared/planning/progress'
import { isWorkingDay } from '../../src/shared/planning/working-days'
import { createMigratedDatabase } from '../helpers/database'

const human = { kind: 'human' as const }

/** Local noon on a day, so no time zone moves it. */
const at = (date: string, hour = 12) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour).getTime()
}

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: '#3b82f6', enabled } as WatchedProject
}

const me = { id: 'me', name: 'Ana', workingDays: [1, 2, 3, 4, 5] } as Person

describe('progress migrations (N3.6)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-progress-migration-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

  it('migration 48 gives milestones already complete their last update time, marked approximate', async () => {
    const file = path.join(dir, 'ostler.db')
    const options = { backupDir: path.join(dir, 'backups'), appVersion: 'test' }
    await migrateOstlerDatabase(
      file,
      options,
      MIGRATIONS.filter((migration) => migration.version <= 47)
    )
    const before = new Database(file)
    const insert = before.prepare(
      "INSERT INTO planning_milestones (id, project_id, name, status, created_at, updated_at) VALUES (?, 'p1', ?, ?, 1, ?)"
    )
    insert.run('done', 'Launched', 'complete', 1_700_000_000_000)
    insert.run('open', 'Next', 'active', 1_700_000_000_500)
    before.close()
    const result = await migrateOstlerDatabase(file, options, MIGRATIONS)
    expect(result).toMatchObject({ from: 47, to: LATEST_SCHEMA_VERSION })
    const db = new Database(file)
    try {
      expect(
        db
          .prepare('SELECT id, completed_at, completed_approx FROM planning_milestones ORDER BY id')
          .all()
      ).toEqual([
        { id: 'done', completed_at: 1_700_000_000_000, completed_approx: 1 },
        { id: 'open', completed_at: null, completed_approx: 0 }
      ])
    } finally {
      db.close()
    }
  })

  it('sets the completion time when a milestone becomes complete and clears it when it leaves', async () => {
    const planning = new PlanningService(await createMigratedDatabase(dir), () => ['p1'])
    try {
      const milestone = planning.createMilestone('p1', { name: 'Beta' })
      const read = () =>
        planning.database
          .prepare('SELECT completed_at, completed_approx FROM planning_milestones WHERE id = ?')
          .get(milestone.id) as { completed_at: number | null; completed_approx: number }
      expect(read()).toEqual({ completed_at: null, completed_approx: 0 })
      const before = Date.now()
      const complete = planning.updateMilestone(milestone.id, { status: 'complete' })
      expect(read().completed_at).toBe(complete.updatedAt)
      expect(read().completed_at).toBeGreaterThanOrEqual(before)
      expect(read().completed_approx).toBe(0)
      // Renaming a complete milestone keeps its time.
      planning.updateMilestone(milestone.id, { name: 'Beta 1' })
      expect(read().completed_at).toBe(complete.updatedAt)
      planning.updateMilestone(milestone.id, { status: 'active' })
      expect(read()).toEqual({ completed_at: null, completed_approx: 0 })
      // Written as complete in one go (an import, an undo): its update time, approximate.
      planning.database
        .prepare(
          "INSERT INTO planning_milestones (id, project_id, name, status, created_at, updated_at) VALUES ('imported', 'p1', 'Old', 'complete', 1, 5000)"
        )
        .run()
      expect(
        planning.database
          .prepare(
            "SELECT completed_at, completed_approx FROM planning_milestones WHERE id = 'imported'"
          )
          .get()
      ).toEqual({ completed_at: 5000, completed_approx: 1 })
    } finally {
      planning.close()
    }
  })

  it('config migration 36 turns Show my progress off, for new installs and old configs', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 36)
    expect(migration?.name).toBe('show-progress')
    const config: Record<string, unknown> = { ui: { theme: 'dark' } }
    migration?.up(config, { newInstall: false })
    expect(config.ui).toEqual({ theme: 'dark', showProgress: false })
    const kept: Record<string, unknown> = { ui: { showProgress: true } }
    migration?.up(kept, { newInstall: false })
    expect(kept.ui).toEqual({ showProgress: true })

    const fresh = new ConfigStore(path.join(dir, 'fresh.json'))
    expect(fresh.get().ui.showProgress).toBe(false)
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ configVersion: 35, ui: {} }))
    const old = new ConfigStore(path.join(dir, 'old.json'))
    expect(old.get().ui.showProgress).toBe(false)
    expect(old.update({ ui: { showProgress: true } }).ui.showProgress).toBe(true)
  })
})

describe('what counts as finished (N3.6)', () => {
  let dir: string
  let planning: PlanningService
  let projects: WatchedProject[]

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-progress-'))
    planning = new PlanningService(await createMigratedDatabase(dir), () => ['p1', 'p2', 'off'])
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('off', 'Old', false)]
    const person = planning.database.prepare(
      "INSERT INTO people (id, name, color, created_at, updated_at) VALUES (?, ?, '#3b82f6', 0, 0)"
    )
    person.run('me', 'Ana')
    person.run('someone', 'Bo')
  })

  afterEach(() => {
    planning.close()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  /** Moves a task to `status`, then dates that move. */
  function move(taskId: string, status: 'done' | 'ready' | 'active', when: number) {
    planning.updateWorkItem(taskId, { status }, human)
    planning.database
      .prepare(
        `UPDATE planning_status_history SET at = ? WHERE sequence =
          (SELECT MAX(sequence) FROM planning_status_history WHERE work_item_id = ?)`
      )
      .run(when, taskId)
  }

  function task(title: string, projectId = 'p1', assignee: string | null = null) {
    const item = planning.createWorkItem(projectId, { title }, human)
    if (assignee)
      planning.database
        .prepare('UPDATE planning_work_items SET assignee_id = ? WHERE id = ?')
        .run(assignee, item.id)
    return item.id
  }

  const finished = (ids = ['p1', 'p2'], meId: string | null = 'me') =>
    queryFinishedTasks(planning.database, ids, meId, 0, at('2100-01-01')).map((row) => [
      row.taskId,
      row.at
    ])

  it('counts a task once, at its latest move to Done, and not once it is reopened', () => {
    const twice = task('Finished twice')
    move(twice, 'done', at('2026-10-05'))
    move(twice, 'active', at('2026-10-06'))
    move(twice, 'done', at('2026-10-07'))
    const reopened = task('Reopened')
    move(reopened, 'done', at('2026-10-05'))
    move(reopened, 'ready', at('2026-10-06'))
    expect(finished()).toEqual([[twice, at('2026-10-07')]])
    // Only moves inside the span count.
    expect(
      queryFinishedTasks(planning.database, ['p1'], 'me', at('2026-10-08'), at('2026-10-09'))
    ).toEqual([])
  })

  it('counts archived tasks, but not deleted ones or ones in the bin', () => {
    const archived = task('Archived')
    move(archived, 'done', at('2026-10-05'))
    planning.archiveWorkItem(archived, human)
    const binned = task('Binned')
    move(binned, 'done', at('2026-10-05'))
    planning.moveWorkItemToBin(binned, human)
    const deleted = task('Deleted')
    move(deleted, 'done', at('2026-10-05'))
    planning.deleteWorkItem(deleted, human)
    expect(finished()).toEqual([[archived, at('2026-10-05')]])
  })

  it("counts Me's tasks and nobody's, not someone else's, and only the projects asked for", () => {
    const mine = task('Mine', 'p1', 'me')
    const nobodys = task('Nobody', 'p2')
    const theirs = task('Theirs', 'p1', 'someone')
    const elsewhere = task('Disabled project', 'off')
    for (const id of [mine, nobodys, theirs, elsewhere]) move(id, 'done', at('2026-10-05'))
    expect(finished().map(([id]) => id)).toEqual(expect.arrayContaining([mine, nobodys]))
    expect(finished()).toHaveLength(2)
    // With no Me, only nobody's count.
    expect(finished(['p1', 'p2'], null).map(([id]) => id)).toEqual([nobodys])

    // The service reads enabled projects only.
    const service = new ProgressService({
      db: planning.database,
      getProjects: () => projects,
      getMe: () => me,
      getDaysOff: () => [],
      getTimeEntries: () => [],
      now: () => at('2026-10-09')
    })
    expect(service.home({ today: '2026-10-09', weekStart: 1 }).thisWeek).toBe(2)
    expect(service.weeks('off', '2026-10-01', '2026-10-31').every((week) => week.count === 0)).toBe(
      true
    )
  })

  it("Home's streak is Me's own: Me's days off and everyone's are skipped, not someone else's leave", () => {
    // Thursday 8, Saturday 10, Tuesday 13 and Wednesday 14 October 2026 each have a finish.
    for (const day of ['2026-10-08', '2026-10-10', '2026-10-13', '2026-10-14'])
      move(task('Finished on ' + day), 'done', at(day))
    const bankHoliday = {
      personId: null,
      firstDate: '2026-10-09',
      lastDate: '2026-10-09',
      name: 'Bank holiday'
    }
    const leaveOnMonday = (personId: string) => ({
      personId,
      firstDate: '2026-10-12',
      lastDate: '2026-10-12',
      name: 'Leave'
    })
    const streak = (who: Person | null, onLeave: string[]) =>
      new ProgressService({
        db: planning.database,
        getProjects: () => projects,
        getMe: () => who,
        getDaysOff: () => [bankHoliday, ...onLeave.map(leaveOnMonday)],
        getTimeEntries: () => [],
        now: () => at('2026-10-14')
      }).home({ today: '2026-10-14', weekStart: 1 }).streak

    // Wednesday, Tuesday, Me's Monday off skipped, Sunday skipped, Saturday's finish counts,
    // Friday's bank holiday skipped, Thursday; Wednesday 7 had nothing and ends it.
    expect(streak(me, ['me'])).toBe(4)
    // Someone else's leave on Monday is not mine: Monday had nothing and ends it.
    expect(streak(me, ['someone'])).toBe(2)
    // With nobody as Me, no one's leave counts, only everyone's days off.
    expect(streak(null, ['me'])).toBe(2)
    // Me's own working days: with Mondays not among them, Monday is skipped without any leave.
    expect(streak({ ...me, workingDays: [2, 3, 4, 5] }, [])).toBe(4)
  })
})

describe('the streak and the weeks (N3.6)', () => {
  const weekdays = (date: string) => isWorkingDay(date, 'me', { workingDays: [1, 2, 3, 4, 5] })

  it('weeks start on the week start given', () => {
    // Saturday 10 October 2026.
    expect(weekStartOf('2026-10-10', 1)).toBe('2026-10-05')
    expect(weekStartOf('2026-10-10', 0)).toBe('2026-10-04')
    expect(weekStartOf('2026-10-10', 6)).toBe('2026-10-10')
    const weeks = progressWeeks(
      [{ taskId: 'a', projectId: 'p1', at: at('2026-10-04') }],
      '2026-09-28',
      '2026-10-10',
      1
    )
    expect(weeks).toEqual([
      { weekStart: '2026-09-28', count: 1 },
      { weekStart: '2026-10-05', count: 0 }
    ])
  })

  it('runs across weekends, and days off never break it', () => {
    // Thursday 8 to Wednesday 14 October; the weekend between has nothing.
    const days = new Set(['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'])
    expect(workingDayStreak(days, '2026-10-14', weekdays)).toBe(5)
    // Monday 12 a bank holiday with nothing finished: skipped, not a break.
    const holiday = new Set(['2026-10-08', '2026-10-09', '2026-10-13', '2026-10-14'])
    const withDayOff = (date: string) =>
      isWorkingDay(date, 'me', {
        workingDays: [1, 2, 3, 4, 5],
        daysOff: [
          { personId: null, firstDate: '2026-10-12', lastDate: '2026-10-12', name: 'Bank holiday' }
        ]
      })
    expect(workingDayStreak(holiday, '2026-10-14', withDayOff)).toBe(4)
    expect(workingDayStreak(holiday, '2026-10-14', weekdays)).toBe(2)
  })

  it('counts a finish on a weekend, and skips an empty weekend', () => {
    // Friday 9, Saturday 10 and Monday 12 October: Saturday's finish counts too.
    const weekend = new Set(['2026-10-09', '2026-10-10', '2026-10-12'])
    expect(workingDayStreak(weekend, '2026-10-12', weekdays)).toBe(3)
    // Sunday 11 had nothing: skipped, not a break.
    expect(workingDayStreak(new Set(['2026-10-10', '2026-10-12']), '2026-10-12', weekdays)).toBe(2)
    // A weekend alone, today Sunday with nothing yet: Saturday still counts.
    expect(workingDayStreak(new Set(['2026-10-10']), '2026-10-11', weekdays)).toBe(1)
    // An empty weekend between two working days does not break the run.
    expect(workingDayStreak(new Set(['2026-10-09', '2026-10-12']), '2026-10-12', weekdays)).toBe(2)
  })

  it("skips Me's own day off with nothing finished, but not someone else's", () => {
    const days = new Set(['2026-10-12', '2026-10-14'])
    const off = (personId: string) => (date: string) =>
      isWorkingDay(date, 'me', {
        workingDays: [1, 2, 3, 4, 5],
        daysOff: [{ personId, firstDate: '2026-10-13', lastDate: '2026-10-13', name: 'Leave' }]
      })
    // Tuesday 13 is my day off: skipped.
    expect(workingDayStreak(days, '2026-10-14', off('me'))).toBe(2)
    // Tuesday 13 is someone else's leave: still my working day, and it had nothing.
    expect(workingDayStreak(days, '2026-10-14', off('someone'))).toBe(1)
    // A finish on my day off counts.
    expect(workingDayStreak(new Set([...days, '2026-10-13']), '2026-10-14', off('me'))).toBe(3)
  })

  it('a working day with nothing finished ends it, but today does not before it ends', () => {
    const days = new Set(['2026-10-12', '2026-10-14'])
    // Tuesday 13 had nothing: the streak is Wednesday alone.
    expect(workingDayStreak(days, '2026-10-14', weekdays)).toBe(1)
    // Thursday 15, nothing yet today: still Wednesday's streak of one.
    expect(workingDayStreak(days, '2026-10-15', weekdays)).toBe(1)
    // Nothing on Wednesday either: no streak.
    expect(workingDayStreak(new Set(['2026-10-12']), '2026-10-15', weekdays)).toBe(0)
  })

  it("Home's card: this week, eight weeks the oldest first, and the streak", () => {
    const progress = homeProgress(
      [
        { taskId: 'a', projectId: 'p1', at: at('2026-08-24') },
        { taskId: 'b', projectId: 'p1', at: at('2026-10-15') },
        { taskId: 'c', projectId: 'p1', at: at('2026-10-16') },
        { taskId: 'd', projectId: 'p1', at: at('2026-10-16', 18) }
      ],
      '2026-10-17',
      1,
      weekdays
    )
    expect(progress.weeks).toHaveLength(8)
    expect(progress.weeks[0]).toEqual({ weekStart: '2026-08-24', count: 1 })
    expect(progress.weeks[7]).toEqual({ weekStart: '2026-10-12', count: 3 })
    expect(progress.thisWeek).toBe(3)
    // Saturday: Friday and Thursday.
    expect(progress.streak).toBe(2)
  })
})

describe("the year's numbers (N3.6)", () => {
  const names = new Map([
    ['p1', 'Website'],
    ['p2', 'Garden'],
    ['p3', 'Shed']
  ])

  it('counts months, the busiest week, projects finished and the most finished', () => {
    const finished = [
      { taskId: 'a', projectId: 'p1', at: at('2026-01-05') },
      { taskId: 'b', projectId: 'p1', at: at('2026-01-06') },
      { taskId: 'c', projectId: 'p2', at: at('2026-03-10') },
      { taskId: 'd', projectId: 'p1', at: at('2026-03-11') },
      { taskId: 'e', projectId: 'p1', at: at('2026-03-12') },
      { taskId: 'f', projectId: 'p2', at: at('2026-03-13') },
      // Another year: left out.
      { taskId: 'g', projectId: 'p3', at: at('2025-12-31') }
    ]
    const year = buildYearInReview({
      year: 2026,
      years: [2026, 2025],
      weekStart: 1,
      finished,
      milestones: [
        { projectId: 'p1', at: at('2026-03-20'), approximate: false },
        { projectId: 'p2', at: at('2026-05-01'), approximate: true }
      ],
      projectNames: names,
      doneProjects: [
        { projectId: 'p2', lastAt: at('2026-03-13') },
        { projectId: 'p3', lastAt: at('2025-12-31') }
      ],
      time: []
    })
    expect(year.totalTasks).toBe(6)
    expect(year.totalMilestones).toBe(2)
    expect(year.months.map((month) => month.tasks)).toEqual([2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(year.months[2]).toEqual({ month: 3, tasks: 4, milestones: 1, approximate: false })
    expect(year.months[4]).toEqual({ month: 5, tasks: 0, milestones: 1, approximate: true })
    expect(year.busiestWeek).toEqual({ weekStart: '2026-03-09', count: 4 })
    expect(year.projectsFinished).toEqual([
      { projectId: 'p2', projectName: 'Garden', finishedOn: '2026-03-13' }
    ])
    expect(year.topProjects).toEqual([
      { projectId: 'p1', projectName: 'Website', count: 4 },
      { projectId: 'p2', projectName: 'Garden', count: 2 }
    ])
    expect(year.time).toBeNull()
  })

  it('a week across New Year counts only its part in the year', () => {
    const year = buildYearInReview({
      year: 2026,
      years: [2026],
      weekStart: 1,
      finished: [
        { taskId: 'a', projectId: 'p1', at: at('2026-01-01') },
        { taskId: 'b', projectId: 'p1', at: at('2026-01-02') }
      ],
      milestones: [],
      projectNames: names,
      doneProjects: [],
      time: []
    })
    expect(year.busiestWeek).toEqual({ weekStart: '2025-12-29', count: 2 })
  })

  it('time tracked by month and project, with tracking (R2.3) and without', () => {
    const year = buildYearInReview({
      year: 2026,
      years: [2026],
      weekStart: 1,
      finished: [],
      milestones: [],
      projectNames: names,
      doneProjects: [],
      time: [
        { projectId: 'p1', startedAt: at('2026-02-03'), seconds: 3600 },
        { projectId: 'p2', startedAt: at('2026-02-04'), seconds: 7200 },
        { projectId: 'p1', startedAt: at('2026-11-04'), seconds: 1800 }
      ]
    })
    expect(year.time?.byMonth).toEqual([0, 10800, 0, 0, 0, 0, 0, 0, 0, 0, 1800, 0])
    expect(year.time?.byProject).toEqual([
      { projectId: 'p2', projectName: 'Garden', seconds: 7200 },
      { projectId: 'p1', projectName: 'Website', seconds: 5400 }
    ])
    expect(year.time?.totalSeconds).toBe(12600)
    expect(year.busiestWeek).toBeNull()
  })

  it('the service reads the year from the database, with time by Me or no one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-year-'))
    const planning = new PlanningService(await createMigratedDatabase(dir), () => ['p1', 'p2'])
    try {
      const move = (id: string, when: number) => {
        planning.updateWorkItem(id, { status: 'done' }, human)
        planning.database
          .prepare(
            'UPDATE planning_status_history SET at = ? WHERE work_item_id = ? AND to_status = ?'
          )
          .run(when, id, 'done')
      }
      const a = planning.createWorkItem('p1', { title: 'A' }, human)
      const b = planning.createWorkItem('p2', { title: 'B' }, human)
      planning.createWorkItem('p2', { title: 'Still open' }, human)
      move(a.id, at('2026-04-02'))
      move(b.id, at('2026-04-03'))
      const milestone = planning.createMilestone('p1', { name: 'Launch' })
      planning.updateMilestone(milestone.id, { status: 'complete' })
      planning.database
        .prepare('UPDATE planning_milestones SET completed_at = ? WHERE id = ?')
        .run(at('2026-06-01'), milestone.id)
      planning.time.create('p1', {
        workItemId: a.id,
        startedAt: at('2026-04-01'),
        durationSeconds: 3600,
        personId: null
      })
      const service = new ProgressService({
        db: planning.database,
        getProjects: () => [project('p1', 'Website'), project('p2', 'Garden')],
        getMe: () => null,
        getDaysOff: () => [],
        getTimeEntries: trackedTime(planning.time, () => null),
        now: () => at('2026-10-17')
      })
      const year = service.year({ year: 2026, weekStart: 1 })
      expect(year.years).toEqual([2026])
      expect(year.months[3].tasks).toBe(2)
      expect(year.months[5].milestones).toBe(1)
      expect(year.projectsFinished.map((p) => p.projectName)).toEqual(['Website'])
      expect(year.time?.totalSeconds).toBe(3600)
      // One project's part, as the automation API asks.
      expect(service.year({ year: 2026, weekStart: 1 }, ['p2']).totalTasks).toBe(1)
      expect(() => service.year({ year: 26, weekStart: 1 })).toThrow('year')
    } finally {
      planning.close()
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
})
