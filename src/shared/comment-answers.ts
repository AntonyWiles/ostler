/**
 * An agent's answers to the line comments its task was sent back with
 * (N9.2b): done, or not done and why, for each comment by id. Pure code,
 * shared by both agent paths (the embedded plugin and the harness API), the
 * report as Ostler stores it, the automation API and Review changes.
 *
 * An answer is the agent's claim, never a fact Ostler checked: the person
 * judges it beside the excerpt and the new diff.
 */
import type {
  HarnessCommentAnswer,
  HarnessSentReviewComment,
  HarnessTaskReport,
  HarnessTaskRejection
} from './ostler-api/harness-types'
import { findDiffFile, linesInRange, type ParsedDiff } from './diff/unified-diff'

export const MAX_COMMENT_ANSWER_NOTE_LENGTH = 1000
/** Entries read from a report: twice the 50-comment limit, so a flood is bounded. */
const MAX_ANSWERS_READ = 100
const MAX_PATH_LENGTH = 500
const MAX_LINE = 10_000_000
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Control characters out, newlines kept: a note is shown as plain text. */
function plainNote(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim()
}

function lineNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return null
  const whole = Math.floor(number)
  return whole >= 1 && whole <= MAX_LINE ? whole : null
}

function relativePath(value: unknown): string | null {
  const raw = text(value)
  if (!raw || raw.length > MAX_PATH_LENGTH || raw.includes('\0')) return null
  const slashed = raw.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return null
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join('/')
}

/**
 * The answers as an agent sent them, shaped and bounded: each needs a
 * comment id and a status (`done` or `not-done`); a `not-done` needs a note;
 * notes are cut to 1,000 characters; where the change now is (a path and
 * lines in the new version) is optional. An unusable entry is dropped, so its
 * comment reads as No answer; the first answer to an id wins.
 */
export function parseCommentAnswers(value: unknown): HarnessCommentAnswer[] {
  if (!Array.isArray(value)) return []
  const answers: HarnessCommentAnswer[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_ANSWERS_READ)) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = text(candidate.id ?? candidate.commentId)
    if (!ID_PATTERN.test(id) || seen.has(id)) continue
    const status = candidate.status
    if (status !== 'done' && status !== 'not-done') continue
    const note = plainNote(text(candidate.note)).slice(0, MAX_COMMENT_ANSWER_NOTE_LENGTH)
    if (status === 'not-done' && !note) continue
    seen.add(id)
    const path = relativePath(candidate.path ?? candidate.file)
    const first = lineNumber(candidate.startLine ?? candidate.line)
    const last = lineNumber(candidate.endLine) ?? first
    answers.push({
      id,
      status,
      note,
      ...(path ? { path } : {}),
      ...(path && first !== null && last !== null
        ? { startLine: Math.min(first, last), endLine: Math.max(first, last) }
        : {})
    })
  }
  return answers
}

/**
 * The answers kept against the comments they answer: answers to ids that
 * were not in the latest rejection are ignored, and listed by id.
 */
export function matchCommentAnswers(
  answers: HarnessCommentAnswer[],
  comments: Pick<HarnessSentReviewComment, 'id'>[]
): { answers: HarnessCommentAnswer[]; ignored: string[] } {
  const known = new Set(comments.map((comment) => comment.id))
  return {
    answers: answers.filter((answer) => known.has(answer.id)),
    ignored: answers.filter((answer) => !known.has(answer.id)).map((answer) => answer.id)
  }
}

/**
 * The report as it is stored, its answers matched against the comments the
 * task was last sent back with. A report without answers passes through.
 */
export function withMatchedAnswers(
  report: HarnessTaskReport | null,
  rejections: HarnessTaskRejection[] | undefined
): HarnessTaskReport | null {
  if (!report?.commentAnswers) return report
  const { commentAnswers, ...rest } = report
  const { answers, ignored } = matchCommentAnswers(
    commentAnswers,
    rejections?.at(-1)?.comments ?? []
  )
  return {
    ...rest,
    ...(answers.length > 0 ? { commentAnswers: answers } : {}),
    ...(ignored.length > 0 ? { commentAnswersIgnored: ignored } : {})
  }
}

/**
 * The answers a report gives, or none when the attempt ended without one:
 * an attempt that did not report (outcome other than `reported`) answered
 * nothing, so every comment reads as No answer.
 */
export function reportAnswers(
  report: HarnessTaskReport | null | undefined
): HarnessCommentAnswer[] {
  if (!report || report.missing) return []
  if (report.outcome && report.outcome !== 'reported') return []
  return report.commentAnswers ?? []
}

export interface CommentWithAnswer {
  comment: HarnessSentReviewComment
  /** Null: No answer. */
  answer: HarnessCommentAnswer | null
}

/** Each comment with the report's answer to it, in the comments' order. */
export function pairCommentAnswers(
  comments: HarnessSentReviewComment[],
  report: HarnessTaskReport | null | undefined
): CommentWithAnswer[] {
  const byId = new Map(reportAnswers(report).map((answer) => [answer.id, answer]))
  return comments.map((comment) => ({ comment, answer: byId.get(comment.id) ?? null }))
}

export interface CommentAnswerCounts {
  total: number
  done: number
  notDone: number
  missing: number
}

export function countCommentAnswers(pairs: CommentWithAnswer[]): CommentAnswerCounts {
  const done = pairs.filter((pair) => pair.answer?.status === 'done').length
  const notDone = pairs.filter((pair) => pair.answer?.status === 'not-done').length
  return { total: pairs.length, done, notDone, missing: pairs.length - done - notDone }
}

/**
 * The report's alerts about answers, in English for the APIs: how many
 * comments were answered when any were not ("3 of 4 comments answered"), and
 * the ids answered that were not in the latest rejection.
 */
export function commentAnswerAlerts(
  comments: HarnessSentReviewComment[],
  report: HarnessTaskReport | null | undefined
): string[] {
  const alerts: string[] = []
  if (comments.length > 0) {
    const counts = countCommentAnswers(pairCommentAnswers(comments, report))
    if (counts.missing > 0) {
      alerts.push(`${counts.total - counts.missing} of ${counts.total} comments answered`)
    }
  }
  const ignored = report?.commentAnswersIgnored ?? []
  if (ignored.length > 0) {
    alerts.push(`Answers to comments not in the last review were ignored: ${ignored.join(', ')}`)
  }
  return alerts
}

/** Where Show goes: the answer's lines when the new diff shows them, else its file, else nothing. */
export type AnswerTarget =
  { path: string; startLine: number; endLine: number } | { path: string } | null

/**
 * Where an answer says the change now is, checked against the new diff:
 * lines the diff does not show fall back to the file, and a file the diff
 * does not have falls back to the comment's own file when the diff has that.
 */
export function answerTarget(
  parsed: ParsedDiff,
  comment: Pick<HarnessSentReviewComment, 'file'>,
  answer: HarnessCommentAnswer | null
): AnswerTarget {
  if (answer?.path) {
    const file = findDiffFile(parsed, answer.path)
    if (file) {
      if (
        answer.startLine !== undefined &&
        answer.endLine !== undefined &&
        linesInRange(file, answer.startLine, answer.endLine).length > 0
      ) {
        return { path: answer.path, startLine: answer.startLine, endLine: answer.endLine }
      }
      return { path: answer.path }
    }
  }
  return findDiffFile(parsed, comment.file) ? { path: comment.file } : null
}

/**
 * How an agent answers line comments: one rule for embedded and external
 * agents, in their standing instructions and the harness API's help.
 */
export const COMMENT_ANSWERS_GUIDANCE =
  'Answer every line comment by its id in your completion report, as commentAnswers: a list of { id, status, note, path?, startLine?, endLine? }. status is "done" or "not-done". For done, the note may say what you changed (optional), and path, startLine and endLine may say where the change now is in the new version of a file, when that helps the person find it. For not-done, the note is required: say why (you disagree, it is out of scope, you could not). Notes are plain text of up to 1000 characters. A comment you do not answer is shown to the person as No answer; an answer to an id that was not in the last review is ignored.'
