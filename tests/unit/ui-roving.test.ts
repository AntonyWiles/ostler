import { describe, expect, it } from 'vitest'
import { nextRovingIndex, stepIndex, typeaheadIndex } from '../../src/renderer/ui/roving'

const NONE = [false, false, false, false]

describe('nextRovingIndex', () => {
  it('moves forward and back horizontally, wrapping', () => {
    expect(nextRovingIndex('ArrowRight', 0, NONE)).toBe(1)
    expect(nextRovingIndex('ArrowRight', 3, NONE)).toBe(0)
    expect(nextRovingIndex('ArrowLeft', 0, NONE)).toBe(3)
  })

  it('respects orientation', () => {
    expect(nextRovingIndex('ArrowDown', 0, NONE)).toBeNull()
    expect(nextRovingIndex('ArrowDown', 0, NONE, 'vertical')).toBe(1)
    expect(nextRovingIndex('ArrowUp', 0, NONE, 'vertical')).toBe(3)
    expect(nextRovingIndex('ArrowRight', 0, NONE, 'vertical')).toBeNull()
    expect(nextRovingIndex('ArrowDown', 0, NONE, 'both')).toBe(1)
    expect(nextRovingIndex('ArrowRight', 0, NONE, 'both')).toBe(1)
  })

  it('skips disabled items, including on Home and End', () => {
    const disabled = [true, false, true, false, true]
    expect(nextRovingIndex('ArrowRight', 1, disabled)).toBe(3)
    expect(nextRovingIndex('ArrowRight', 3, disabled)).toBe(1)
    expect(nextRovingIndex('ArrowLeft', 1, disabled)).toBe(3)
    expect(nextRovingIndex('Home', 3, disabled)).toBe(1)
    expect(nextRovingIndex('End', 1, disabled)).toBe(3)
  })

  it('returns null for unhandled keys, no items, or all disabled', () => {
    expect(nextRovingIndex('Enter', 0, NONE)).toBeNull()
    expect(nextRovingIndex('ArrowRight', 0, [])).toBeNull()
    expect(nextRovingIndex('ArrowRight', 0, [true, true])).toBeNull()
  })

  it('starts from -1 so Home-style scans work before anything is active', () => {
    expect(nextRovingIndex('ArrowRight', -1, NONE)).toBe(0)
  })
})

describe('typeaheadIndex', () => {
  const labels = ['Apple', 'Banana', 'Avocado', 'Blueberry', 'Cherry']
  const enabled = labels.map(() => false)

  it('finds the next item starting with a letter, wrapping', () => {
    expect(typeaheadIndex('a', 0, labels, enabled)).toBe(2)
    expect(typeaheadIndex('a', 2, labels, enabled)).toBe(0)
    expect(typeaheadIndex('B', 1, labels, enabled)).toBe(3)
  })

  it('matches longer queries from the current item, case-insensitively', () => {
    expect(typeaheadIndex('AV', 2, labels, enabled)).toBe(2)
    expect(typeaheadIndex('blu', 0, labels, enabled)).toBe(3)
  })

  it('skips disabled items and returns null when nothing matches', () => {
    const disabled = [false, false, true, false, false]
    expect(typeaheadIndex('a', 0, labels, disabled)).toBe(0)
    expect(typeaheadIndex('z', 0, labels, enabled)).toBeNull()
    expect(typeaheadIndex('', 0, labels, enabled)).toBeNull()
  })
})

describe('stepIndex', () => {
  it('steps forward and back, wrapping round', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
  })

  it('is 0 when there is nothing to step through', () => {
    expect(stepIndex(4, 1, 0)).toBe(0)
  })
})
