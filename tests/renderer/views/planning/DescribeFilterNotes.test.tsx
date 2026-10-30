// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { describeFilterNote } from '@renderer/views/planning/DescribeFilter'
import {
  FILTER_VOCABULARY_LISTS,
  LIST_KINDS,
  capVocabulary,
  readFilterAnswer,
  type FilterVocabulary
} from '@shared/filter-from-words'
import { FIELD_SPECS } from '@shared/task-filter'
import { i18n } from '@shared/i18n'

/**
 * Describe it's notes are worded from keys built at run time: one per field
 * whose values are names, one per list the vocabulary can cut. A key that is
 * missing would show as raw text, so every one Describe it can produce must
 * exist in English.
 */

/** Every field a name can be unknown in: those with a list-of-names operator. */
const nameFields = FIELD_SPECS.filter((spec) =>
  spec.ops.some((op) => LIST_KINDS.includes(op.kind))
).map((spec) => spec.field)

const EMPTY: FilterVocabulary = {
  statuses: [],
  priorities: [],
  labels: [],
  milestones: [],
  goals: [],
  iterations: [],
  types: [],
  people: [],
  contacts: []
}

describe('Describe it’s notes', () => {
  it('has an English line for an unknown name in every field of names', () => {
    expect(nameFields).toContain('type')
    for (const field of nameFields) {
      expect(i18n.exists(`tasks:describeFilter.unknown.${field}`), field).toBe(true)
    }
  })

  it('has an English line for every list that can be cut', () => {
    for (const list of FILTER_VOCABULARY_LISTS) {
      expect(i18n.exists(`tasks:describeFilter.cut.${list}`), list).toBe(true)
    }
  })

  it('words every note the answer and the vocabulary can give, never as a raw key', () => {
    const unknown = readFilterAnswer(
      {
        conditions: FIELD_SPECS.flatMap((spec) => {
          const op = spec.ops.find((candidate) => LIST_KINDS.includes(candidate.kind))
          return op ? [{ field: spec.field, op: op.op, value: ['Nowhere'] }] : []
        })
      },
      EMPTY
    ).notes
    expect(unknown.filter((note) => note.kind === 'unknownName')).toHaveLength(nameFields.length)
    const many = Array.from({ length: 300 }, (_, index) => ({
      id: `id-${index}`,
      name: `Name ${index}`
    }))
    const cut = capVocabulary({
      ...EMPTY,
      labels: many.map((entry) => entry.name),
      milestones: many,
      goals: many,
      iterations: many,
      types: many,
      people: many,
      contacts: many
    }).notes
    expect(cut).toHaveLength(FILTER_VOCABULARY_LISTS.length)
    for (const note of [...unknown, ...cut]) {
      const text = describeFilterNote(note)
      expect(text).not.toMatch(/describeFilter/)
      expect(text.length).toBeGreaterThan(0)
    }
    expect(describeFilterNote({ kind: 'unknownName', field: 'type', name: 'Bug' })).toBe(
      "Could not find a task type called 'Bug'"
    )
    expect(describeFilterNote({ kind: 'cut', list: 'types', sent: 200 })).toBe(
      'Only the first 200 task types were sent.'
    )
  })
})
