/**
 * Comments on lines of an agent's change (N9.2a): the limits, checking a
 * comment that came over IPC or HTTP, the excerpt Send back takes from the
 * diff, and the words agents read. Pure code, shared by main (Send back, the
 * prompts, the APIs) and the renderer (Review changes).
 */
import type {
  HarnessReviewComment,
  HarnessSentReviewComment,
  HarnessTaskRejection
} from './ostler-api'
import { findDiffFile, type DiffFile, type DiffLine, type ParsedDiff } from './diff/unified-diff'
import { Refusal } from './refusal'
import { COMMENT_ANSWERS_GUIDANCE } from './comment-answers'

export const MAX_REVIEW_COMMENTS = 50
export const MAX_REVIEW_COMMENT_LENGTH = 2000
/** Lines kept around the commented ones in an excerpt. */
export const EXCERPT_CONTEXT_LINES = 3
export const MAX_EXCERPT_LINES = 40
/** A longer line is cut in an excerpt, so `state.json` stays bounded. */
const MAX_EXCERPT_LINE_LENGTH = 400
/** Only the latest rejections keep their comments. */
export const REJECTIONS_KEEPING_COMMENTS = 3
/** The reason Send back records when the person wrote none but left line comments. Text for agents. */
export const SEE_LINE_COMMENTS = 'See the line comments'

/** What an anchor needs; the id is optional where Ostler makes one. */
export type ReviewCommentInput = Omit<HarnessReviewComment, 'id'> & { id?: string }

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * A comment from outside main, checked: a file, a side, whole positive line
 * numbers (first no later than last) and 1 to 2,000 characters of text.
 * `makeId` supplies an id when the input has none.
 */
export function normalizeReviewComment(input: unknown, makeId: () => string): HarnessReviewComment {
  if (!input || typeof input !== 'object') throw new Refusal('Each comment must be an object')
  const value = input as Record<string, unknown>
  const file = typeof value.file === 'string' ? value.file.trim().replace(/\\/g, '/') : ''
  if (!file || file.length > 1000) throw new Refusal('Each comment needs the file it is on')
  const side = value.side === undefined ? 'new' : value.side
  if (side !== 'new' && side !== 'old') throw new Refusal('side must be "new" or "old"')
  const firstLine = value.firstLine
  const lastLine = value.lastLine === undefined ? firstLine : value.lastLine
  if (
    typeof firstLine !== 'number' ||
    typeof lastLine !== 'number' ||
    !Number.isInteger(firstLine) ||
    !Number.isInteger(lastLine) ||
    firstLine < 1 ||
    lastLine < firstLine
  ) {
    throw new Refusal('firstLine and lastLine must be line numbers, first no later than last')
  }
  const comment = typeof value.comment === 'string' ? value.comment.trim() : ''
  if (!comment) throw new Refusal('Each comment needs its text')
  if (comment.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new Refusal(`A comment can be at most ${MAX_REVIEW_COMMENT_LENGTH} characters`)
  }
  let id = value.id
  if (id === undefined || id === null || id === '') id = makeId()
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Refusal('Invalid comment id')
  return { id, file, side, firstLine, lastLine, comment }
}

/** A list of comments from outside main: at most 50, each checked, ids unique. */
export function normalizeReviewComments(
  input: unknown,
  makeId: () => string
): HarnessReviewComment[] {
  if (!Array.isArray(input)) throw new Refusal('comments must be a list')
  if (input.length > MAX_REVIEW_COMMENTS) {
    throw new Refusal(`At most ${MAX_REVIEW_COMMENTS} line comments can be sent`)
  }
  const comments = input.map((entry) => normalizeReviewComment(entry, makeId))
  if (new Set(comments.map((entry) => entry.id)).size !== comments.length) {
    throw new Refusal('Comment ids must be unique')
  }
  return comments
}

/** A diff line's number on one side, or null when it has none there. */
export function lineNumberOn(line: DiffLine, side: HarnessReviewComment['side']): number | null {
  if (side === 'old') return line.kind === 'remove' ? line.oldLine : null
  return line.kind === 'add' || line.kind === 'context' ? line.newLine : null
}

/** The side a comment on this diff line is on: old for a removed line, new otherwise. */
export function sideOfLine(line: DiffLine): HarnessReviewComment['side'] | null {
  if (line.kind === 'remove') return 'old'
  if (line.kind === 'add' || line.kind === 'context') return 'new'
  return null
}

/** Every line of a file's hunks in order, the `@@` lines included. */
function fileBody(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((hunk) => hunk.lines)
}

/** The diff lines a comment covers, in patch order; empty when the diff does not show them. */
export function commentedLines(
  parsed: ParsedDiff,
  comment: Pick<HarnessReviewComment, 'file' | 'side' | 'firstLine' | 'lastLine'>
): DiffLine[] {
  const file = findDiffFile(parsed, comment.file)
  if (!file) return []
  return fileBody(file).filter((line) => {
    const number = lineNumberOn(line, comment.side)
    return number !== null && number >= comment.firstLine && number <= comment.lastLine
  })
}

/**
 * The commented lines with three lines around them, as the diff shows them
 * (a hunk's `@@` line included when the span crosses one), at most 40 lines.
 * Null when the diff does not show the commented lines.
 */
export function commentExcerpt(
  parsed: ParsedDiff,
  comment: Pick<HarnessReviewComment, 'file' | 'side' | 'firstLine' | 'lastLine'>
): string | null {
  const file = findDiffFile(parsed, comment.file)
  if (!file) return null
  const body = fileBody(file)
  const hits = commentedLines(parsed, comment).map((line) => body.indexOf(line))
  if (hits.length === 0) return null
  const first = hits[0]
  const last = hits[hits.length - 1]
  let start = Math.max(0, first - EXCERPT_CONTEXT_LINES)
  let end = Math.min(body.length - 1, last + EXCERPT_CONTEXT_LINES)
  // Over the limit: give up the context first, then the end of a long span.
  while (end - start + 1 > MAX_EXCERPT_LINES && (start < first || end > last)) {
    if (end > last) end--
    if (end - start + 1 > MAX_EXCERPT_LINES && start < first) start++
  }
  if (end - start + 1 > MAX_EXCERPT_LINES) end = start + MAX_EXCERPT_LINES - 1
  return body
    .slice(start, end + 1)
    .map((line) =>
      line.text.length > MAX_EXCERPT_LINE_LENGTH
        ? `${line.text.slice(0, MAX_EXCERPT_LINE_LENGTH)}…`
        : line.text
    )
    .join('\n')
}

/**
 * Each comment with its excerpt, taken from the diff as it is now. Refused
 * when a comment's lines are not in the diff, so an agent is never pointed at
 * code it cannot find.
 */
export function withExcerpts(
  parsed: ParsedDiff,
  comments: HarnessReviewComment[]
): HarnessSentReviewComment[] {
  return comments.map((comment, index) => {
    const excerpt = commentExcerpt(parsed, comment)
    if (excerpt === null) {
      throw new Refusal(
        `Comment ${index + 1} is on lines the change does not show (${comment.file}, ${comment.side} lines ${comment.firstLine}-${comment.lastLine})`
      )
    }
    return { ...comment, excerpt }
  })
}

/** The rejections with comments dropped from all but the latest three. */
export function pruneRejectionComments(rejections: HarnessTaskRejection[]): HarnessTaskRejection[] {
  const keepFrom = rejections.length - REJECTIONS_KEEPING_COMMENTS
  return rejections.map((rejection, index) => {
    if (index >= keepFrom || !rejection.comments) return rejection
    const rest = { ...rejection }
    delete rest.comments
    return rest
  })
}

/** The latest rejection's comments: what the next attempt is asked to deal with. */
export function latestReviewComments(
  rejections: HarnessTaskRejection[] | undefined
): HarnessSentReviewComment[] {
  return rejections?.at(-1)?.comments ?? []
}

/** "lines 4-9" or "line 4", with "removed" for the old side. Text for agents. */
export function describeCommentLines(
  comment: Pick<HarnessReviewComment, 'side' | 'firstLine' | 'lastLine'>
): string {
  const lines =
    comment.firstLine === comment.lastLine
      ? `line ${comment.firstLine}`
      : `lines ${comment.firstLine}-${comment.lastLine}`
  return comment.side === 'old' ? `removed ${lines} (old version)` : lines
}

/** The line comments as a numbered list, for an agent's opening prompt. */
export function formatReviewCommentsForAgent(comments: HarnessSentReviewComment[]): string {
  if (comments.length === 0) return ''
  const items = comments.map(
    (comment, index) =>
      `${index + 1}. [id: ${comment.id}] ${comment.file}, ${describeCommentLines(comment)}\n` +
      '```diff\n' +
      `${comment.excerpt}\n` +
      '```\n' +
      `Comment: ${comment.comment}`
  )
  return [
    `Line comments from the last review (${comments.length}). ${REVIEW_COMMENTS_GUIDANCE} ${COMMENT_ANSWERS_GUIDANCE}`,
    ...items
  ].join('\n\n')
}

/**
 * How an agent treats line comments: one rule for embedded and external
 * agents, in their standing instructions and the harness API's help.
 */
export const REVIEW_COMMENTS_GUIDANCE =
  'Each comment is the person\'s instruction about the lines it points at, for this task only: deal with every one. The excerpt is from the attempt that was sent back. When the task kept its copy ("retry" or "hold"), you continue in that same copy, so the lines are usually still there; when it was reworked, that work is gone, and the line numbers say where the code was, not where it is now. Like guidance, a comment never widens the task\'s scope.'
