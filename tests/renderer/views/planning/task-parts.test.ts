import { describe, expect, it } from 'vitest'
import {
  QUICK_PARTS,
  TASK_PARTS,
  itemHoldsPart,
  partShown,
  partsProjectUses,
  quickParts
} from '@renderer/views/planning/task-parts'
import { makeWorkItem } from '../../fixtures/planning-records'

describe('the task drawer’s optional parts', () => {
  it('shows a part the task holds, the project uses or the person added, and nothing else', () => {
    expect(partShown({ inUse: false, projectUses: false, added: false })).toBe(false)
    expect(partShown({ inUse: true, projectUses: false, added: false })).toBe(true)
    expect(partShown({ inUse: false, projectUses: true, added: false })).toBe(true)
    expect(partShown({ inUse: false, projectUses: false, added: true })).toBe(true)
  })

  it('reads what a task holds from the task itself', () => {
    const plain = makeWorkItem('a')
    const full = makeWorkItem('b', {
      startDate: '2026-10-01',
      milestoneId: 'm1',
      labels: ['home'],
      estimate: 2,
      dependencyIds: ['a'],
      impact: 3,
      fieldValues: { f1: 'Lake' }
    })
    const child = makeWorkItem('c', { parentWorkItemId: 'b' })
    for (const part of [
      'startDate',
      'milestone',
      'labels',
      'estimate',
      'waitsOn',
      'scores',
      'fields'
    ] as const) {
      expect(itemHoldsPart(plain, part), part).toBe(false)
      expect(itemHoldsPart(full, part), part).toBe(true)
    }
    expect(itemHoldsPart(full, 'subtasks', [full, child])).toBe(true)
    expect(itemHoldsPart(plain, 'subtasks', [plain, child])).toBe(false)
    // An empty field value holds nothing.
    expect(itemHoldsPart(makeWorkItem('d', { fieldValues: { f1: '  ' } }), 'fields')).toBe(false)
  })

  it('shows on every task what a third of the project’s open tasks hold', () => {
    const items = [
      makeWorkItem('1', { milestoneId: 'm1', labels: ['x'] }),
      makeWorkItem('2', { milestoneId: 'm1' }),
      makeWorkItem('3'),
      makeWorkItem('4'),
      makeWorkItem('5'),
      makeWorkItem('6', { estimate: 1 })
    ]
    const uses = partsProjectUses(items)
    expect(uses.has('milestone')).toBe(true)
    // One task is not a habit, however small the project.
    expect(uses.has('labels')).toBe(false)
    expect(uses.has('estimate')).toBe(false)
  })

  it('counts only open, top-level tasks', () => {
    const items = [
      makeWorkItem('1', { estimate: 1, status: 'done' }),
      makeWorkItem('2', { estimate: 1, archivedAt: 1 }),
      makeWorkItem('3', { estimate: 1, parentWorkItemId: '4' }),
      makeWorkItem('4'),
      makeWorkItem('5')
    ]
    expect(partsProjectUses(items).has('estimate')).toBe(false)
    expect(partsProjectUses([]).size).toBe(0)
  })

  it('offers first what the project uses, then the everyday order, and the rest under More', () => {
    const hidden = TASK_PARTS.map((part) => part.id)
    const plain = quickParts(hidden)
    expect(plain.quick).toEqual(['subtasks', 'reminders', 'repeat', 'labels'])
    expect(plain.quick.length + plain.more.length).toBe(hidden.length)

    const items = [makeWorkItem('1', { estimate: 2 }), makeWorkItem('2')]
    const led = quickParts(hidden, items)
    expect(led.quick[0]).toBe('estimate')
    expect(led.quick).toHaveLength(QUICK_PARTS)
  })
})
