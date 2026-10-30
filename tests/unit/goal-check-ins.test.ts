import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { MIGRATIONS } from '../../electron/services/database/migrations'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import type { GoalMeasure } from '../../src/shared/goal-measures'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-12'

const MEASURE: GoalMeasure = {
  unit: 'members',
  startValue: 0,
  targetValue: 200,
  startDate: '2026-10-01',
  targetDate: '2026-12-31',
  direction: 'up'
}

const tempDir = useTempDir('ostler-goal-check-ins-')
let databasePath: string
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const CLUB = packageOf({
  project: { name: 'Club' },
  people: [],
  labels: [],
  goals: [{ ref: 'g1', title: 'Sign up members' }],
  milestones: [],
  tasks: [],
  decisions: [],
  library: []
})

async function newGoal() {
  const { project } = await service.createProjectFromPackage(CLUB, {}, TODAY)
  const goal = planning.listGoals(project.id)[0]
  return { project, goal: planning.updateGoal(goal.id, { measure: MEASURE }) }
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

describe('the goal measures migration (N5.6a)', () => {
  it('is version 36 and adds the measure columns and the check-ins table', () => {
    expect(MIGRATIONS.find((migration) => migration.name === 'goal-measures')?.version).toBe(36)
    const db = new Database(databasePath, { readonly: true })
    try {
      const goalColumns = (
        db.prepare('PRAGMA table_info(planning_goals)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(goalColumns).toEqual(
        expect.arrayContaining([
          'measure_unit',
          'measure_start_value',
          'measure_target_value',
          'measure_start_date',
          'measure_target_date',
          'measure_direction'
        ])
      )
      const checkInColumns = (
        db.prepare('PRAGMA table_info(goal_check_ins)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(checkInColumns).toEqual(
        expect.arrayContaining(['goal_id', 'project_id', 'date', 'value', 'note', 'recorded_at'])
      )
    } finally {
      db.close()
    }
  })
})

describe('a goal measure on the goal (N5.6a)', () => {
  it('is stored, read back, changed and taken away; a goal without one has null', async () => {
    const { project, goal } = await newGoal()
    expect(goal.measure).toEqual(MEASURE)
    expect(planning.getGoal(goal.id).measure).toEqual(MEASURE)
    const plain = planning.createGoal(project.id, { title: 'No number' })
    expect(plain.measure).toBeNull()
    expect(planning.updateGoal(goal.id, { title: 'Members' }).measure).toEqual(MEASURE)
    expect(planning.updateGoal(goal.id, { measure: null }).measure).toBeNull()
    expect(planning.getGoal(goal.id).measure).toBeNull()
  })

  it('refuses a measure the parser refuses', async () => {
    const { goal } = await newGoal()
    expect(() =>
      planning.updateGoal(goal.id, { measure: { ...MEASURE, targetDate: '2026-01-01' } })
    ).toThrow(/after/)
  })
})

describe('check-ins (N5.6a)', () => {
  it('keeps one a day: a second replaces the first and returns it for Undo', async () => {
    const { goal } = await newGoal()
    const human = planning.humanActor()
    const first = planning.goalCheckIns.record(goal.id, { date: TODAY, value: 40 }, human)
    expect(first.replaced).toBeNull()
    const second = planning.goalCheckIns.record(
      goal.id,
      { date: TODAY, value: 42, note: 'After the fair' },
      human
    )
    expect(second.replaced).toMatchObject({ date: TODAY, value: 40 })
    expect(planning.goalCheckIns.list(goal.id)).toEqual([second.checkIn])

    // Undo puts the first back as it was, its time included.
    const restored = planning.goalCheckIns.restore(goal.id, second.replaced, human)
    expect(restored).toEqual(first.checkIn)
  })

  it('removes one with Undo, lists them oldest first, and goes with its goal', async () => {
    const { goal } = await newGoal()
    const human = planning.humanActor()
    planning.goalCheckIns.record(goal.id, { date: '2026-10-10', value: 30 }, human)
    planning.goalCheckIns.record(goal.id, { date: '2026-10-05', value: 10 }, human)
    expect(planning.goalCheckIns.list(goal.id).map((entry) => entry.date)).toEqual([
      '2026-10-05',
      '2026-10-10'
    ])
    const removed = planning.goalCheckIns.delete(goal.id, '2026-10-10')
    expect(planning.goalCheckIns.list(goal.id)).toHaveLength(1)
    planning.goalCheckIns.restore(goal.id, removed, human)
    expect(planning.goalCheckIns.list(goal.id)).toHaveLength(2)
    expect(() => planning.goalCheckIns.delete(goal.id, '2026-01-01')).toThrow(/not found/)

    planning.deleteGoal(goal.id)
    const db = new Database(databasePath, { readonly: true })
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM goal_check_ins').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('shows in the project activity, by who recorded it', async () => {
    const { project, goal } = await newGoal()
    planning.goalCheckIns.record(goal.id, { date: TODAY, value: 142 }, { kind: 'automation' })
    const entry = planning
      .listProjectActivity(project.id)
      .entries.find((candidate) => candidate.kind === 'goal-check-in')
    expect(entry?.summary).toMatch(/checked in 142 members on Sign up members/)
    expect(entry?.actor.kind).toBe('automation')
  })

  it('gives Home each active goal with a number at a glance', async () => {
    const { project, goal } = await newGoal()
    planning.goalCheckIns.record(goal.id, { date: TODAY, value: 142 }, planning.humanActor())
    const glances = planning.goalGlances([project.id], TODAY)[project.id]
    expect(glances).toHaveLength(1)
    expect(glances[0].progress.latest).toBe(142)
    planning.updateGoal(goal.id, { status: 'achieved' })
    expect(planning.goalGlances([project.id], TODAY)[project.id]).toBeUndefined()
  })
})

describe('measures and check-ins in the project file and templates (N5.6a)', () => {
  it('carries a measure and its check-ins through an export', async () => {
    const { project, goal } = await newGoal()
    planning.goalCheckIns.record(
      goal.id,
      { date: '2026-10-05', value: 20, note: 'First week' },
      planning.humanActor()
    )
    planning.goalCheckIns.record(goal.id, { date: TODAY, value: 42 }, planning.humanActor())
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.goals[0].measure).toEqual(MEASURE)
    expect(file.goals[0].checkIns?.map((entry) => [entry.date, entry.value, entry.note])).toEqual([
      ['2026-10-05', 20, 'First week'],
      [TODAY, 42, '']
    ])
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copied = planning.listGoals(copy.id)[0]
    expect(copied.measure).toEqual(MEASURE)
    expect(planning.goalCheckIns.list(copied.id).map((entry) => entry.value)).toEqual([20, 42])
  })

  it('carries a measure without check-ins in a template, its dates counted from the day used', async () => {
    const { project, goal } = await newGoal()
    planning.goalCheckIns.record(goal.id, { date: TODAY, value: 42 }, planning.humanActor())
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.goals[0].measure).toMatchObject({ startDate: '-11d', targetDate: '+80d' })
    expect(template.goals[0].checkIns).toBeUndefined()

    const { project: used } = await service.createProjectFromPackage(
      JSON.parse(JSON.stringify(template)),
      {},
      '2027-01-11'
    )
    const made = planning.listGoals(used.id)[0]
    expect(made.measure).toEqual({ ...MEASURE, startDate: '2026-12-31', targetDate: '2027-04-01' })
    expect(planning.goalCheckIns.list(made.id)).toEqual([])
  })

  it('refuses a malformed measure or two check-ins on one day', () => {
    const base = {
      format: 'ostler-project-package',
      version: 1,
      project: { name: 'Club' },
      people: [],
      labels: [],
      milestones: [],
      tasks: [],
      decisions: [],
      library: []
    }
    const goal = { ref: 'g1', title: 'Members', measure: MEASURE }
    expect(validateProjectPackage({ ...base, goals: [goal] }).ok).toBe(true)
    expect(
      validateProjectPackage({
        ...base,
        goals: [{ ...goal, measure: { ...MEASURE, direction: 'down' } }]
      }).ok
    ).toBe(false)
    const checkIn = { date: TODAY, value: 1, recordedAt: '2026-10-12T09:00:00.000Z' }
    expect(validateProjectPackage({ ...base, goals: [{ ...goal, checkIns: [checkIn] }] }).ok).toBe(
      true
    )
    expect(
      validateProjectPackage({ ...base, goals: [{ ...goal, checkIns: [checkIn, checkIn] }] }).ok
    ).toBe(false)
  })
})
