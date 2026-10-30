import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shell = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }))
vi.mock('electron', () => ({ shell, session: { defaultSession: {} } }))

import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { filterVocabulary } from '../../electron/ipc/filter-from-words-handlers'
import { LATEST_SCHEMA_VERSION } from '../../electron/services/database/migrations'
import { openContactAddress, openExternalUrl } from '../../electron/app/security'
import { buildFilterFromWordsUserPrompt } from '../../src/shared/ostler-ai-prompts'
import {
  contactMatches,
  isContactAddress,
  mailtoHref,
  telHref,
  websiteHref
} from '../../src/shared/contacts'
import { capVocabulary, filterGrammar, readFilterAnswer } from '../../src/shared/filter-from-words'
import { matchesFilter, parseTaskFilter } from '../../src/shared/task-filter'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-17'
const HUMAN = { kind: 'human' as const }

const tempDir = useTempDir('ostler-contacts-')
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

const WEDDING = packageOf({
  project: { name: 'Wedding' },
  people: [],
  labels: [],
  goals: [],
  milestones: [],
  tasks: [
    { ref: 't1', title: 'Book the flowers' },
    { ref: 't2', title: 'Fix the boiler' }
  ],
  decisions: [],
  library: []
})

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
  shell.openExternal.mockClear()
})

afterEach(() => {
  planning.close()
  people.close()
})

async function wedding() {
  const { project } = await service.createProjectFromPackage(WEDDING, {}, TODAY)
  const tasks = planning.listWorkItems(project.id)
  return {
    project,
    flowers: tasks.find((task) => task.title === 'Book the flowers')!,
    boiler: tasks.find((task) => task.title === 'Fix the boiler')!
  }
}

const florist = () =>
  planning.contacts.create({
    name: 'Rosa Bloom',
    organisation: 'Bloom & Co',
    role: 'Florist',
    phones: [{ label: 'Mobile', number: '+44 (0)7700 900123' }],
    emails: ['rosa@bloom.example'],
    website: 'bloom.example',
    notes: 'Prefers texts in the morning'
  })

describe('the contacts migration (N6.5)', () => {
  it('adds contacts with no project, and task contacts with a project, task, contact and role', () => {
    const db = new Database(databasePath, { readonly: true })
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    expect(columns('contacts')).toEqual([
      'id',
      'name',
      'organisation',
      'role',
      'phones',
      'emails',
      'website',
      'address',
      'notes',
      'created_at',
      'updated_at'
    ])
    expect(columns('task_contacts')).toEqual([
      'id',
      'project_id',
      'work_item_id',
      'contact_id',
      'role',
      'created_at'
    ])
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    db.close()
  })
})

describe('contacts (N6.5)', () => {
  it('keeps every field, trimmed, and lists contacts by name', () => {
    florist()
    planning.contacts.create({ name: '  adam  Plumb ', phones: [{ label: '', number: '' }] })
    const list = planning.contacts.list()
    expect(list.map((contact) => contact.name)).toEqual(['adam Plumb', 'Rosa Bloom'])
    expect(list[0].phones).toEqual([])
    expect(list[1]).toMatchObject({
      organisation: 'Bloom & Co',
      role: 'Florist',
      phones: [{ label: 'Mobile', number: '+44 (0)7700 900123' }],
      emails: ['rosa@bloom.example'],
      website: 'bloom.example'
    })
  })

  it('finds contacts by name, organisation, role, email and phone digits', () => {
    const rosa = florist()
    expect(planning.contacts.list('bloom').map((c) => c.id)).toEqual([rosa.id])
    expect(planning.contacts.list('florist').map((c) => c.id)).toEqual([rosa.id])
    expect(planning.contacts.list('rosa@bloom')).toHaveLength(1)
    expect(planning.contacts.list('7700900123')).toHaveLength(1)
    expect(planning.contacts.list('plumber')).toHaveLength(0)
    expect(contactMatches(rosa, '')).toBe(true)
  })

  it('refuses a contact without a name, a bad email or website, and too much', () => {
    expect(() => planning.contacts.create({ name: '  ' })).toThrow(/needs a name/)
    expect(() => planning.contacts.create({ name: 'A', emails: ['not an email'] })).toThrow(
      /Email 1 is not an email address/
    )
    expect(() =>
      planning.contacts.create({ name: 'A', emails: ['a@b.example?cc=evil@x.example'] })
    ).toThrow(/not an email/)
    expect(() => planning.contacts.create({ name: 'A', website: 'javascript:alert(1)' })).toThrow(
      /web address/
    )
    expect(() => planning.contacts.create({ name: 'x'.repeat(121) })).toThrow(/at most 120/)
    expect(() =>
      planning.contacts.create({
        name: 'A',
        phones: Array.from({ length: 11 }, () => ({ label: '', number: '1' }))
      })
    ).toThrow(/at most 10 phone/)
  })

  it('edits a field and keeps the rest; Undo of a delete puts the contact and its links back', async () => {
    const { project, flowers } = await wedding()
    const rosa = florist()
    const edited = planning.contacts.update(rosa.id, { role: 'Owner' })
    expect(edited).toMatchObject({ role: 'Owner', organisation: 'Bloom & Co' })

    planning.contacts.link(flowers.id, rosa.id, 'supplier')
    const deleted = planning.contacts.delete(rosa.id)
    expect(deleted.links).toHaveLength(1)
    expect(planning.contacts.list()).toEqual([])
    expect(planning.contacts.forTask(flowers.id)).toEqual([])
    expect(planning.contacts.marksForProject(project.id)).toEqual({})

    planning.contacts.restore(deleted)
    expect(planning.contacts.get(rosa.id).role).toBe('Owner')
    expect(planning.contacts.forTask(flowers.id).map((link) => link.role)).toEqual(['supplier'])
  })
})

describe('tasks naming contacts (N6.5)', () => {
  it('names a contact once per task, contact and role, and lists the tasks across projects', async () => {
    const { project, flowers, boiler } = await wedding()
    const rosa = florist()
    planning.contacts.link(flowers.id, rosa.id, 'supplier')
    planning.contacts.link(flowers.id, rosa.id, 'asked-for-it')
    expect(() => planning.contacts.link(flowers.id, rosa.id, 'supplier')).toThrow(/already names/)
    expect(() => planning.contacts.link(flowers.id, rosa.id, 'boss')).toThrow(/asked-for-it/)
    expect(() => planning.contacts.link(boiler.id, 'missing', 'other')).toThrow(/not found/)
    planning.contacts.link(boiler.id, rosa.id, 'other')

    const forTask = planning.contacts.forTask(flowers.id)
    expect(forTask.map((link) => [link.role, link.contact.name])).toEqual([
      ['supplier', 'Rosa Bloom'],
      ['asked-for-it', 'Rosa Bloom']
    ])
    expect(planning.contacts.tasksOf(rosa.id).map((task) => [task.title, task.role])).toEqual(
      expect.arrayContaining([
        ['Book the flowers', 'supplier'],
        ['Book the flowers', 'asked-for-it'],
        ['Fix the boiler', 'other']
      ])
    )
    expect(planning.contacts.marksForProject(project.id)[boiler.id]).toEqual([
      { contactId: rosa.id, role: 'other' }
    ])
  })

  it('removes a link with Undo, and deleting the task removes its links', async () => {
    const { project, flowers, boiler } = await wedding()
    const rosa = florist()
    const link = planning.contacts.link(flowers.id, rosa.id, 'supplier')
    const removed = planning.contacts.unlink(flowers.id, link.id)
    expect(planning.contacts.forTask(flowers.id)).toEqual([])
    planning.contacts.relink(flowers.id, removed)
    expect(planning.contacts.forTask(flowers.id).map((entry) => entry.id)).toEqual([link.id])

    planning.contacts.link(boiler.id, rosa.id, 'other')
    planning.deleteWorkItem(boiler.id, HUMAN)
    expect(planning.contacts.tasksOf(rosa.id).map((task) => task.workItemId)).toEqual([flowers.id])
    // Removing the project removes its links; the contact stays, shared by every project.
    deleteProjectRows(planning.database, project.id)
    expect(planning.contacts.tasksOf(rosa.id)).toEqual([])
    expect(planning.contacts.get(rosa.id).name).toBe('Rosa Bloom')
  })
})

describe('Call, Email and Open website (N6.5)', () => {
  it('builds tel: from digits and a leading + only, and mailto: from one address', () => {
    expect(telHref('+44 (0)20 7946-0018 ext')).toBe('tel:+4402079460018')
    expect(telHref('020 7946 0018')).toBe('tel:02079460018')
    expect(telHref('call me')).toBeNull()
    expect(mailtoHref(' rosa@bloom.example ')).toBe('mailto:rosa@bloom.example')
    expect(mailtoHref('rosa@bloom.example?subject=hi')).toBeNull()
    expect(mailtoHref('a@b.example,c@d.example')).toBeNull()
    expect(websiteHref('bloom.example')).toBe('https://bloom.example/')
    expect(websiteHref('http://bloom.example/shop')).toBe('http://bloom.example/shop')
    expect(websiteHref('file:///C:/Windows')).toBeNull()
    expect(websiteHref('javascript:alert(1)')).toBeNull()
  })

  it('lets exactly tel: and mailto: addresses through, and nothing else', async () => {
    expect(isContactAddress('tel:+447700900123')).toBe(true)
    expect(isContactAddress('mailto:rosa@bloom.example')).toBe(true)
    for (const url of [
      'tel:+44 7700',
      'tel:12;phone-context=x',
      'mailto:rosa@bloom.example?body=x',
      'mailto:a@b.example,c@d.example',
      'callto:123',
      'https://bloom.example',
      'file:///C:/x',
      'ms-settings:privacy'
    ])
      expect(isContactAddress(url)).toBe(false)

    await openContactAddress('tel:+447700900123')
    expect(shell.openExternal).toHaveBeenCalledWith('tel:+447700900123')
    await expect(openContactAddress('https://bloom.example')).rejects.toThrow()
    await expect(openContactAddress('ms-settings:privacy')).rejects.toThrow()
    // The web route stays http and https only: tel: does not pass it.
    await expect(openExternalUrl('tel:+447700900123')).rejects.toThrow()
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('builds the address only from what is stored on the contact', () => {
    const rosa = florist()
    // The stored number, typed with spaces and brackets, becomes digits and a +.
    expect(telHref(rosa.phones[0].number)).toBe('tel:+4407700900123')
    expect(mailtoHref(rosa.emails[0])).toBe('mailto:rosa@bloom.example')
  })
})

describe('search finds contacts (N6.5)', () => {
  it('finds a contact by name, organisation, role, email, phone and notes, in its own type', async () => {
    const { project } = await wedding()
    const rosa = florist()
    for (const words of ['Rosa', 'Bloom', 'florist', 'rosa@bloom.example', '900123', 'texts']) {
      const results = planning.search.search(words)
      expect(results.find((result) => result.type === 'contact')?.id).toBe(rosa.id)
    }
    expect(planning.search.search('Rosa')[0]).toMatchObject({
      type: 'contact',
      projectId: '',
      workItemId: null,
      title: 'Rosa Bloom'
    })
    // A project's search, the automation API's and Ask Ostler's, never finds contacts.
    expect(planning.search.search('Rosa', { projectId: project.id })).toEqual([])
    planning.contacts.update(rosa.id, { name: 'Rosa Petal' })
    expect(planning.search.search('Petal').map((result) => result.id)).toEqual([rosa.id])
    planning.contacts.delete(rosa.id)
    expect(planning.search.search('Petal')).toEqual([])
  })
})

describe('the Contact filter (N6.5)', () => {
  it('matches tasks naming a contact in any role or in a given one', async () => {
    const { project, flowers, boiler } = await wedding()
    const rosa = florist()
    planning.contacts.link(flowers.id, rosa.id, 'supplier')
    const context = planning.taskFilterContext(project.id, TODAY)
    const matching = (value: string[], op = 'hasAny') => {
      const filter = parseTaskFilter({ conditions: [{ field: 'contact', op, value }] })
      return [flowers, boiler]
        .filter((task) => matchesFilter(task, filter, context))
        .map((task) => task.title)
    }
    expect(matching([rosa.id])).toEqual(['Book the flowers'])
    expect(matching([`${rosa.id}:supplier`])).toEqual(['Book the flowers'])
    expect(matching([`${rosa.id}:asked-for-it`])).toEqual([])
    expect(matching([rosa.id], 'hasNone')).toEqual(['Fix the boiler'])
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'contact', op: 'hasAny', value: ['x:boss'] }] })
    ).toThrow(/contact ids/)
  })
})

describe('the project file carries contacts (N6.5)', () => {
  it('exports the contacts its tasks name, and matches them by email on import', async () => {
    const { project, flowers } = await wedding()
    const rosa = florist()
    const unnamed = planning.contacts.create({ name: 'Nobody on a task' })
    planning.contacts.link(flowers.id, rosa.id, 'supplier')
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.contacts?.map((contact) => contact.name)).toEqual(['Rosa Bloom'])
    expect(file.taskContacts).toEqual([
      { taskRef: expect.any(String), contactRef: 'c1', role: 'supplier' }
    ])
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    // Same email: the contact is reused, not duplicated.
    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const copied = planning
      .listWorkItems(copy.id)
      .find((task) => task.title === 'Book the flowers')!
    expect(planning.contacts.forTask(copied.id).map((link) => link.contactId)).toEqual([rosa.id])
    expect(
      planning.contacts
        .list()
        .map((contact) => contact.id)
        .sort()
    ).toEqual([rosa.id, unnamed.id].sort())

    // A template carries no contacts.
    const template = service.exportProjectAsPackage(project.id, {
      kind: 'template',
      relativeDates: true
    })
    expect(template.contacts).toBeUndefined()
  })

  it('matches by name when a contact has no email, and creates the missing ones', async () => {
    const pkg = packageOf({
      ...WEDDING,
      contacts: [
        { ref: 'c1', name: 'Adam Plumb', phones: [{ label: 'Work', number: '0161 496 0000' }] },
        { ref: 'c2', name: 'New Person', emails: ['new@person.example', 'not an email'] }
      ],
      taskContacts: [
        { taskRef: 't2', contactRef: 'c1', role: 'other' },
        { taskRef: 't1', contactRef: 'c2', role: 'asked-for-it' }
      ]
    })
    const adam = planning.contacts.create({ name: 'adam plumb' })
    const { project } = await service.createProjectFromPackage(pkg, {}, TODAY)
    const tasks = planning.listWorkItems(project.id)
    const boiler = tasks.find((task) => task.title === 'Fix the boiler')!
    expect(planning.contacts.forTask(boiler.id).map((link) => link.contactId)).toEqual([adam.id])
    const created = planning.contacts.list().find((contact) => contact.name === 'New Person')!
    expect(created.emails).toEqual(['new@person.example'])
  })

  it('refuses a link to a contact or task the file does not have', () => {
    const result = validateProjectPackage({
      ...WEDDING,
      contacts: [{ ref: 'c1', name: 'A' }],
      taskContacts: [{ taskRef: 't1', contactRef: 'c9', role: 'other' }]
    })
    expect(result.ok).toBe(false)
  })
})

describe('contacts are not People (N6.5)', () => {
  it('never lists a contact among people, and refuses one as an assignee', async () => {
    const { flowers } = await wedding()
    const before = people.list({ includeArchived: true }).length
    const rosa = florist()
    expect(people.list({ includeArchived: true })).toHaveLength(before)
    expect(people.exists(rosa.id)).toBe(false)
    expect(() => planning.updateWorkItem(flowers.id, { assigneeId: rosa.id }, HUMAN)).toThrow()
  })
})

describe('Ostler AI may read contacts: Describe it filters by contact', () => {
  it('offers the contacts by name, as it offers people, and maps a named one to its id', async () => {
    const { project, flowers } = await wedding()
    const rosa = florist()
    planning.contacts.link(flowers.id, rosa.id, 'supplier')
    expect(filterGrammar()).toContain('- contact hasAny: a list of names from CONTACTS')
    expect(filterGrammar()).not.toMatch(/not available|never use/)

    const vocabulary = filterVocabulary(planning, people, project.id)
    expect(vocabulary.contacts).toContainEqual({ id: rosa.id, name: 'Rosa Bloom' })
    expect(
      buildFilterFromWordsUserPrompt({ text: 'Rosa', today: TODAY, weekStart: 1, vocabulary })
    ).toContain('CONTACTS: ["Rosa Bloom"]')

    const answer = readFilterAnswer(
      {
        conditions: [
          { field: 'contact', op: 'hasAny', value: ['rosa bloom', 'Rosa Bloom:supplier', 'Ivy'] }
        ]
      },
      vocabulary
    )
    expect(answer.filter.conditions).toEqual([
      { field: 'contact', op: 'hasAny', value: [rosa.id, `${rosa.id}:supplier`] }
    ])
    expect(answer.notes).toEqual([{ kind: 'unknownName', field: 'contact', name: 'Ivy' }])
  })

  it('caps the contacts sent like any other list', () => {
    const contacts = Array.from({ length: 205 }, (_, index) => ({
      id: `c${index}`,
      name: `Contact ${index}`
    }))
    const { vocabulary, notes } = capVocabulary({
      statuses: [],
      priorities: [],
      labels: [],
      milestones: [],
      goals: [],
      iterations: [],
      people: [],
      contacts
    })
    expect(vocabulary.contacts).toHaveLength(200)
    expect(notes).toEqual([{ kind: 'cut', list: 'contacts', sent: 200 }])
  })
})
