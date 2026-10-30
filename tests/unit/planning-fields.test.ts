import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { MAX_FIELD_OPTIONS, MAX_PROJECT_FIELDS } from '../../src/shared/ostler-api'
import {
  compareFieldValues,
  fieldValueText,
  normalizeFieldValue,
  parseFieldValueText
} from '../../src/shared/planning/custom-fields'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** Custom fields (R2.2, D32) as the planning service keeps them. */
describe('PlanningService custom fields', () => {
  const tempDir = useTempDir('ostler-fields-')
  let service: PlanningService
  const human = { kind: 'human' } as const
  const projectIds = ['p1', 'p2']

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  const choiceField = () =>
    service.createField('p1', {
      name: 'Room',
      type: 'choice',
      options: [{ name: 'Kitchen' }, { name: 'Hall', color: '#ef4444' }]
    })

  it('makes a field of every type, in order, with options for the choice types', () => {
    for (const type of ['text', 'number', 'date', 'checkbox'] as const)
      service.createField('p1', { name: `A ${type}`, type })
    const room = choiceField()
    const tags = service.createField('p1', {
      name: 'Tags',
      type: 'choices',
      options: [{ name: 'One' }, { name: 'Two' }]
    })
    const fields = service.listFields('p1')
    expect(fields.map((field) => [field.name, field.type, field.position])).toEqual([
      ['A text', 'text', 0],
      ['A number', 'number', 1],
      ['A date', 'date', 2],
      ['A checkbox', 'checkbox', 3],
      ['Room', 'choice', 4],
      ['Tags', 'choices', 5]
    ])
    expect(room.options.map((option) => option.name)).toEqual(['Kitchen', 'Hall'])
    expect(room.options[1].color).toBe('#ef4444')
    expect(room.options[0].color).toMatch(/^#[0-9a-f]{6}$/)
    expect(tags.options).toHaveLength(2)
    expect(service.listFields('p2')).toEqual([])
  })

  it('refuses a bad name, a taken name, options on a text field and the limits', () => {
    expect(() => service.createField('p1', { name: ' ', type: 'text' })).toThrow(/needs a name/)
    service.createField('p1', { name: 'Client', type: 'text' })
    expect(() => service.createField('p1', { name: 'client', type: 'number' })).toThrow(
      /already has a field/
    )
    expect(() =>
      service.createField('p1', { name: 'Kind', type: 'text', options: [{ name: 'x' }] })
    ).toThrow(/Only Choice/)
    expect(() =>
      service.createField('p1', {
        name: 'Many',
        type: 'choice',
        options: Array.from({ length: MAX_FIELD_OPTIONS + 1 }, (_, i) => ({ name: `o${i}` }))
      })
    ).toThrow(/at most 50 options/)
    expect(() =>
      service.createField('p1', {
        name: 'Twice',
        type: 'choice',
        options: [{ name: 'a' }, { name: 'A' }]
      })
    ).toThrow(/already has an option/)
    expect(() => service.createField('p1', { name: 'Odd', type: 'colour' as never })).toThrow(
      /type is one of/
    )
    for (let i = 1; i < MAX_PROJECT_FIELDS; i++)
      service.createField('p1', { name: `Field ${i}`, type: 'text' })
    expect(service.listFields('p1')).toHaveLength(MAX_PROJECT_FIELDS)
    expect(() => service.createField('p1', { name: 'One more', type: 'text' })).toThrow(
      /at most 20 fields/
    )
    expect(() => service.createField('unknown', { name: 'X', type: 'text' })).toThrow()
  })

  it('never changes a field type', () => {
    const field = service.createField('p1', { name: 'Size', type: 'number' })
    expect(() => service.updateField('p1', field.id, { type: 'text' } as never)).toThrow(
      /type can't change/
    )
  })

  it('stores, reads and clears a value of every type, loaded with the tasks', () => {
    const text = service.createField('p1', { name: 'Client', type: 'text' })
    const number = service.createField('p1', { name: 'Version', type: 'number' })
    const date = service.createField('p1', { name: 'Signed', type: 'date' })
    const check = service.createField('p1', { name: 'Billable', type: 'checkbox' })
    const room = choiceField()
    const tags = service.createField('p1', {
      name: 'Tags',
      type: 'choices',
      options: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }]
    })
    const [one, two, three] = tags.options.map((option) => option.id)
    const task = service.createWorkItem(
      'p1',
      {
        title: 'Move',
        fieldValues: {
          [text.id]: '  Acme  ',
          [number.id]: 2.5,
          [date.id]: '2026-11-01',
          [check.id]: true,
          [room.id]: room.options[1].id,
          [tags.id]: [three, one]
        }
      },
      human
    )
    const expected = {
      [text.id]: 'Acme',
      [number.id]: 2.5,
      [date.id]: '2026-11-01',
      [check.id]: true,
      [room.id]: room.options[1].id,
      [tags.id]: [one, three]
    }
    expect(task.fieldValues).toEqual(expected)
    expect(service.getWorkItem(task.id).fieldValues).toEqual(expected)
    expect(service.listWorkItems('p1')[0].fieldValues).toEqual(expected)

    const updated = service.updateWorkItem(
      task.id,
      { fieldValues: { [text.id]: null, [check.id]: false, [tags.id]: [two] } },
      human
    )
    expect(updated.fieldValues).toEqual({
      [number.id]: 2.5,
      [date.id]: '2026-11-01',
      [room.id]: room.options[1].id,
      [tags.id]: [two]
    })
    expect(service.getWorkItem(task.id).fieldValues).toEqual(updated.fieldValues)
  })

  it('refuses a value the field does not take, and a field of another project', () => {
    const number = service.createField('p1', { name: 'Version', type: 'number' })
    const room = choiceField()
    const other = service.createField('p2', { name: 'Elsewhere', type: 'text' })
    const task = service.createWorkItem('p1', { title: 'T' }, human)
    expect(() =>
      service.updateWorkItem(task.id, { fieldValues: { [number.id]: 'many' } }, human)
    ).toThrow('Version takes a number')
    expect(() =>
      service.updateWorkItem(task.id, { fieldValues: { [room.id]: 'not-an-option' } }, human)
    ).toThrow('Room has no such option')
    expect(() =>
      service.updateWorkItem(task.id, { fieldValues: { [other.id]: 'x' } }, human)
    ).toThrow(/another project/)
    expect(() =>
      service.createWorkItem('p1', { title: 'U', fieldValues: { [number.id]: 'x' } }, human)
    ).toThrow('Version takes a number')
    expect(service.listWorkItems('p1').map((item) => item.title)).toEqual(['T'])
  })

  it('renames an option without touching values, and a removed option leaves every task', () => {
    const room = choiceField()
    const [kitchen, hall] = room.options
    const a = service.createWorkItem(
      'p1',
      { title: 'A', fieldValues: { [room.id]: kitchen.id } },
      human
    )
    const b = service.createWorkItem(
      'p1',
      { title: 'B', fieldValues: { [room.id]: hall.id } },
      human
    )
    const renamed = service.updateField('p1', room.id, {
      name: 'Where',
      options: [
        { id: hall.id, name: 'Hallway', color: '#10b981' },
        { id: kitchen.id, name: 'Kitchen' }
      ]
    })
    expect(renamed.options.map((option) => [option.name, option.color])).toEqual([
      ['Hallway', '#10b981'],
      ['Kitchen', kitchen.color]
    ])
    expect(service.getWorkItem(a.id).fieldValues).toEqual({ [room.id]: kitchen.id })
    service.updateField('p1', room.id, { options: [{ id: kitchen.id, name: 'Kitchen' }] })
    expect(service.getWorkItem(b.id).fieldValues).toEqual({})
    expect(service.getWorkItem(a.id).fieldValues).toEqual({ [room.id]: kitchen.id })
  })

  it('reorders fields, refusing a list that is not every field once', () => {
    const a = service.createField('p1', { name: 'A', type: 'text' })
    const b = service.createField('p1', { name: 'B', type: 'text' })
    expect(service.reorderFields('p1', [b.id, a.id]).map((field) => field.name)).toEqual(['B', 'A'])
    expect(() => service.reorderFields('p1', [b.id])).toThrow(/every field/)
  })

  it('deletes a field with its values, and undo restores every value at its place', () => {
    const a = service.createField('p1', { name: 'A', type: 'text' })
    const tags = service.createField('p1', {
      name: 'Tags',
      type: 'choices',
      options: [{ name: 'One' }, { name: 'Two' }]
    })
    const c = service.createField('p1', { name: 'C', type: 'number' })
    const ids = tags.options.map((option) => option.id)
    const x = service.createWorkItem(
      'p1',
      { title: 'X', fieldValues: { [tags.id]: ids, [a.id]: 'kept' } },
      human
    )
    const y = service.createWorkItem(
      'p1',
      { title: 'Y', fieldValues: { [tags.id]: [ids[1]] } },
      human
    )
    const z = service.createWorkItem('p1', { title: 'Z', fieldValues: { [c.id]: 3 } }, human)

    const deletion = service.deleteField('p1', tags.id)
    expect(service.listFields('p1').map((field) => [field.name, field.position])).toEqual([
      ['A', 0],
      ['C', 1]
    ])
    expect(service.getWorkItem(x.id).fieldValues).toEqual({ [a.id]: 'kept' })
    expect(service.getWorkItem(y.id).fieldValues).toEqual({})

    const restored = service.restoreField('p1', deletion)
    expect(restored.id).toBe(tags.id)
    expect(service.listFields('p1').map((field) => field.name)).toEqual(['A', 'Tags', 'C'])
    expect(service.getWorkItem(x.id).fieldValues).toEqual({ [a.id]: 'kept', [tags.id]: ids })
    expect(service.getWorkItem(y.id).fieldValues).toEqual({ [tags.id]: [ids[1]] })
    expect(service.getWorkItem(z.id).fieldValues).toEqual({ [c.id]: 3 })
  })

  it('finds a task by a text field value, and stops once the field is deleted', () => {
    const client = service.createField('p1', { name: 'Client', type: 'text' })
    service.createWorkItem(
      'p1',
      { title: 'Invoice', fieldValues: { [client.id]: 'Zephyrine' } },
      human
    )
    const found = () => service.search.search('zephyrine', { projectId: 'p1' })
    expect(found().map((result) => result.title)).toEqual(['Invoice'])
    const deletion = service.deleteField('p1', client.id)
    expect(found()).toEqual([])
    service.restoreField('p1', deletion)
    expect(found().map((result) => result.title)).toEqual(['Invoice'])
  })

  it('copies field values to the next occurrence of a repeating task', () => {
    const client = service.createField('p1', { name: 'Client', type: 'text' })
    const task = service.createWorkItem(
      'p1',
      { title: 'Report', targetDate: '2026-10-01', fieldValues: { [client.id]: 'Acme' } },
      human
    )
    service.setRecurrence(task.id, { rule: { every: 'week', interval: 1 } }, human)
    const done = service.updateWorkItem(task.id, { status: 'done' }, human)
    expect(done.repeatedAs).toBeTruthy()
    expect(service.getWorkItem(done.repeatedAs!).fieldValues).toEqual({ [client.id]: 'Acme' })
  })

  it('goes with the project when it is removed', () => {
    const field = service.createField('p1', { name: 'Client', type: 'text' })
    service.createWorkItem('p1', { title: 'T', fieldValues: { [field.id]: 'x' } }, human)
    const deleted = deleteProjectRows(service.database, 'p1')
    expect(deleted.map((entry) => entry.table)).toEqual(
      expect.arrayContaining(['planning_fields', 'planning_field_values'])
    )
    expect(
      service.database.prepare('SELECT COUNT(*) AS n FROM planning_field_values').get()
    ).toEqual({ n: 0 })
  })
})

describe('custom field values', () => {
  const field = (type: 'text' | 'number' | 'date' | 'choice' | 'choices' | 'checkbox') => ({
    id: 'f',
    projectId: 'p',
    name: 'Field',
    type,
    options: [
      { id: 'a', name: 'Alpha', color: '#000000' },
      { id: 'b', name: 'Beta', color: '#000000' }
    ],
    position: 0,
    createdAt: 0
  })

  it('checks every type', () => {
    expect(normalizeFieldValue(field('text'), '')).toBeNull()
    expect(() => normalizeFieldValue(field('text'), 3)).toThrow('Field takes text')
    expect(normalizeFieldValue(field('number'), '4')).toBe(4)
    expect(() => normalizeFieldValue(field('number'), 'four')).toThrow('Field takes a number')
    expect(() => normalizeFieldValue(field('date'), '1/2/2026')).toThrow(/YYYY-MM-DD/)
    expect(normalizeFieldValue(field('checkbox'), false)).toBeNull()
    expect(() => normalizeFieldValue(field('checkbox'), 'yes')).toThrow(/true or false/)
    expect(() => normalizeFieldValue(field('choice'), 'c')).toThrow('Field has no such option')
    expect(normalizeFieldValue(field('choices'), ['b', 'a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFieldValue(field('choices'), [])).toBeNull()
  })

  it('reads and writes values as text, for CSV', () => {
    expect(fieldValueText(field('choices'), ['a', 'b'])).toBe('Alpha; Beta')
    expect(fieldValueText(field('checkbox'), true)).toBe('Yes')
    expect(parseFieldValueText(field('choices'), 'beta, ALPHA')).toEqual(['a', 'b'])
    expect(parseFieldValueText(field('choice'), 'Beta')).toBe('b')
    expect(() => parseFieldValueText(field('choice'), 'Gamma')).toThrow(/no such option/)
    expect(parseFieldValueText(field('checkbox'), 'Yes')).toBe(true)
    expect(parseFieldValueText(field('checkbox'), 'no')).toBeNull()
    expect(parseFieldValueText(field('number'), '1,200')).toBe(1200)
  })

  it('sorts empty last, choices by the field order', () => {
    expect(compareFieldValues(field('number'), 2, undefined)).toBeLessThan(0)
    expect(compareFieldValues(field('choice'), 'b', 'a')).toBeGreaterThan(0)
    expect(compareFieldValues(field('text'), 'item 10', 'item 9')).toBeGreaterThan(0)
  })
})
