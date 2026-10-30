import { describe, expect, it } from 'vitest'
import {
  SNIPPET_CONTEXT,
  applyMatches,
  findInText,
  findMatches,
  undoTextChanges,
  type FindReplaceTask
} from '../../src/shared/planning/find-replace'

const task = (extra: Partial<FindReplaceTask> = {}): FindReplaceTask => ({
  id: 't1',
  title: 'Call Acme',
  description: '',
  acceptanceCriteria: [],
  ...extra
})

describe('findInText (N2.5)', () => {
  it('ignores case unless match case is on', () => {
    expect(findInText('Acme and acme and ACME', 'acme')).toEqual([0, 9, 18])
    expect(findInText('Acme and acme and ACME', 'acme', { matchCase: true })).toEqual([9])
  })

  it('finds whole words only when asked', () => {
    const text = 'cat, catalog, a cat_x, bobcat; cat'
    expect(findInText(text, 'cat')).toHaveLength(5)
    expect(findInText(text, 'cat', { wholeWords: true })).toEqual([0, 31])
    expect(findInText('café cafés', 'café', { wholeWords: true })).toEqual([0])
  })

  it('treats the find text as plain text, never a pattern', () => {
    expect(findInText('a.b axb (x) [y]', 'a.b')).toEqual([0])
    expect(findInText('a.b axb (x) [y]', '(x)')).toEqual([8])
    expect(findInText('price $5 $5', '$5')).toEqual([6, 9])
  })

  it('finds several matches in one field without overlapping', () => {
    expect(findInText('aaaa', 'aa')).toEqual([0, 2])
  })
})

describe('findMatches (N2.5)', () => {
  it('finds in titles, descriptions and checklist items, with where each is', () => {
    const matches = findMatches(
      [
        task({
          title: 'Acme invoice',
          description: 'Send it to Acme. Acme pays late.',
          acceptanceCriteria: ['Acme signed', 'Filed']
        })
      ],
      'Acme',
      'Apex'
    )
    expect(matches.map((m) => [m.field, m.itemIndex, m.start])).toEqual([
      ['title', null, 0],
      ['description', null, 11],
      ['description', null, 17],
      ['checklist', 0, 0]
    ])
    expect(new Set(matches.map((m) => m.id)).size).toBe(4)
    expect(matches.every((m) => m.problem === null)).toBe(true)
  })

  it('cuts snippets at the start and end of a text', () => {
    const long = `${'x'.repeat(100)} Acme ${'y'.repeat(100)}`
    const [middle] = findMatches([task({ title: 'T', description: long })], 'Acme', 'B')
    expect(middle!.before).toHaveLength(SNIPPET_CONTEXT)
    expect(middle!.after).toHaveLength(SNIPPET_CONTEXT)
    expect(middle!.cutBefore && middle!.cutAfter).toBe(true)
    const [start] = findMatches([task({ title: 'Acme first' })], 'Acme', 'B')
    expect(start).toMatchObject({ before: '', after: ' first', cutBefore: false, cutAfter: false })
    const [end] = findMatches([task({ title: 'Last is Acme' })], 'Acme', 'B')
    expect(end).toMatchObject({ before: 'Last is ', after: '', cutBefore: false, cutAfter: false })
  })

  it('marks a match that would break a rule', () => {
    const [empty] = findMatches([task({ title: 'Acme' })], 'Acme', '  ')
    expect(empty!.problem).toBe('titleEmpty')
    const [long] = findMatches([task({ title: 'Acme' })], 'Acme', 'x'.repeat(201))
    expect(long!.problem).toBe('titleTooLong')
    const [same] = findMatches([task({ acceptanceCriteria: ['Pay Acme'] })], 'Acme', 'Apex')
    expect(same!.problem).toBeNull()
    const [merge] = findMatches(
      [task({ title: 'T', acceptanceCriteria: ['Pay Apex', 'Pay Acme'] })],
      'Acme',
      'Apex'
    )
    expect(merge!.problem).toBe('checklistDuplicate')
  })
})

describe('applyMatches (N2.5)', () => {
  it('replaces the chosen matches, and a replacement holding the find text ends', () => {
    const item = task({ title: 'cat and cat', acceptanceCriteria: ['cat food'] })
    const matches = findMatches([item], 'cat', 'catcat')
    const change = applyMatches(item, matches, 'catcat')
    expect(change).toMatchObject({
      to: { title: 'catcat and catcat', acceptanceCriteria: ['catcat food'] },
      renamed: [['cat food', 'catcat food']]
    })
  })

  it('leaves unchosen matches as they are', () => {
    const item = task({ title: 'Acme and Acme' })
    const [, second] = findMatches([item], 'Acme', 'Apex')
    expect(applyMatches(item, [second!], 'Apex')).toMatchObject({
      to: { title: 'Acme and Apex' }
    })
  })

  it('reports a task changed since the preview', () => {
    const item = task({ title: 'Call Acme' })
    const matches = findMatches([item], 'Acme', 'Apex')
    expect(applyMatches({ ...item, title: 'Call Acme now' }, matches, 'Apex')).not.toBe('changed')
    expect(applyMatches({ ...item, title: 'Phone Acme' }, matches, 'Apex')).toBe('changed')
  })

  it('refuses a result that breaks a rule', () => {
    const item = task({ title: 'T', acceptanceCriteria: ['Pay Apex', 'Pay Acme'] })
    expect(applyMatches(item, findMatches([item], 'Acme', 'Apex'), 'Apex')).toBe('invalid')
  })

  it('undo swaps from and to, and the renames', () => {
    const item = task({ title: 'Acme', acceptanceCriteria: ['Acme'] })
    const change = applyMatches(item, findMatches([item], 'Acme', 'Apex'), 'Apex')
    if (typeof change === 'string') throw new Error(change)
    const [back] = undoTextChanges([change])
    expect(back).toEqual({
      id: 't1',
      from: change.to,
      to: change.from,
      renamed: [['Apex', 'Acme']]
    })
  })
})
