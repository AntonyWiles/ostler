import { describe, expect, it } from 'vitest'
import type {
  HarnessSentReviewComment,
  HarnessTaskRejection,
  HarnessTaskReport
} from '@shared/ostler-api'
import {
  answerTarget,
  commentAnswerAlerts,
  countCommentAnswers,
  MAX_COMMENT_ANSWER_NOTE_LENGTH,
  matchCommentAnswers,
  pairCommentAnswers,
  parseCommentAnswers,
  withMatchedAnswers
} from '@shared/comment-answers'
import { parseReportExtras } from '@shared/agent-report-extras'
import { formatReviewCommentsForAgent } from '@shared/review-comments'
import { parseUnifiedDiff } from '@shared/diff/unified-diff'

/** Answers to line comments in an agent's report (N9.2b). */

function comment(id: string, file = 'src/a.ts'): HarnessSentReviewComment {
  return { id, file, side: 'new', firstLine: 2, lastLine: 2, comment: `fix ${id}`, excerpt: '+two' }
}

const COMMENTS = ['c1', 'c2', 'c3', 'c4'].map((id) => comment(id))

function report(extra: Partial<HarnessTaskReport> = {}): HarnessTaskReport {
  return {
    filesChanged: ['src/a.ts'],
    summary: 'Done',
    submittedAt: '2026-10-15T10:00:00.000Z',
    outcome: 'reported',
    ...extra
  }
}

describe('parseCommentAnswers', () => {
  it('reads done and not-done answers with optional where', () => {
    expect(
      parseCommentAnswers([
        {
          id: 'c1',
          status: 'done',
          note: 'Flipped it',
          path: 'src\\a.ts',
          startLine: 5,
          endLine: 3
        },
        { id: 'c2', status: 'not-done', note: 'Out of scope' },
        { id: 'c3', status: 'done' }
      ])
    ).toEqual([
      { id: 'c1', status: 'done', note: 'Flipped it', path: 'src/a.ts', startLine: 3, endLine: 5 },
      { id: 'c2', status: 'not-done', note: 'Out of scope' },
      { id: 'c3', status: 'done', note: '' }
    ])
  })

  it('drops not-done without a note, bad statuses, bad ids and repeats', () => {
    expect(
      parseCommentAnswers([
        { id: 'c1', status: 'not-done', note: '   ' },
        { id: 'c2', status: 'maybe', note: 'x' },
        { id: 'has spaces', status: 'done' },
        { id: 'c3', status: 'done', note: 'first' },
        { id: 'c3', status: 'not-done', note: 'second' },
        'c4'
      ])
    ).toEqual([{ id: 'c3', status: 'done', note: 'first' }])
    expect(parseCommentAnswers('nope')).toEqual([])
  })

  it('cuts notes to 1,000 characters and keeps them plain', () => {
    const [answer] = parseCommentAnswers([
      { id: 'c1', status: 'not-done', note: `a\u0007b\n${'x'.repeat(2000)}` }
    ])
    expect(answer.note.length).toBe(MAX_COMMENT_ANSWER_NOTE_LENGTH)
    expect(answer.note.startsWith('ab\n')).toBe(true)
  })

  it('drops a where that climbs out of the copy', () => {
    const [answer] = parseCommentAnswers([
      { id: 'c1', status: 'done', path: '../secret.ts', startLine: 1 }
    ])
    expect(answer).toEqual({ id: 'c1', status: 'done', note: '' })
  })

  it('rides in the report extras both agent paths read', () => {
    expect(
      parseReportExtras({ commentAnswers: [{ id: 'c1', status: 'done' }] }).commentAnswers
    ).toEqual([{ id: 'c1', status: 'done', note: '' }])
    expect(parseReportExtras({ commentAnswers: [] })).toEqual({})
  })
})

describe('matching answers to the latest rejection', () => {
  it('ignores ids that were not in it and lists them', () => {
    expect(
      matchCommentAnswers(
        [
          { id: 'c1', status: 'done', note: '' },
          { id: 'old', status: 'done', note: '' }
        ],
        COMMENTS
      )
    ).toEqual({ answers: [{ id: 'c1', status: 'done', note: '' }], ignored: ['old'] })
  })

  it('uses only the latest rejection', () => {
    const rejections = [
      { comments: [comment('old')] },
      { comments: [comment('c1')] }
    ] as HarnessTaskRejection[]
    const stored = withMatchedAnswers(
      report({
        commentAnswers: [
          { id: 'c1', status: 'done', note: '' },
          { id: 'old', status: 'done', note: '' }
        ]
      }),
      rejections
    )
    expect(stored?.commentAnswers).toEqual([{ id: 'c1', status: 'done', note: '' }])
    expect(stored?.commentAnswersIgnored).toEqual(['old'])
    expect(withMatchedAnswers(report(), rejections)).toEqual(report())
  })
})

describe('counts and alerts', () => {
  const answered = report({
    commentAnswers: [
      { id: 'c1', status: 'done', note: '' },
      { id: 'c2', status: 'done', note: '' },
      { id: 'c3', status: 'not-done', note: 'Disagree' }
    ]
  })

  it('counts done, not done and no answer', () => {
    expect(countCommentAnswers(pairCommentAnswers(COMMENTS, answered))).toEqual({
      total: 4,
      done: 2,
      notDone: 1,
      missing: 1
    })
    expect(commentAnswerAlerts(COMMENTS, answered)).toEqual(['3 of 4 comments answered'])
  })

  it('says nothing when every comment is answered', () => {
    expect(commentAnswerAlerts(COMMENTS.slice(0, 3), answered)).toEqual([])
  })

  it('treats an attempt that did not report as answering nothing', () => {
    const unreported = { ...answered, outcome: 'unreported' as const }
    expect(countCommentAnswers(pairCommentAnswers(COMMENTS, unreported)).missing).toBe(4)
    expect(commentAnswerAlerts(COMMENTS, null)).toEqual(['0 of 4 comments answered'])
  })

  it('lists ignored ids', () => {
    expect(commentAnswerAlerts([], report({ commentAnswersIgnored: ['x1', 'x2'] }))).toEqual([
      'Answers to comments not in the last review were ignored: x1, x2'
    ])
  })
})

describe('answerTarget', () => {
  const parsed = parseUnifiedDiff(
    [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' one',
      '+two',
      ' three'
    ].join('\n')
  )

  it('goes to the lines when the new diff shows them', () => {
    expect(
      answerTarget(parsed, comment('c1'), {
        id: 'c1',
        status: 'done',
        note: '',
        path: 'src/a.ts',
        startLine: 2,
        endLine: 2
      })
    ).toEqual({ path: 'src/a.ts', startLine: 2, endLine: 2 })
  })

  it('falls back to the file for lines outside the diff, or no lines', () => {
    expect(
      answerTarget(parsed, comment('c1'), {
        id: 'c1',
        status: 'done',
        note: '',
        path: 'src/a.ts',
        startLine: 90,
        endLine: 95
      })
    ).toEqual({ path: 'src/a.ts' })
    expect(answerTarget(parsed, comment('c1'), null)).toEqual({ path: 'src/a.ts' })
  })

  it('falls back to the comment file, or nothing', () => {
    const answer = { id: 'c1', status: 'done' as const, note: '', path: 'src/gone.ts' }
    expect(answerTarget(parsed, comment('c1'), answer)).toEqual({ path: 'src/a.ts' })
    expect(answerTarget(parsed, comment('c1', 'src/other.ts'), answer)).toBeNull()
  })
})

describe('what the agent receives', () => {
  it('shows each comment id and asks for an answer by id', () => {
    const text = formatReviewCommentsForAgent([comment('c1')])
    expect(text).toContain('[id: c1]')
    expect(text).toContain('commentAnswers')
  })
})
