import { describe, expect, it } from 'vitest'
import {
  describeCondition,
  effectiveFilter,
  matchesFilter,
  parseTaskFilter,
  type FilterableTask,
  type TaskFilterCondition,
  type TaskFilterContext
} from '../../src/shared/task-filter'

// Wednesday 14 October 2026; its week runs Monday 12 to Sunday 18.
const TODAY = '2026-10-14'
const at = (date: string) => new Date(`${date}T12:00:00`).getTime()

function task(overrides: Partial<FilterableTask> = {}): FilterableTask {
  return {
    id: 't1',
    title: 'Paint the fence',
    description: 'Use the green colour scheme',
    status: 'ready',
    priority: 'medium',
    labels: ['garden'],
    acceptanceCriteria: [],
    checkedCriteria: [],
    milestoneId: null,
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-13'),
    ...overrides
  }
}

const ctx: TaskFilterContext = {
  today: TODAY,
  meId: 'me-1',
  goalIdForTask: (t) => (t.milestoneId === 'm1' ? 'g1' : null),
  commentCount: (t) => (t.title === 'Discussed' ? 2 : 0)
}

const one = (condition: TaskFilterCondition, t: FilterableTask, context = ctx) =>
  matchesFilter(t, { match: 'all', conditions: [condition] }, context)

type Row = [string, TaskFilterCondition, Partial<FilterableTask>, boolean]

const VALUES = {
  fieldValues: {
    'f-text': 'Acme Holdings',
    'f-num': 4,
    'f-date': '2026-11-02',
    'f-room': 'kitchen',
    'f-tags': ['one', 'three'],
    'f-ok': true
  }
}

function customRows(): Row[] {
  const c = (fieldId: string, op: TaskFilterCondition['op'], value: TaskFilterCondition['value']) =>
    ({ field: 'custom', fieldId, op, value }) as TaskFilterCondition
  return [
    ['custom text contains', c('f-text', 'contains', 'acme'), VALUES, true],
    ['custom text does not contain', c('f-text', 'notContains', 'acme'), VALUES, false],
    ['custom text is empty', c('f-text', 'isEmpty', 'empty'), {}, true],
    ['custom text is set', c('f-text', 'isEmpty', 'set'), VALUES, true],
    ['custom number between', c('f-num', 'between', [3, 5]), VALUES, true],
    ['custom number between, outside', c('f-num', 'between', [5, 9]), VALUES, false],
    ['custom number equals', c('f-num', 'equals', 4), VALUES, true],
    ['custom number less than', c('f-num', 'lessThan', 4), VALUES, false],
    ['custom number more than', c('f-num', 'greaterThan', 3), VALUES, true],
    ['custom number empty never between', c('f-num', 'between', [0, 9]), {}, false],
    ['custom date before', c('f-date', 'before', '2026-12-01'), VALUES, true],
    ['custom date after', c('f-date', 'after', '2026-12-01'), VALUES, false],
    ['custom choice is one of', c('f-room', 'is', ['hall', 'kitchen']), VALUES, true],
    ['custom choice is not', c('f-room', 'isNot', ['kitchen']), VALUES, false],
    ['custom choice is not, empty', c('f-room', 'isNot', ['kitchen']), {}, true],
    ['custom choices include any', c('f-tags', 'hasAny', ['two', 'three']), VALUES, true],
    ['custom choices include all', c('f-tags', 'hasAll', ['one', 'two']), VALUES, false],
    ['custom choices include none', c('f-tags', 'hasNone', ['two']), VALUES, true],
    ['custom checkbox ticked', c('f-ok', 'is', true), VALUES, true],
    ['custom checkbox not ticked', c('f-ok', 'is', false), {}, true],
    ['custom field deleted, is empty', c('f-gone', 'isEmpty', 'empty'), VALUES, true]
  ]
}

const ROWS: Row[] = [
  ['text in title', { field: 'text', op: 'contains', value: 'FENCE' }, {}, true],
  ['text in description', { field: 'text', op: 'contains', value: 'colour' }, {}, true],
  ['text in a label', { field: 'text', op: 'contains', value: 'gard' }, {}, true],
  [
    'text in a checklist item',
    { field: 'text', op: 'contains', value: 'primer' },
    { acceptanceCriteria: ['Primer first'] },
    true
  ],
  ['text missing', { field: 'text', op: 'contains', value: 'roof' }, {}, false],
  ['text does not contain', { field: 'text', op: 'notContains', value: 'roof' }, {}, true],
  ['status is', { field: 'status', op: 'is', value: ['ready', 'active'] }, {}, true],
  ['status is not', { field: 'status', op: 'isNot', value: ['ready'] }, {}, false],
  ['priority is', { field: 'priority', op: 'is', value: ['high'] }, { priority: 'high' }, true],
  [
    'priority is not',
    { field: 'priority', op: 'isNot', value: ['high'] },
    { priority: 'low' },
    true
  ],
  ['assignee is me', { field: 'assignee', op: 'is', value: ['me'] }, { assigneeId: 'me-1' }, true],
  [
    'assignee is me, someone else',
    { field: 'assignee', op: 'is', value: ['me'] },
    { assigneeId: 'p2' },
    false
  ],
  ['assignee is nobody', { field: 'assignee', op: 'is', value: ['nobody'] }, {}, true],
  [
    'assignee is a person',
    { field: 'assignee', op: 'is', value: ['p2'] },
    { assigneeId: 'p2' },
    true
  ],
  [
    'assignee is not me',
    { field: 'assignee', op: 'isNot', value: ['me'] },
    { assigneeId: 'p2' },
    true
  ],
  ['assignee is not me, unassigned', { field: 'assignee', op: 'isNot', value: ['me'] }, {}, true],
  ['labels any', { field: 'labels', op: 'hasAny', value: ['garden', 'home'] }, {}, true],
  ['labels all', { field: 'labels', op: 'hasAll', value: ['garden', 'home'] }, {}, false],
  [
    'labels all, both',
    { field: 'labels', op: 'hasAll', value: ['garden', 'home'] },
    { labels: ['home', 'garden'] },
    true
  ],
  ['labels none', { field: 'labels', op: 'hasNone', value: ['garden'] }, {}, false],
  ['milestone is', { field: 'milestone', op: 'is', value: ['m1'] }, { milestoneId: 'm1' }, true],
  ['milestone is none', { field: 'milestone', op: 'is', value: ['none'] }, {}, true],
  [
    'milestone is not',
    { field: 'milestone', op: 'isNot', value: ['m1'] },
    { milestoneId: 'm1' },
    false
  ],
  [
    'goal is (through milestone)',
    { field: 'goal', op: 'is', value: ['g1'] },
    { milestoneId: 'm1' },
    true
  ],
  ['subproject is', { field: 'subproject', op: 'is', value: ['s1'] }, { subprojectId: 's1' }, true],
  [
    'subproject is, another one',
    { field: 'subproject', op: 'is', value: ['s1'] },
    { subprojectId: 's2' },
    false
  ],
  ['subproject is, none set', { field: 'subproject', op: 'is', value: ['s1'] }, {}, false],
  ['subproject is none', { field: 'subproject', op: 'is', value: ['none'] }, {}, true],
  [
    'subproject is none, one set',
    { field: 'subproject', op: 'is', value: ['none'] },
    { subprojectId: 's1' },
    false
  ],
  [
    'subproject is not',
    { field: 'subproject', op: 'isNot', value: ['s1'] },
    { subprojectId: 's1' },
    false
  ],
  ['goal is none', { field: 'goal', op: 'is', value: ['none'] }, { milestoneId: 'm2' }, true],
  ['goal is not', { field: 'goal', op: 'isNot', value: ['g1'] }, {}, true],
  ['due today', { field: 'due', op: 'is', value: 'today' }, { targetDate: TODAY }, true],
  [
    'due today, tomorrow',
    { field: 'due', op: 'is', value: 'today' },
    { targetDate: '2026-10-15' },
    false
  ],
  ['due overdue', { field: 'due', op: 'is', value: 'overdue' }, { targetDate: '2026-10-13' }, true],
  [
    'due overdue, but done',
    { field: 'due', op: 'is', value: 'overdue' },
    { targetDate: '2026-10-13', status: 'done' },
    false
  ],
  [
    'due overdue, today is not',
    { field: 'due', op: 'is', value: 'overdue' },
    { targetDate: TODAY },
    false
  ],
  [
    'due this week, Monday',
    { field: 'due', op: 'is', value: 'thisWeek' },
    { targetDate: '2026-10-12' },
    true
  ],
  [
    'due this week, Sunday',
    { field: 'due', op: 'is', value: 'thisWeek' },
    { targetDate: '2026-10-18' },
    true
  ],
  [
    'due this week, next Monday',
    { field: 'due', op: 'is', value: 'thisWeek' },
    { targetDate: '2026-10-19' },
    false
  ],
  [
    'due next 7 days, +7',
    { field: 'due', op: 'is', value: 'next7Days' },
    { targetDate: '2026-10-21' },
    true
  ],
  [
    'due next 7 days, +8',
    { field: 'due', op: 'is', value: 'next7Days' },
    { targetDate: '2026-10-22' },
    false
  ],
  [
    'due next 7 days, today',
    { field: 'due', op: 'is', value: 'next7Days' },
    { targetDate: TODAY },
    false
  ],
  ['due no date', { field: 'due', op: 'is', value: 'none' }, {}, true],
  ['due set', { field: 'due', op: 'is', value: 'any' }, { targetDate: TODAY }, true],
  [
    'due before',
    { field: 'due', op: 'before', value: '2026-10-20' },
    { targetDate: '2026-10-19' },
    true
  ],
  ['due before, undated', { field: 'due', op: 'before', value: '2026-10-20' }, {}, false],
  [
    'due after',
    { field: 'due', op: 'after', value: '2026-10-20' },
    { targetDate: '2026-10-20' },
    false
  ],
  ['start today', { field: 'start', op: 'is', value: 'today' }, { startDate: TODAY }, true],
  [
    'start after',
    { field: 'start', op: 'after', value: '2026-10-01' },
    { startDate: '2026-10-02' },
    true
  ],
  ['estimate set', { field: 'estimate', op: 'is', value: 'set' }, { estimate: 0 }, true],
  ['estimate empty', { field: 'estimate', op: 'is', value: 'empty' }, {}, true],
  ['estimate equals', { field: 'estimate', op: 'equals', value: 3 }, { estimate: 3 }, true],
  ['estimate less than', { field: 'estimate', op: 'lessThan', value: 3 }, { estimate: 2 }, true],
  [
    'estimate more than',
    { field: 'estimate', op: 'greaterThan', value: 3 },
    { estimate: 3 },
    false
  ],
  ['estimate more than, none', { field: 'estimate', op: 'greaterThan', value: 0 }, {}, false],
  [
    'checklist complete',
    { field: 'checklist', op: 'is', value: 'complete' },
    { acceptanceCriteria: ['a'], checkedCriteria: ['a'] },
    true
  ],
  [
    'checklist incomplete',
    { field: 'checklist', op: 'is', value: 'incomplete' },
    { acceptanceCriteria: ['a', 'b'], checkedCriteria: ['a'] },
    true
  ],
  ['checklist, none at all', { field: 'checklist', op: 'is', value: 'incomplete' }, {}, false],
  ['has comments', { field: 'hasComments', op: 'is', value: true }, { title: 'Discussed' }, true],
  ['has no comments', { field: 'hasComments', op: 'is', value: false }, {}, true],
  ['repeats', { field: 'recurring', op: 'is', value: true }, { recurring: true }, true],
  ['does not repeat', { field: 'recurring', op: 'is', value: false }, {}, true],
  ['created this week', { field: 'created', op: 'is', value: 'thisWeek' }, {}, false],
  ['created before', { field: 'created', op: 'before', value: '2026-10-02' }, {}, true],
  ['updated last 7 days', { field: 'updated', op: 'is', value: 'last7Days' }, {}, true],
  ['updated today', { field: 'updated', op: 'is', value: 'today' }, { updatedAt: at(TODAY) }, true],
  // Custom fields (R2.2): f-text, f-num, f-date, f-room (choice), f-tags (choices), f-ok (checkbox).
  ...customRows()
]

describe('matchesFilter', () => {
  it.each(ROWS)('%s', (_name, condition, overrides, expected) => {
    // Every row is valid input as well.
    expect(parseTaskFilter({ match: 'all', conditions: [condition] }).conditions).toHaveLength(1)
    expect(one(condition, task(overrides))).toBe(expected)
  })

  it('covers every field', () => {
    const fields = new Set(ROWS.map(([, condition]) => condition.field))
    expect([...fields].sort()).toEqual(
      [
        'text',
        'status',
        'priority',
        'assignee',
        'labels',
        'milestone',
        'goal',
        'due',
        'start',
        'estimate',
        'checklist',
        'subproject',
        'hasComments',
        'recurring',
        'created',
        'updated',
        'custom'
      ].sort()
    )
  })

  it('matches everything with no conditions, and all or any of several', () => {
    const t = task({ priority: 'high' })
    expect(matchesFilter(t, { match: 'all', conditions: [] }, ctx)).toBe(true)
    const conditions: TaskFilterCondition[] = [
      { field: 'priority', op: 'is', value: ['high'] },
      { field: 'due', op: 'is', value: 'today' }
    ]
    expect(matchesFilter(t, { match: 'all', conditions }, ctx)).toBe(false)
    expect(matchesFilter(t, { match: 'any', conditions }, ctx)).toBe(true)
  })

  it('follows Me when Me changes', () => {
    const mine = { field: 'assignee', op: 'is', value: ['me'] } as TaskFilterCondition
    const t = task({ assigneeId: 'p2' })
    expect(one(mine, t)).toBe(false)
    expect(one(mine, t, { ...ctx, meId: 'p2' })).toBe(true)
    expect(one(mine, task(), { ...ctx, meId: null })).toBe(false)
  })

  it('uses the projected status when a view gives one', () => {
    const projected = { ...ctx, projectedStatus: () => 'done' as const }
    expect(one({ field: 'status', op: 'is', value: ['done'] }, task(), projected)).toBe(true)
    expect(
      one(
        { field: 'due', op: 'is', value: 'overdue' },
        task({ targetDate: '2026-01-01' }),
        projected
      )
    ).toBe(false)
  })
})

describe('parseTaskFilter', () => {
  it('checks custom field conditions by their operator', () => {
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'custom', op: 'contains', value: 'x' }] })
    ).toThrow(/needs the field's id/)
    expect(() =>
      parseTaskFilter({
        conditions: [{ field: 'custom', fieldId: 'f', op: 'between', value: [1] }]
      })
    ).toThrow(/two numbers/)
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'custom', fieldId: 'f', op: 'wobbles', value: 1 }] })
    ).toThrow(/can't use "wobbles"/)
  })

  it.each([
    [null, 'must be an object'],
    [{ match: 'some' }, 'must be "all" or "any"'],
    [{ conditions: [{ field: 'colour', op: 'is', value: 'x' }] }, 'unknown field "colour"'],
    [{ conditions: [{ field: 'due', op: 'contains', value: 'x' }] }, '"due" can\'t use "contains"'],
    [{ conditions: [{ field: 'due', op: 'is', value: 'soon' }] }, 'must be one of: today'],
    [{ conditions: [{ field: 'due', op: 'before', value: '14/10/2026' }] }, 'YYYY-MM-DD'],
    [{ conditions: [{ field: 'priority', op: 'is', value: ['urgent'] }] }, 'list of priorities'],
    [{ conditions: [{ field: 'estimate', op: 'equals', value: 'three' }] }, 'a number']
  ])('refuses %j with a plain message', (input, message) => {
    expect(() => parseTaskFilter(input)).toThrow(message)
  })

  it('defaults match to all and drops repeated list values', () => {
    expect(
      parseTaskFilter({ conditions: [{ field: 'priority', op: 'is', value: ['high', 'high'] }] })
    ).toEqual({ match: 'all', conditions: [{ field: 'priority', op: 'is', value: ['high'] }] })
  })
})

describe('describeCondition', () => {
  it('says a condition in words', () => {
    expect(describeCondition({ field: 'due', op: 'is', value: 'thisWeek' })).toBe(
      'Due is this week'
    )
    expect(describeCondition({ field: 'priority', op: 'is', value: ['high', 'critical'] })).toBe(
      'Priority is High or Critical'
    )
    expect(
      describeCondition(
        { field: 'assignee', op: 'isNot', value: ['me', 'p2'] },
        { person: (id) => (id === 'p2' ? 'Sam' : undefined) }
      )
    ).toBe('Assignee is not me or Sam')
  })

  it('describes a custom field condition with its name and option names', () => {
    const field = {
      id: 'f-room',
      projectId: 'p',
      name: 'Room',
      type: 'choice' as const,
      options: [
        { id: 'kitchen', name: 'Kitchen', color: '#000000' },
        { id: 'hall', name: 'Hall', color: '#000000' }
      ],
      position: 0,
      createdAt: 0
    }
    const names = { customField: (id: string) => (id === field.id ? field : undefined) }
    expect(
      describeCondition(
        { field: 'custom', fieldId: 'f-room', op: 'is', value: ['kitchen', 'hall'] },
        names
      )
    ).toBe('Room is one of Kitchen or Hall')
    expect(
      describeCondition(
        { field: 'custom', fieldId: 'f-room', op: 'isEmpty', value: 'empty' },
        names
      )
    ).toBe('Room is empty')
    expect(
      describeCondition({ field: 'custom', fieldId: 'gone', op: 'isEmpty', value: 'empty' }, names)
    ).toBe('A deleted field')
  })

  it('leaves conditions still being edited out of the effective filter', () => {
    expect(
      effectiveFilter({
        match: 'all',
        conditions: [
          { field: 'text', op: 'contains', value: '' },
          { field: 'labels', op: 'hasAny', value: [] },
          { field: 'due', op: 'is', value: 'today' }
        ]
      }).conditions
    ).toEqual([{ field: 'due', op: 'is', value: 'today' }])
  })
})
