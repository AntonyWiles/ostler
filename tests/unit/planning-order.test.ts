import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { createWorkItemBatch } from '../../electron/services/planning-batch'
import { MAX_ORDER_KEY_LENGTH } from '../../src/shared/planning/order-key'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** The manual order (D31) as the service keeps it. */
describe('PlanningService manual order', () => {
  const tempDir = useTempDir('ostler-order-')
  let databasePath: string
  let service: PlanningService
  const human = { kind: 'human' } as const
  const projectIds = ['project-one', 'project-two']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    service = new PlanningService(databasePath, () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  const make = (title: string, status: 'backlog' | 'ready' | 'done' = 'ready') =>
    service.createWorkItem('project-one', { title, status }, human)
  const titles = (status?: string) =>
    service
      .listWorkItems('project-one')
      .filter((item) => !status || item.status === status)
      .map((item) => item.title)

  it('puts a new task at the end, in its column and in the project', () => {
    make('First')
    make('Second', 'backlog')
    make('Third')
    expect(titles()).toEqual(['First', 'Second', 'Third'])
    expect(titles('ready')).toEqual(['First', 'Third'])
  })

  it('never moves a task when it is edited, even to another status', () => {
    const first = make('First')
    make('Second')
    make('Third')
    service.updateWorkItem(first.id, { description: 'More words', labels: ['x'] }, human)
    expect(titles()).toEqual(['First', 'Second', 'Third'])
    const moved = service.updateWorkItem(first.id, { status: 'done' }, human)
    expect(moved.orderKey).toBe(first.orderKey)
    expect(titles()).toEqual(['First', 'Second', 'Third'])
  })

  it('moves a task before or after another, writing only its own row', () => {
    const a = make('A')
    const b = make('B')
    const c = make('C')
    const before = service.getWorkItem(b.id)
    const moved = service.moveWorkItemInOrder(c.id, { beforeId: a.id }, human)
    expect(titles()).toEqual(['C', 'A', 'B'])
    expect(moved.updatedAt).toBe(c.updatedAt)
    expect(service.getWorkItem(a.id).orderKey).toBe(a.orderKey)
    expect(service.getWorkItem(b.id)).toEqual(before)
    service.moveWorkItemInOrder(c.id, { afterId: a.id }, human)
    expect(titles()).toEqual(['A', 'C', 'B'])
    service.moveWorkItemInOrder(a.id, { afterId: b.id }, human)
    expect(titles()).toEqual(['C', 'B', 'A'])
  })

  it('moves a task to the start or end of a status, and into that status', () => {
    make('Ready one')
    make('Ready two')
    const backlog = make('Backlog', 'backlog')
    service.moveWorkItemInOrder(backlog.id, { position: 'start', status: 'ready' }, human)
    expect(titles('ready')).toEqual(['Backlog', 'Ready one', 'Ready two'])
    service.moveWorkItemInOrder(backlog.id, { position: 'end' }, human)
    expect(titles('ready')).toEqual(['Ready one', 'Ready two', 'Backlog'])
    // An empty status: it goes there and keeps its key.
    const key = service.getWorkItem(backlog.id).orderKey
    const done = service.moveWorkItemInOrder(backlog.id, { position: 'end', status: 'done' }, human)
    expect(done.status).toBe('done')
    expect(done.orderKey).toBe(key)
  })

  it('drops a card between two others in another column', () => {
    const first = make('First', 'backlog')
    const second = make('Second', 'backlog')
    const card = make('Card')
    service.moveWorkItemInOrder(card.id, { afterId: first.id, status: 'backlog' }, human)
    expect(titles('backlog')).toEqual(['First', 'Card', 'Second'])
    expect(service.getWorkItem(second.id).orderKey).toBe(second.orderKey)
  })

  it('refuses a move that does not say where, or names a task elsewhere', () => {
    const a = make('A')
    const other = service.createWorkItem('project-two', { title: 'Other' }, human)
    expect(() => service.moveWorkItemInOrder(a.id, {}, human)).toThrow()
    expect(() => service.moveWorkItemInOrder(a.id, { beforeId: a.id }, human)).toThrow()
    expect(() => service.moveWorkItemInOrder(a.id, { beforeId: other.id }, human)).toThrow()
    expect(() =>
      service.moveWorkItemInOrder(a.id, { beforeId: other.id, afterId: other.id }, human)
    ).toThrow()
  })

  it('respaces the project when one spot has been split until keys grow long', () => {
    const a = make('A')
    const b = make('B')
    make('C')
    // Always dropping the next card right after A splits the same gap.
    let previous = b
    for (let i = 0; i < 400; i++) {
      const card = make(`N${i}`)
      service.moveWorkItemInOrder(card.id, { afterId: a.id }, human)
      previous = card
    }
    const items = service.listWorkItems('project-one')
    expect(items[0].title).toBe('A')
    expect(items[1].id).toBe(previous.id)
    expect(items.at(-2)!.title).toBe('B')
    expect(Math.max(...items.map((item) => item.orderKey!.length))).toBeLessThanOrEqual(
      MAX_ORDER_KEY_LENGTH
    )
  })

  it('keeps a plan in the order its rows were listed, not the order they were made', () => {
    make('Existing')
    createWorkItemBatch(
      service,
      'project-one',
      [
        { ref: 'later', title: 'Later', dependencyRefs: ['first'] },
        { ref: 'first', title: 'First' },
        { title: 'Child', parentRef: 'later' }
      ],
      human
    )
    expect(titles()).toEqual(['Existing', 'Later', 'First', 'Child'])
  })

  it('keeps the order across a restart', () => {
    const a = make('A')
    const b = make('B')
    service.moveWorkItemInOrder(b.id, { beforeId: a.id }, human)
    service.close()
    service = new PlanningService(databasePath, () => projectIds)
    expect(titles()).toEqual(['B', 'A'])
  })
})
