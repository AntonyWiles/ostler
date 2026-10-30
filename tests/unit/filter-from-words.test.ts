import { describe, expect, it } from 'vitest'
import {
  FILTER_VOCABULARY_CAP,
  capVocabulary,
  filterGrammar,
  readFilterAnswer,
  type FilterVocabulary
} from '../../src/shared/filter-from-words'
import { FIELD_SPECS } from '../../src/shared/task-filter'

const vocabulary: FilterVocabulary = {
  statuses: [
    { value: 'ready', name: 'To do' },
    { value: 'active', name: 'Doing' },
    { value: 'done', name: 'Shipped' }
  ],
  priorities: [
    { value: 'high', name: 'High' },
    { value: 'critical', name: 'Critical' }
  ],
  labels: ['Design', 'Launch'],
  milestones: [{ id: 'm-launch', name: 'Launch' }],
  goals: [{ id: 'g-grow', name: 'Grow' }],
  iterations: [{ id: 'i-one', name: 'Sprint 1' }],
  people: [
    { id: 'p-sam', name: 'Sam Lee' },
    { id: 'p-me', name: 'Alex Kay', isMe: true }
  ]
}

describe('filterGrammar', () => {
  it('has a line for every field and operator in FIELD_SPECS', () => {
    const grammar = filterGrammar()
    for (const spec of FIELD_SPECS) {
      for (const op of spec.ops) expect(grammar).toContain(`- ${spec.field} ${op.op}: `)
    }
    expect(grammar.split('\n')).toHaveLength(FIELD_SPECS.flatMap((spec) => spec.ops).length)
  })

  it('lists the relative dates each date field offers', () => {
    expect(filterGrammar()).toMatch(/- due is: .*overdue, thisWeek, next7Days/)
    expect(filterGrammar()).toMatch(/- showFrom is: .*hidden, shown/)
  })
})

describe('readFilterAnswer', () => {
  it('maps names to ids within their own field', () => {
    const { filter, notes } = readFilterAnswer(
      {
        match: 'all',
        conditions: [
          { field: 'assignee', op: 'is', value: ['Sam'] },
          { field: 'priority', op: 'is', value: ['high'] },
          { field: 'status', op: 'isNot', value: ['Shipped'] },
          { field: 'milestone', op: 'is', value: ['Launch'] },
          { field: 'labels', op: 'hasAny', value: ['launch'] },
          { field: 'iteration', op: 'is', value: 'current' }
        ]
      },
      vocabulary
    )
    expect(notes).toEqual([])
    expect(filter).toEqual({
      match: 'all',
      conditions: [
        { field: 'assignee', op: 'is', value: ['p-sam'] },
        { field: 'priority', op: 'is', value: ['high'] },
        { field: 'status', op: 'isNot', value: ['done'] },
        { field: 'milestone', op: 'is', value: ['m-launch'] },
        { field: 'labels', op: 'hasAny', value: ['Launch'] },
        { field: 'iteration', op: 'is', value: ['current'] }
      ]
    })
  })

  it('keeps "me", "nobody" and "none" as their special values', () => {
    const { filter } = readFilterAnswer(
      {
        match: 'any',
        conditions: [
          { field: 'assignee', op: 'is', value: ['me', 'nobody'] },
          { field: 'goal', op: 'is', value: ['none'] }
        ]
      },
      vocabulary
    )
    expect(filter).toEqual({
      match: 'any',
      conditions: [
        { field: 'assignee', op: 'is', value: ['me', 'nobody'] },
        { field: 'goal', op: 'is', value: ['none'] }
      ]
    })
  })

  it('drops unknown names with a note, and a condition left with none', () => {
    const { filter, notes } = readFilterAnswer(
      {
        conditions: [
          { field: 'labels', op: 'hasAny', value: ['urgent', 'Design'] },
          { field: 'milestone', op: 'is', value: ['Design'] }
        ]
      },
      vocabulary
    )
    expect(filter.conditions).toEqual([{ field: 'labels', op: 'hasAny', value: ['Design'] }])
    expect(notes).toEqual([
      { kind: 'unknownName', field: 'labels', name: 'urgent' },
      { kind: 'unknownName', field: 'milestone', name: 'Design' }
    ])
  })

  it('keeps relative and ISO dates, and drops a date that is neither', () => {
    const { filter, notes } = readFilterAnswer(
      {
        conditions: [
          { field: 'due', op: 'is', value: 'overdue' },
          { field: 'due', op: 'before', value: '2026-11-01' },
          { field: 'start', op: 'after', value: 'next Friday' }
        ]
      },
      vocabulary
    )
    expect(filter.conditions).toEqual([
      { field: 'due', op: 'is', value: 'overdue' },
      { field: 'due', op: 'before', value: '2026-11-01' }
    ])
    expect(notes).toEqual([{ kind: 'unusable', field: 'start' }])
  })

  it('drops unknown fields and operators, and custom fields', () => {
    const { filter, notes } = readFilterAnswer(
      {
        conditions: [
          { field: 'colour', op: 'is', value: 'red' },
          { field: 'due', op: 'contains', value: 'x' },
          { field: 'custom', fieldId: 'f1', op: 'contains', value: 'x' },
          { field: 'text', op: 'contains', value: '  ' }
        ]
      },
      vocabulary
    )
    expect(filter.conditions).toEqual([])
    expect(notes.map((note) => note.kind)).toEqual(['unusable', 'unusable', 'unusable', 'unusable'])
  })

  it('reads anything that is not a filter as no filter', () => {
    expect(readFilterAnswer([], vocabulary).filter.conditions).toEqual([])
    expect(readFilterAnswer({ conditions: 'due' }, vocabulary).filter.conditions).toEqual([])
  })
})

describe('capVocabulary', () => {
  it('cuts long lists and says which', () => {
    const labels = Array.from({ length: FILTER_VOCABULARY_CAP + 5 }, (_, i) => `label ${i}`)
    const capped = capVocabulary({ ...vocabulary, labels })
    expect(capped.vocabulary.labels).toHaveLength(FILTER_VOCABULARY_CAP)
    expect(capped.notes).toEqual([{ kind: 'cut', list: 'labels', sent: FILTER_VOCABULARY_CAP }])
    expect(capVocabulary(vocabulary).notes).toEqual([])
  })
})
