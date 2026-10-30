import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import {
  MAX_BASELINES,
  compareBaseline,
  planItemDates,
  type BaselineWithEntries
} from '../../src/shared/planning/baselines'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-18'

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const HOUSE = packageOf({
  project: { name: 'House' },
  people: [],
  labels: [],
  goals: [],
  milestones: [{ ref: 'm1', name: 'Walls done', targetDate: '2026-11-01' }],
  tasks: [
    {
      ref: 't1',
      title: 'Plaster',
      startDate: '2026-10-20',
      dueDate: '2026-10-23',
      milestoneRef: 'm1'
    },
    { ref: 't2', title: 'Paint', dueDate: '2026-10-28', milestoneRef: 'm1' },
    { ref: 't3', title: 'Old idea', dueDate: '2026-10-30' },
    { ref: 't4', title: 'Binned', dueDate: '2026-10-30' },
    { ref: 't5', title: 'Someday' }
  ],
  decisions: [],
  library: []
})

const tempDir = useTempDir('ostler-baselines-')
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
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

async function house() {
  const { project } = await service.createProjectFromPackage(HOUSE, {}, TODAY)
  const tasks = planning.listWorkItems(project.id)
  const task = (title: string) => tasks.find((item) => item.title === title)!
  const milestone = planning.listMilestones(project.id)[0]
  return { project, task, milestone }
}

describe('comparing a baseline with the plan (N7.4)', () => {
  const baseline: Pick<BaselineWithEntries, 'id' | 'name' | 'savedAt' | 'entries'> = {
    id: 'b1',
    name: 'Plan agreed 3 October',
    savedAt: 0,
    entries: [
      { kind: 'task', itemId: 'later', start: '2026-10-01', due: '2026-10-05' },
      { kind: 'task', itemId: 'earlier', start: null, due: '2026-10-10' },
      { kind: 'task', itemId: 'same', start: '2026-10-01', due: '2026-10-02' },
      { kind: 'task', itemId: 'undated', start: null, due: null },
      { kind: 'task', itemId: 'gone', start: null, due: '2026-10-03' },
      { kind: 'milestone', itemId: 'm1', start: null, due: '2026-10-31' }
    ]
  }
  const plan = planItemDates(
    [
      { id: 'later', startDate: '2026-10-04', targetDate: '2026-10-08' },
      { id: 'earlier', startDate: '2026-10-01', targetDate: '2026-10-07' },
      { id: 'same', startDate: '2026-10-01', targetDate: '2026-10-02' },
      { id: 'undated', startDate: null, targetDate: '2026-10-09' },
      { id: 'new', startDate: null, targetDate: '2026-10-09' }
    ],
    [{ id: 'm1', targetDate: '2026-11-04' }]
  )

  it('gives each move in calendar days, positive later, and what is new and gone', () => {
    const result = compareBaseline(baseline, plan)
    const byId = new Map(result.changes.map((change) => [change.itemId, change]))
    expect(byId.get('later')).toMatchObject({ startDays: 3, dueDays: 3 })
    expect(byId.get('earlier')).toMatchObject({ startDays: null, dueDays: -3 })
    expect(byId.get('same')).toMatchObject({ startDays: 0, dueDays: 0 })
    expect(byId.get('undated')).toMatchObject({ startDays: null, dueDays: null })
    expect(byId.get('m1')).toMatchObject({ kind: 'milestone', dueDays: 4 })
    expect(result.added).toEqual([{ kind: 'task', itemId: 'new' }])
    expect(result.gone).toEqual([{ kind: 'task', itemId: 'gone' }])
    expect(result.summary).toEqual({ later: 1, earlier: 1, unchanged: 2, added: 1 })
  })

  it('counts calendar days across a month and a clock change', () => {
    const result = compareBaseline(
      { ...baseline, entries: [{ kind: 'task', itemId: 'a', start: null, due: '2026-10-20' }] },
      planItemDates([{ id: 'a', startDate: null, targetDate: '2026-11-03' }], [])
    )
    expect(result.changes[0].dueDays).toBe(14)
  })
})

describe('saving baselines (N7.4)', () => {
  it("copies live tasks' and milestones' dates only, in one go", async () => {
    const { project, task, milestone } = await house()
    planning.archiveWorkItem(task('Old idea').id, planning.humanActor())
    planning.moveWorkItemToBin(task('Binned').id, planning.humanActor())

    const saved = planning.baselines.create(project.id, { name: '  Plan agreed 3 October ' })

    expect(saved).toMatchObject({ name: 'Plan agreed 3 October', taskCount: 3, milestoneCount: 1 })
    const full = planning.baselines.get(project.id, saved.id)
    expect(full.entries).toEqual([
      { kind: 'task', itemId: task('Plaster').id, start: '2026-10-20', due: '2026-10-23' },
      { kind: 'task', itemId: task('Paint').id, start: null, due: '2026-10-28' },
      { kind: 'task', itemId: task('Someday').id, start: null, due: null },
      { kind: 'milestone', itemId: milestone.id, start: null, due: '2026-11-01' }
    ])
  })

  it('is a snapshot: moving a task later changes the comparison, never the baseline', async () => {
    const { project, task } = await house()
    const saved = planning.baselines.create(project.id, { name: 'Agreed' })
    planning.updateWorkItem(task('Paint').id, { targetDate: '2026-11-01' }, planning.humanActor())

    const entry = planning.baselines
      .get(project.id, saved.id)
      .entries.find((item) => item.itemId === task('Paint').id)
    expect(entry?.due).toBe('2026-10-28')
    const compared = planning.baselines.compare(project.id, saved.id)
    expect(compared.changes.find((change) => change.itemId === task('Paint').id)?.dueDays).toBe(4)
    expect(compared.summary.later).toBe(1)
  })

  it('keeps entries when a task is deleted, and the comparison says it is gone', async () => {
    const { project, task } = await house()
    const saved = planning.baselines.create(project.id, { name: 'Agreed' })
    const plaster = task('Plaster').id
    planning.deleteWorkItem(plaster, planning.humanActor())

    expect(planning.baselines.get(project.id, saved.id).taskCount).toBe(5)
    expect(planning.baselines.compare(project.id, saved.id).gone).toEqual([
      { kind: 'task', itemId: plaster }
    ])
  })

  it('keeps ten per project, and an eleventh names the one to delete', async () => {
    const { project } = await house()
    let at = 1000
    const clocked = planning.baselines as unknown as { now: () => number }
    clocked.now = () => (at += 1000)
    const made = Array.from({ length: MAX_BASELINES }, (_, i) =>
      planning.baselines.create(project.id, { name: `Plan ${i + 1}` })
    )
    expect(() => planning.baselines.create(project.id, { name: 'Eleventh' })).toThrow(/at most 10/)

    planning.baselines.create(project.id, { name: 'Eleventh', replaceId: made[0].id })

    const names = planning.baselines.list(project.id).map((baseline) => baseline.name)
    expect(names).toHaveLength(MAX_BASELINES)
    expect(names[0]).toBe('Eleventh')
    expect(names).not.toContain('Plan 1')
  })

  it('renames, deletes and restores with the same id and entries', async () => {
    const { project } = await house()
    const saved = planning.baselines.create(project.id, { name: 'Agreed' })
    expect(() => planning.baselines.rename(project.id, saved.id, { name: '' })).toThrow()
    expect(() =>
      planning.baselines.rename(project.id, saved.id, { name: 'x'.repeat(81) })
    ).toThrow()
    const { after } = planning.baselines.rename(project.id, saved.id, { name: 'Signed off' })
    expect(after.name).toBe('Signed off')

    const deleted = planning.baselines.delete(project.id, saved.id)
    expect(planning.baselines.list(project.id)).toEqual([])
    planning.baselines.restore(project.id, deleted)
    expect(planning.baselines.get(project.id, saved.id)).toEqual(deleted)
  })

  it("refuses another project's baseline, and removing the project removes them", async () => {
    const { project } = await house()
    const { project: other } = await service.createProjectFromPackage(HOUSE, {}, TODAY)
    const saved = planning.baselines.create(project.id, { name: 'Agreed' })
    expect(() => planning.baselines.get(other.id, saved.id)).toThrow(/not found/)

    deleteProjectRows(planning.database, project.id)

    const db = planning.database
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_baselines').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_baseline_entries').get()).toEqual({
      n: 0
    })
  })
})

describe('baselines in the project file (N7.4)', () => {
  it('travel with ids mapped, and an item gone since stays gone', async () => {
    const { project, task } = await house()
    planning.baselines.create(project.id, { name: 'Agreed' })
    planning.deleteWorkItem(task('Someday').id, planning.humanActor())

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.baselines).toHaveLength(1)
    expect(file.baselines![0].entries.map((entry) => entry.ref)).toContain('gone1')
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const [baseline] = planning.baselines.list(copy.id)
    expect(baseline).toMatchObject({ name: 'Agreed', taskCount: 5, milestoneCount: 1 })
    const compared = planning.baselines.compare(copy.id, baseline.id)
    const copiedPlaster = planning.listWorkItems(copy.id).find((item) => item.title === 'Plaster')!
    expect(compared.changes.find((change) => change.itemId === copiedPlaster.id)).toMatchObject({
      startDays: 0,
      dueDays: 0
    })
    expect(compared.gone).toHaveLength(1)
    expect(compared.added).toEqual([])
  })

  it('never travel in a template', async () => {
    const { project } = await house()
    planning.baselines.create(project.id, { name: 'Agreed' })
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.baselines).toBeUndefined()
  })
})
