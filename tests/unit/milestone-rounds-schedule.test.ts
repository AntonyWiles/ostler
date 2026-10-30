import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { REMINDER_CHECK_MS, ReminderService } from '../../electron/services/reminder-service'
import { roundSource } from '../../electron/services/inbox-sources'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import type { RecurrenceRule } from '../../src/shared/recurrence'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const MONTHLY: RecurrenceRule = { every: 'month', interval: 1, monthDay: 1 }
const TODAY = '2027-04-20'

const tempDir = useTempDir('ostler-round-schedule-')
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const BOOKS = packageOf({
  project: { name: 'Books' },
  people: [],
  labels: [],
  goals: [],
  milestones: [{ ref: 'm1', name: 'Accounts', targetDate: '2027-04-10' }],
  tasks: [
    { ref: 't1', title: 'Gather receipts', milestoneRef: 'm1', dueDate: '2027-04-03' },
    { ref: 't2', title: 'Send report', milestoneRef: 'm1', dueDate: '2027-04-10' }
  ],
  decisions: [],
  library: []
})

/** A project whose Accounts milestone repeats monthly, with its May round made. */
async function repeatingProject() {
  const { project } = await service.createProjectFromPackage(BOOKS, {}, TODAY)
  const first = planning.listMilestones(project.id)[0]
  planning.rounds.setRepeat(first.id, { rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01' })
  const round = planning.rounds.startNextRound(first.id, planning.humanActor())
  return { project, first, round }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2027, 3, 20, 10, 0))
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
  vi.useRealTimers()
})

describe('the hourly check makes a round on its start date (N5.7a)', () => {
  it('runs at start and every hour, with the clock it is given', async () => {
    const { project } = await service.createProjectFromPackage(BOOKS, {}, TODAY)
    const first = planning.listMilestones(project.id)[0]
    planning.rounds.setRepeat(first.id, { rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01' })
    vi.useRealTimers()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 3, 30, 22, 30))
    const reminders = new ReminderService({
      reminders: planning.reminders,
      getProjects: () => store.getProjects(),
      getTask: () => null,
      replanDueReminders: () => {},
      startDueRounds: () => void planning.rounds.startDueRounds([project.id]),
      notify: () => {},
      onDelivered: () => {},
      timeZone: () => 'UTC|0'
    })
    reminders.start()
    try {
      expect(planning.listMilestones(project.id)).toHaveLength(1)
      // Past midnight, the next hourly check makes May's round.
      vi.advanceTimersByTime(REMINDER_CHECK_MS * 2)
      const names = planning.listMilestones(project.id).map((milestone) => milestone.name)
      expect(names).toContain('Accounts · May 2027')
      expect(names).toHaveLength(2)
      vi.advanceTimersByTime(REMINDER_CHECK_MS)
      expect(planning.listMilestones(project.id)).toHaveLength(2)
    } finally {
      reminders.stop()
    }
  })

  it('says in the Inbox that a round was started on schedule, never for Start next round now', async () => {
    const { project, round } = await repeatingProject()
    const inbox = roundSource(planning.database, () => store.getProjects())
    expect(inbox()).toEqual([])
    const [made] = planning.rounds.startDueRounds([project.id], '2027-06-03')
    expect(made.id).not.toBe(round.id)
    expect(inbox()).toEqual([
      expect.objectContaining({
        key: `round:${made.id}`,
        kind: 'round',
        title: 'Accounts · June 2027 was started',
        projectId: project.id,
        milestoneId: made.id,
        taskId: null
      })
    ])
  })
})

describe('rounds in the project file and templates (N5.7a)', () => {
  it('carries the schedule, the series and each copy’s source through an export', async () => {
    const { project, first, round } = await repeatingProject()
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)
    const names = new Map(planning.listMilestones(project.id).map((m) => [m.id, m.name]))
    const refOf = (id: string) => file.milestones.find((m) => m.name === names.get(id))!
    expect(refOf(round.id)).toMatchObject({
      repeat: { rule: MONTHLY, lengthDays: 10, nextStart: '2027-06-01', on: true },
      roundStart: '2027-05-01',
      previousRoundRef: refOf(first.id).ref
    })
    const copies = file.tasks.filter((task) => task.milestoneRef === refOf(round.id).ref)
    expect(copies).toHaveLength(2)
    for (const copy of copies) {
      const source = file.tasks.find((task) => task.ref === copy.roundSourceRef)!
      expect(source.title).toBe(copy.title)
      expect(source.milestoneRef).toBe(refOf(first.id).ref)
    }

    const { project: back } = await service.createProjectFromPackage(
      JSON.parse(JSON.stringify(file)),
      {},
      TODAY
    )
    const milestones = planning.listMilestones(back.id)
    const latest = milestones.find((milestone) => milestone.name === round.name)!
    const earlier = milestones.find((milestone) => milestone.name === first.name)!
    expect(latest).toMatchObject({
      previousRoundId: earlier.id,
      roundStart: '2027-05-01',
      repeat: { rule: MONTHLY, lengthDays: 10, nextStart: '2027-06-01', on: true }
    })
    const tasks = planning.listWorkItems(back.id)
    for (const copy of tasks.filter((task) => task.milestoneId === latest.id)) {
      const source = tasks.find((task) => task.id === copy.roundSourceId)!
      expect(source).toMatchObject({ title: copy.title, milestoneId: earlier.id })
    }
  })

  it('carries one round’s tasks and the rule in a template, its next start counted from the day used', async () => {
    const { project, round } = await repeatingProject()
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.milestones).toHaveLength(1)
    expect(template.milestones[0]).toMatchObject({
      name: round.name,
      repeat: { rule: MONTHLY, lengthDays: 10, nextStart: '+42d', on: true },
      roundStart: '+11d'
    })
    expect(template.milestones[0].previousRoundRef).toBeUndefined()
    expect(template.tasks).toHaveLength(2)
    expect(template.tasks.every((task) => task.roundSourceRef === undefined)).toBe(true)

    const { project: used } = await service.createProjectFromPackage(
      JSON.parse(JSON.stringify(template)),
      {},
      '2027-08-01'
    )
    const [made] = planning.listMilestones(used.id)
    expect(made.repeat).toEqual({
      rule: MONTHLY,
      lengthDays: 10,
      nextStart: '2027-09-12',
      on: true
    })
    expect(made.previousRoundId).toBeUndefined()
  })

  it('refuses a round naming a milestone or task the file does not have', () => {
    const base = {
      format: 'ostler-project-package',
      version: 1,
      project: { name: 'Books' },
      people: [],
      labels: [],
      goals: [],
      decisions: [],
      library: []
    }
    expect(
      validateProjectPackage({
        ...base,
        milestones: [{ ref: 'm1', name: 'A', previousRoundRef: 'm9' }],
        tasks: []
      }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({
        ...base,
        milestones: [],
        tasks: [{ ref: 't1', title: 'A', roundSourceRef: 't9' }]
      }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({
        ...base,
        milestones: [
          { ref: 'm1', name: 'A', repeat: { rule: MONTHLY, lengthDays: 0, nextStart: '+1d' } }
        ],
        tasks: []
      }).ok
    ).toBe(false)
  })
})
