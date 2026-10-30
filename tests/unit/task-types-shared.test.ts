import { describe, expect, it } from 'vitest'
import { makeWorkItem } from '../renderer/fixtures/planning-records'
import { matchesFilter, describeValue, parseTaskFilter } from '../../src/shared/task-filter'
import { groupTasks, listGroupByOptions } from '../../src/shared/planning/list'
import { allTaskCsvColumns, tasksToCsv } from '../../src/shared/export/task-csv'
import { analyzeCsv } from '../../src/shared/import/csv-import'
import { taskTypeByName, sortTaskTypes } from '../../src/shared/task-types'

/** Task types (N2.7a) in the shared rules: the filter, the List's groups, CSV in and out. */
const types = [
  { id: 'y1', name: 'Bug', position: 0 },
  { id: 'y2', name: 'Feature', position: 1 }
]
const bug = makeWorkItem('a', { typeId: 'y1' })
const feature = makeWorkItem('b', { typeId: 'y2' })
const none = makeWorkItem('c')
const ctx = { today: '2026-10-16', meId: null }

describe('the Type filter', () => {
  const match = (value: string[], op: 'is' | 'isNot' = 'is') =>
    [bug, feature, none]
      .filter((task) =>
        matchesFilter(task, { match: 'all', conditions: [{ field: 'type', op, value }] }, ctx)
      )
      .map((task) => task.id)

  it('is one of the types, or none', () => {
    expect(match(['y1'])).toEqual(['a'])
    expect(match(['y1', 'none'])).toEqual(['a', 'c'])
    expect(match(['none'])).toEqual(['c'])
  })

  it('is not one of them', () => {
    expect(match(['y1'], 'isNot')).toEqual(['b', 'c'])
    expect(match(['none'], 'isNot')).toEqual(['a', 'b'])
  })

  it('validates as a list and reads as words', () => {
    expect(
      parseTaskFilter({ match: 'all', conditions: [{ field: 'type', op: 'is', value: ['y1'] }] })
        .conditions
    ).toHaveLength(1)
    expect(() =>
      parseTaskFilter({ match: 'all', conditions: [{ field: 'type', op: 'is', value: 'y1' }] })
    ).toThrow(/task type/)
    expect(describeValue({ field: 'type' }, 'y1', { taskType: () => 'Bug' })).toBe('Bug')
    expect(describeValue({ field: 'type' }, 'none')).toBe('no type')
  })
})

describe('grouping by type', () => {
  const context = {
    projectedStatus: (task: typeof bug) => task.status,
    milestones: [],
    people: [],
    taskTypes: types
  }

  it('makes one group per type in order, then the tasks with none or a gone type', () => {
    const gone = makeWorkItem('d', { typeId: 'deleted' })
    const groups = groupTasks([none, feature, bug, gone], 'type', context)
    expect(groups.map((group) => [group.label, group.items.map((task) => task.id)])).toEqual([
      ['Bug', ['a']],
      ['Feature', ['b']],
      ['No type', ['c', 'd']]
    ])
    expect(groups[0].quickAdd).toEqual({ typeId: 'y1' })
    expect(groups[2].quickAdd).toEqual({ typeId: null })
  })

  it('offers Type only once the project has a type', () => {
    expect(listGroupByOptions([]).some((option) => option.value === 'type')).toBe(false)
    expect(
      listGroupByOptions([], { hasTypes: true }).some((option) => option.value === 'type')
    ).toBe(true)
  })
})

describe('task types in CSV', () => {
  it('writes a Type column by name after Priority', () => {
    const columns = allTaskCsvColumns([], { types: true })
    expect(columns.indexOf('type')).toBe(columns.indexOf('priority') + 1)
    expect(allTaskCsvColumns([])).not.toContain('type')
    const text = tasksToCsv([bug, none], ['title', 'type'], {
      personName: () => null,
      milestoneName: () => null,
      typeName: (id) => types.find((type) => type.id === id)?.name ?? null,
      commentCount: () => 0,
      estimateUnit: 'points'
    })
    expect(text.replace('﻿', '').split('\r\n')).toEqual(['Title,Type', 'Item a,Bug', 'Item c,', ''])
  })

  it('reads a Type column by name, listing the types the import will create', () => {
    const { plan, preview } = analyzeCsv(
      { text: 'Title,Type\nCrash,bug\nShine,Polish\nTidy,\n', encoding: 'utf-8' },
      {},
      { milestones: [], people: [], types: ['Bug'] },
      'en-GB'
    )
    expect(preview.columns.type).toBe(1)
    expect(plan.tasks.map((task) => task.typeName ?? null)).toEqual(['bug', 'Polish', null])
    expect(preview.newTypes).toEqual(['Polish'])
  })

  it('leaves a Type column to a custom field of that name', () => {
    const field = { id: 'f1', projectId: 'p1', name: 'Type', type: 'text', options: [] }
    const { preview } = analyzeCsv(
      { text: 'Title,Type\nCrash,Web\n', encoding: 'utf-8' },
      {},
      { milestones: [], people: [], types: [], fields: [field] } as never,
      'en-GB'
    )
    expect(preview.columns.type).toBeNull()
  })
})

describe('task type helpers', () => {
  it('finds a type by name in any case, and sorts by position', () => {
    expect(taskTypeByName(types, ' feature ')?.id).toBe('y2')
    expect(taskTypeByName(types, 'chore')).toBeUndefined()
    expect(sortTaskTypes([types[1], types[0]]).map((type) => type.id)).toEqual(['y1', 'y2'])
  })
})
