import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import { PeopleService } from '../../../electron/services/people-service'
import { LibraryService } from '../../../electron/services/library-service'
import { shiftIsoDate, todayIsoDate } from '../../../src/shared/dates'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { pdf } from '../../helpers/office-files'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts people, task fields, checklist and label routes', () => {
  const temp = useTempDir('ostler-automation-essentials-')
  const http = useAutomationServer()
  let root: string
  let project: WatchedProject
  let planning: PlanningService
  let people: PeopleService
  let server: AutomationHttpServer
  let peopleNotified: number
  let essentialsDatabasePath: string

  beforeEach(async () => {
    root = temp()
    project = makeWatchedProject({
      id: 'essentials-project',
      name: 'Essentials',
      addedAt: Date.now(),
      automationToken: 'automation-token',
      estimateUnit: 'points'
    })
    const databasePath = await createMigratedDatabase(root)
    essentialsDatabasePath = databasePath
    planning = new PlanningService(databasePath, () => [project.id])
    people = new PeopleService(databasePath)
    peopleNotified = 0
    server = new AutomationHttpServer(
      () => [project],
      path.join(root, 'runtime'),
      undefined,
      planning,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { service: people, notify: () => peopleNotified++ }
    )
    await http.start(server, planning, people)
  })

  function call<T = unknown>(method: string, route: string, body?: unknown) {
    return http.route<T>(project.id, project.automationToken, method, route, body)
  }

  it('GET /search gives the page of a match in a Library PDF (N4.5)', async () => {
    const library = new LibraryService(essentialsDatabasePath, root)
    try {
      await library.importFiles(project.id, [
        {
          fileName: 'plan.pdf',
          mimeType: 'application/pdf',
          bytes: pdf(['Welcome', 'Parking behind the hall'])
        }
      ])
    } finally {
      library.close()
    }
    const found = await call<Array<{ type: string; location?: unknown; snippet: unknown[] }>>(
      'GET',
      '/search?q=parking&types=library'
    )
    expect(found.value).toHaveLength(1)
    expect(found.value[0]).toMatchObject({
      type: 'library',
      location: { kind: 'page', label: '2' }
    })
    expect(found.value[0].snippet).toContainEqual({ text: 'Parking', match: true })
  })

  it('lists the new routes in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/people'],
      ['POST', '/people'],
      ['PATCH', '/people/:personId'],
      ['POST', '/work-items/:workItemId/checklist'],
      ['GET', '/labels'],
      ['PATCH', '/labels/:name'],
      ['DELETE', '/labels/:name'],
      ['POST', '/labels/restore']
    ]) {
      expect(
        help.value.routes.some(
          (candidate) => candidate.method === method && candidate.path === route
        )
      ).toBe(true)
    }
  })

  it('adds, renames, archives and chooses Me through /people', async () => {
    const created = await call<{ id: string; name: string; initials: string }>('POST', '/people', {
      name: 'Alex Chen'
    })
    expect(created).toMatchObject({ status: 200, ok: true })
    expect(created.value).toMatchObject({ name: 'Alex Chen', initials: 'AC' })
    const id = created.value.id

    const renamed = await call<{ name: string }>('PATCH', `/people/${id}`, { name: 'Alex Kim' })
    expect(renamed.value.name).toBe('Alex Kim')
    const me = await call<{ isMe: boolean }>('PATCH', `/people/${id}`, { isMe: true })
    expect(me.value.isMe).toBe(true)
    const listed = await call<Array<{ id: string }>>('GET', '/people')
    expect(listed.value.map((person) => person.id)).toEqual([id])

    const other = await call<{ id: string }>('POST', '/people', { name: 'Sam' })
    await call('PATCH', `/people/${other.value.id}`, { archived: true })
    expect((await call<unknown[]>('GET', '/people')).value).toHaveLength(1)
    expect((await call<unknown[]>('GET', '/people?includeArchived=true')).value).toHaveLength(2)
    expect(peopleNotified).toBe(5)

    expect(await call('POST', '/people', { name: '' })).toMatchObject({
      status: 400,
      error: 'A person needs a name'
    })
    expect(await call('PATCH', '/people/nobody', { name: 'X' })).toMatchObject({
      status: 400,
      error: 'Person not found'
    })
    expect(await call('PATCH', `/people/${id}`, {})).toMatchObject({ status: 400 })
    // A refused part keeps the whole edit out: Me cannot be archived, so the rename is not saved.
    expect(await call('PATCH', `/people/${id}`, { name: 'Renamed', archived: true })).toMatchObject(
      { status: 400 }
    )
    expect((await call<{ name: string }>('GET', '/people')).value).toMatchObject([
      { name: 'Alex Kim' }
    ])
  })

  it('reads and sets weekly capacity and working days through /people (R3.2)', async () => {
    const created = await call<{ id: string; weeklyCapacityHours: null; workingDays: number[] }>(
      'POST',
      '/people',
      { name: 'Ada', weeklyCapacityHours: 32, workingDays: [4, 1, 2, 3] }
    )
    expect(created.value).toMatchObject({ weeklyCapacityHours: 32, workingDays: [1, 2, 3, 4] })
    const plain = await call<{ weeklyCapacityHours: null; workingDays: number[] }>(
      'POST',
      '/people',
      { name: 'Bo' }
    )
    expect(plain.value).toMatchObject({ weeklyCapacityHours: null, workingDays: [1, 2, 3, 4, 5] })

    const id = created.value.id
    const cleared = await call('PATCH', `/people/${id}`, { weeklyCapacityHours: null })
    expect(cleared.value).toMatchObject({ weeklyCapacityHours: null, workingDays: [1, 2, 3, 4] })
    const listed = await call<Array<{ id: string; workingDays: number[] }>>('GET', '/people')
    expect(listed.value.find((person) => person.id === id)?.workingDays).toEqual([1, 2, 3, 4])

    expect(await call('PATCH', `/people/${id}`, { weeklyCapacityHours: 169 })).toMatchObject({
      status: 400
    })
    expect(await call('PATCH', `/people/${id}`, { workingDays: [] })).toMatchObject({
      status: 400
    })
  })

  it('creates, reads and updates assignee, start date and estimate, with the same refusals as the app', async () => {
    const person = await call<{ id: string }>('POST', '/people', { name: 'Ada' })
    const created = await call<{ id: string; assigneeId: string; estimate: number }>(
      'POST',
      '/work-items',
      {
        title: 'Plan the launch',
        assigneeId: person.value.id,
        startDate: '2026-10-12',
        targetDate: '2026-10-20',
        estimate: 3
      }
    )
    expect(created.value).toMatchObject({
      assigneeId: person.value.id,
      startDate: '2026-10-12',
      targetDate: '2026-10-20',
      estimate: 3,
      checkedCriteria: []
    })
    const id = created.value.id

    const listed = await call<Array<{ id: string; estimate: number }>>('GET', '/work-items')
    expect(listed.value.find((item) => item.id === id)?.estimate).toBe(3)

    expect(await call('PATCH', `/work-items/${id}`, { startDate: '2026-10-21' })).toMatchObject({
      status: 400,
      error: 'The start date is after the due date'
    })
    expect(await call('PATCH', `/work-items/${id}`, { estimate: 5000 })).toMatchObject({
      status: 400,
      error: 'The estimate must be from 0 to 1000'
    })
    expect(await call('PATCH', `/work-items/${id}`, { assigneeId: 'nobody' })).toMatchObject({
      status: 400,
      error: 'That person does not exist'
    })
    const cleared = await call<{ assigneeId: string | null }>('PATCH', `/work-items/${id}`, {
      assigneeId: null
    })
    expect(cleared.value.assigneeId).toBeNull()
  })

  it('sets a repeat and custom reminders, and repeats the task when it is done', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/work-items/:workItemId/recurrence'],
      ['POST', '/work-items/:workItemId/recurrence'],
      ['DELETE', '/work-items/:workItemId/recurrence'],
      ['GET', '/work-items/:workItemId/reminders'],
      ['POST', '/work-items/:workItemId/reminders'],
      ['DELETE', '/work-items/:workItemId/reminders/:reminderId']
    ]) {
      expect(help.value.routes).toContainEqual(expect.objectContaining({ method, path: route }))
    }
    const created = await call<{ id: string }>('POST', '/work-items', {
      title: 'Water plants',
      targetDate: '2099-01-07'
    })
    const id = created.value.id
    expect((await call('GET', `/work-items/${id}/recurrence`)).value).toBeNull()
    const set = await call<{ rule: unknown }>('POST', `/work-items/${id}/recurrence`, {
      rule: { every: 'week', weekdays: [3] }
    })
    expect(set.value.rule).toEqual({ every: 'week', interval: 1, weekdays: [3] })
    expect(
      await call('POST', `/work-items/${id}/recurrence`, { rule: { every: 'hourly' } })
    ).toMatchObject({ status: 400 })

    const reminder = await call<{ id: string; kind: string }>(
      'POST',
      `/work-items/${id}/reminders`,
      {
        remindAt: new Date(Date.now() + 86_400_000).toISOString()
      }
    )
    expect(reminder.value.kind).toBe('custom')
    const listed = await call<Array<{ id: string; kind: string }>>(
      'GET',
      `/work-items/${id}/reminders`
    )
    // The due-date reminder and the custom one.
    expect(listed.value.map((entry) => entry.kind).sort()).toEqual(['custom', 'due'])
    expect(
      await call('POST', `/work-items/${id}/reminders`, { remindAt: '2000-01-01T00:00:00Z' })
    ).toMatchObject({ status: 400, error: 'Choose a time in the future' })
    await call('DELETE', `/work-items/${id}/reminders/${reminder.value.id}`)
    expect((await call<unknown[]>('GET', `/work-items/${id}/reminders`)).value).toHaveLength(1)

    const done = await call<{ repeatedAs: string }>('PATCH', `/work-items/${id}`, {
      status: 'done'
    })
    expect(done.value.repeatedAs).toEqual(expect.any(String))
    const next = planning.getWorkItem(done.value.repeatedAs)
    expect(next).toMatchObject({ title: 'Water plants', targetDate: '2099-01-14' })
    expect((await call('GET', `/work-items/${next.id}/recurrence`)).value).not.toBeNull()
    expect((await call('DELETE', `/work-items/${next.id}/recurrence`)).value).toBeNull()
  })

  it('reads and writes take turns on the recurrence routes (N2.3)', async () => {
    const sam = (await call<{ id: string }>('POST', '/people', { name: 'Sam' })).value.id
    const alex = (await call<{ id: string }>('POST', '/people', { name: 'Alex' })).value.id
    const created = await call<{ id: string }>('POST', '/work-items', {
      title: 'Bins out',
      targetDate: '2099-01-06'
    })
    const id = created.value.id
    const set = await call<{ rotation: string[]; nextIndex: number }>(
      'POST',
      `/work-items/${id}/recurrence`,
      { rule: { every: 'week' }, rotation: [sam, alex], nextIndex: 1 }
    )
    expect(set.value).toMatchObject({ rotation: [sam, alex], nextIndex: 1 })
    expect((await call('GET', `/work-items/${id}/recurrence`)).value).toMatchObject({
      rotation: [sam, alex],
      nextIndex: 1
    })
    expect(
      await call('POST', `/work-items/${id}/recurrence`, {
        rule: { every: 'week' },
        rotation: [sam, sam]
      })
    ).toMatchObject({ status: 400 })
    expect(
      await call('POST', `/work-items/${id}/recurrence`, {
        rule: { every: 'week' },
        rotation: [sam],
        nextIndex: 4
      })
    ).toMatchObject({ status: 400 })

    const done = await call<{ repeatedAs: string }>('PATCH', `/work-items/${id}`, {
      status: 'done'
    })
    expect(planning.getWorkItem(done.value.repeatedAs).assigneeId).toBe(alex)
    expect(
      (await call('GET', `/work-items/${done.value.repeatedAs}/recurrence`)).value
    ).toMatchObject({ rotation: [sam, alex], nextIndex: 0 })
  })

  it('ticks a checklist item by its text', async () => {
    const created = await call<{ id: string }>('POST', '/work-items', {
      title: 'Ship',
      status: 'done',
      acceptanceCriteria: ['Docs', 'Tests']
    })
    const id = created.value.id
    const ticked = await call<{ checkedCriteria: string[]; status: string }>(
      'POST',
      `/work-items/${id}/checklist`,
      { text: 'Tests', checked: true }
    )
    expect(ticked.value).toMatchObject({ checkedCriteria: ['Tests'], status: 'done' })
    const unticked = await call<{ checkedCriteria: string[]; status: string }>(
      'POST',
      `/work-items/${id}/checklist`,
      { text: 'Tests', checked: false }
    )
    expect(unticked.value).toMatchObject({ checkedCriteria: [], status: 'done' })
    expect(
      await call('POST', `/work-items/${id}/checklist`, { text: 'Nope', checked: true })
    ).toMatchObject({ status: 400, error: expect.stringContaining('not on this task') })
    expect(
      await call('POST', `/work-items/${id}/checklist`, { text: 'Docs', checked: 'yes' })
    ).toMatchObject({ status: 400, error: 'checked must be true or false' })
  })

  it('dates, assigns and renames a checklist item, keeping its tick (N2.2)', async () => {
    const sam = await call<{ id: string }>('POST', '/people', { name: 'Sam' })
    const created = await call<{ id: string }>('POST', '/work-items', {
      title: 'Party',
      acceptanceCriteria: ['Book caterer', 'Send invitations']
    })
    const id = created.value.id
    type Item = {
      acceptanceCriteria: string[]
      checkedCriteria: string[]
      checklistDetails: { text: string; dueDate: string | null; assigneeId: string | null }[]
    }
    const dated = await call<Item>('POST', `/work-items/${id}/checklist`, {
      text: 'Book caterer',
      dueDate: '2099-01-09',
      assigneeId: sam.value.id,
      checked: true
    })
    expect(dated.value).toMatchObject({
      checkedCriteria: ['Book caterer'],
      checklistDetails: [{ text: 'Book caterer', dueDate: '2099-01-09', assigneeId: sam.value.id }]
    })
    const renamed = await call<Item>('POST', `/work-items/${id}/checklist`, {
      text: 'Book caterer',
      renameTo: 'Confirm caterer'
    })
    expect(renamed.value).toMatchObject({
      acceptanceCriteria: ['Confirm caterer', 'Send invitations'],
      checkedCriteria: ['Confirm caterer'],
      checklistDetails: [
        { text: 'Confirm caterer', dueDate: '2099-01-09', assigneeId: sam.value.id }
      ]
    })
    const listed = await call<Array<{ id: string } & Item>>('GET', '/work-items')
    expect(listed.value.find((item) => item.id === id)!.checklistDetails).toEqual(
      renamed.value.checklistDetails
    )
    const cleared = await call<Item>('POST', `/work-items/${id}/checklist`, {
      text: 'Confirm caterer',
      assigneeId: null
    })
    expect(cleared.value.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '2099-01-09', assigneeId: null }
    ])
    // Replacing the list drops the state of an item whose text is gone.
    const replaced = await call<Item>('PATCH', `/work-items/${id}`, {
      acceptanceCriteria: ['Confirm the caterer', 'Send invitations']
    })
    expect(replaced.value).toMatchObject({ checkedCriteria: [], checklistDetails: [] })
    expect(
      await call('POST', `/work-items/${id}/checklist`, { text: 'Send invitations' })
    ).toMatchObject({ status: 400, error: 'Send checked, dueDate, assigneeId or renameTo' })
    expect(
      await call('POST', `/work-items/${id}/checklist`, {
        text: 'Send invitations',
        dueDate: 'Friday'
      })
    ).toMatchObject({ status: 400 })
    expect(
      await call('POST', `/work-items/${id}/checklist`, {
        text: 'Send invitations',
        renameTo: 'Confirm the caterer'
      })
    ).toMatchObject({ status: 400 })
    // A refused part leaves the rest undone: one transaction.
    expect(
      await call('POST', `/work-items/${id}/checklist`, {
        text: 'Send invitations',
        renameTo: 'Post invitations',
        assigneeId: 'ghost'
      })
    ).toMatchObject({ status: 400 })
    expect(planning.getWorkItem(id).acceptanceCriteria).toEqual([
      'Confirm the caterer',
      'Send invitations'
    ])
  })

  it('moves a task before or after another, or to the start or end of a status, and lists in that order (D31)', async () => {
    const make = async (title: string, status = 'ready') =>
      (await call<{ id: string }>('POST', '/work-items', { title, status })).value.id
    const a = await make('A')
    const b = await make('B')
    const c = await make('C')
    const backlog = await make('Backlog', 'backlog')
    const order = async () =>
      (await call<Array<{ title: string }>>('GET', '/work-items')).value.map((item) => item.title)
    expect(await order()).toEqual(['A', 'B', 'C', 'Backlog'])

    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    expect(
      help.value.routes.some(
        (route) => route.method === 'POST' && route.path === '/work-items/:workItemId/move'
      )
    ).toBe(true)

    expect(await call('POST', `/work-items/${c}/move`, { beforeId: a })).toMatchObject({
      status: 200
    })
    expect(await order()).toEqual(['C', 'A', 'B', 'Backlog'])
    await call('POST', `/work-items/${c}/move`, { afterId: b })
    expect(await order()).toEqual(['A', 'B', 'C', 'Backlog'])
    await call('POST', `/work-items/${a}/move`, { position: 'end' })
    expect(await order()).toEqual(['B', 'C', 'A', 'Backlog'])
    const moved = await call<{ status: string }>('POST', `/work-items/${backlog}/move`, {
      position: 'start',
      status: 'ready'
    })
    expect(moved.value.status).toBe('ready')
    expect(await order()).toEqual(['Backlog', 'B', 'C', 'A'])
    // The key is internal: nothing sets it, and a move must say where.
    expect(await call('POST', `/work-items/${a}/move`, { orderKey: '0' })).toMatchObject({
      status: 400
    })
    expect(await call('POST', `/work-items/${a}/move`, { beforeId: 7 })).toMatchObject({
      status: 400,
      error: 'beforeId must be a string'
    })
  })

  it('lists, recolours, renames, deletes and restores labels across the project', async () => {
    const a = await call<{ id: string }>('POST', '/work-items', {
      title: 'A',
      labels: ['ux design', 'web']
    })
    await call('POST', '/work-items', { title: 'B', labels: ['ux design'] })

    const labels = await call<Array<{ name: string; taskCount: number }>>('GET', '/labels')
    expect(labels.value.map((label) => [label.name, label.taskCount])).toEqual([
      ['ux design', 2],
      ['web', 1]
    ])

    const recoloured = await call('PATCH', `/labels/${encodeURIComponent('ux design')}`, {
      name: 'design',
      color: '#ec4899'
    })
    expect(recoloured.value).toMatchObject({ name: 'design', color: '#ec4899', taskCount: 2 })
    expect(await call('PATCH', '/labels/design', { color: 'pink' })).toMatchObject({
      status: 400,
      error: 'A colour must look like #3b82f6'
    })

    const deleted = await call<{ name: string; workItemIds: string[] }>('DELETE', '/labels/design')
    expect(deleted.value.workItemIds).toHaveLength(2)
    expect((await call<unknown[]>('GET', '/labels')).value).toHaveLength(1)

    await call('POST', '/labels/restore', deleted.value)
    const items = await call<Array<{ id: string; labels: string[] }>>('GET', '/work-items')
    expect(items.value.find((candidate) => candidate.id === a.value.id)?.labels).toEqual([
      'web',
      'design'
    ])
  })

  it('reads and changes the column settings, with the same refusals as the app (R2.4)', async () => {
    const help = await call<{
      routes: Array<{ method: string; path: string; description: string }>
    }>('GET', '/help')
    for (const method of ['GET', 'PATCH'])
      expect(help.value.routes.some((r) => r.method === method && r.path === '/columns')).toBe(true)
    expect(help.value.routes.find((r) => r.path === '/columns')?.description).toContain(
      'for display only'
    )

    expect((await call('GET', '/columns')).value).toEqual({ names: {}, hidden: [] })
    const renamed = await call('PATCH', '/columns', {
      names: { backlog: 'To do', active: 'Doing' },
      hidden: ['review']
    })
    expect(renamed.status).toBe(200)
    expect(renamed.value).toEqual({
      names: { backlog: 'To do', active: 'Doing' },
      hidden: ['review']
    })

    // Status values stay the ids.
    const task = await call<{ id: string; status: string }>('POST', '/work-items', {
      title: 'Paint',
      status: 'blocked'
    })
    expect(task.value.status).toBe('blocked')

    const busy = await call('PATCH', '/columns', { hidden: ['review', 'blocked'] })
    expect(busy.status).toBe(400)
    expect(busy.error).toContain('1 task is in it')
    const always = await call('PATCH', '/columns', { hidden: ['done'] })
    expect(always.status).toBe(400)

    // A blank name restores the standard word.
    expect((await call('PATCH', '/columns', { names: { backlog: '' } })).value).toEqual({
      names: { active: 'Doing' },
      hidden: ['review']
    })

    // With a folder, agents keep Ready and In review (the API runs only while they are on).
    project.path = root
    const agents = await call('PATCH', '/columns', { hidden: ['review', 'ready'] })
    expect(agents.status).toBe(400)
    expect(agents.error).toContain('agents are on')
  })

  it('manages custom fields, writes values on work items and filters by them (R2.2)', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/fields'],
      ['POST', '/fields'],
      ['PATCH', '/fields/:fieldId'],
      ['POST', '/fields/reorder'],
      ['DELETE', '/fields/:fieldId'],
      ['POST', '/fields/restore']
    ])
      expect(help.value.routes.some((r) => r.method === method && r.path === route)).toBe(true)

    type Field = { id: string; name: string; options: { id: string; name: string }[] }
    const size = await call<Field>('POST', '/fields', {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small' }, { name: 'Large' }]
    })
    expect(size.status).toBe(200)
    const cost = await call<Field>('POST', '/fields', { name: 'Cost', type: 'number' })
    const [small, large] = size.value.options

    const a = await call<{ id: string; fieldValues?: Record<string, unknown> }>(
      'POST',
      '/work-items',
      {
        title: 'A',
        fieldValues: { [size.value.id]: small.id, [cost.value.id]: 5 }
      }
    )
    expect(a.value.fieldValues).toEqual({ [size.value.id]: small.id, [cost.value.id]: 5 })
    const b = await call<{ id: string }>('POST', '/work-items', {
      title: 'B',
      fieldValues: { [size.value.id]: large.id }
    })
    expect(
      await call('PATCH', `/work-items/${b.value.id}`, { fieldValues: { [cost.value.id]: 'lots' } })
    ).toMatchObject({ status: 400 })
    const patched = await call<{ fieldValues?: Record<string, unknown> }>(
      'PATCH',
      `/work-items/${a.value.id}`,
      { fieldValues: { [cost.value.id]: null } }
    )
    expect(patched.value.fieldValues).toEqual({ [size.value.id]: small.id })

    const filter = (conditions: unknown[]) =>
      call<Array<{ title: string }>>(
        'GET',
        `/work-items?filter=${encodeURIComponent(JSON.stringify({ conditions }))}`
      )
    const large_ = await filter([
      { field: 'custom', fieldId: size.value.id, op: 'is', value: [large.id] }
    ])
    expect(large_.value.map((item) => item.title)).toEqual(['B'])
    const noCost = await filter([
      { field: 'custom', fieldId: cost.value.id, op: 'isEmpty', value: 'empty' }
    ])
    expect(noCost.value.map((item) => item.title).sort()).toEqual(['A', 'B'])

    const renamed = await call<Field>('PATCH', `/fields/${size.value.id}`, {
      options: [
        { id: small.id, name: 'S' },
        { id: large.id, name: 'L' }
      ]
    })
    expect(renamed.value.options.map((option) => option.name)).toEqual(['S', 'L'])
    const reordered = await call<Field[]>('POST', '/fields/reorder', {
      fieldIds: [cost.value.id, size.value.id]
    })
    expect(reordered.value.map((field) => field.name)).toEqual(['Cost', 'Size'])

    const deleted = await call<{ field: Field; values: unknown[] }>(
      'DELETE',
      `/fields/${size.value.id}`
    )
    expect(deleted.value.values).toHaveLength(2)
    expect((await call<Field[]>('GET', '/fields')).value).toHaveLength(1)
    await call('POST', '/fields/restore', deleted.value)
    const items = await call<Array<{ title: string; fieldValues?: Record<string, unknown> }>>(
      'GET',
      '/work-items'
    )
    expect(items.value.find((item) => item.title === 'B')?.fieldValues).toEqual({
      [size.value.id]: large.id
    })
  })

  it('filters work items by the shared filter, searches, and manages saved views (P5.7)', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/search'],
      ['GET', '/views'],
      ['GET', '/views/:viewId'],
      ['POST', '/views'],
      ['PATCH', '/views/:viewId'],
      ['POST', '/views/:viewId/set-default'],
      ['DELETE', '/views/:viewId']
    ]) {
      expect(help.value.routes).toContainEqual(expect.objectContaining({ method, path: route }))
    }

    const me = await call<{ id: string }>('POST', '/people', { name: 'Ada' })
    await call('PATCH', `/people/${me.value.id}`, { isMe: true })
    const today = todayIsoDate()
    const late = await call<{ id: string }>('POST', '/work-items', {
      title: 'Send the invoice',
      targetDate: shiftIsoDate(today, -2),
      assigneeId: me.value.id,
      priority: 'high'
    })
    const soon = await call<{ id: string }>('POST', '/work-items', {
      title: 'Choose the colour scheme',
      targetDate: shiftIsoDate(today, 3)
    })
    await call('POST', '/work-items', { title: 'Someday' })

    const filtered = async (filter: unknown) => {
      const result = await call<Array<{ id: string }>>(
        'GET',
        `/work-items?filter=${encodeURIComponent(JSON.stringify(filter))}`
      )
      expect(result.status).toBe(200)
      return result.value.map((item) => item.id)
    }
    expect(await filtered({ conditions: [{ field: 'due', op: 'is', value: 'overdue' }] })).toEqual([
      late.value.id
    ])
    expect(
      await filtered({ conditions: [{ field: 'assignee', op: 'is', value: ['me'] }] })
    ).toEqual([late.value.id])
    expect(
      (
        await filtered({
          match: 'any',
          conditions: [
            { field: 'due', op: 'is', value: 'overdue' },
            { field: 'due', op: 'is', value: 'next7Days' }
          ]
        })
      ).sort()
    ).toEqual([late.value.id, soon.value.id].sort())

    expect(await call('GET', '/work-items?filter=not-json')).toMatchObject({
      status: 400,
      error: expect.stringContaining('filter must be URL-encoded JSON')
    })
    expect(
      await call(
        'GET',
        `/work-items?filter=${encodeURIComponent(JSON.stringify({ conditions: [{ field: 'due', op: 'is', value: 'soon' }] }))}`
      )
    ).toMatchObject({
      status: 400,
      error: expect.stringContaining('Filter condition 1: the value for "due is" must be one of')
    })

    // Search, through the API's own writes: a comment made here is found at once.
    await call('POST', `/work-items/${late.value.id}/comments`, {
      body: 'Wait for the colour proofs first'
    })
    const found = await call<Array<{ type: string; workItemId: string; snippet: unknown[] }>>(
      'GET',
      '/search?q=colour'
    )
    expect(found.value.map((hit) => hit.type).sort()).toEqual(['comment', 'task'])
    expect(found.value.every((hit) => hit.snippet !== undefined)).toBe(true)
    expect((await call<unknown[]>('GET', '/search?q=colour&types=comment')).value).toHaveLength(1)
    expect(await call('GET', '/search?q=colour&types=widgets')).toMatchObject({ status: 400 })
    expect(await call('GET', '/search')).toMatchObject({ status: 400 })
    await call('PATCH', `/work-items/${soon.value.id}`, { title: 'Pick fonts' })
    expect((await call<unknown[]>('GET', '/search?q=colour&types=task')).value).toEqual([])
    await call('DELETE', `/work-items/${late.value.id}`)
    expect((await call<unknown[]>('GET', '/search?q=colour')).value).toEqual([])

    // Saved views.
    const created = await call<{ id: string; name: string }>('POST', '/views', {
      name: 'Overdue',
      viewType: 'list',
      config: { filter: { conditions: [{ field: 'due', op: 'is', value: 'overdue' }] } }
    })
    expect(created.status).toBe(200)
    const viewId = created.value.id
    expect((await call<unknown[]>('GET', '/views')).value).toHaveLength(1)
    expect((await call<unknown[]>('GET', '/views?viewType=board')).value).toHaveLength(0)
    expect((await call<{ name: string }>('GET', `/views/${viewId}`)).value.name).toBe('Overdue')
    expect(
      (await call<{ name: string }>('PATCH', `/views/${viewId}`, { name: 'Late' })).value.name
    ).toBe('Late')
    const def = await call<{ isDefault: boolean; config: unknown }>(
      'POST',
      `/views/${viewId}/set-default`
    )
    expect(def.value.isDefault).toBe(true)
    expect(await call('DELETE', `/views/${viewId}`)).toMatchObject({ status: 200 })
    expect((await call<unknown[]>('GET', '/views')).value).toHaveLength(1)
    expect(await call('POST', '/views', { name: 'X', viewType: 'gantt' })).toMatchObject({
      status: 400,
      error: expect.stringContaining('board, list, calendar, timeline')
    })
    expect(await call('GET', '/views/nope')).toMatchObject({
      status: 400,
      error: 'Saved view not found'
    })
  })

  it('lists, creates, updates, deletes and restores time entries (R2.3)', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/time-entries'],
      ['GET', '/time-entries/:entryId'],
      ['POST', '/time-entries'],
      ['PATCH', '/time-entries/:entryId'],
      ['DELETE', '/time-entries/:entryId'],
      ['POST', '/time-entries/restore'],
      ['GET', '/timer'],
      ['POST', '/timer/start'],
      ['POST', '/timer/stop']
    ])
      expect(help.value.routes.some((r) => r.method === method && r.path === route)).toBe(true)

    type Entry = { id: string; durationSeconds: number | null; note: string; startedAt: number }
    const task = await call<{ id: string }>('POST', '/work-items', { title: 'Timed' })
    const created = await call<Entry>('POST', '/time-entries', {
      workItemId: task.value.id,
      startedAt: '2026-10-12T09:30',
      duration: '1h 30m',
      note: 'Call'
    })
    expect(created.status).toBe(200)
    expect(created.value).toMatchObject({ durationSeconds: 5400, note: 'Call', source: 'manual' })
    expect(created.value.startedAt).toBe(new Date(2026, 9, 12, 9, 30).getTime())

    expect(
      await call('POST', '/time-entries', {
        workItemId: task.value.id,
        startedAt: Date.now(),
        duration: 'later'
      })
    ).toMatchObject({ status: 400, error: expect.stringContaining('1h 30m') })

    const patched = await call<Entry>('PATCH', `/time-entries/${created.value.id}`, {
      durationSeconds: 600
    })
    expect(patched.value.durationSeconds).toBe(600)
    expect(
      (await call<Entry[]>('GET', '/time-entries?from=2026-10-12&to=2026-10-12')).value
    ).toHaveLength(1)
    expect((await call<Entry[]>('GET', '/time-entries?from=2026-10-13')).value).toHaveLength(0)
    expect((await call<Entry>('GET', `/time-entries/${created.value.id}`)).value.id).toBe(
      created.value.id
    )

    const csv = await fetch(
      `http://127.0.0.1:${http.port}/automation/${project.id}/time-entries?format=csv`,
      { headers: { Authorization: `Bearer ${project.automationToken}` } }
    )
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('2026-10-12,Essentials,Timed,')

    const deleted = await call<Entry>('DELETE', `/time-entries/${created.value.id}`)
    expect((await call<Entry[]>('GET', '/time-entries')).value).toHaveLength(0)
    await call('POST', '/time-entries/restore', deleted.value)
    expect((await call<Entry[]>('GET', '/time-entries')).value).toHaveLength(1)
  })

  it('starts and stops the one timer (R2.3)', async () => {
    type Entry = { id: string; workItemId: string; durationSeconds: number | null }
    const a = await call<{ id: string }>('POST', '/work-items', { title: 'A' })
    const b = await call<{ id: string }>('POST', '/work-items', { title: 'B' })
    const first = await call<{ started: Entry; stopped: Entry | null }>('POST', '/timer/start', {
      workItemId: a.value.id
    })
    expect(first.value.stopped).toBeNull()
    expect((await call<{ running: Entry | null }>('GET', '/timer')).value.running?.workItemId).toBe(
      a.value.id
    )
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const second = await call<{ started: Entry; stopped: Entry | null }>('POST', '/timer/start', {
      workItemId: b.value.id
    })
    expect(second.value.stopped?.workItemId).toBe(a.value.id)
    const stopped = await call<Entry | null>('POST', '/timer/stop')
    expect(stopped.value?.workItemId).toBe(b.value.id)
    expect((await call<{ running: Entry | null }>('GET', '/timer')).value.running).toBeNull()
    expect(await call('POST', '/timer/start', { workItemId: 'nope' })).toMatchObject({
      status: 400
    })
  })
})
