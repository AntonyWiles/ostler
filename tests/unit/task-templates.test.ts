import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import {
  parseTaskTemplateBody,
  taskInputFromTemplate,
  taskTemplateBodyFrom
} from '../../src/shared/task-templates'
import { createMigratedDatabase } from '../helpers/database'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const body = (extra: Record<string, unknown> = {}) => ({ title: 'Invoice run', ...extra })

describe('parseTaskTemplateBody', () => {
  it('fills in every optional field', () => {
    expect(parseTaskTemplateBody(body())).toEqual({
      title: 'Invoice run',
      description: '',
      checklist: [],
      labels: [],
      priority: 'medium',
      estimate: null,
      assigneeId: null,
      fieldValues: {},
      startDate: null,
      dueDate: null,
      subtasks: []
    })
  })

  it('checks each field', () => {
    expect(() => parseTaskTemplateBody(null)).toThrow()
    expect(() => parseTaskTemplateBody({ title: '  ' })).toThrow(/title/)
    expect(() => parseTaskTemplateBody(body({ title: 'x'.repeat(201) }))).toThrow(/200/)
    expect(() => parseTaskTemplateBody(body({ description: 4 }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ checklist: 'one' }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ checklist: Array(31).fill('a') }))).toThrow()
    expect(parseTaskTemplateBody(body({ checklist: [' a ', 'a', 'b'] })).checklist).toEqual([
      'a',
      'b'
    ])
    expect(() => parseTaskTemplateBody(body({ labels: [''] }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ priority: 'urgent' }))).toThrow(/Priority/)
    expect(() => parseTaskTemplateBody(body({ estimate: -1 }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ estimate: 1001 }))).toThrow()
    expect(parseTaskTemplateBody(body({ estimate: 3 })).estimate).toBe(3)
    expect(() => parseTaskTemplateBody(body({ assigneeId: 5 }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ status: 'done' }))).toThrow(/status/)
    expect(() => parseTaskTemplateBody(body({ comments: [] }))).toThrow(/comments/)
    expect(() => parseTaskTemplateBody(body({ dependencyIds: [] }))).toThrow()
  })

  it('takes dates only as days after the day it is used', () => {
    expect(parseTaskTemplateBody(body({ startDate: '+1d', dueDate: '+2w' }))).toMatchObject({
      startDate: '+1d',
      dueDate: '+2w'
    })
    expect(() => parseTaskTemplateBody(body({ dueDate: '2026-10-15' }))).toThrow(/\+3d/)
    expect(() => parseTaskTemplateBody(body({ startDate: '+5d', dueDate: '+2d' }))).toThrow(
      /start date/
    )
  })

  it('checks custom field values by shape, not by project', () => {
    expect(
      parseTaskTemplateBody(body({ fieldValues: { f1: 'text', f2: 3, f3: true, f4: ['o1'] } }))
        .fieldValues
    ).toEqual({ f1: 'text', f2: 3, f3: true, f4: ['o1'] })
    expect(() => parseTaskTemplateBody(body({ fieldValues: { f1: false } }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ fieldValues: { f1: [] } }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ fieldValues: ['x'] }))).toThrow()
  })

  it('keeps subtasks one level deep', () => {
    const parsed = parseTaskTemplateBody(
      body({ subtasks: [{ title: 'Send', checklist: ['Check total'] }] })
    )
    expect(parsed.subtasks).toEqual([
      { title: 'Send', description: '', checklist: ['Check total'] }
    ])
    expect(() =>
      parseTaskTemplateBody(
        body({ subtasks: [{ title: 'Send', subtasks: [{ title: 'Deeper' }] }] })
      )
    ).toThrow(/subtasks/)
    expect(() => parseTaskTemplateBody(body({ subtasks: [{ title: '' }] }))).toThrow()
    expect(() => parseTaskTemplateBody(body({ subtasks: Array(31).fill({ title: 'x' }) }))).toThrow(
      /30/
    )
  })
})

describe('taskInputFromTemplate', () => {
  it('counts dates from the day used and lets overrides win', () => {
    const parsed = parseTaskTemplateBody(
      body({ startDate: '+1d', dueDate: '+1w', labels: ['admin'], fieldValues: { d: '+2d' } })
    )
    expect(taskInputFromTemplate(parsed, '2026-10-15', {}, new Set(['d']))).toMatchObject({
      title: 'Invoice run',
      startDate: '2026-10-16',
      targetDate: '2026-10-22',
      labels: ['admin'],
      fieldValues: { d: '2026-10-17' }
    })
    expect(
      taskInputFromTemplate(parsed, '2026-10-15', { targetDate: '2026-12-01', labels: ['urgent'] })
    ).toMatchObject({ targetDate: '2026-12-01', labels: ['urgent'], startDate: '2026-10-16' })
  })
})

describe('TaskTemplates', () => {
  const tempDir = useTempDir('ostler-task-templates-')
  let service: PlanningService
  const human = { kind: 'human' } as const
  const today = '2026-10-15'

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
  })

  const addPerson = (id: string) =>
    service.database
      .prepare(
        "INSERT INTO people (id, name, color, is_me, created_at, updated_at) VALUES (?, ?, '#3b82f6', 0, 1, 1)"
      )
      .run(id, `Person ${id}`)

  const save = (name: string, projectId: string | null, extra: Record<string, unknown> = {}) =>
    service.taskTemplates.save({ name, projectId, body: body(extra) })

  it('lists a project its own templates and every project’s, never another project’s', () => {
    const own = save('Own', 'p1')
    const every = save('Every', null)
    save('Theirs', 'p2')
    expect(service.taskTemplates.listForProject('p1').map((tpl) => tpl.id)).toEqual([
      every.id,
      own.id
    ])
    expect(() => service.taskTemplates.use('p2', own.id, human)).toThrow(/another project/)
    expect(() => service.taskTemplates.listForProject('nope')).toThrow()
  })

  it('refuses a name clash in the same scope unless it replaces', () => {
    const first = save('Bug report', 'p1')
    expect(() => save('bug REPORT', 'p1')).toThrow(/already/)
    // Another scope may use the name.
    expect(save('Bug report', null).projectId).toBeNull()
    const replaced = service.taskTemplates.save({
      name: 'Bug report',
      projectId: 'p1',
      body: body({ title: 'New' }),
      replace: true
    })
    expect(replaced.id).toBe(first.id)
    expect(service.taskTemplates.get(first.id).body.title).toBe('New')
  })

  it('saves a task and its subtasks, with dates relative only when kept', () => {
    const parent = service.createWorkItem(
      'p1',
      {
        title: 'Book a venue',
        description: 'For the launch',
        labels: ['events'],
        priority: 'high',
        acceptanceCriteria: ['Deposit paid'],
        startDate: '2026-10-17',
        targetDate: '2026-10-20',
        estimate: 2
      },
      human
    )
    service.setChecklistItemChecked(parent.id, 'Deposit paid', true, human)
    service.addComment(parent.id, 'Never travels', human)
    service.createWorkItem(
      'p1',
      { title: 'Shortlist', acceptanceCriteria: ['Three places'], parentWorkItemId: parent.id },
      human
    )
    const kept = service.taskTemplates.saveFromWorkItem(
      parent.id,
      { scope: 'project', keepDates: true },
      today
    )
    expect(kept).toMatchObject({ name: 'Book a venue', projectId: 'p1' })
    expect(kept.body).toMatchObject({
      title: 'Book a venue',
      description: 'For the launch',
      labels: ['events'],
      priority: 'high',
      checklist: ['Deposit paid'],
      estimate: 2,
      startDate: '+2d',
      dueDate: '+5d',
      subtasks: [{ title: 'Shortlist', description: '', checklist: ['Three places'] }]
    })
    const dateless = service.taskTemplates.saveFromWorkItem(
      parent.id,
      { scope: 'every', name: 'Venue', keepDates: false },
      today
    )
    expect(dateless).toMatchObject({ projectId: null })
    expect(dateless.body).toMatchObject({ startDate: null, dueDate: null })
    expect(() =>
      service.taskTemplates.saveFromWorkItem(parent.id, { scope: 'somewhere' as 'every' })
    ).toThrow()
  })

  it('makes the task and subtasks in one go, dates counted from the day used', () => {
    addPerson('ada')
    const template = save('Invoice', 'p1', {
      assigneeId: 'ada',
      checklist: ['Export', 'Send'],
      startDate: '+0d',
      dueDate: '+3d',
      subtasks: [{ title: 'Export', checklist: ['CSV'] }, { title: 'Send' }]
    })
    const made = service.taskTemplates.use('p1', template.id, human, {}, today)
    expect(made.dropped).toEqual({ assignee: false, fieldCount: 0 })
    expect(made.workItem).toMatchObject({
      title: 'Invoice run',
      assigneeId: 'ada',
      acceptanceCriteria: ['Export', 'Send'],
      startDate: '2026-10-15',
      targetDate: '2026-10-18'
    })
    expect(made.subtasks.map((task) => [task.title, task.parentWorkItemId])).toEqual([
      ['Export', made.workItem.id],
      ['Send', made.workItem.id]
    ])
    expect(made.subtasks[0].acceptanceCriteria).toEqual(['CSV'])
    // A normal create: it has its "created" activity like any other.
    const activity = service.listActivity('p1', made.workItem.id)
    expect(JSON.stringify(activity)).toContain('created')
    const later = service.taskTemplates.use('p1', template.id, human, {}, '2026-11-01')
    expect(later.workItem.targetDate).toBe('2026-11-04')
  })

  it('round trips checklist items’ dates and people: saved from a task, made again (N2.2)', () => {
    addPerson('sam')
    const task = service.createWorkItem(
      'p1',
      { title: 'Party', acceptanceCriteria: ['Confirm caterer', 'Send invitations', 'Cake'] },
      human
    )
    service.setChecklistItemDetails(
      task.id,
      'Confirm caterer',
      { dueDate: '2026-10-17', assigneeId: 'sam' },
      human
    )
    service.setChecklistItemDetails(task.id, 'Send invitations', { dueDate: '2026-10-18' }, human)
    const kept = service.taskTemplates.saveFromWorkItem(
      task.id,
      { scope: 'project', keepDates: true },
      today
    )
    expect(kept.body.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '+2d', assigneeId: 'sam' },
      { text: 'Send invitations', dueDate: '+3d', assigneeId: null }
    ])
    // Without dates, an item keeps only its person.
    const dateless = service.taskTemplates.saveFromWorkItem(
      task.id,
      { scope: 'project', name: 'Party, no dates', keepDates: false },
      today
    )
    expect(dateless.body.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: null, assigneeId: 'sam' }
    ])

    const made = service.taskTemplates.use('p1', kept.id, human, {}, '2026-11-01')
    expect(made.workItem.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '2026-11-03', assigneeId: 'sam' },
      { text: 'Send invitations', dueDate: '2026-11-04', assigneeId: null }
    ])
    // A person who is gone is left off the item; an item no longer listed is skipped.
    service.database.prepare("DELETE FROM people WHERE id = 'sam'").run()
    const again = service.taskTemplates.use(
      'p1',
      kept.id,
      human,
      { acceptanceCriteria: ['Confirm caterer'] },
      '2026-11-01'
    )
    expect(again.workItem.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '2026-11-03', assigneeId: null }
    ])
    expect(() =>
      parseTaskTemplateBody(
        body({ checklist: ['a'], checklistDetails: [{ text: 'b', dueDate: '+1d' }] })
      )
    ).toThrow(/b/)
    expect(() =>
      parseTaskTemplateBody(
        body({ checklist: ['a'], checklistDetails: [{ text: 'a', dueDate: '2026-10-10' }] })
      )
    ).toThrow()
  })

  it('drops a person who is gone and fields the project does not have, and says so', () => {
    const field = service.createField('p1', { name: 'Size', type: 'number' })
    const template = save('Everywhere', null, {
      assigneeId: 'gone',
      fieldValues: { [field.id]: 5, unknown: 'x' }
    })
    const here = service.taskTemplates.use('p1', template.id, human, {}, today)
    expect(here.dropped).toEqual({ assignee: true, fieldCount: 1 })
    expect(here.workItem.assigneeId).toBeNull()
    expect(here.workItem.fieldValues).toEqual({ [field.id]: 5 })
    const there = service.taskTemplates.use('p2', template.id, human, {}, today)
    expect(there.dropped).toEqual({ assignee: true, fieldCount: 2 })
  })

  it('leaves nothing half-made when a subtask fails', () => {
    const template = save('Broken', 'p1', { subtasks: [{ title: 'Fine' }, { title: 'Also fine' }] })
    const before = service.listWorkItems('p1').length
    // The person's override is checked as usual: an unknown milestone refuses the whole use.
    expect(() =>
      service.taskTemplates.use('p1', template.id, human, { milestoneId: 'missing' }, today)
    ).toThrow()
    expect(service.listWorkItems('p1')).toHaveLength(before)
    // A failure part-way (the third task) rolls back the first two.
    const real = service.createWorkItem.bind(service)
    let calls = 0
    ;(service as unknown as { createWorkItem: typeof real }).createWorkItem = (...args) => {
      calls++
      if (calls === 3) throw new Error('disk full')
      return real(...args)
    }
    expect(() => service.taskTemplates.use('p1', template.id, human, {}, today)).toThrow(
      'disk full'
    )
    ;(service as unknown as { createWorkItem: typeof real }).createWorkItem = real
    expect(service.listWorkItems('p1')).toHaveLength(before)
  })

  it('renames, re-scopes, deletes and restores', () => {
    const template = save('One', 'p1')
    save('Two', null)
    expect(service.taskTemplates.update(template.id, { name: 'Uno' }).name).toBe('Uno')
    expect(() =>
      service.taskTemplates.update(template.id, { projectId: null, name: 'two' })
    ).toThrow()
    expect(service.taskTemplates.update(template.id, { projectId: null }).projectId).toBeNull()
    expect(service.taskTemplates.update(template.id, { projectId: 'p2' }).projectId).toBe('p2')
    expect(() => service.taskTemplates.update(template.id, { projectId: 'nope' })).toThrow()
    const deletion = service.taskTemplates.delete(template.id)
    expect(() => service.taskTemplates.get(template.id)).toThrow()
    expect(service.taskTemplates.restore(deletion).id).toBe(template.id)
    expect(() => service.taskTemplates.restore(deletion)).toThrow()
  })

  it('goes with its project; templates for every project stay', () => {
    const own = save('Own', 'p1')
    const every = save('Every', null)
    const theirs = save('Theirs', 'p2')
    deleteProjectRows(service.database, 'p1')
    expect(
      service.taskTemplates
        .listAll()
        .map((tpl) => tpl.id)
        .sort()
    ).toEqual([every.id, theirs.id].sort())
    expect(() => service.taskTemplates.get(own.id)).toThrow()
  })
})

describe('taskTemplateBodyFrom', () => {
  it('counts a past date as today and leaves out comments and dependencies', () => {
    const item = {
      title: 'Late',
      description: '',
      acceptanceCriteria: [],
      labels: [],
      priority: 'low',
      estimate: null,
      assigneeId: null,
      fieldValues: { d: '2026-10-01', n: 4 },
      startDate: '2026-10-01',
      targetDate: '2026-10-16',
      dependencyIds: ['x']
    } as unknown as PlanningWorkItem
    expect(
      taskTemplateBodyFrom(item, [], {
        keepDates: true,
        today: '2026-10-15',
        dateFieldIds: new Set(['d'])
      })
    ).toMatchObject({ startDate: '+0d', dueDate: '+1d', fieldValues: { d: '+0d', n: 4 } })
  })
})
