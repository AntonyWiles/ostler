import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import {
  applyColumnChange,
  orderedColumns,
  placeOfKey,
  statusFromColumnWord,
  taskColumnKey,
  visibleColumnPlaces
} from '../../src/shared/board-columns'
import { taskColumnLabel } from '../../src/shared/task-labels'
import { conditionHolds, planActions, triggerFires } from '../../src/shared/planning/rules'
import { matchesFilter } from '../../src/shared/task-filter'
import type { PlanningColumnSettings, PlanningWorkItem } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** Columns of a project's own (MOP-26): each counts as one of the six statuses. */
describe('custom columns, shared rules', () => {
  const settings: PlanningColumnSettings = {
    names: {},
    hidden: ['blocked'],
    custom: [
      { id: 'c-test', name: 'Testing', countsAs: 'active', hidden: false },
      { id: 'c-wait', name: 'Waiting for client', countsAs: 'blocked', hidden: true }
    ]
  }

  it('adds, keeps and orders columns after the status each counts as', () => {
    const added = applyColumnChange(
      { names: {}, hidden: [] },
      {
        custom: [
          { name: '  Waiting   for client ', countsAs: 'blocked' },
          { name: 'Testing', countsAs: 'active' }
        ]
      }
    )
    expect(added.custom?.map((column) => [column.name, column.countsAs])).toEqual([
      ['Testing', 'active'],
      ['Waiting for client', 'blocked']
    ])
    const id = added.custom![0].id
    expect(id).toBeTruthy()
    // A known id keeps its column; one left out is deleted.
    const renamed = applyColumnChange(added, {
      custom: [{ id, name: 'QA', countsAs: 'active' }]
    })
    expect(renamed.custom).toEqual([{ id, name: 'QA', countsAs: 'active', hidden: false }])
    expect(applyColumnChange(renamed, { custom: [] })).toEqual({ names: {}, hidden: [] })
  })

  it('refuses a blank name, a standard word, a name twice and an unknown status', () => {
    const base = { names: {}, hidden: [] }
    expect(() => applyColumnChange(base, { custom: [{ name: ' ', countsAs: 'done' }] })).toThrow(
      'A column needs a name'
    )
    expect(() =>
      applyColumnChange(base, { custom: [{ name: 'in progress', countsAs: 'done' }] })
    ).toThrow('There is already a column called')
    expect(() =>
      applyColumnChange(base, {
        custom: [
          { name: 'QA', countsAs: 'active' },
          { name: 'qa', countsAs: 'review' }
        ]
      })
    ).toThrow('There is already a column called')
    expect(() =>
      applyColumnChange(base, {
        custom: [{ name: 'QA', countsAs: 'later' as never }]
      })
    ).toThrow('Unknown status')
  })

  it('names a task by its column while the column counts as its status', () => {
    const task = { status: 'active' as const, columnId: 'c-test' }
    expect(taskColumnLabel(task, settings)).toBe('Testing')
    expect(taskColumnKey(task, settings)).toBe('custom:c-test')
    // Moved on by an agent or a rule: the status's own column.
    expect(taskColumnLabel({ status: 'review', columnId: 'c-test' }, settings)).toBe('In review')
    expect(taskColumnKey({ status: 'review', columnId: 'c-test' }, settings)).toBe('review')
    // A queued agent's run shows its own status.
    expect(taskColumnKey(task, settings, 'review')).toBe('review')
    expect(taskColumnLabel({ status: 'active', columnId: 'gone' }, settings)).toBe('In progress')
  })

  it('lists the columns in Board order, and offers the shown ones', () => {
    expect(orderedColumns(settings).map(({ status, custom }) => custom?.name ?? status)).toEqual([
      'backlog',
      'ready',
      'active',
      'Testing',
      'blocked',
      'Waiting for client',
      'review',
      'done'
    ])
    expect(visibleColumnPlaces(settings).map((place) => place.label)).toEqual([
      'Backlog',
      'Ready',
      'In progress',
      'Testing',
      'In review',
      'Done'
    ])
    // A task's own hidden column stays on offer.
    expect(visibleColumnPlaces(settings, 'custom:c-wait').map((place) => place.key)).toContain(
      'custom:c-wait'
    )
    expect(placeOfKey('custom:c-wait', settings)).toEqual({
      key: 'custom:c-wait',
      status: 'blocked',
      columnId: 'c-wait'
    })
    expect(placeOfKey('custom:gone', settings)).toBeNull()
    expect(statusFromColumnWord('testing', settings)).toBe('active')
  })

  it('lets rules name a column: status is, status changes to, and move to', () => {
    const task = {
      id: 't',
      status: 'active',
      columnId: 'c-test',
      labels: [],
      acceptanceCriteria: []
    } as unknown as PlanningWorkItem
    const inTesting = { kind: 'status', op: 'is', status: 'active', columnId: 'c-test' } as const
    expect(conditionHolds(inTesting, task)).toBe(true)
    expect(conditionHolds(inTesting, { ...task, columnId: null })).toBe(false)
    // "In progress" takes every task counting as it.
    expect(conditionHolds({ kind: 'status', op: 'is', status: 'active' }, task)).toBe(true)

    const toTesting = { kind: 'statusChanged', to: 'active', toColumnId: 'c-test' } as const
    expect(triggerFires(toTesting, { task, statusFrom: 'active', columnFrom: null })).toBe(true)
    expect(triggerFires(toTesting, { task, statusFrom: 'ready', columnFrom: null })).toBe(true)
    // A move into Testing is not a move to In progress, which it already counted as.
    expect(
      triggerFires({ kind: 'statusChanged', to: 'active' }, { task, statusFrom: 'active' })
    ).toBe(false)

    const plan = planActions({ ...task, columnId: null }, [
      { kind: 'setStatus', status: 'active', columnId: 'c-test' }
    ])
    expect(plan.patch).toEqual({ status: 'active', columnId: 'c-test' })
    expect(
      planActions(task, [{ kind: 'setStatus', status: 'active', columnId: 'c-test' }]).effects[0]
        .outcome
    ).toBe('none')
    expect(planActions(task, [{ kind: 'setStatus', status: 'active' }]).patch).toEqual({
      status: 'active',
      columnId: null
    })
  })

  it('filters by a column, and by a status that takes its columns too', () => {
    const task = {
      id: 't',
      title: 'Check',
      description: '',
      status: 'active',
      columnId: 'c-test',
      priority: 'medium',
      labels: [],
      acceptanceCriteria: []
    } as unknown as PlanningWorkItem
    const ctx = { today: '2026-10-28', meId: null }
    const filter = (value: string[]) => ({
      match: 'all' as const,
      conditions: [{ field: 'status' as const, op: 'is' as const, value }]
    })
    expect(matchesFilter(task, filter(['custom:c-test']), ctx)).toBe(true)
    expect(matchesFilter(task, filter(['active']), ctx)).toBe(true)
    expect(matchesFilter({ ...task, columnId: null }, filter(['custom:c-test']), ctx)).toBe(false)
  })
})

describe('custom columns, planning service', () => {
  const tempDir = useTempDir('ostler-custom-columns-')
  let service: PlanningService
  const human = { kind: 'human' } as const
  const free = { agentsLocked: false }

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
  })

  const addTesting = () =>
    service.columns.update('p1', { custom: [{ name: 'Testing', countsAs: 'active' }] }, free)
      .custom![0]

  it('keeps a project’s own columns, and a task in one has its status', () => {
    const testing = addTesting()
    expect(service.columns.get('p1').custom).toEqual([testing])
    expect(service.columns.get('p2').custom).toBeUndefined()
    const task = service.createWorkItem(
      'p1',
      { title: 'Try it', status: 'backlog', columnId: testing.id },
      human
    )
    expect(task).toMatchObject({ status: 'active', columnId: testing.id })
    expect(service.getWorkItem(task.id)).toMatchObject({ status: 'active', columnId: testing.id })
    // Another project's column, or none at all, is refused.
    expect(() =>
      service.createWorkItem('p2', { title: 'No', columnId: testing.id }, human)
    ).toThrow('isn’t one of this project’s columns')
  })

  it('a new status leaves the column; the column moves the status', () => {
    const testing = addTesting()
    const task = service.createWorkItem('p1', { title: 'Try it', columnId: testing.id }, human)
    const back = service.updateWorkItem(task.id, { status: 'review' }, human)
    expect(back).toMatchObject({ status: 'review', columnId: null })
    const again = service.updateWorkItem(task.id, { columnId: testing.id }, human)
    expect(again).toMatchObject({ status: 'active', columnId: testing.id })
    // Another field's change keeps it there.
    expect(service.updateWorkItem(task.id, { title: 'Renamed' }, human).columnId).toBe(testing.id)
    // Back to the status's own column without a status change.
    expect(service.updateWorkItem(task.id, { columnId: null }, human)).toMatchObject({
      status: 'active',
      columnId: null
    })
    // A move in the manual order into the column.
    const moved = service.moveWorkItemInOrder(
      task.id,
      { position: 'start', status: 'active', columnId: testing.id },
      human
    )
    expect(moved).toMatchObject({ status: 'active', columnId: testing.id })
  })

  it('refuses to hide or re-count a column with tasks, and deleting one sends them back', () => {
    const testing = addTesting()
    const task = service.createWorkItem('p1', { title: 'Try it', columnId: testing.id }, human)
    expect(() =>
      service.columns.update('p1', { custom: [{ ...testing, hidden: true }] }, free)
    ).toThrow('Testing can’t be hidden while 1 task is in it')
    expect(() =>
      service.columns.update('p1', { custom: [{ ...testing, countsAs: 'review' }] }, free)
    ).toThrow('Testing can’t count as another status while 1 task is in it')
    // Renaming is fine.
    service.columns.update('p1', { custom: [{ ...testing, name: 'QA' }] }, free)
    expect(service.columns.get('p1').custom![0].name).toBe('QA')
    service.columns.update('p1', { custom: [] }, free)
    expect(service.getWorkItem(task.id)).toMatchObject({ status: 'active', columnId: null })
  })

  it('a rule can move a task into a column, and is refused one the project lacks', () => {
    const testing = addTesting()
    service.rules.create('p1', {
      name: 'Test what is done',
      trigger: { kind: 'statusChanged', to: 'review' },
      conditions: [],
      actions: [{ kind: 'setStatus', status: 'active', columnId: testing.id }]
    })
    const task = service.createWorkItem('p1', { title: 'Try it', status: 'active' }, human)
    const after = service.updateWorkItem(task.id, { status: 'review' }, human)
    expect(service.getWorkItem(after.id)).toMatchObject({ status: 'active', columnId: testing.id })
    expect(() =>
      service.rules.create('p1', {
        name: 'Wrong',
        trigger: { kind: 'taskCreated' },
        conditions: [],
        actions: [{ kind: 'setStatus', status: 'done', columnId: testing.id }]
      })
    ).toThrow('isn’t one of this project’s columns')
  })

  it('a file’s own columns come before its tasks, matched by name', () => {
    const testing = addTesting()
    const ids = service.columns.bringIn('p1', [
      { name: 'testing', countsAs: 'active' },
      { name: 'Testing', countsAs: 'review' },
      { name: 'Signed off', countsAs: 'done' }
    ])
    expect(ids[0]).toBe(testing.id)
    expect(ids[1]).toBeNull()
    expect(service.columns.get('p1').custom?.map((column) => column.name)).toEqual([
      'Testing',
      'Signed off'
    ])
    // Names and hidden columns from a file leave the project's own columns alone.
    service.columns.adopt('p1', { names: { done: 'Shipped' }, hidden: [] }, free)
    expect(service.columns.get('p1').custom).toHaveLength(2)
  })
})
