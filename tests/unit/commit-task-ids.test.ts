import { describe, expect, it } from 'vitest'
import { findCommitTaskMentions } from '../../src/shared/commit-task-ids'

/** Reading task IDs in commit messages (N9.8b). */
describe('findCommitTaskMentions', () => {
  it('reads an ID in any case, with a dash or a space', () => {
    expect(findCommitTaskMentions('SHOP', 'Work on SHOP-12')).toEqual([
      { number: 12, kind: 'mention' }
    ])
    expect(findCommitTaskMentions('SHOP', 'work on shop-12')).toEqual([
      { number: 12, kind: 'mention' }
    ])
    expect(findCommitTaskMentions('SHOP', 'Shop 7 and sHoP-8')).toEqual([
      { number: 7, kind: 'mention' },
      { number: 8, kind: 'mention' }
    ])
  })

  it('reads whole words only', () => {
    expect(findCommitTaskMentions('SHOP', 'Fixes SHOP-123')).toEqual([
      { number: 123, kind: 'fixes' }
    ])
    expect(findCommitTaskMentions('SHOP', 'WORKSHOP-12 and SHOP-12a and SHOP12')).toEqual([])
    expect(findCommitTaskMentions('SHOP', '(SHOP-4), SHOP-5.')).toEqual([
      { number: 4, kind: 'mention' },
      { number: 5, kind: 'mention' }
    ])
  })

  it('reads a branch name in a merge message', () => {
    expect(
      findCommitTaskMentions('SHOP', "Merge branch 'shop-12-fix-the-login' into main")
    ).toEqual([{ number: 12, kind: 'mention' }])
    expect(findCommitTaskMentions('SHOP', 'Merge feature/shop-3-cart')).toEqual([
      { number: 3, kind: 'mention' }
    ])
  })

  it("ignores another project's prefix", () => {
    expect(findCommitTaskMentions('SHOP', 'Fixes BLOG-12')).toEqual([])
    expect(findCommitTaskMentions('BLOG', 'Fixes BLOG-12, see SHOP-3')).toEqual([
      { number: 12, kind: 'fixes' }
    ])
  })

  it('reads every fixing word, any case, with and without a colon', () => {
    for (const word of [
      'fix',
      'fixes',
      'fixed',
      'close',
      'closes',
      'closed',
      'resolve',
      'resolves',
      'resolved'
    ]) {
      for (const said of [word, word.toUpperCase(), `${word}:`]) {
        expect(findCommitTaskMentions('SHOP', `${said} SHOP-9`), said).toEqual([
          { number: 9, kind: 'fixes' }
        ])
      }
    }
    expect(findCommitTaskMentions('SHOP', 'prefix SHOP-9')).toEqual([
      { number: 9, kind: 'mention' }
    ])
    expect(findCommitTaskMentions('SHOP', 'unfixed SHOP-9')).toEqual([
      { number: 9, kind: 'mention' }
    ])
  })

  it('reads the body too, and counts a task once, fixes winning', () => {
    expect(
      findCommitTaskMentions('SHOP', 'Start SHOP-2', 'More on shop-2.\n\nCloses: SHOP-2')
    ).toEqual([{ number: 2, kind: 'fixes' }])
  })

  it('reads nothing without a prefix', () => {
    expect(findCommitTaskMentions(null, 'Fixes SHOP-1')).toEqual([])
    expect(findCommitTaskMentions('S.*', 'Fixes S-1')).toEqual([])
  })
})
