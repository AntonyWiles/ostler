import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { LibraryService } from '../../electron/services/library-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import {
  deleteProjectRows,
  ProjectRemovalService,
  projectScopedTables
} from '../../electron/services/project-removal-service'
import { applyLocale } from '../../src/shared/i18n'
import {
  resolvePackageDate,
  validateProjectPackage,
  type ProjectPackage
} from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { isoDaysBetween, shiftIsoDate } from '../../src/shared/dates'
import { customColumns } from '../../src/shared/board-columns'

const TODAY = '2026-10-09'

let tempDir: string
let databasePath: string
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let library: LibraryService
let service: ProjectPackageService
let registerFails = false

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const PARTY = packageOf({
  project: { name: 'Party', color: '#ec4899', estimateUnit: 'hours' },
  people: [
    { ref: 'p1', name: 'Sam Rivera' },
    { ref: 'p2', name: 'Jo Park', initials: 'JP', color: '#22c55e' }
  ],
  labels: [{ name: 'venue', color: '#8b5cf6' }],
  goals: [{ ref: 'g1', title: 'A good party', outcome: 'Everyone has fun' }],
  milestones: [
    { ref: 'm1', goalRef: 'g1', name: 'Venue booked', targetDate: '+14d' },
    { ref: 'm2', name: 'Party day', targetDate: '+2w', successCriteria: ['Food ready'] }
  ],
  tasks: [
    {
      ref: 't1',
      title: 'Book the hall',
      milestoneRef: 'm1',
      labels: ['venue'],
      priority: 'high',
      assigneeRef: 'p1',
      dueDate: '+7d',
      estimate: 2,
      checklist: [
        { text: 'Call the hall', checked: true },
        { text: 'Pay the deposit', checked: false }
      ]
    },
    {
      ref: 't2',
      title: 'Send invites',
      milestoneRef: 'm2',
      dependsOnRefs: ['t1'],
      dueDate: '+10d'
    },
    { ref: 't3', title: 'Plan the food', assigneeRef: 'p2', startDate: '-3d', dueDate: '+12d' },
    { ref: 't4', title: 'Buy drinks', parentRef: 't3', status: 'ready' },
    { ref: 't5', title: 'Buy snacks', parentRef: 't3', dependsOnRefs: ['t4'] },
    {
      ref: 't6',
      title: 'Water the plants',
      dueDate: '+1d',
      recurrence: { rule: { every: 'week', interval: 1 }, endsOn: '+8w' }
    }
  ],
  decisions: [{ title: 'Venue', decision: 'The village hall', date: '-1d', taskRefs: ['t1'] }],
  library: [{ kind: 'note', title: 'Ideas', body: 'Fancy dress?' }]
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 9, 10, 0))
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-package-'))
  databasePath = await createMigratedDatabase(tempDir)
  store = new ConfigStore(path.join(tempDir, 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  library = new LibraryService(databasePath, tempDir)
  people.ensureMe('Me')
  const scaffold = new ProjectScaffoldService(store, () => tempDir)
  registerFails = false
  service = new ProjectPackageService({
    planning,
    registerProject: async (request, fixed) => {
      if (registerFails) throw new Error('The disk is full')
      return scaffold.createProject(request, fixed)
    },
    getProject: (projectId) => {
      const project = store.getProjects().find((entry) => entry.id === projectId)
      if (!project) throw new Error('Project not found')
      return project
    },
    dataDir: tempDir,
    appVersion: 'test'
  })
})

afterEach(() => {
  planning.close()
  people.close()
  library.close()
  vi.useRealTimers()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function rowCounts(): Record<string, number> {
  const db = new Database(databasePath, { readonly: true })
  try {
    const counts: Record<string, number> = {}
    for (const table of projectScopedTables(db)) {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n
    }
    counts.people = (db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n
    return counts
  } finally {
    db.close()
  }
}

/** A package with what differs on every run taken out: export time, dates. */
function comparable(pkg: ProjectPackage): unknown {
  return {
    ...pkg,
    exportedAt: null,
    milestones: pkg.milestones.map((milestone) => ({ ...milestone, targetDate: null })),
    tasks: pkg.tasks.map((task) => ({
      ...task,
      startDate: null,
      dueDate: null,
      recurrence: task.recurrence ? { ...task.recurrence, endsOn: null } : null
    })),
    decisions: pkg.decisions.map((decision) => ({ ...decision, date: null }))
  }
}

describe('createProjectFromPackage', () => {
  it('creates every record, with refs as new ids and relative dates resolved', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    expect(project).toMatchObject({ name: 'Party', color: '#ec4899', estimateUnit: 'hours' })

    const milestones = planning.listMilestones(project.id)
    const booked = milestones.find((m) => m.name === 'Venue booked')!
    expect(booked.targetDate).toBe('2026-10-23')
    expect(booked.goalId).toBe(planning.listGoals(project.id)[0].id)

    const items = planning.listWorkItems(project.id)
    const byTitle = (title: string) => items.find((item) => item.title === title)!
    const hall = byTitle('Book the hall')
    expect(hall).toMatchObject({
      milestoneId: booked.id,
      targetDate: '2026-10-16',
      priority: 'high',
      labels: ['venue'],
      estimate: 2,
      acceptanceCriteria: ['Call the hall', 'Pay the deposit'],
      checkedCriteria: ['Call the hall']
    })
    expect(byTitle('Send invites').dependencyIds).toEqual([hall.id])
    const food = byTitle('Plan the food')
    expect(food.startDate).toBe('2026-10-06')
    expect(byTitle('Buy drinks')).toMatchObject({ parentWorkItemId: food.id, status: 'ready' })
    expect(byTitle('Buy snacks').dependencyIds).toEqual([byTitle('Buy drinks').id])
    const recurrence = planning.getRecurrence(byTitle('Water the plants').id)
    expect(recurrence).toMatchObject({ rule: { every: 'week', interval: 1 }, endsOn: '2026-12-04' })

    expect(planning.listProjectLabels(project.id)).toEqual([
      expect.objectContaining({ name: 'venue', color: '#8b5cf6', hasColor: true })
    ])
    expect(planning.listDecisions(project.id)[0]).toMatchObject({
      decision: 'The village hall',
      date: '2026-10-08',
      linkedWorkItemIds: [hall.id]
    })
    expect(library.listItems(project.id).map((item) => item.title)).toEqual(['Ideas'])
  })

  it('records each task as created by the human, from the template', async () => {
    const { project } = await service.createProjectFromTemplate('event-planning', {}, TODAY)
    const item = planning.listWorkItems(project.id)[0]
    const entries = planning.listActivity(project.id, item.id).entries
    const created = entries.find((entry) => entry.summary.includes('created the task'))!
    expect(created.summary).toBe('Me created the task from template “Event planning”')
    expect(created.actor.kind).toBe('human')
  })

  it('matches people by exact name, and creates the ones it cannot match', async () => {
    const sam = people.create({ name: 'Sam Rivera' })
    people.create({ name: 'jo park' })
    const before = people.list().length
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const items = planning.listWorkItems(project.id)
    expect(items.find((item) => item.title === 'Book the hall')!.assigneeId).toBe(sam.id)
    const jo = people.list().find((person) => person.name === 'Jo Park')!
    expect(jo).toMatchObject({ initials: 'JP', color: '#22c55e' })
    expect(items.find((item) => item.title === 'Plan the food')!.assigneeId).toBe(jo.id)
    expect(people.list()).toHaveLength(before + 1)
  })

  it('leaves no rows and no config entry when a record fails part-way', async () => {
    const before = rowCounts()
    // The validator allows it; the service refuses a start after the due date
    // on the third task, after the goal, milestones and two tasks exist.
    const broken = packageOf({
      ...PARTY,
      tasks: PARTY.tasks.map((task) => (task.ref === 't3' ? { ...task, startDate: '+30d' } : task))
    } as unknown as Record<string, unknown>)
    await expect(service.createProjectFromPackage(broken, {}, TODAY)).rejects.toThrow(
      'The start date is after the due date'
    )
    expect(rowCounts()).toEqual(before)
    expect(store.getProjects()).toEqual([])
  })

  it('removes every record when the config entry cannot be written', async () => {
    const before = rowCounts()
    registerFails = true
    await expect(service.createProjectFromPackage(PARTY, {}, TODAY)).rejects.toThrow(
      'The disk is full'
    )
    expect(rowCounts()).toEqual(before)
    expect(store.getProjects()).toEqual([])
  })

  it('takes the name and colour the wizard chose', async () => {
    const { project } = await service.createProjectFromTemplate(
      'sample',
      { name: 'Try it out', color: '#3b82f6' },
      TODAY
    )
    expect(project).toMatchObject({ name: 'Try it out', color: '#3b82f6', path: null })
    expect(planning.listWorkItems(project.id).map((item) => item.title)).toContain(
      'Pick the weekend'
    )
  })

  it('starts a template project in the stage the wizard chose, else Active', async () => {
    const planned = await service.createProjectFromTemplate(
      'event-planning',
      { stage: 'planning' },
      TODAY
    )
    const plain = await service.createProjectFromTemplate('event-planning', {}, TODAY)
    expect(planned.project.stage).toBe('planning')
    expect(plain.project.stage).toBe('active')
  })

  it('marks a demo made from its package as that demo, and no other project', async () => {
    const simple = await service.createProjectFromTemplate('sample', {}, TODAY)
    const advanced = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
    const other = await service.createProjectFromTemplate('event-planning', {}, TODAY)
    expect(simple.project.demo).toBe('simple')
    expect(advanced.project.demo).toBe('advanced')
    expect(other.project.demo).toBeUndefined()
    // A copy from a project file is not a demo, even of a demo.
    const copy = await service.createProjectFromPackage(
      service.exportProjectAsPackage(simple.project.id, { kind: 'export', relativeDates: false })
    )
    expect(copy.project.demo).toBeUndefined()
  })

  it('gives each demo its own people, who leave with it', async () => {
    const before = people.list({ includeArchived: true }).map((person) => person.id)
    const simple = await service.createProjectFromTemplate('sample', {}, TODAY)
    const advanced = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
    const own = (projectId: string) =>
      people.list({ includeArchived: true }).filter((person) => person.projectId === projectId)
    expect(own(simple.project.id).length).toBeGreaterThan(0)
    expect(own(advanced.project.id).length).toBeGreaterThan(0)
    // The address book is as it was: nobody new in it.
    expect(
      people
        .list({ includeArchived: true })
        .filter((person) => person.projectId === null)
        .map((person) => person.id)
    ).toEqual(before)
    // The demo's tasks are assigned to its own people.
    const ids = new Set(own(simple.project.id).map((person) => person.id))
    const assigned = planning
      .listWorkItems(simple.project.id)
      .map((item) => item.assigneeId)
      .filter((id): id is string => id !== null)
    expect(assigned.length).toBeGreaterThan(0)
    expect(assigned.every((id) => ids.has(id))).toBe(true)

    // Removing one demo takes its people, and leaves the other demo's.
    const db = new Database(databasePath)
    try {
      deleteProjectRows(db, simple.project.id)
    } finally {
      db.close()
    }
    expect(own(simple.project.id)).toEqual([])
    expect(own(advanced.project.id).length).toBeGreaterThan(0)
  })

  it('gives the advanced demo its workstreams, which travel in its file', async () => {
    const { project } = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
    const [building, front] = planning.subprojects.list(project.id)
    expect([building.name, front.name]).toEqual(['Building work', 'Front of house'])
    expect(building.leadId).not.toBeNull()
    const items = planning.listWorkItems(project.id)
    const inFront = items.filter((item) => item.subprojectId === front.id)
    expect(inFront.map((item) => item.title)).toContain('New shopfront sign')
    expect(items.some((item) => !item.subprojectId)).toBe(true)
    const strip = planning.listMilestones(project.id).find((m) => m.name === 'Strip-out finished')!
    expect(strip.subprojectId).toBe(building.id)

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.subprojects?.map((subproject) => subproject.name)).toEqual([
      'Building work',
      'Front of house'
    ])
    const copy = await service.createProjectFromPackage(file, {}, TODAY)
    const [copied] = planning.subprojects.list(copy.project.id)
    expect(
      planning.listWorkItems(copy.project.id).filter((item) => item.subprojectId === copied.id)
        .length
    ).toBe(items.filter((item) => item.subprojectId === building.id).length)
  })

  it('gives the advanced demo its saved views, which travel in its file with new ids', async () => {
    const { project } = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
    const [, front] = planning.subprojects.list(project.id)
    const onOrder = customColumns(planning.columns.get(project.id))[0]
    const views = planning.views.list(project.id)
    expect(views.filter((view) => view.isDefault).map((view) => view.viewType)).toEqual([
      'board',
      'calendar',
      'list',
      'timeline'
    ])
    const frontBoard = views.find((view) => view.name === 'Front of house')!
    expect(frontBoard.config.filter.conditions[0].value).toEqual([front.id])
    expect(frontBoard.config.options.hiddenColumns).toEqual(['blocked', `custom:${onOrder.id}`])
    const room = planning.listFields(project.id).find((field) => field.name === 'Room')!
    expect(views.find((view) => view.name === 'Snags by room')!.config.options.groupBy).toBe(
      `field:${room.id}`
    )
    const list = views.find((view) => view.viewType === 'list' && view.isDefault)!
    const shown = (list.config.options.columns as { id: string; visible: boolean }[])
      .filter((column) => column.visible)
      .map((column) => column.id)
    expect(shown).toEqual(
      expect.arrayContaining(['priority', 'start', 'estimate', `field:${room.id}`])
    )
    expect(shown.length).toBeGreaterThanOrEqual(12)
    const assignee = views.find((view) => view.name === "Tom's open work")!.config.filter
      .conditions[0].value as string[]
    expect(people.list().find((person) => person.id === assignee[0])?.name).toBe('Tom (demo)')
    expect(
      planning.pins.overviewPins(project.id).some((pin) => pin.targetId === frontBoard.id)
    ).toBe(true)

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.views?.find((view) => view.name === 'Front of house')).toMatchObject({
      filter: { conditions: [{ value: ['#subproject.s2'] }] },
      options: { hiddenColumns: ['blocked', 'custom:#column.column-1'] }
    })
    expect(JSON.stringify(file.views)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(file.pins).toContainEqual({ kind: 'view', index: 1 })

    const copy = await service.createProjectFromPackage(file, {}, TODAY)
    const [, copiedFront] = planning.subprojects.list(copy.project.id)
    const copied = planning.views.list(copy.project.id)
    expect(copied.map((view) => [view.name, view.viewType, view.isDefault])).toEqual(
      views.map((view) => [view.name, view.viewType, view.isDefault])
    )
    expect(copied.find((view) => view.name === 'Front of house')!.config.filter).toEqual({
      match: 'all',
      conditions: [{ field: 'subproject', op: 'is', value: [copiedFront.id] }]
    })
  })

  it('makes a template that is not a demo with people in the address book', async () => {
    const { project } = await service.createProjectFromPackage(PARTY)
    const sam = people.list().find((person) => person.name === 'Sam Rivera')
    expect(sam?.projectId).toBeNull()
    expect(planning.listWorkItems(project.id).some((item) => item.assigneeId === sam?.id)).toBe(
      true
    )
  })

  it('makes the demos in the language shown, untouched until someone works in them', async () => {
    applyLocale({ language: 'de', formatLocale: 'de-DE' })
    try {
      const simple = await service.createProjectFromTemplate('sample', {}, TODAY)
      const advanced = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
      const titles = planning.listWorkItems(simple.project.id).map((item) => item.title)
      expect(titles).toContain('Das Wochenende auswählen')
      const removal = new ProjectRemovalService(databasePath, tempDir, planning, {} as never)
      const demos = [simple.project, advanced.project]
      expect(removal.editedSinceMade(demos)).toBe(false)
      vi.setSystemTime(Date.now() + 5 * 60_000)
      const task = planning.listWorkItems(advanced.project.id)[0]
      planning.updateWorkItem(task.id, { title: 'Meins' }, { kind: 'human' })
      expect(removal.editedSinceMade(demos)).toBe(true)
    } finally {
      applyLocale({ language: 'en', formatLocale: 'en' })
    }
  })

  it('gives the sample project none of the old feature-level labels', async () => {
    const { project } = await service.createProjectFromTemplate('sample', {}, TODAY)
    const labels = planning.listWorkItems(project.id).flatMap((item) => item.labels)
    for (const level of ['Essentials', 'Standard', 'Everything']) {
      expect(labels).not.toContain(level)
    }
  })

  it.each([
    'blank',
    'software-project',
    'website-launch',
    'marketing-campaign',
    'event-planning',
    'content-calendar',
    'product-launch',
    'moving-house',
    'study-plan',
    'sample',
    'demo-advanced'
  ])('creates a project from the built-in template %s', async (templateId) => {
    const pkg = service.getTemplatePackage(templateId)
    const { project } = await service.createProjectFromTemplate(templateId, {}, TODAY)
    // A task closed as won't do goes straight to the Archive.
    const live = pkg.tasks.filter((task) => task.resolution !== 'wont-do')
    expect(planning.listWorkItems(project.id)).toHaveLength(live.length)
    expect(planning.listMilestones(project.id)).toHaveLength(pkg.milestones.length)
    const recurring = pkg.tasks.filter((task) => task.recurrence).length
    expect(planning.listWorkItems(project.id).filter((item) => item.recurring)).toHaveLength(
      recurring
    )
  })
})

describe('the advanced demo', () => {
  it('comes with its history, dated as if its anchor were today', async () => {
    const { project } = await service.createProjectFromTemplate('demo-advanced', {}, TODAY)
    const made = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    const days = isoDaysBetween('2026-01-15', TODAY)
    expect(made.rules).toHaveLength(4)
    expect(made.timeEntries).toHaveLength(9)
    expect(made.statusUpdates?.map((update) => update.postedAt.slice(0, 10))).toEqual([
      shiftIsoDate('2026-01-09', days),
      shiftIsoDate('2026-01-14', days)
    ])
    expect(made.billings?.[0]).toMatchObject({
      from: shiftIsoDate('2026-01-04', days),
      to: shiftIsoDate('2026-01-10', days)
    })
    expect(made.baselines).toHaveLength(1)
    expect(made.taskLinks).toHaveLength(2)
    expect(made.contacts).toHaveLength(3)
    expect(made.iterations).toHaveLength(4)
    expect(made.taskTemplates?.map((template) => template.name)).toEqual(['Snag'])
    expect(made.columns).toMatchObject({ hidden: [] })
    // Relative dates count from today, as in any template.
    expect(
      planning
        .listMilestones(project.id)
        .map((milestone) => milestone.targetDate)
        .sort()
    ).toEqual([shiftIsoDate(TODAY, -6), shiftIsoDate(TODAY, 6), shiftIsoDate(TODAY, 21)])
  })

  it('leaves the history out of other templates', async () => {
    const { project } = await service.createProjectFromTemplate('sample', {}, TODAY)
    const made = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(made.timeEntries).toBeUndefined()
    expect(made.rules).toBeUndefined()
  })
})

describe('exportProjectAsPackage', () => {
  it('round trips: export, create, export again gives an equal package apart from ids and dates', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    vi.setSystemTime(new Date(2026, 9, 20, 10, 0))
    const { project: copy } = await service.createProjectFromPackage(first, {}, '2026-10-20')
    const second = service.exportProjectAsPackage(copy.id, { kind: 'export', relativeDates: false })
    // The task prefix (N9.8a) travels, but the original still has it: the copy's has a letter more.
    expect([first.project.taskPrefix, second.project.taskPrefix]).toEqual(['PAR', 'PART'])
    second.project.taskPrefix = first.project.taskPrefix
    expect(comparable(second)).toEqual(comparable(first))
    expect(first.tasks.find((task) => task.title === 'Book the hall')!.checklist).toEqual([
      { text: 'Call the hall', checked: true },
      { text: 'Pay the deposit', checked: false }
    ])
  })

  it('keeps the manual order through export and import, and a template keeps its own (D31)', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const titles = (projectId: string) =>
      planning.listWorkItems(projectId).map((item) => item.title)
    // The file's order, not the order parents and dependencies were made in.
    expect(titles(project.id)).toEqual(PARTY.tasks.map((task) => task.title))
    const items = planning.listWorkItems(project.id)
    const plants = items.find((item) => item.title === 'Water the plants')!
    planning.moveWorkItemInOrder(plants.id, { beforeId: items[0].id }, { kind: 'human' })
    const moved = titles(project.id)
    expect(moved[0]).toBe('Water the plants')

    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(exported.tasks.map((task) => task.title)).toEqual(moved)
    const { project: copy } = await service.createProjectFromPackage(exported, {}, TODAY)
    expect(titles(copy.id)).toEqual(moved)
  })

  it('carries show-from dates and Someday through export, import and templates (N1.1a)', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const items = planning.listWorkItems(project.id)
    const hall = items.find((item) => item.title === 'Book the hall')!
    const invites = items.find((item) => item.title === 'Send invites')!
    planning.updateWorkItem(hall.id, { showFrom: '2026-10-12' }, planning.humanActor())
    planning.updateWorkItem(invites.id, { someday: true }, planning.humanActor())

    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    const byTitle = (title: string) => exported.tasks.find((task) => task.title === title)!
    expect(byTitle('Book the hall').showFrom).toBe('2026-10-12')
    expect(byTitle('Send invites').someday).toBe(true)
    expect(byTitle('Plan the food')).not.toHaveProperty('showFrom')
    expect(byTitle('Plan the food')).not.toHaveProperty('someday')

    const { project: copy } = await service.createProjectFromPackage(exported, {}, TODAY)
    const copied = planning.listWorkItems(copy.id)
    expect(copied.find((item) => item.title === 'Book the hall')!.showFrom).toBe('2026-10-12')
    expect(copied.find((item) => item.title === 'Send invites')!.someday).toBe(true)

    const template = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true
    })
    expect(template.tasks.find((task) => task.title === 'Book the hall')!.showFrom).toBe('+3d')
    expect(template.tasks.find((task) => task.title === 'Send invites')!.someday).toBe(true)
  })

  it('carries take turns through export, import and templates, people by ref (N2.3)', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const plants = planning.listWorkItems(project.id).find((t) => t.title === 'Water the plants')!
    const sam = people.list().find((person) => person.name === 'Sam Rivera')!
    const jo = people.list().find((person) => person.name === 'Jo Park')!
    const before = planning.getRecurrence(plants.id)!
    planning.setRecurrence(
      plants.id,
      { rule: before.rule, endsOn: before.endsOn, rotation: [jo.id, sam.id], nextIndex: 1 },
      planning.humanActor()
    )

    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    const recurrence = exported.tasks.find((task) => task.title === 'Water the plants')!.recurrence!
    const refOf = (name: string) => exported.people.find((person) => person.name === name)!.ref
    expect(recurrence.rotationRefs).toEqual([refOf('Jo Park'), refOf('Sam Rivera')])
    expect(recurrence.nextIndex).toBe(1)
    expect(exported.tasks.find((task) => task.title === 'Book the hall')!.recurrence).toBeNull()
    const template = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true
    })
    expect(
      template.tasks.find((task) => task.title === 'Water the plants')!.recurrence
    ).toMatchObject({ rotationRefs: recurrence.rotationRefs, nextIndex: 1 })

    for (const pkg of [exported, template]) {
      const { project: copy } = await service.createProjectFromPackage(
        packageOf(JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>),
        {},
        TODAY
      )
      const copied = planning.listWorkItems(copy.id).find((t) => t.title === 'Water the plants')!
      // Matched by name, so the same two people, in the same order.
      expect(planning.getRecurrence(copied.id)).toMatchObject({
        rotation: [jo.id, sam.id],
        nextIndex: 1
      })
    }
  })

  it('refuses take turns naming a person the file does not have', () => {
    expect(() =>
      packageOf({
        project: { name: 'Bins' },
        tasks: [
          {
            ref: 't1',
            title: 'Bins out',
            dueDate: '+1d',
            recurrence: { rule: { every: 'week', interval: 1 }, rotationRefs: ['p9'] }
          }
        ]
      })
    ).toThrow('p9')
  })

  it('makes a template: relative dates, no completed state, no comments', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.updateWorkItem(hall.id, { status: 'done' }, planning.humanActor())
    planning.addComment(hall.id, 'Booked!', planning.humanActor())

    const template = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true
    })
    const exported = template.tasks.find((task) => task.title === 'Book the hall')!
    expect(exported.status).toBe('backlog')
    expect(exported.checklist.every((entry) => !entry.checked)).toBe(true)
    expect(exported.dueDate).toBe('+7d')
    expect(template.comments).toEqual([])
    expect(template.milestones[0].targetDate).toBe('+14d')
  })

  it('leaves out what is not included', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const pkg = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true,
      include: { people: false, decisions: false, library: false, milestones: false }
    })
    expect(pkg.people).toEqual([])
    expect(pkg.decisions).toEqual([])
    expect(pkg.library).toEqual([])
    expect(pkg.milestones).toEqual([])
    expect(pkg.tasks.every((task) => task.assigneeRef === null && task.milestoneRef === null)).toBe(
      true
    )
    expect(validateProjectPackage(pkg).ok).toBe(true)
  })
})

describe('custom fields in the project file (R2.2)', () => {
  async function partyWithFields() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const size = planning.createField(project.id, {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small', color: '#22c55e' }, { name: 'Large' }]
    })
    const venue = planning.createField(project.id, { name: 'Venue ready', type: 'date' })
    const tags = planning.createField(project.id, {
      name: 'Teams',
      type: 'choices',
      options: [{ name: 'Food' }, { name: 'Music' }]
    })
    const cost = planning.createField(project.id, { name: 'Cost', type: 'number' })
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.updateWorkItem(
      hall.id,
      {
        fieldValues: {
          [size.id]: size.options[1].id,
          [venue.id]: '2026-10-25',
          [tags.id]: [tags.options[0].id, tags.options[1].id],
          [cost.id]: 120.5
        }
      },
      planning.humanActor()
    )
    return project
  }

  it('carries definitions and values through export and import', async () => {
    const project = await partyWithFields()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    expect(first.fields!.map((field) => [field.ref, field.name, field.type])).toEqual([
      ['f1', 'Size', 'choice'],
      ['f2', 'Venue ready', 'date'],
      ['f3', 'Teams', 'choices'],
      ['f4', 'Cost', 'number']
    ])
    expect(first.tasks.find((task) => task.title === 'Book the hall')!.fieldValues).toEqual({
      f1: 'o2',
      f2: '2026-10-25',
      f3: ['o1', 'o2'],
      f4: 120.5
    })
    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const second = service.exportProjectAsPackage(copy.id, { kind: 'export', relativeDates: false })
    // The task prefix (N9.8a) travels, but the original still has it: the copy's has a letter more.
    expect([first.project.taskPrefix, second.project.taskPrefix]).toEqual(['PAR', 'PART'])
    second.project.taskPrefix = first.project.taskPrefix
    expect(comparable(second)).toEqual(comparable(first))
    expect(planning.listFields(copy.id)[0].options[0].color).toBe('#22c55e')
  })

  it('a saved template carries them too, with a date value relative to the day it is used', async () => {
    const project = await partyWithFields()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Fields party' })
    const pkg = service.getTemplatePackage(saved.id)
    const hall = pkg.tasks.find((task) => task.title === 'Book the hall')!
    const relative = String(hall.fieldValues!.f2)
    expect(relative).toMatch(/^[+-]\d+d$/)
    const { project: reused } = await service.createProjectFromTemplate(saved.id, {}, '2026-11-01')
    const field = planning.listFields(reused.id).find((entry) => entry.name === 'Venue ready')!
    const item = planning.listWorkItems(reused.id).find((entry) => entry.title === 'Book the hall')!
    expect(item.fieldValues![field.id]).toBe(resolvePackageDate(relative, '2026-11-01'))
  })

  it('refuses a value that names no option of its field', () => {
    const result = validateProjectPackage({
      ...PARTY,
      fields: [{ ref: 'f1', name: 'Size', type: 'choice', options: [{ ref: 'o1', name: 'S' }] }],
      tasks: [{ ...PARTY.tasks[0], fieldValues: { f1: 'o9' } }, ...PARTY.tasks.slice(1)]
    })
    expect(result.ok).toBe(false)
  })
})

describe('time entries in the project file (R2.3)', () => {
  async function partyWithTime() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.time.create(project.id, {
      workItemId: hall.id,
      startedAt: Date.UTC(2026, 9, 12, 8, 30),
      durationSeconds: 5400,
      note: 'Called the venue'
    })
    planning.time.startTimer(project.id, hall.id)
    return { project, hall }
  }

  it('carries finished entries through export and import, but not a running timer', async () => {
    const { project } = await partyWithTime()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    expect(first.timeEntries).toEqual([
      {
        taskRef: expect.any(String),
        personRef: expect.any(String),
        startedAt: '2026-10-12T08:30:00.000Z',
        durationSeconds: 5400,
        note: 'Called the venue',
        source: 'manual'
      }
    ])
    planning.time.stopTimer()
    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const entries = planning.time.listForProject(copy.id)
    expect(entries.map((entry) => [entry.workItemTitle, entry.durationSeconds])).toEqual([
      ['Book the hall', 5400]
    ])
  })

  it('a template carries none', async () => {
    const { project } = await partyWithTime()
    planning.time.stopTimer()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Timed party' })
    expect(service.getTemplatePackage(saved.id).timeEntries).toBeUndefined()
    const withEntries = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    const { project: fromFile } = await service.createProjectFromPackage(
      withEntries,
      { templateName: 'Party' },
      TODAY
    )
    expect(planning.time.listForProject(fromFile.id)).toEqual([])
  })

  it('refuses an entry with a bad duration or a task it does not have', () => {
    const entry = {
      taskRef: PARTY.tasks[0].ref,
      startedAt: '2026-10-12T08:30:00Z',
      durationSeconds: 60
    }
    expect(validateProjectPackage({ ...PARTY, timeEntries: [entry] }).ok).toBe(true)
    expect(
      validateProjectPackage({ ...PARTY, timeEntries: [{ ...entry, durationSeconds: 0 }] }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({ ...PARTY, timeEntries: [{ ...entry, taskRef: 'zz' }] }).ok
    ).toBe(false)
  })
})

describe('GitHub links in the project file (R4.4)', () => {
  async function partyWithLinks() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.githubLinks.add(project.id, hall.id, {
      owner: 'acme',
      repo: 'party',
      number: 7,
      kind: null,
      fetched: { kind: 'pull', title: 'Cached title', state: 'merged', fetchedAt: 5 }
    })
    return { project, hall }
  }

  it('carries links through export and import, without the cached title and state', async () => {
    const { project } = await partyWithLinks()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    expect(first.githubLinks).toEqual([
      { taskRef: expect.any(String), url: 'https://github.com/acme/party/pull/7' }
    ])
    expect(JSON.stringify(first)).not.toContain('Cached title')
    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const hall = planning.listWorkItems(copy.id).find((item) => item.title === 'Book the hall')!
    expect(hall.githubLinks).toEqual([
      expect.objectContaining({
        owner: 'acme',
        repo: 'party',
        number: 7,
        kind: 'pull',
        title: '',
        state: null,
        fetchedAt: null
      })
    ])
  })

  it('a template carries none', async () => {
    const { project } = await partyWithLinks()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Linked party' })
    expect(service.getTemplatePackage(saved.id).githubLinks).toBeUndefined()
  })

  it('refuses a link that is not a github.com issue or pull request, or names no task', () => {
    const link = { taskRef: PARTY.tasks[0].ref, url: 'https://github.com/acme/party/issues/3' }
    expect(validateProjectPackage({ ...PARTY, githubLinks: [link] }).ok).toBe(true)
    expect(
      validateProjectPackage({
        ...PARTY,
        githubLinks: [{ ...link, url: 'https://gitlab.com/acme/party/issues/3' }]
      }).ok
    ).toBe(false)
    expect(validateProjectPackage({ ...PARTY, githubLinks: [{ ...link, taskRef: 'zz' }] }).ok).toBe(
      false
    )
  })
})

describe('Links between tasks in the project file (N2.4)', () => {
  const human = { kind: 'human' as const }

  it('keeps links within the file and drops a link to a task left out', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const [first, second, third] = planning.listWorkItems(project.id)
    planning.addWorkItemLink(second.id, first.id, 'duplicates', human)
    planning.addWorkItemLink(first.id, third.id, 'relates', human)
    // The third task goes to the recycle bin, so the file leaves it out.
    planning.moveWorkItemToBin(third.id, human)

    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    expect(validateProjectPackage(pkg).ok).toBe(true)
    expect(pkg.taskLinks).toHaveLength(1)
    expect(pkg.taskLinks![0].kind).toBe('duplicates')

    const { project: copy } = await service.createProjectFromPackage(pkg, {}, TODAY)
    const byTitle = new Map(planning.listWorkItems(copy.id).map((item) => [item.title, item]))
    const links = planning.listWorkItemLinks(byTitle.get(second.title)!.id)
    expect(links.map((link) => [link.role, link.otherTitle])).toEqual([
      ['duplicate-of', first.title]
    ])
  })

  it('a template carries none', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const [first, second] = planning.listWorkItems(project.id)
    planning.addWorkItemLink(first.id, second.id, 'relates', human)
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Linked tasks' })
    expect(service.getTemplatePackage(saved.id).taskLinks).toBeUndefined()
  })

  it('drops links naming a task not in the file, a task itself, an unknown kind or a pair twice', () => {
    const [a, b] = PARTY.tasks.map((task) => task.ref)
    const result = validateProjectPackage({
      ...PARTY,
      taskLinks: [
        { fromRef: a, toRef: b, kind: 'relates' },
        { fromRef: b, toRef: a, kind: 'relates' },
        { fromRef: a, toRef: 'zz', kind: 'relates' },
        { fromRef: a, toRef: a, kind: 'duplicates' },
        { fromRef: a, toRef: b, kind: 'blocks' }
      ]
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.value.taskLinks).toEqual([{ fromRef: a, toRef: b, kind: 'relates' }])
  })
})

describe('saved templates', () => {
  it('saves a project as a template, and a new project can start from it', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const saved = service.saveProjectAsTemplate(project.id, {
      name: 'Our party',
      description: 'How we plan parties'
    })
    expect(saved).toMatchObject({ source: 'saved', name: 'Our party', taskCount: 6 })
    expect(fs.existsSync(path.join(tempDir, 'templates', `${saved.id}.json`))).toBe(true)
    expect(service.listTemplates().map((entry) => entry.name)).toContain('Our party')

    const { project: reused } = await service.createProjectFromTemplate(saved.id, {}, TODAY)
    expect(reused.name).toBe('Our party')
    expect(planning.listWorkItems(reused.id)).toHaveLength(6)
  })

  it('renames, deletes and restores a saved template', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Our party' })
    expect(service.renameTemplate(saved.id, 'Parties').name).toBe('Parties')
    const removed = service.deleteTemplate(saved.id)
    expect(service.listTemplates().some((entry) => entry.id === saved.id)).toBe(false)
    service.restoreTemplate(saved.id, removed)
    expect(service.listTemplates().find((entry) => entry.id === saved.id)?.name).toBe('Parties')
  })

  it('refuses to export, as a file or a package, or save as a template a project too large to import again', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    for (let index = 0; index < 130; index += 1)
      planning.createWorkItem(
        project.id,
        { title: `Long ${index}`, description: 'x'.repeat(8000) },
        planning.humanActor()
      )
    const target = path.join(tempDir, 'big.ostler-project')
    expect(() => service.exportProjectFile(project.id, target)).toThrow(/1 MB/)
    expect(fs.existsSync(target)).toBe(false)
    // The package the automation API's export returns is checked the same way.
    expect(() =>
      service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    ).toThrow(/1 MB/)
    expect(() => service.saveProjectAsTemplate(project.id, { name: 'Big' })).toThrow(/1 MB/)
    expect(fs.existsSync(path.join(tempDir, 'templates'))).toBe(false)
  })

  it('refuses to change a built-in template', () => {
    expect(() => service.renameTemplate('sample', 'Mine')).toThrow('Template not found')
    expect(() => service.deleteTemplate('event-planning')).toThrow('Template not found')
  })
})

describe('columns in the project file (R2.4)', () => {
  it('carries names and hidden columns through export and import', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    planning.columns.update(
      project.id,
      { names: { backlog: 'To do', active: 'Doing' }, hidden: ['blocked', 'review'] },
      { agentsLocked: false }
    )
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.columns).toEqual({
      names: { backlog: 'To do', active: 'Doing' },
      hidden: ['blocked', 'review']
    })
    expect(validateProjectPackage(file).ok).toBe(true)
    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    expect(planning.columns.get(copy.id)).toEqual(file.columns)
    // A saved template keeps them too.
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Our party' })
    expect(service.getTemplatePackage(saved.id).columns).toEqual(file.columns)
  })

  it('leaves the standard columns out of the file', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.columns).toBeUndefined()
  })

  it('shows a hidden column a task in the file is in', async () => {
    // PARTY has a task in Ready.
    const { project } = await service.createProjectFromPackage(
      { ...PARTY, columns: { names: {}, hidden: ['ready', 'blocked'] } },
      {},
      TODAY
    )
    expect(planning.columns.get(project.id).hidden).toEqual(['blocked'])
  })

  it('built-in templates that are not software hide the columns their tasks never use', async () => {
    const hidden: Record<string, string[]> = {}
    for (const id of [
      'blank',
      'software-project',
      'website-launch',
      'marketing-campaign',
      'event-planning',
      'content-calendar',
      'product-launch',
      'moving-house',
      'study-plan'
    ]) {
      const { project } = await service.createProjectFromTemplate(id, {}, TODAY)
      hidden[id] = planning.columns.get(project.id).hidden
    }
    expect(hidden).toEqual({
      blank: [],
      'software-project': [],
      'website-launch': [],
      'marketing-campaign': ['ready'],
      'event-planning': ['ready', 'review'],
      'content-calendar': ['ready', 'blocked'],
      'product-launch': ['ready'],
      'moving-house': ['ready', 'review'],
      'study-plan': ['ready', 'blocked', 'review']
    })
  })

  it('refuses columns that always show, or a name that is too long', () => {
    expect(validateProjectPackage({ ...PARTY, columns: { hidden: ['done'] } }).ok).toBe(false)
    expect(
      validateProjectPackage({ ...PARTY, columns: { names: { backlog: 'x'.repeat(41) } } }).ok
    ).toBe(false)
    expect(validateProjectPackage({ ...PARTY, columns: { names: { later: 'Soon' } } }).ok).toBe(
      false
    )
  })
})

describe('Iterations in the project file (R6.1)', () => {
  async function partyWithIterations() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const one = planning.iterations.create(project.id, {
      name: 'Week one',
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      goal: 'Book it'
    })
    const two = planning.iterations.create(project.id, {
      name: 'Week two',
      startDate: '2026-10-12',
      endDate: '2026-10-18'
    })
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    const invites = planning
      .listWorkItems(project.id)
      .find((item) => item.title === 'Send invites')!
    planning.updateWorkItem(hall.id, { iterationId: one.id, status: 'done' }, { kind: 'human' })
    planning.updateWorkItem(invites.id, { iterationId: one.id }, { kind: 'human' })
    planning.iterations.start(one.id)
    planning.iterations.finish(one.id, 'next', { kind: 'human' })
    return { project, one, two }
  }

  it('carries iterations, their summaries and task membership through export and import', async () => {
    const { project } = await partyWithIterations()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    expect(first.iterations?.map((i) => [i.name, i.status, i.summary?.doneCount ?? null])).toEqual([
      ['Week one', 'finished', 1],
      ['Week two', 'planned', null]
    ])
    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const iterations = planning.iterations.list(copy.id)
    expect(iterations.map((i) => [i.name, i.status, i.goal])).toEqual([
      ['Week one', 'finished', 'Book it'],
      ['Week two', 'planned', '']
    ])
    const byTitle = new Map(planning.listWorkItems(copy.id).map((item) => [item.title, item]))
    expect(byTitle.get('Book the hall')?.iterationId).toBe(iterations[0].id)
    expect(byTitle.get('Send invites')?.iterationId).toBe(iterations[1].id)
    expect(byTitle.get('Plan the food')?.iterationId).toBeNull()
  })

  it('a template keeps only the unfinished iterations, as planned', async () => {
    const { project } = await partyWithIterations()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Sprinted party' })
    const template = service.getTemplatePackage(saved.id)
    expect(template.iterations?.map((i) => [i.name, i.status, i.summary])).toEqual([
      ['Week two', 'planned', null]
    ])
  })

  it('leaves iterations out of a project without any', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    expect(pkg.iterations).toBeUndefined()
    expect(pkg.tasks.every((task) => task.iterationRef === undefined)).toBe(true)
  })

  it('refuses a task naming an iteration the file does not have', () => {
    const iteration = { ref: 'i1', name: 'One', startDate: '+0d', endDate: '+13d' }
    const tasks = [{ ...PARTY.tasks[0], iterationRef: 'i1' }]
    expect(validateProjectPackage({ ...PARTY, iterations: [iteration], tasks }).ok).toBe(true)
    expect(
      validateProjectPackage({ ...PARTY, tasks: [{ ...PARTY.tasks[0], iterationRef: 'i9' }] }).ok
    ).toBe(false)
  })
})

describe('Won’t do in the project file (N1.2)', () => {
  it('carries a won’t-do task, its mark and reason, through export and import', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.closeWorkItemsAsWontDo([hall.id], 'Using the garden', { kind: 'human' })

    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    expect(validateProjectPackage(pkg).ok).toBe(true)
    const exported = pkg.tasks.find((task) => task.title === 'Book the hall')!
    expect(exported).toMatchObject({ resolution: 'wont-do', resolutionReason: 'Using the garden' })
    expect(pkg.tasks.filter((task) => task.resolution).length).toBe(1)

    const { project: copy } = await service.createProjectFromPackage(pkg, {}, TODAY)
    expect(planning.listWorkItems(copy.id).map((item) => item.title)).not.toContain('Book the hall')
    expect(planning.listWorkItems(copy.id, 'archived')).toEqual([
      expect.objectContaining({
        title: 'Book the hall',
        resolution: 'wont-do',
        resolutionReason: 'Using the garden'
      })
    ])
  })

  it('refuses a done task marked won’t do, and a resolution it does not know', () => {
    const task = PARTY.tasks[0]
    expect(
      validateProjectPackage({ ...PARTY, tasks: [{ ...task, resolution: 'wont-do' }] }).ok
    ).toBe(true)
    expect(
      validateProjectPackage({
        ...PARTY,
        tasks: [{ ...task, status: 'done', resolution: 'wont-do' }]
      }).ok
    ).toBe(false)
    expect(
      validateProjectPackage({ ...PARTY, tasks: [{ ...task, resolution: 'obsolete' }] }).ok
    ).toBe(false)
  })
})

describe('Rules in the project file (R6.2)', () => {
  async function partyWithRules() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const milestone = planning.listMilestones(project.id)[0]
    const person = planning.listWorkItems(project.id).find((item) => item.assigneeId)!.assigneeId!
    planning.rules.create(project.id, {
      name: 'Hand over',
      enabled: false,
      trigger: { kind: 'statusChanged', to: 'review' },
      conditions: [{ kind: 'milestone', op: 'is', milestoneId: milestone.id }],
      actions: [
        { kind: 'setAssignee', personId: person },
        { kind: 'addComment', text: 'Over to you.' }
      ]
    })
    return { project, milestone, person }
  }

  it('carries rules through export and import, with refs for ids', async () => {
    const { project, milestone } = await partyWithRules()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    expect(first.rules).toHaveLength(1)
    expect(JSON.stringify(first.rules)).not.toContain(milestone.id)
    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const [rule] = planning.rules.list(copy.id)
    const copiedMilestone = planning.listMilestones(copy.id)[0]
    const copiedPerson = planning.listWorkItems(copy.id).find((item) => item.assigneeId)!.assigneeId
    expect(rule).toMatchObject({
      name: 'Hand over',
      enabled: false,
      trigger: { kind: 'statusChanged', to: 'review' },
      conditions: [{ kind: 'milestone', op: 'is', milestoneId: copiedMilestone.id }],
      actions: [
        { kind: 'setAssignee', personId: copiedPerson },
        { kind: 'addComment', text: 'Over to you.' }
      ]
    })
  })

  it('a template carries none', async () => {
    const { project } = await partyWithRules()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Ruled party' })
    expect(service.getTemplatePackage(saved.id).rules).toBeUndefined()
  })

  it('leaves out a rule naming something the file does not carry', async () => {
    const { project } = await partyWithRules()
    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    const rule = {
      ...pkg.rules![0],
      conditions: [{ kind: 'milestone', op: 'is', milestoneId: 'm99' }]
    }
    const { project: copy } = await service.createProjectFromPackage(
      { ...pkg, rules: [rule] } as ProjectPackage,
      {},
      TODAY
    )
    expect(planning.rules.list(copy.id)).toEqual([])
  })

  it('refuses a rule that is not one', () => {
    expect(validateProjectPackage({ ...PARTY, rules: [{ name: 'Empty', actions: [] }] }).ok).toBe(
      false
    )
  })
})

describe('Task templates in the project file (N2.1)', () => {
  async function partyWithTaskTemplates() {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const person = planning.listWorkItems(project.id).find((item) => item.assigneeId)!.assigneeId!
    const size = planning.createField(project.id, {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small' }, { name: 'Large' }]
    })
    const ready = planning.createField(project.id, { name: 'Ready by', type: 'date' })
    planning.taskTemplates.save({
      name: 'Invoice run',
      projectId: project.id,
      body: {
        title: 'Send invoices',
        checklist: ['Export', 'Send'],
        assigneeId: person,
        dueDate: '+3d',
        fieldValues: { [size.id]: size.options[1].id, [ready.id]: '+2d' },
        subtasks: [{ title: 'Export the hours' }]
      }
    })
    planning.taskTemplates.save({ name: 'Bug report', projectId: null, body: { title: 'Bug' } })
    return { project, person }
  }

  it('carries a project’s own templates through export and import, with refs for ids', async () => {
    const { project, person } = await partyWithTaskTemplates()
    const first = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(first).ok).toBe(true)
    // Only the project's own: a template for every project stays where it is.
    expect(first.taskTemplates!.map((tpl) => tpl.name)).toEqual(['Invoice run'])
    const [saved] = first.taskTemplates!
    expect(JSON.stringify(saved)).not.toContain(person)
    expect(saved.body).toMatchObject({ assigneeId: null, fieldValues: {}, dueDate: '+3d' })
    expect(saved.fieldValues).toEqual({ f1: 'o2', f2: '+2d' })

    const { project: copy } = await service.createProjectFromPackage(first, {}, TODAY)
    const [copied] = planning.taskTemplates.listOwn(copy.id)
    const fields = planning.listFields(copy.id)
    const size = fields.find((field) => field.name === 'Size')!
    const ready = fields.find((field) => field.name === 'Ready by')!
    expect(copied).toMatchObject({ name: 'Invoice run', projectId: copy.id })
    expect(copied.body).toMatchObject({
      title: 'Send invoices',
      checklist: ['Export', 'Send'],
      assigneeId: planning.listWorkItems(copy.id).find((item) => item.assigneeId)!.assigneeId,
      dueDate: '+3d',
      fieldValues: { [size.id]: size.options[1].id, [ready.id]: '+2d' },
      subtasks: [{ title: 'Export the hours', description: '', checklist: [] }]
    })
    const second = service.exportProjectAsPackage(copy.id, { kind: 'export', relativeDates: false })
    expect(second.taskTemplates).toEqual(first.taskTemplates)
  })

  it('travels in a project template unless left out', async () => {
    const { project } = await partyWithTaskTemplates()
    const saved = service.saveProjectAsTemplate(project.id, { name: 'With templates' })
    expect(service.getTemplatePackage(saved.id).taskTemplates).toHaveLength(1)
    const { project: reused } = await service.createProjectFromTemplate(saved.id, {}, TODAY)
    expect(planning.taskTemplates.listOwn(reused.id).map((tpl) => tpl.name)).toEqual([
      'Invoice run'
    ])
    const without = service.saveProjectAsTemplate(project.id, {
      name: 'Without',
      include: { taskTemplates: false }
    })
    expect(service.getTemplatePackage(without.id).taskTemplates).toBeUndefined()
  })

  it('carries a playbook and its agent part through the project file and project templates (N9.6b)', async () => {
    const { project } = await partyWithTaskTemplates()
    const agent = {
      model: 'claude-haiku-5-5',
      effort: 'low',
      planFirst: 'yes',
      instructions: 'Run `npm outdated` first.'
    }
    planning.taskTemplates.save({
      name: 'Update dependencies',
      projectId: project.id,
      body: { title: 'Update the dependencies', agent },
      playbook: true
    })
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(file).ok).toBe(true)
    const saved = file.taskTemplates!.find((tpl) => tpl.name === 'Update dependencies')!
    expect(saved).toMatchObject({ playbook: true, body: { agent } })
    expect(file.taskTemplates!.find((tpl) => tpl.name === 'Invoice run')).not.toHaveProperty(
      'playbook'
    )

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copied = planning.taskTemplates
      .listOwn(copy.id)
      .find((tpl) => tpl.name === 'Update dependencies')!
    expect(copied).toMatchObject({ playbook: true, body: { agent } })
    expect(
      planning.taskTemplates.listOwn(copy.id).find((tpl) => tpl.name === 'Invoice run')
    ).toMatchObject({ playbook: false })

    const template = service.saveProjectAsTemplate(project.id, { name: 'With a playbook' })
    const { project: reused } = await service.createProjectFromTemplate(template.id, {}, TODAY)
    expect(
      planning.taskTemplates.listOwn(reused.id).find((tpl) => tpl.name === 'Update dependencies')
    ).toMatchObject({ playbook: true, body: { agent } })

    expect(
      validateProjectPackage({
        ...PARTY,
        taskTemplates: [{ name: 'Odd', body: { title: 'x' }, playbook: 'yes' }]
      }).ok
    ).toBe(false)
  })

  it('refuses a template whose body is wrong, or that names a person the file lacks', () => {
    const check = (taskTemplates: unknown[]) =>
      validateProjectPackage({ ...PARTY, taskTemplates }).ok
    expect(check([{ name: 'Bad', body: { title: 'x', dueDate: '2026-10-10' } }])).toBe(false)
    expect(check([{ name: 'Nobody', body: { title: 'x' }, assigneeRef: 'p9' }])).toBe(false)
    expect(check([{ name: 'Inline', body: { title: 'x', assigneeId: 'abc' } }])).toBe(false)
    expect(
      check([
        { name: 'Twice', body: { title: 'x' } },
        { name: 'twice', body: { title: 'y' } }
      ])
    ).toBe(false)
    expect(check([{ name: 'Fine', body: { title: 'x' }, assigneeRef: 'p1' }])).toBe(true)
  })
})

describe('checklist item dates and people (N2.2)', () => {
  it('carries them through export and import, by ref, and a template keeps them relative', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const items = planning.listWorkItems(project.id)
    const hall = items.find((item) => item.title === 'Book the hall')!
    const food = items.find((item) => item.title === 'Plan the food')!
    planning.setChecklistItemDetails(
      hall.id,
      'Pay the deposit',
      { dueDate: '2026-10-12', assigneeId: food.assigneeId },
      planning.humanActor()
    )

    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(exported).ok).toBe(true)
    const checklist = exported.tasks.find((task) => task.title === 'Book the hall')!.checklist
    const joRef = exported.tasks.find((task) => task.title === 'Plan the food')!.assigneeRef
    expect(checklist).toEqual([
      { text: 'Call the hall', checked: true },
      { text: 'Pay the deposit', checked: false, dueDate: '2026-10-12', assigneeRef: joRef }
    ])

    const { project: copy } = await service.createProjectFromPackage(exported, {}, TODAY)
    const copied = planning.listWorkItems(copy.id)
    const copiedHall = copied.find((item) => item.title === 'Book the hall')!
    expect(copiedHall.checkedCriteria).toEqual(['Call the hall'])
    expect(copiedHall.checklistDetails).toEqual([
      {
        text: 'Pay the deposit',
        dueDate: '2026-10-12',
        assigneeId: copied.find((item) => item.title === 'Plan the food')!.assigneeId
      }
    ])

    const template = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true
    })
    expect(template.tasks.find((task) => task.title === 'Book the hall')!.checklist[1]).toEqual({
      text: 'Pay the deposit',
      checked: false,
      dueDate: '+3d',
      assigneeRef: expect.any(String)
    })
  })

  it('carries a task template’s item dates and people, with people by ref', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const findSam = (projectId: string) =>
      planning.listWorkItems(projectId).find((item) => item.title === 'Book the hall')!.assigneeId!
    const sam = findSam(project.id)
    planning.taskTemplates.save({
      name: 'Party prep',
      projectId: project.id,
      body: {
        title: 'Prep',
        checklist: ['Confirm caterer', 'Send invitations'],
        checklistDetails: [
          { text: 'Confirm caterer', dueDate: '+2d', assigneeId: sam },
          { text: 'Send invitations', dueDate: null, assigneeId: sam }
        ]
      }
    })
    const exported = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(validateProjectPackage(exported).ok).toBe(true)
    const [saved] = exported.taskTemplates!
    expect(JSON.stringify(saved)).not.toContain(sam)
    expect(saved.body.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '+2d', assigneeId: null }
    ])
    expect(Object.keys(saved.checklistAssigneeRefs!)).toEqual([
      'Confirm caterer',
      'Send invitations'
    ])

    const { project: copy } = await service.createProjectFromPackage(exported, {}, TODAY)
    const samCopy = findSam(copy.id)
    const [copied] = planning.taskTemplates.listOwn(copy.id)
    expect(copied.body.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '+2d', assigneeId: samCopy },
      { text: 'Send invitations', dueDate: null, assigneeId: samCopy }
    ])
  })

  it('refuses an item naming a person the file lacks', () => {
    const withItem = (item: object) =>
      validateProjectPackage({ ...PARTY, tasks: [{ ref: 't1', title: 'x', checklist: [item] }] }).ok
    expect(withItem({ text: 'a', assigneeRef: 'p9' })).toBe(false)
    expect(withItem({ text: 'a', dueDate: 'soon' })).toBe(false)
    expect(withItem({ text: 'a', dueDate: '+1d', assigneeRef: 'p1' })).toBe(true)
  })
})

describe('Task types in the project file and templates (N2.7a)', () => {
  it("carries types, in order, and each task's type through export and import", async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const errand = planning.taskTypes.create(project.id, { name: 'Errand', icon: 'car' })
    planning.taskTypes.create(project.id, { name: 'Call', icon: 'phone', color: '#10b981' })
    const hall = planning.listWorkItems(project.id).find((item) => item.title === 'Book the hall')!
    planning.updateWorkItem(hall.id, { typeId: errand.id }, { kind: 'human' })

    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    expect(validateProjectPackage(pkg).ok).toBe(true)
    expect(pkg.taskTypes?.map((type) => [type.name, type.icon])).toEqual([
      ['Errand', 'car'],
      ['Call', 'phone']
    ])

    const { project: copy } = await service.createProjectFromPackage(pkg, {}, TODAY)
    const types = planning.taskTypes.list(copy.id)
    expect(types.map((type) => [type.name, type.icon, type.color])).toEqual([
      ['Errand', 'car', errand.color],
      ['Call', 'phone', '#10b981']
    ])
    const byTitle = new Map(planning.listWorkItems(copy.id).map((item) => [item.title, item]))
    expect(byTitle.get('Book the hall')?.typeId).toBe(types[0].id)
    expect(byTitle.get('Plan the food')?.typeId).toBeNull()

    // A saved template keeps them too.
    const saved = service.saveProjectAsTemplate(project.id, { name: 'Typed party' })
    expect(service.getTemplatePackage(saved.id).taskTypes?.map((type) => type.name)).toEqual([
      'Errand',
      'Call'
    ])
  })

  it('refuses a task naming a type the file does not have, and a name listed twice', () => {
    const taskTypes = [{ ref: 'y1', name: 'Bug', icon: 'bug', color: '#ef4444' }]
    const tasks = [{ ...PARTY.tasks[0], typeRef: 'y1' }]
    expect(validateProjectPackage({ ...PARTY, taskTypes, tasks }).ok).toBe(true)
    expect(validateProjectPackage({ ...PARTY, tasks }).ok).toBe(false)
    expect(
      validateProjectPackage({ ...PARTY, taskTypes: [...taskTypes, { ref: 'y2', name: 'bug' }] }).ok
    ).toBe(false)
  })

  it('brings Bug, Feature and Chore with the software template, and no types with the others', async () => {
    const { project } = await service.createProjectFromTemplate('software-project', {}, TODAY)
    const types = planning.taskTypes.list(project.id)
    expect(types.map((type) => type.name)).toEqual(['Bug', 'Feature', 'Chore'])
    expect(planning.listWorkItems(project.id).some((item) => item.typeId === types[0].id)).toBe(
      true
    )
    for (const id of ['website-launch', 'moving-house', 'study-plan', 'blank']) {
      const { project: other } = await service.createProjectFromTemplate(id, {}, TODAY)
      expect(planning.taskTypes.list(other.id)).toEqual([])
    }
  })
})

describe('links in texts (N4.4a)', () => {
  const scheme = 'ostler'
  const url = (kind: string, projectId: string, id: string) =>
    `${scheme}://${kind}/${projectId}/${id}`

  it('points links at the new items when a project file is imported as a new project', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const tasks = planning.listWorkItems(project.id)
    const hall = tasks.find((task) => task.title === 'Book the hall')!
    const invites = tasks.find((task) => task.title === 'Send invites')!
    const milestone = planning.listMilestones(project.id).find((m) => m.name === 'Party day')!
    const decision = planning.listDecisions(project.id)[0]
    const note = library.listItems(project.id)[0]
    const elsewhere = url('task', '5a1d0f3e-0000-4000-8000-000000000009', hall.id)
    const me = planning.humanActor()
    planning.updateWorkItem(
      invites.id,
      {
        description: `After [the hall](${url('task', project.id, hall.id)}), see [far](${elsewhere})`
      },
      me
    )
    planning.addComment(hall.id, `For [day](${url('milestone', project.id, milestone.id)})`, me)
    planning.updateDecision(decision.id, {
      consequences: `[note](${url('library', project.id, note.id)})`
    })
    library.updateItem(project.id, note.id, {
      body: `[why](${url('decision', project.id, decision.id)})`
    })

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.linkIds?.projectId).toBe(project.id)
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)
    // Links travel as written.
    expect(file.tasks.find((task) => task.title === 'Send invites')!.description).toContain(hall.id)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copyTasks = planning.listWorkItems(copy.id)
    const newHall = copyTasks.find((task) => task.title === 'Book the hall')!
    const newInvites = copyTasks.find((task) => task.title === 'Send invites')!
    const newMilestone = planning.listMilestones(copy.id).find((m) => m.name === 'Party day')!
    const newDecision = planning.listDecisions(copy.id)[0]
    const newNote = library.listItems(copy.id)[0]

    expect(newInvites.description).toBe(
      `After [the hall](${url('task', copy.id, newHall.id)}), see [far](${elsewhere})`
    )
    expect(planning.listComments(newHall.id)[0].body).toBe(
      `For [day](${url('milestone', copy.id, newMilestone.id)})`
    )
    expect(newDecision.consequences).toBe(`[note](${url('library', copy.id, newNote.id)})`)
    expect(library.getItem(copy.id, newNote.id).body).toBe(
      `[why](${url('decision', copy.id, newDecision.id)})`
    )
    // The index follows: each new item knows what links to it; the old ones are untouched.
    const sources = (kind: 'task' | 'decision', id: string) =>
      planning.listLinkedFrom(kind, id).map((entry) => entry.sourceId)
    expect(sources('task', newHall.id)).toEqual([newInvites.id])
    expect(sources('decision', newDecision.id)).toEqual([newNote.id])
    expect(sources('task', hall.id)).toEqual([invites.id])
  })

  it('leaves out the ids when no text holds a link', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.linkIds).toBeUndefined()
  })
})

describe('pins in the project file (N5.2a)', () => {
  it('carries the Overview shortcuts to the new project, and never the sidebar pins', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const hall = planning.listWorkItems(project.id).find((task) => task.title === 'Book the hall')!
    const milestone = planning.listMilestones(project.id).find((m) => m.name === 'Party day')!
    const note = library.listItems(project.id)[0]
    planning.pins.create({ place: 'overview', kind: 'milestone', targetId: milestone.id })
    planning.pins.create({ place: 'overview', kind: 'library', targetId: note.id })
    planning.pins.create({
      place: 'overview',
      kind: 'project-view',
      targetId: 'board',
      projectId: project.id
    })
    planning.pins.create({ place: 'sidebar', kind: 'task', targetId: hall.id })

    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.pins!.map((pin) => pin.kind)).toEqual(['milestone', 'library', 'project-view'])
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const shortcuts = planning.pins.list({ place: 'overview', projectId: copy.id })
    expect(shortcuts.map((pin) => [pin.kind, pin.title ?? pin.targetId, pin.exists])).toEqual([
      ['milestone', 'Party day', true],
      ['library', note.title, true],
      ['project-view', 'board', true]
    ])
    expect(planning.pins.list({ place: 'sidebar', projectId: copy.id })).toEqual([])
  })

  it('leaves pins out when there are none, and drops malformed ones', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.pins).toBeUndefined()
    const checked = validateProjectPackage({
      ...JSON.parse(JSON.stringify(file)),
      pins: [
        { kind: 'task', index: 9999 },
        { kind: 'toString', index: 0 },
        { kind: 'project-view', viewId: 'Not a view' },
        { kind: 'task', index: 0 }
      ]
    })
    expect(checked.ok && checked.value.pins).toEqual([{ kind: 'task', index: 0 }])
  })
})

describe('Waits-on types and lag in the project file (N7.2a)', () => {
  const human = { kind: 'human' as const }

  it('carries each link’s type and lag through export, import and a template', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const byTitle = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    const hall = byTitle.get('Book the hall')!
    const invites = byTitle.get('Send invites')!
    const food = byTitle.get('Plan the food')!
    planning.updateWorkItem(
      invites.id,
      {
        dependencyLinks: [
          { id: hall.id, type: 'start-to-start', lagDays: 2 },
          { id: food.id, type: 'finish-to-finish', lagDays: -1 }
        ]
      },
      human
    )

    const pkg = service.exportProjectAsPackage(project.id, { kind: 'export', relativeDates: false })
    expect(validateProjectPackage(pkg).ok).toBe(true)
    const exported = pkg.tasks.find((task) => task.title === 'Send invites')!
    expect(exported.dependsOnLinks).toEqual([
      { ref: exported.dependsOnRefs[0], type: 'start-to-start', lagDays: 2 },
      { ref: exported.dependsOnRefs[1], type: 'finish-to-finish', lagDays: -1 }
    ])
    // A plain link writes nothing extra.
    expect(pkg.tasks.find((task) => task.title === 'Buy snacks')!.dependsOnLinks).toBeUndefined()

    const { project: copy } = await service.createProjectFromPackage(pkg, {}, TODAY)
    const copied = new Map(planning.listWorkItems(copy.id).map((item) => [item.title, item]))
    expect(copied.get('Send invites')!.dependencyLinks).toEqual([
      { id: copied.get('Book the hall')!.id, type: 'start-to-start', lagDays: 2 },
      { id: copied.get('Plan the food')!.id, type: 'finish-to-finish', lagDays: -1 }
    ])
    expect(copied.get('Buy snacks')!.dependencyLinks).toEqual([
      { id: copied.get('Buy drinks')!.id, type: 'finish-to-start', lagDays: 0 }
    ])

    const saved = service.saveProjectAsTemplate(project.id, { name: 'Typed links' })
    const template = service.getTemplatePackage(saved.id)
    expect(template.tasks.find((task) => task.title === 'Send invites')!.dependsOnLinks).toEqual(
      exported.dependsOnLinks
    )
  })

  it('reads an old file without types as finish to start, 0 days', async () => {
    const { project } = await service.createProjectFromPackage(PARTY, {}, TODAY)
    const items = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    expect(items.get('Send invites')!.dependencyLinks).toEqual([
      { id: items.get('Book the hall')!.id, type: 'finish-to-start', lagDays: 0 }
    ])
  })

  it('reads an unknown type or a lag out of range as finish to start, 0 days', () => {
    const result = validateProjectPackage({
      ...PARTY,
      tasks: PARTY.tasks.map((task) =>
        task.ref === 't2'
          ? {
              ...task,
              dependsOnLinks: [
                { ref: 't1', type: 'start-to-finish', lagDays: 999 },
                { ref: 't1', type: 'start-to-start', lagDays: 1 }
              ]
            }
          : task
      )
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tasks[1].dependsOnLinks).toBeUndefined()
  })
})
