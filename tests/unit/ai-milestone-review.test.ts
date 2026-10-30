import { describe, expect, it } from 'vitest'
import { clipForModel, perRecordBudget } from '../../src/shared/ai-evidence'
import { milestoneAction } from '../../electron/services/ai-planning-service'

describe('clipForModel', () => {
  it('leaves short text alone', () => {
    expect(clipForModel('short', 100)).toBe('short')
  })

  it('cuts at a word and says Ostler shortened it', () => {
    const clipped = clipForModel('the production build checks every route', 25)
    expect(clipped.startsWith('the production build … [Ostler shortened')).toBe(true)
    expect(clipped).toContain('not incomplete')
  })

  it('gives one record the whole budget and many a fair share', () => {
    expect(perRecordBudget(1, 24000, 800, 6000)).toBe(6000)
    expect(perRecordBudget(100, 24000, 800, 6000)).toBe(800)
  })
})

describe('milestoneAction', () => {
  const known = {
    workItemIds: new Set(['task-1']),
    libraryItems: new Map([['lib-1', 'Graphics note']])
  }

  it('keeps actions whose ids the model was shown', () => {
    expect(
      milestoneAction({ kind: 'add-acceptance-criterion', workItemId: 'task-1', text: 'x' }, known)
    ).toEqual({ kind: 'add-acceptance-criterion', workItemId: 'task-1', text: 'x' })
    expect(milestoneAction({ kind: 'include-library-item', itemId: 'lib-1' }, known)).toEqual({
      kind: 'include-library-item',
      itemId: 'lib-1',
      title: 'Graphics note'
    })
  })

  it('drops invented ids, unknown kinds and empty text', () => {
    expect(
      milestoneAction({ kind: 'add-acceptance-criterion', workItemId: 'nope', text: 'x' }, known)
    ).toBeNull()
    expect(milestoneAction({ kind: 'include-library-item', itemId: 'nope' }, known)).toBeNull()
    expect(milestoneAction({ kind: 'queue-task' }, known)).toBeNull()
    expect(milestoneAction({ kind: 'add-success-criterion', text: '  ' }, known)).toBeNull()
  })
})
