import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { MAX_TASK_TYPES, TASK_TYPE_ICONS } from '../../src/shared/task-types'
import { createMigratedDatabase } from '../helpers/database'
import { formatPlanningTaskDetails } from '../../electron/services/task-intake'
import { useTempDir } from '../helpers/temp-dir'

/** Task types (N2.7a, N22) as the planning service keeps them. */
describe('PlanningService task types', () => {
  const tempDir = useTempDir('ostler-task-types-')
  let service: PlanningService
  const human = { kind: 'human' } as const

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
  })

  it('offers about forty curated icons, each named once', () => {
    expect(TASK_TYPE_ICONS.length).toBe(40)
    expect(new Set(TASK_TYPE_ICONS).size).toBe(TASK_TYPE_ICONS.length)
  })

  it('creates types in order, with a default icon and a palette colour', () => {
    const bug = service.taskTypes.create('p1', { name: ' Bug ', icon: 'bug', color: '#EF4444' })
    const chore = service.taskTypes.create('p1', { name: 'Chore' })
    expect(bug).toMatchObject({ name: 'Bug', icon: 'bug', color: '#ef4444', position: 0 })
    expect(chore.icon).toBe('circle-dot')
    expect(chore.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(chore.position).toBe(1)
    expect(service.taskTypes.list('p1').map((type) => type.name)).toEqual(['Bug', 'Chore'])
    expect(service.taskTypes.list('p2')).toEqual([])
  })

  it('refuses a taken name, an unknown icon, a bad colour and more than twenty', () => {
    service.taskTypes.create('p1', { name: 'Bug' })
    expect(() => service.taskTypes.create('p1', { name: 'bug' })).toThrow(/already/)
    expect(() => service.taskTypes.create('p1', { name: '  ' })).toThrow()
    expect(() => service.taskTypes.create('p1', { name: 'x'.repeat(41) })).toThrow()
    expect(() => service.taskTypes.create('p1', { name: 'Odd', icon: 'skull' })).toThrow(/icon/)
    expect(() => service.taskTypes.create('p1', { name: 'Odd', color: 'red' })).toThrow()
    // Another project may use the same name.
    expect(service.taskTypes.create('p2', { name: 'Bug' }).name).toBe('Bug')
    for (let index = 1; index < MAX_TASK_TYPES; index++)
      service.taskTypes.create('p1', { name: `Type ${index}` })
    expect(() => service.taskTypes.create('p1', { name: 'One too many' })).toThrow(/20/)
  })

  it('renames, recolours and reorders, refusing a rename onto another name', () => {
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    const feature = service.taskTypes.create('p1', { name: 'Feature' })
    expect(service.taskTypes.update(bug.id, { name: 'BUG', icon: 'flame' })).toMatchObject({
      name: 'BUG',
      icon: 'flame'
    })
    expect(() => service.taskTypes.update(bug.id, { name: 'feature' })).toThrow(/already/)
    expect(service.taskTypes.reorder('p1', [feature.id, bug.id]).map((type) => type.name)).toEqual([
      'Feature',
      'BUG'
    ])
    expect(() => service.taskTypes.reorder('p1', [feature.id])).toThrow()
  })

  it('gives a task one type of its own project, on create and update', () => {
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    const other = service.taskTypes.create('p2', { name: 'Bug' })
    const task = service.createWorkItem('p1', { title: 'Crash', typeId: bug.id }, human)
    expect(task.typeId).toBe(bug.id)
    expect(service.listWorkItems('p1')[0].typeId).toBe(bug.id)
    expect(() => service.createWorkItem('p1', { title: 'No', typeId: other.id }, human)).toThrow(
      /another project/
    )
    expect(service.updateWorkItem(task.id, { typeId: null }, human).typeId).toBeNull()
    expect(service.updateWorkItem(task.id, { typeId: bug.id }, human).typeId).toBe(bug.id)
  })

  it('deletes a type off its tasks at once, and undo puts both back', () => {
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    const a = service.createWorkItem('p1', { title: 'A', typeId: bug.id }, human)
    const b = service.createWorkItem('p1', { title: 'B', typeId: bug.id }, human)
    const before = service.listWorkItems('p1').find((item) => item.id === a.id)!.updatedAt

    const deletion = service.taskTypes.delete(bug.id)

    expect(deletion.taskIds.sort()).toEqual([a.id, b.id].sort())
    expect(service.taskTypes.list('p1')).toEqual([])
    expect(service.listWorkItems('p1').every((item) => item.typeId === null)).toBe(true)
    // B was given another type meanwhile: undo leaves it.
    const chore = service.taskTypes.create('p1', { name: 'Chore' })
    service.updateWorkItem(b.id, { typeId: chore.id }, human)

    expect(service.taskTypes.restore(deletion)).toMatchObject({ id: bug.id, name: 'Bug' })
    const items = new Map(service.listWorkItems('p1').map((item) => [item.id, item]))
    expect(items.get(a.id)!.typeId).toBe(bug.id)
    expect(items.get(a.id)!.updatedAt).toBe(before)
    expect(items.get(b.id)!.typeId).toBe(chore.id)
    expect(() => service.taskTypes.restore(deletion)).toThrow(/already/)
  })

  it("puts the type's name in the task text every agent receives", () => {
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    const typed = service.createWorkItem('p1', { title: 'Crash', typeId: bug.id }, human)
    const plain = service.createWorkItem('p1', { title: 'Tidy' }, human)
    const text = (item: typeof typed) =>
      formatPlanningTaskDetails(item, [], service.taskTypes.nameOf(item.typeId))
    expect(text(typed)).toContain('Type: Bug')
    expect(text(plain)).not.toContain('Type:')
    service.taskTypes.delete(bug.id)
    expect(service.taskTypes.nameOf(bug.id)).toBeNull()
  })

  it('finds a type by name, making it when there is none', () => {
    const bug = service.taskTypes.create('p1', { name: 'Bug' })
    expect(service.taskTypes.ensureByName('p1', ' bug ').id).toBe(bug.id)
    expect(service.taskTypes.ensureByName('p1', 'Errand').name).toBe('Errand')
    expect(service.taskTypes.list('p1')).toHaveLength(2)
  })
})
