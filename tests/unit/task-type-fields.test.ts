import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import {
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations/index'
import { createMigratedDatabase } from '../helpers/database'
import {
  fieldsForType,
  fieldsForTypes,
  fieldsHiddenByType,
  fieldHoldsValue,
  fillFromTypeTemplate,
  hiddenFieldsWithValues
} from '../../src/shared/task-type-fields'
import { templateFormValues } from '../../src/shared/task-templates'

/** Fields and templates by task type (N2.7b, N22). */
describe('task type fields and templates', () => {
  let tempDir: string
  let service: PlanningService
  const human = { kind: 'human' } as const

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-type-fields-'))
    service = new PlanningService(await createMigratedDatabase(tempDir), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const setUp = () => {
    const steps = service.createField('p1', { name: 'Steps to reproduce', type: 'text' })
    const version = service.createField('p1', { name: 'Version', type: 'text' })
    const customer = service.createField('p1', { name: 'Customer', type: 'text' })
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    return { steps, version, customer, bug }
  }

  it('a new type shows every field, and a chosen list keeps the project order', () => {
    const { steps, version, customer, bug } = setUp()
    expect(bug.fieldIds).toBeNull()
    expect(bug.templateId).toBeNull()
    const updated = service.taskTypes.update(bug.id, { fieldIds: [version.id, steps.id] })
    expect(updated.fieldIds).toEqual([steps.id, version.id])
    expect(service.taskTypes.get(bug.id).fieldIds).toEqual([steps.id, version.id])
    const fields = service.listFields('p1')
    expect(fieldsForType(fields, updated).map((field) => field.name)).toEqual([
      'Steps to reproduce',
      'Version'
    ])
    expect(fieldsHiddenByType(fields, updated).map((field) => field.id)).toEqual([customer.id])
    expect(fieldsForType(fields, null)).toHaveLength(3)
    // Back to every field.
    expect(service.taskTypes.update(bug.id, { fieldIds: null }).fieldIds).toBeNull()
  })

  it('refuses a field of another project or a list that is not one', () => {
    const { bug } = setUp()
    const other = service.createField('p2', { name: 'Elsewhere', type: 'text' })
    expect(() => service.taskTypes.update(bug.id, { fieldIds: [other.id] })).toThrow(/field/)
    expect(() =>
      service.taskTypes.update(bug.id, { fieldIds: 'all' as unknown as string[] })
    ).toThrow(/field/)
  })

  it('hiding a field keeps its values, and they come back with the type', () => {
    const { steps, version, bug } = setUp()
    const task = service.createWorkItem(
      'p1',
      { title: 'Crash', fieldValues: { [steps.id]: 'Click save', [version.id]: '1.2' } },
      human
    )
    service.taskTypes.update(bug.id, { fieldIds: [version.id] })
    service.updateWorkItem(task.id, { typeId: bug.id }, human)
    expect(service.getWorkItem(task.id).fieldValues).toMatchObject({
      [steps.id]: 'Click save',
      [version.id]: '1.2'
    })
    service.updateWorkItem(task.id, { typeId: null }, human)
    expect(service.getWorkItem(task.id).fieldValues?.[steps.id]).toBe('Click save')
  })

  it('deleting a field takes it off every type, and Undo puts it back', () => {
    const { steps, version, bug } = setUp()
    const feature = service.taskTypes.create('p1', { name: 'Feature' })
    service.taskTypes.update(bug.id, { fieldIds: [steps.id, version.id] })
    const deletion = service.deleteField('p1', steps.id)
    expect(deletion.typeIds).toEqual([bug.id])
    expect(service.taskTypes.get(bug.id).fieldIds).toEqual([version.id])
    expect(service.taskTypes.get(feature.id).fieldIds).toBeNull()
    service.restoreField('p1', deletion)
    expect(service.taskTypes.get(bug.id).fieldIds).toEqual([steps.id, version.id])
    // A type left with no fields shows none, rather than every field.
    service.taskTypes.update(bug.id, { fieldIds: [version.id] })
    service.deleteField('p1', version.id)
    expect(service.taskTypes.get(bug.id).fieldIds).toEqual([])
  })

  it('names a template of its project or every project, and deleting it clears the type', () => {
    const { bug } = setUp()
    const own = service.taskTemplates.save({
      name: 'Bug report',
      projectId: 'p1',
      body: { title: 'Bug: ' }
    })
    const everywhere = service.taskTemplates.save({
      name: 'Errand',
      projectId: null,
      body: { title: 'Errand' }
    })
    const elsewhere = service.taskTemplates.save({
      name: 'Other',
      projectId: 'p2',
      body: { title: 'Other' }
    })
    expect(service.taskTypes.update(bug.id, { templateId: own.id }).templateId).toBe(own.id)
    expect(service.taskTypes.update(bug.id, { templateId: everywhere.id }).templateId).toBe(
      everywhere.id
    )
    expect(() => service.taskTypes.update(bug.id, { templateId: elsewhere.id })).toThrow(
      /another project/
    )
    const deletion = service.taskTemplates.delete(everywhere.id)
    expect(deletion.typeIds).toEqual([bug.id])
    expect(service.taskTypes.get(bug.id).templateId).toBeNull()
    service.taskTemplates.restore(deletion)
    expect(service.taskTypes.get(bug.id).templateId).toBe(everywhere.id)
    // Moving an every-project template to another project takes it off this one's types.
    service.taskTemplates.update(everywhere.id, { projectId: 'p2' })
    expect(service.taskTypes.get(bug.id).templateId).toBeNull()
  })

  it('deleting a type removes its references; Undo leaves out a field deleted since', () => {
    const { steps, version, bug } = setUp()
    service.taskTypes.update(bug.id, { fieldIds: [steps.id, version.id] })
    const deletion = service.taskTypes.delete(bug.id)
    expect(service.taskTypes.list('p1')).toEqual([])
    service.deleteField('p1', steps.id)
    expect(service.taskTypes.restore(deletion).fieldIds).toEqual([version.id])
  })

  it('a task made from its type template takes the person’s entries first', () => {
    const { version, bug } = setUp()
    const template = service.taskTemplates.save({
      name: 'Bug report',
      projectId: 'p1',
      body: {
        title: 'Bug: ',
        description: 'Steps:\n1.',
        priority: 'high',
        labels: ['bug'],
        checklist: ['Reproduce'],
        fieldValues: { [version.id]: '1.0' }
      }
    })
    service.taskTypes.update(bug.id, { templateId: template.id })
    const entries = {
      title: 'Save button crashes',
      description: '',
      priority: 'medium' as const,
      labels: [],
      acceptanceCriteria: [],
      assigneeId: null,
      startDate: null,
      targetDate: '2026-11-01',
      estimate: null,
      fieldValues: { [version.id]: '2.1' }
    }
    const form = fillFromTypeTemplate(
      entries,
      templateFormValues(template.body, '2026-10-17', {
        personIds: new Set(),
        fields: service.listFields('p1')
      })
    )
    expect(form).toMatchObject({
      title: 'Save button crashes',
      description: 'Steps:\n1.',
      priority: 'high',
      labels: ['bug'],
      acceptanceCriteria: ['Reproduce'],
      targetDate: '2026-11-01',
      fieldValues: { [version.id]: '2.1' }
    })
    // Create from the form: the template's use, the form as overrides, as New task does.
    const made = service.taskTemplates.use('p1', template.id, human, { ...form, typeId: bug.id })
    expect(made.workItem).toMatchObject({
      title: 'Save button crashes',
      typeId: bug.id,
      priority: 'high',
      targetDate: '2026-11-01'
    })
    expect(made.workItem.fieldValues?.[version.id]).toBe('2.1')
  })

  it('changing the type of an existing task applies nothing from its template', () => {
    const { bug } = setUp()
    const template = service.taskTemplates.save({
      name: 'Bug report',
      projectId: 'p1',
      body: { title: 'Bug: ', description: 'From the template', labels: ['bug'] }
    })
    service.taskTypes.update(bug.id, { templateId: template.id })
    const task = service.createWorkItem('p1', { title: 'Plain' }, human)
    const changed = service.updateWorkItem(task.id, { typeId: bug.id }, human)
    expect(changed).toMatchObject({ title: 'Plain', description: '', labels: [], typeId: bug.id })
    expect(service.listWorkItems('p1')).toHaveLength(1)
  })

  it('offers the plan grid every field one of its rows’ types shows', () => {
    const fields = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const onlyA = { id: 't1', fieldIds: ['a'] }
    const onlyB = { id: 't2', fieldIds: ['b'] }
    expect(fieldsForTypes(fields, [onlyA, onlyB]).map((field) => field.id)).toEqual(['a', 'b'])
    expect(fieldsForTypes(fields, [onlyA, null])).toHaveLength(3)
    expect(fieldsForTypes(fields, [])).toHaveLength(3)
  })

  it('counts only the hidden fields that hold a value', () => {
    const fields = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }]
    const onlyA = { id: 't1', fieldIds: ['a'] }
    const values = { a: 'shown', b: 'Steps', c: '   ', d: false, e: [], f: 0 }
    // Blank text, an unticked box and no choices hold nothing; a zero does.
    expect(hiddenFieldsWithValues(fields, onlyA, values).map((field) => field.id)).toEqual([
      'b',
      'f'
    ])
    expect(hiddenFieldsWithValues(fields, null, values)).toEqual([])
    expect(fieldHoldsValue(true)).toBe(true)
    expect(fieldHoldsValue(['x'])).toBe(true)
    expect(fieldHoldsValue(null)).toBe(false)
    expect(fieldHoldsValue(undefined)).toBe(false)
  })
})

describe('migration 46 (task type fields)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-migration-46-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('keeps existing types showing every field, with no template', async () => {
    const dbPath = path.join(tempDir, 'ostler.db')
    const backupDir = path.join(tempDir, 'backups')
    await migrateOstlerDatabase(
      dbPath,
      { backupDir, appVersion: '9.9.9' },
      MIGRATIONS.filter((migration) => migration.version <= 45)
    )
    const before = new Database(dbPath)
    before
      .prepare(
        `INSERT INTO planning_task_types (id, project_id, name, icon, color, position, created_at, updated_at)
         VALUES ('t1', 'p1', 'Bug', 'bug', '#ef4444', 0, 1, 1)`
      )
      .run()
    before.close()
    const result = await migrateOstlerDatabase(dbPath, { backupDir, appVersion: '9.9.9' })
    expect(result.from).toBe(45)
    const db = new Database(dbPath)
    try {
      expect(
        db.prepare('SELECT name, field_ids, template_id FROM planning_task_types').get()
      ).toEqual({ name: 'Bug', field_ids: null, template_id: null })
    } finally {
      db.close()
    }
  })
})
