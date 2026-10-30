import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../../src/shared/diff/unified-diff'
import {
  commentExcerpt,
  formatReviewCommentsForAgent,
  latestReviewComments,
  MAX_EXCERPT_LINES,
  MAX_REVIEW_COMMENT_LENGTH,
  MAX_REVIEW_COMMENTS,
  normalizeReviewComment,
  normalizeReviewComments,
  pruneRejectionComments,
  withExcerpts
} from '../../src/shared/review-comments'
import { sendBackNote, withSendBackNotes } from '../../electron/services/harness/task-queue'
import type { HarnessTaskRejection } from '../../src/shared/ostler-api'

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,5 +1,5 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  ' five',
  '@@ -20,4 +20,5 @@ function later()',
  ' twenty',
  ' twenty-one',
  '+inserted',
  ' twenty-two',
  ' twenty-three',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 3333333..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-first',
  '-second',
  ''
].join('\n')

const parsed = parseUnifiedDiff(PATCH)
const id = () => 'generated'

describe('commentExcerpt', () => {
  it('takes the commented line with three lines around it, at the start of a file', () => {
    expect(
      commentExcerpt(parsed, { file: 'src/app.ts', side: 'new', firstLine: 1, lastLine: 1 })
    ).toBe(['@@ -1,5 +1,5 @@', ' one', '-two', '+TWO', ' three'].join('\n'))
  })

  it('stops at the end of a file', () => {
    expect(
      commentExcerpt(parsed, { file: 'src/app.ts', side: 'new', firstLine: 24, lastLine: 24 })
    ).toBe([' twenty-one', '+inserted', ' twenty-two', ' twenty-three'].join('\n'))
  })

  it('anchors a removed line on the old side', () => {
    expect(
      commentExcerpt(parsed, { file: 'src/app.ts', side: 'old', firstLine: 2, lastLine: 2 })
    ).toBe(['@@ -1,5 +1,5 @@', ' one', '-two', '+TWO', ' three', ' four'].join('\n'))
    // The old side holds removed lines only, so a context line there is not found.
    expect(
      commentExcerpt(parsed, { file: 'src/app.ts', side: 'old', firstLine: 1, lastLine: 1 })
    ).toBeNull()
    expect(
      commentExcerpt(parsed, { file: 'src/gone.ts', side: 'old', firstLine: 1, lastLine: 2 })
    ).toBe(['@@ -1,2 +0,0 @@', '-first', '-second'].join('\n'))
  })

  it('takes a range across a hunk boundary with the hunk line between', () => {
    const excerpt = commentExcerpt(parsed, {
      file: 'src/app.ts',
      side: 'new',
      firstLine: 5,
      lastLine: 20
    })!
    expect(excerpt.split('\n')).toEqual([
      '+TWO',
      ' three',
      ' four',
      ' five',
      '@@ -20,4 +20,5 @@ function later()',
      ' twenty',
      ' twenty-one',
      '+inserted',
      ' twenty-two'
    ])
  })

  it('is null for lines or a file the diff does not show', () => {
    expect(
      commentExcerpt(parsed, { file: 'src/app.ts', side: 'new', firstLine: 10, lastLine: 12 })
    ).toBeNull()
    expect(
      commentExcerpt(parsed, { file: 'src/none.ts', side: 'new', firstLine: 1, lastLine: 1 })
    ).toBeNull()
  })

  it('keeps an excerpt to 40 lines', () => {
    const body = Array.from({ length: 100 }, (_, index) => `+line ${index + 1}`)
    const big = parseUnifiedDiff(
      ['--- /dev/null', '+++ b/big.ts', '@@ -0,0 +1,100 @@', ...body].join('\n')
    )
    const excerpt = commentExcerpt(big, {
      file: 'big.ts',
      side: 'new',
      firstLine: 10,
      lastLine: 80
    })
    expect(excerpt!.split('\n')).toHaveLength(MAX_EXCERPT_LINES)
    expect(excerpt!.split('\n')[0]).toBe('+line 10')
    const small = commentExcerpt(big, { file: 'big.ts', side: 'new', firstLine: 50, lastLine: 50 })
    expect(small!.split('\n')).toEqual([
      '+line 47',
      '+line 48',
      '+line 49',
      '+line 50',
      '+line 51',
      '+line 52',
      '+line 53'
    ])
  })

  it('refuses to send a comment whose lines the diff does not show', () => {
    expect(() =>
      withExcerpts(parsed, [
        { id: 'a', file: 'src/app.ts', side: 'new', firstLine: 40, lastLine: 40, comment: 'x' }
      ])
    ).toThrow(/does not show/)
  })
})

describe('the limits', () => {
  it('checks a comment and fills in what may be left out', () => {
    expect(
      normalizeReviewComment({ file: 'src\\app.ts', firstLine: 3, comment: '  Backwards  ' }, id)
    ).toEqual({
      id: 'generated',
      file: 'src/app.ts',
      side: 'new',
      firstLine: 3,
      lastLine: 3,
      comment: 'Backwards'
    })
  })

  it('refuses bad lines, an empty or long comment, and a bad side', () => {
    const base = { file: 'a.ts', firstLine: 2, lastLine: 3, comment: 'ok' }
    expect(() => normalizeReviewComment({ ...base, firstLine: 0 }, id)).toThrow()
    expect(() => normalizeReviewComment({ ...base, lastLine: 1 }, id)).toThrow()
    expect(() => normalizeReviewComment({ ...base, firstLine: 1.5 }, id)).toThrow()
    expect(() => normalizeReviewComment({ ...base, comment: '  ' }, id)).toThrow()
    expect(() =>
      normalizeReviewComment({ ...base, comment: 'x'.repeat(MAX_REVIEW_COMMENT_LENGTH + 1) }, id)
    ).toThrow(/2000/)
    expect(() => normalizeReviewComment({ ...base, side: 'left' }, id)).toThrow()
    expect(() => normalizeReviewComment({ ...base, id: 'has spaces' }, id)).toThrow()
  })

  it('takes at most 50 comments, with unique ids', () => {
    const one = { file: 'a.ts', firstLine: 1, comment: 'c' }
    let n = 0
    const counter = () => `c${n++}`
    expect(normalizeReviewComments(Array(MAX_REVIEW_COMMENTS).fill(one), counter)).toHaveLength(50)
    expect(() => normalizeReviewComments(Array(MAX_REVIEW_COMMENTS + 1).fill(one), id)).toThrow(
      /50/
    )
    expect(() =>
      normalizeReviewComments(
        [
          { ...one, id: 'same' },
          { ...one, id: 'same' }
        ],
        id
      )
    ).toThrow(/unique/)
  })

  it('keeps comments on the latest three rejections only, with their count', () => {
    const rejection = (n: number): HarnessTaskRejection => ({
      reason: `r${n}`,
      rejectedAt: '',
      disposition: 'retry',
      sessionId: `s${n}`,
      comments: [
        {
          id: `c${n}`,
          file: 'a',
          side: 'new',
          firstLine: 1,
          lastLine: 1,
          comment: 'c',
          excerpt: ''
        }
      ],
      commentCount: 1
    })
    const pruned = pruneRejectionComments([1, 2, 3, 4].map(rejection))
    expect(pruned.map((entry) => Boolean(entry.comments))).toEqual([false, true, true, true])
    expect(pruned[0].commentCount).toBe(1)
    expect(latestReviewComments(pruned)[0].id).toBe('c4')
    expect(latestReviewComments(undefined)).toEqual([])
  })
})

describe('the details line', () => {
  it('says how many line comments went with the reason', () => {
    expect(sendBackNote(2, 'See the line comments', 4)).toBe(
      '\n\n[Sent back 2] See the line comments (4 line comments)'
    )
    expect(sendBackNote(1, 'Wrong file', 1)).toBe('\n\n[Sent back 1] Wrong file (1 line comment)')
    expect(sendBackNote(1, 'Wrong file')).toBe('\n\n[Sent back 1] Wrong file')
  })

  it('stays within the 8,000-character cap', () => {
    const details = withSendBackNotes('x'.repeat(7990), [
      { reason: 'Fix it', rejectedAt: '', disposition: 'retry', sessionId: 's', commentCount: 3 }
    ])
    expect(details.length).toBe(8000)
  })
})

describe('formatReviewCommentsForAgent', () => {
  it('numbers the comments with file, lines, excerpt and comment', () => {
    const text = formatReviewCommentsForAgent([
      {
        id: 'a',
        file: 'src/app.ts',
        side: 'new',
        firstLine: 2,
        lastLine: 3,
        comment: 'This check is backwards',
        excerpt: '+TWO'
      },
      {
        id: 'b',
        file: 'src/app.ts',
        side: 'old',
        firstLine: 2,
        lastLine: 2,
        comment: 'Keep this',
        excerpt: '-two'
      }
    ])
    expect(text).toContain('Line comments from the last review (2).')
    expect(text).toContain(
      '1. [id: a] src/app.ts, lines 2-3\n```diff\n+TWO\n```\nComment: This check is backwards'
    )
    expect(text).toContain('2. [id: b] src/app.ts, removed line 2 (old version)')
    expect(text).toContain('the attempt that was sent back')
    expect(formatReviewCommentsForAgent([])).toBe('')
  })
})
