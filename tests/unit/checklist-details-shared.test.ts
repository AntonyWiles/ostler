import { describe, expect, it } from 'vitest'
import {
  checklistDateLabel,
  checklistRename,
  nextDatedChecklistItem
} from '../../src/shared/planning/checklist-details'

describe('checklistRename (N2.2)', () => {
  it('finds one edited item, and nothing for any other change', () => {
    expect(checklistRename(['A', 'B'], ['A', 'Bee'])).toEqual({ from: 'B', to: 'Bee' })
    expect(checklistRename(['A', 'B'], ['A', 'B', 'C'])).toBeNull()
    expect(checklistRename(['A', 'B'], ['B', 'A'])).toBeNull()
    expect(checklistRename(['A', 'B'], ['X', 'Y'])).toBeNull()
    expect(checklistRename(['A', 'B'], ['A', 'A'])).toBeNull()
    expect(checklistRename(['A', 'B'], ['A', 'B'])).toBeNull()
  })
})

describe('nextDatedChecklistItem (N2.2)', () => {
  const details = [
    { text: 'Late', dueDate: '2026-10-20', assigneeId: null },
    { text: 'Soon', dueDate: '2026-10-17', assigneeId: null },
    { text: 'Undated', dueDate: null, assigneeId: 'sam' }
  ]

  it('picks the earliest unticked dated item before the task is due', () => {
    expect(
      nextDatedChecklistItem({ checklistDetails: details, checkedCriteria: [], targetDate: null })
    ).toMatchObject({ text: 'Soon' })
    expect(
      nextDatedChecklistItem({
        checklistDetails: details,
        checkedCriteria: ['Soon'],
        targetDate: '2026-10-25'
      })
    ).toMatchObject({ text: 'Late' })
    expect(
      nextDatedChecklistItem({
        checklistDetails: details,
        checkedCriteria: [],
        targetDate: '2026-10-17'
      })
    ).toBeNull()
  })
})

describe('checklistDateLabel (N2.2)', () => {
  const today = new Date(2026, 9, 16)
  it('says today, tomorrow, a weekday this week, else the date', () => {
    expect(checklistDateLabel('2026-10-16', today)).toBe('Today')
    expect(checklistDateLabel('2026-10-17', today)).toBe('Tomorrow')
    expect(checklistDateLabel('2026-10-20', today)).toBe('Tue')
    expect(checklistDateLabel('2026-11-20', today)).toBe('20 Nov')
  })
})
