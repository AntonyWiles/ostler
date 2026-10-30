import { describe, expect, it } from 'vitest'
import {
  applyColumnChange,
  statusFromColumnWord,
  STANDARD_COLUMNS,
  visibleStatuses
} from '../../src/shared/board-columns'
import { TASK_STATUSES, TASK_STATUS_LABELS, taskStatusLabel } from '../../src/shared/task-labels'
import type { PlanningColumnSettings } from '../../src/shared/ostler-api'

/** A project's column words and hidden columns (R2.4, D34). */
describe('taskStatusLabel for a project', () => {
  const columns: PlanningColumnSettings = {
    names: { backlog: 'To do', active: 'Doing', done: '   ' },
    hidden: ['review']
  }

  it('gives every status its project name, or the standard word', () => {
    expect(TASK_STATUSES.map((status) => taskStatusLabel(status, columns))).toEqual([
      'To do',
      'Ready',
      'Doing',
      'Blocked',
      'In review',
      'Done'
    ])
  })

  it('reads the standard words without settings, and keeps a hidden column named', () => {
    for (const status of TASK_STATUSES) {
      expect(taskStatusLabel(status)).toBe(TASK_STATUS_LABELS[status])
      expect(taskStatusLabel(status, null)).toBe(TASK_STATUS_LABELS[status])
      expect(taskStatusLabel(status, STANDARD_COLUMNS)).toBe(TASK_STATUS_LABELS[status])
    }
    const hiddenAndNamed: PlanningColumnSettings = {
      names: { review: 'Check' },
      hidden: ['review']
    }
    expect(taskStatusLabel('review', hiddenAndNamed)).toBe('Check')
  })

  it('offers the shown statuses, and keeps a hidden one a task is in', () => {
    expect(visibleStatuses(columns)).toEqual(['backlog', 'ready', 'active', 'blocked', 'done'])
    expect(visibleStatuses(columns, 'review')).toEqual(TASK_STATUSES)
    expect(visibleStatuses(null)).toEqual(TASK_STATUSES)
  })
})

describe('applyColumnChange', () => {
  const none: PlanningColumnSettings = { names: {}, hidden: [] }

  it('trims names, and a blank or standard name goes back to the standard word', () => {
    const named = applyColumnChange(none, { names: { backlog: '  To   do ', active: 'Doing' } })
    expect(named.names).toEqual({ backlog: 'To do', active: 'Doing' })
    expect(applyColumnChange(named, { names: { backlog: '', active: null } }).names).toEqual({})
    expect(applyColumnChange(none, { names: { done: 'Done' } }).names).toEqual({})
  })

  it('keeps hidden statuses in Board order, and refuses one that always shows', () => {
    expect(applyColumnChange(none, { hidden: ['review', 'ready'] }).hidden).toEqual([
      'ready',
      'review'
    ])
    for (const status of ['backlog', 'active', 'done'] as const)
      expect(() => applyColumnChange(none, { hidden: [status] })).toThrow(/always shows/)
  })

  it('refuses an unknown status and a name that is too long', () => {
    expect(() =>
      applyColumnChange(none, {
        names: { later: 'x' } as unknown as PlanningColumnSettings['names']
      })
    ).toThrow(/Unknown status/)
    expect(() => applyColumnChange(none, { names: { backlog: 'x'.repeat(41) } })).toThrow(/40/)
  })
})

describe('statusFromColumnWord', () => {
  it('reads the project name, the standard word or the id, ignoring case', () => {
    const columns = { names: { active: 'Doing', ready: 'Up next' } }
    expect(statusFromColumnWord('doing', columns)).toBe('active')
    expect(statusFromColumnWord('UP NEXT', columns)).toBe('ready')
    expect(statusFromColumnWord('In progress', columns)).toBe('active')
    expect(statusFromColumnWord('review', columns)).toBe('review')
    expect(statusFromColumnWord('Someday', columns)).toBeNull()
  })
})
