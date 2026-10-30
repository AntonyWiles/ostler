import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { summedCheckIns, type GoalMeasure } from '../../src/shared/goal-measures'
import { personalGoalProgress, sortPersonalGoals } from '../../src/shared/personal-goals'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-12'

const POUNDS: GoalMeasure = {
  unit: '£',
  startValue: 0,
  targetValue: 5000,
  startDate: '2026-01-01',
  targetDate: '2026-12-31',
  direction: 'up'
}

const tempDir = useTempDir('ostler-personal-goals-')
let databasePath: string
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

function packageOf(name: string): ProjectPackage {
  const result = validateProjectPackage({
    format: 'ostler-project-package',
    version: 1,
    project: { name },
    people: [],
    labels: [],
    goals: [{ ref: 'g1', title: `${name} savings` }],
    milestones: [],
    tasks: [],
    decisions: [],
    library: []
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** A project with one goal measured in `measure`'s unit. */
async function projectGoal(name: string, measure: GoalMeasure = { ...POUNDS, targetValue: 2000 }) {
  const { project } = await service.createProjectFromPackage(packageOf(name), {}, TODAY)
  const goal = planning.listGoals(project.id)[0]
  return { project, goal: planning.updateGoal(goal.id, { measure }) }
}

function checkIn(goalId: string, date: string, value: number) {
  planning.goalCheckIns.record(goalId, { date, value }, planning.humanActor())
}

beforeEach(async () => {
  databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  people.ensureMe('Alex')
  const scaffold = new ProjectScaffoldService(store, () => tempDir())
  service = new ProjectPackageService({
    planning,
    registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
    getProject: (projectId) => {
      const project = store.getProjects().find((entry) => entry.id === projectId)
      if (!project) throw new Error('Project not found')
      return project
    },
    dataDir: tempDir(),
    appVersion: 'test'
  })
})

afterEach(() => {
  planning.close()
  people.close()
})

describe('the personal goals migration (N5.6b)', () => {
  it('is version 50 and adds the goals, their check-ins and links', () => {
    expect(MIGRATIONS.find((migration) => migration.name === 'personal-goals')?.version).toBe(50)
    const db = new Database(databasePath, { readonly: true })
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (column) => column.name
        )
      expect(columns('personal_goals')).toEqual(
        expect.arrayContaining([
          'id',
          'title',
          'outcome',
          'status',
          'measure_unit',
          'measure_direction'
        ])
      )
      expect(columns('personal_goal_check_ins')).toEqual(
        expect.arrayContaining(['personal_goal_id', 'date', 'value', 'note', 'recorded_at'])
      )
      expect(columns('personal_goal_links')).toEqual(
        expect.arrayContaining(['goal_id', 'project_id', 'personal_goal_id'])
      )
      // Goals of one's own carry no project; their links do, so removing a project clears them.
      expect(columns('personal_goals')).not.toContain('project_id')
    } finally {
      db.close()
    }
  })

  it('keeps every pin, its order and its countdown when it rebuilds the pins table', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-personal-goals-pins-'))
    try {
      const dbPath = path.join(dir, 'ostler.db')
      const options = { backupDir: path.join(dir, 'backups'), appVersion: 'test' }
      await migrateOstlerDatabase(
        dbPath,
        options,
        MIGRATIONS.filter((m) => m.version <= 49)
      )
      const before = new Database(dbPath)
      before
        .prepare(
          `INSERT INTO pins (id, place, project_id, kind, target_id, order_key, created_at, countdown)
           VALUES ('p1', 'sidebar', 'project-1', 'milestone', 'm1', 'a', 1000, 1)`
        )
        .run()
      before.close()
      await migrateOstlerDatabase(dbPath, options)
      const after = new Database(dbPath)
      try {
        expect(after.prepare('SELECT * FROM pins').all()).toEqual([
          {
            id: 'p1',
            place: 'sidebar',
            project_id: 'project-1',
            kind: 'milestone',
            target_id: 'm1',
            order_key: 'a',
            created_at: 1000,
            countdown: 1
          }
        ])
        const indexes = (
          after
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pins'")
            .all() as {
            name: string
          }[]
        ).map((index) => index.name)
        expect(indexes).toEqual(
          expect.arrayContaining(['idx_pins_place', 'idx_pins_project', 'idx_pins_countdown'])
        )
        after
          .prepare(
            `INSERT INTO pins (id, place, project_id, kind, target_id, order_key, created_at)
             VALUES ('p2', 'sidebar', '', 'personal-goal', 'g1', 'b', 2000)`
          )
          .run()
      } finally {
        after.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('goals of one’s own (N5.6b)', () => {
  it('are created, changed and read with their own check-ins and progress', () => {
    const goals = planning.personalGoals
    const books = goals.create({
      title: 'Read 24 books',
      measure: {
        unit: 'books',
        startValue: 0,
        targetValue: 24,
        startDate: '2026-01-01',
        targetDate: '2026-12-31'
      }
    })
    expect(books.status).toBe('active')
    expect(books.measure?.direction).toBe('up')
    goals.recordCheckIn(books.id, { date: '2026-03-01', value: 4 }, planning.humanActor())
    const { replaced } = goals.recordCheckIn(
      books.id,
      { date: '2026-03-01', value: 5, note: 'Middlemarch' },
      planning.humanActor()
    )
    expect(replaced?.value).toBe(4)
    goals.recordCheckIn(books.id, { date: '2026-10-01', value: 21 }, planning.humanActor())
    const view = goals.get(books.id, TODAY)
    expect(view.fromLinks).toBe(false)
    expect(view.readings).toEqual([
      { date: '2026-03-01', value: 5 },
      { date: '2026-10-01', value: 21 }
    ])
    expect(view.progress?.latest).toBe(21)
    expect(view.progress?.pace).toBe('ahead')

    const removed = goals.deleteCheckIn(books.id, '2026-10-01')
    expect(goals.get(books.id, TODAY).progress?.latest).toBe(5)
    goals.restoreCheckIn(books.id, removed, planning.humanActor())
    expect(goals.listCheckIns(books.id).map((entry) => entry.recordedAt)).toContain(
      removed.recordedAt
    )

    const achieved = goals.update(books.id, {
      status: 'achieved',
      title: 'Read 24 books this year'
    })
    expect(achieved.title).toBe('Read 24 books this year')
    expect(() => goals.update(books.id, { status: 'archived' })).toThrow(
      /active, achieved or dropped/
    )
    expect(() => goals.create({ title: '  ' })).toThrow(/needs a title/)
  })

  it('lists active goals first, then achieved, then dropped', () => {
    const goals = planning.personalGoals
    const dropped = goals.create({ title: 'Learn the oboe' })
    goals.update(dropped.id, { status: 'dropped' })
    const achieved = goals.create({ title: 'Run 10 km' })
    goals.update(achieved.id, { status: 'achieved' })
    goals.create({ title: 'Save £5,000', measure: POUNDS })
    expect(goals.list(TODAY).map((goal) => goal.status)).toEqual(['active', 'achieved', 'dropped'])
    expect(
      sortPersonalGoals([
        { status: 'dropped', createdAt: 3 },
        { status: 'active', createdAt: 1 },
        { status: 'active', createdAt: 2 }
      ])
    ).toEqual([
      { status: 'active', createdAt: 2 },
      { status: 'active', createdAt: 1 },
      { status: 'dropped', createdAt: 3 }
    ])
  })

  it('takes the sum of linked project goals’ latest values, not its own check-ins', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    goals.recordCheckIn(save.id, { date: '2026-02-01', value: 100 }, planning.humanActor())
    const side = await projectGoal('Side business')
    const house = await projectGoal('House budget', { ...POUNDS, unit: '£ ', targetValue: 3000 })
    checkIn(side.goal.id, '2026-03-01', 400)
    checkIn(side.goal.id, '2026-06-01', 900)
    checkIn(house.goal.id, '2026-04-01', 1200)

    goals.setCountsTowards(side.goal.id, save.id)
    goals.setCountsTowards(house.goal.id, save.id)
    const view = goals.get(save.id, TODAY)
    expect(view.fromLinks).toBe(true)
    expect(view.links.map((link) => [link.title, link.latest, link.mismatch])).toEqual([
      ['Side business savings', 900, null],
      ['House budget savings', 1200, null]
    ])
    // On each day either was checked in: the sum of each one's latest by then (0 before any).
    expect(view.readings).toEqual([
      { date: '2026-03-01', value: 400 },
      { date: '2026-04-01', value: 1600 },
      { date: '2026-06-01', value: 2100 }
    ])
    expect(view.progress?.latest).toBe(2100)
    // Its own check-in is kept, just not counted.
    expect(view.checkIns.map((entry) => entry.value)).toEqual([100])
    expect(planning.personalGoals.countsTowardsForProject(side.project.id)).toEqual({
      [side.goal.id]: {
        goalId: side.goal.id,
        personalGoalId: save.id,
        title: 'Save £5,000',
        counts: true
      }
    })
  })

  it('refuses a project goal whose unit or direction differs, or that has no measure', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    const km = await projectGoal('Running', { ...POUNDS, unit: 'km' })
    expect(() => goals.setCountsTowards(km.goal.id, save.id)).toThrow(
      /counts in “£” and “Running savings” in “km”/
    )
    const debt = await projectGoal('Debt', {
      ...POUNDS,
      startValue: 5000,
      targetValue: 0,
      direction: 'down'
    })
    expect(() => goals.setCountsTowards(debt.goal.id, save.id)).toThrow(/go different ways/)
    const { project } = await projectGoal('Plain')
    const plain = planning.createGoal(project.id, { title: 'No number' })
    expect(() => goals.setCountsTowards(plain.id, save.id)).toThrow(/Give “No number” a measure/)
    const bare = goals.create({ title: 'Be happier' })
    const fine = await projectGoal('Fine')
    expect(() => goals.setCountsTowards(fine.goal.id, bare.id)).toThrow(
      /Give “Be happier” a measure/
    )
    expect(goals.get(save.id, TODAY).links).toEqual([])
  })

  it('marks a link that no longer matches, and stops counting it', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    const side = await projectGoal('Side business')
    checkIn(side.goal.id, '2026-03-01', 400)
    goals.setCountsTowards(side.goal.id, save.id)
    planning.updateGoal(side.goal.id, { measure: { ...POUNDS, unit: '$' } })
    const view = goals.get(save.id, TODAY)
    expect(view.links[0].mismatch).toBe('unit')
    expect(view.fromLinks).toBe(false)
    expect(goals.countsTowardsForProject(side.project.id)[side.goal.id].counts).toBe(false)
  })

  it('removing a link changes neither goal’s check-ins', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    goals.recordCheckIn(save.id, { date: '2026-02-01', value: 100 }, planning.humanActor())
    const side = await projectGoal('Side business')
    checkIn(side.goal.id, '2026-03-01', 400)
    goals.setCountsTowards(side.goal.id, save.id)
    const result = goals.setCountsTowards(side.goal.id, null)
    expect(result).toEqual({ goalId: side.goal.id, personalGoalId: null, previous: save.id })
    const view = goals.get(save.id, TODAY)
    expect(view.links).toEqual([])
    expect(view.fromLinks).toBe(false)
    expect(view.progress?.latest).toBe(100)
    expect(planning.goalCheckIns.list(side.goal.id).map((entry) => entry.value)).toEqual([400])
  })

  it('drops the link when the project goal is deleted or its project removed', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    const side = await projectGoal('Side business')
    const house = await projectGoal('House budget')
    goals.setCountsTowards(side.goal.id, save.id)
    goals.setCountsTowards(house.goal.id, save.id)
    planning.deleteGoal(side.goal.id)
    expect(goals.get(save.id, TODAY).links.map((link) => link.goalId)).toEqual([house.goal.id])

    deleteProjectRows(planning.database, house.project.id)
    const rows = planning.database.prepare('SELECT * FROM personal_goal_links').all()
    expect(rows).toEqual([])
    expect(goals.get(save.id, TODAY).links).toEqual([])
  })

  it('deletes with its check-ins and links, and Undo puts them all back', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    goals.recordCheckIn(save.id, { date: '2026-02-01', value: 100 }, planning.humanActor())
    const side = await projectGoal('Side business')
    goals.setCountsTowards(side.goal.id, save.id)
    const deleted = goals.delete(save.id)
    expect(goals.list(TODAY)).toEqual([])
    expect(planning.goalCheckIns.list(side.goal.id)).toEqual([])
    expect(goals.countsTowardsForProject(side.project.id)).toEqual({})
    const restored = goals.restore(JSON.parse(JSON.stringify(deleted)))
    expect(restored.id).toBe(save.id)
    expect(restored.checkIns.map((entry) => entry.value)).toEqual([100])
    expect(restored.links.map((link) => link.goalId)).toEqual([side.goal.id])
  })

  it('offers every project goal with a measure as one that can count towards a goal', async () => {
    const side = await projectGoal('Side business')
    const { project } = await projectGoal('Plain')
    planning.createGoal(project.id, { title: 'No number' })
    const offered = planning.personalGoals.linkableProjectGoals()
    expect(offered.map((goal) => goal.title)).toEqual(['Plain savings', 'Side business savings'])
    expect(offered.find((goal) => goal.goalId === side.goal.id)?.personalGoalId).toBeNull()
  })
})

describe('the one progress rule (N5.6b)', () => {
  it('sums the latest values on each day, a goal’s start value before its first check-in', () => {
    const start100 = { ...POUNDS, startValue: 100 }
    expect(
      summedCheckIns([
        { measure: POUNDS, checkIns: [{ date: '2026-05-01', value: 50 }] },
        { measure: start100, checkIns: [] }
      ])
    ).toEqual([{ date: '2026-05-01', value: 150 }])
    expect(summedCheckIns([{ measure: POUNDS, checkIns: [] }])).toEqual([])
  })

  it('uses its own check-ins without links, and none without a measure', () => {
    const own = [{ date: '2026-06-30', value: 2500 }]
    const result = personalGoalProgress(POUNDS, own, [], '2026-07-02')
    expect(result.fromLinks).toBe(false)
    expect(result.progress?.pace).toBe('on-pace')
    expect(personalGoalProgress(null, own, [], TODAY).progress).toBeNull()
  })
})

describe('goals of one’s own stay out of project files (N5.6b)', () => {
  it('leaves a project goal’s link out of the project file and a template', async () => {
    const goals = planning.personalGoals
    const save = goals.create({ title: 'Save £5,000', measure: POUNDS })
    const side = await projectGoal('Side business')
    goals.setCountsTowards(side.goal.id, save.id)
    const pin = planning.pins.create({ place: 'sidebar', kind: 'personal-goal', targetId: save.id })
    const file = service.exportProjectAsPackage(side.project.id, {
      kind: 'export',
      relativeDates: false
    })
    const text = JSON.stringify(file)
    expect(text).not.toContain(save.id)
    expect(text).not.toContain('Save £5,000')
    expect(text).not.toContain(pin.id)
    expect(file.goals[0].title).toBe('Side business savings')

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copied = planning.listGoals(copy.id)[0]
    expect(goals.countsTowardsForProject(copy.id)).toEqual({})
    expect(goals.get(save.id, TODAY).links.map((link) => link.goalId)).toEqual([side.goal.id])
    expect(copied.id).not.toBe(side.goal.id)
  })
})

describe('pins and countdowns of goals of one’s own (N5.6b)', () => {
  it('pins to the sidebar only, and counts down to its target date', async () => {
    planning.pins.setCountdownContext(() => ({ today: TODAY, daysOff: [] }))
    const goals = planning.personalGoals
    const save = goals.create({
      title: 'Save £5,000',
      measure: { ...POUNDS, targetDate: '2026-11-21' }
    })
    const bare = goals.create({ title: 'Be happier' })
    expect(() =>
      planning.pins.create({ place: 'overview', kind: 'personal-goal', targetId: save.id })
    ).toThrow(/sidebar only/)
    const pin = planning.pins.create({ place: 'sidebar', kind: 'personal-goal', targetId: save.id })
    expect(pin).toMatchObject({
      projectId: '',
      exists: true,
      title: 'Save £5,000',
      date: '2026-11-21'
    })
    expect(planning.pins.list({ place: 'sidebar' }).map((entry) => entry.id)).toEqual([pin.id])

    const shown = planning.pins.setCountdown(pin.id, { countdown: true })
    expect(shown.countdownText).toBe('40 days to Save £5,000 (29 working days)')
    expect(planning.pins.countdowns().map((entry) => entry.id)).toEqual([pin.id])

    const barePin = planning.pins.create({
      place: 'sidebar',
      kind: 'personal-goal',
      targetId: bare.id
    })
    expect(() => planning.pins.setCountdown(barePin.id, { countdown: true })).toThrow(
      /measure with a target date/
    )

    // Unpin and Undo; delete the goal and its pin is left out of the list (MOP-39).
    const removed = planning.pins.delete(pin.id)
    expect(planning.pins.restore(removed).countdown).toBe(true)
    goals.update(save.id, { status: 'achieved' })
    expect(planning.pins.get(pin.id)).toBeTruthy()
    expect(planning.pins.countdowns()[0].done).toBe(true)
    goals.delete(save.id)
    expect(
      planning.pins.list({ place: 'sidebar' }).find((entry) => entry.id === pin.id)
    ).toBeUndefined()
  })
})
