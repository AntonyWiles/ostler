/**
 * Reviewer runs (N9.5a, decision N63): an ordinary coding-agent run whose task
 * is "review session X". It reads the task and the diff, changes nothing, and
 * reports findings as line comments with a severity. The limits, checking the
 * findings a reviewer sends, and the words agents read. Pure code, shared by
 * main (the harness, the prompts, the APIs) and, from N9.5b, the renderer.
 */
import type {
  HarnessFindingSeverity,
  HarnessReviewFinding,
  HarnessReviewWait,
  HarnessSession,
  HarnessTaskReport
} from './ostler-api'
import type { ParsedDiff } from './diff/unified-diff'
import { commentExcerpt, MAX_REVIEW_COMMENT_LENGTH } from './review-comments'

/**
 * Whether reviewer runs exist. While false, nothing outside tests starts a
 * review, and the standing instructions and the harness help say nothing
 * about reviews. N9.5b turned it on; tests turn it off with `vi.mock`.
 */
export const REVIEWER_RUNS_AVAILABLE = true

/** The most findings one review keeps; the rest are counted as left out. */
export const MAX_REVIEW_FINDINGS = 50
/** The longest a finding's comment may be, the same as a person's line comment. */
export const MAX_FINDING_LENGTH = MAX_REVIEW_COMMENT_LENGTH
/** Reviews kept on a reviewed session, newest last. */
export const MAX_REVIEWS_KEPT = 5
export const FINDING_SEVERITIES: readonly HarnessFindingSeverity[] = [
  'must-fix',
  'should-fix',
  'nit'
]

/** What a review that ended without a report records. Text for people and agents. */
export const REVIEWER_DID_NOT_REPORT = 'The reviewer did not report'

/** A finding as a reviewer sent it, before Ostler checks it against the diff. */
export type FindingRequest = Omit<HarnessReviewFinding, 'id' | 'excerpt' | 'general'>

/**
 * The findings of a raw report, each checked for shape: a file, a side, whole
 * line numbers (first no later than last), 1 to 2,000 characters of comment
 * and a severity. Malformed ones and those past the 50th are left out and
 * counted, so one bad entry never loses the review.
 */
export function parseFindingRequests(raw: unknown): {
  findings: FindingRequest[]
  leftOut: number
} {
  if (!Array.isArray(raw)) return { findings: [], leftOut: 0 }
  const findings: FindingRequest[] = []
  let leftOut = 0
  for (const entry of raw) {
    const finding = parseFinding(entry)
    if (finding && findings.length < MAX_REVIEW_FINDINGS) findings.push(finding)
    else leftOut += 1
  }
  return { findings, leftOut }
}

function parseFinding(input: unknown): FindingRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  const file = typeof value.file === 'string' ? value.file.trim().replace(/\\/g, '/') : ''
  if (!file || file.length > 1000) return null
  const side = value.side === undefined ? 'new' : value.side
  if (side !== 'new' && side !== 'old') return null
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
    return null
  }
  const comment = typeof value.comment === 'string' ? value.comment.trim() : ''
  if (!comment || comment.length > MAX_FINDING_LENGTH) return null
  const severity = value.severity
  if (!FINDING_SEVERITIES.includes(severity as HarnessFindingSeverity)) return null
  return {
    file,
    side,
    firstLine,
    lastLine,
    comment,
    severity: severity as HarnessFindingSeverity
  }
}

/**
 * Each finding checked against the reviewed diff, with its excerpt taken from
 * it. A finding on lines the diff does not show is kept as a general finding,
 * marked so, with no excerpt.
 */
export function checkFindings(
  parsed: ParsedDiff,
  findings: FindingRequest[],
  makeId: () => string
): HarnessReviewFinding[] {
  return findings.map((finding) => {
    const excerpt = commentExcerpt(parsed, finding)
    return excerpt === null
      ? { ...finding, id: makeId(), excerpt: '', general: true as const }
      : { ...finding, id: makeId(), excerpt }
  })
}

/** The report a reviewer's task keeps: its findings live with the reviewed session instead. */
export function withoutFindingRequests(report: HarnessTaskReport | null): HarnessTaskReport | null {
  if (!report?.findingRequests) return report
  const rest = { ...report }
  delete rest.findingRequests
  return rest
}

/**
 * How a reviewer works: one rule for embedded and external agents, in the
 * opening prompt, the claim and the harness help. Text for agents.
 */
export const REVIEWER_GUIDANCE = `This is a review run: you review another agent's change, you do not make one. Read the task it was given (in your task details) and its change with \`git diff <base>..<head>\` (the commits are in your task details and in reviewOf). Change nothing: do not edit files and do not commit. Your folder is a throwaway copy at the change's last commit, removed when you finish, and nothing in it is ever applied. Report what you find as findings, each on the file and lines of the change it is about: file (the path as the diff names it), side (new: lines of the new version; old: removed lines, numbered in the old version), firstLine, lastLine, comment (at most ${MAX_FINDING_LENGTH} characters: what is wrong and why) and severity (must-fix: wrong, broken or unsafe; should-fix: worth changing before it lands; nit: small or a matter of taste). At most ${MAX_REVIEW_FINDINGS} findings; put the most important first. A finding on lines the diff does not show is kept as a general finding. Your summary says in a sentence or two what you think of the change. When there is nothing to fix, say so plainly in the summary and send no findings: do not invent findings.`

/** Why a review run's file-editing tool was refused (embedded). Text for agents. */
export const REVIEW_RUN_REFUSAL =
  'this is a review run, and a review changes nothing. Read the change with git diff, then report your findings with ostler_complete_task.'

/** The details a review task holds: the reviewed task, its report, and the reviewer's instructions. */
export function buildReviewDetails(input: {
  sessionTitle: string
  taskDetails: string
  reportSummary: string | null
  reportFiles: string[]
  baseCommit: string
  headCommit: string
}): string {
  return [
    `Review the change an agent made for the task "${input.sessionTitle}".`,
    '',
    'The task it was given (its description and acceptance criteria):',
    input.taskDetails.trim().slice(0, 3000) || '(no description)',
    '',
    `Its report: ${input.reportSummary?.trim().slice(0, 2000) || '(none)'}`,
    `Files it reported: ${
      input.reportFiles.length > 0 ? input.reportFiles.slice(0, 50).join(', ') : '(none)'
    }`,
    '',
    `The change: git diff ${input.baseCommit}..${input.headCommit}`,
    '',
    // Last, and never cut: the task's own text is bounded above instead.
    REVIEWER_GUIDANCE
  ].join('\n')
}

/**
 * How long a session waits for its reviewer before it shows in Needs you and
 * the Inbox anyway (N9.5b): a review that never ends must not hide work.
 */
export const REVIEW_WAIT_MS = 30 * 60 * 1000

/** The project's "Review agent work before me" (N9.5b): off unless the person turned it on. */
export function projectReviewBeforeMe(project: {
  autoDispatch?: { reviewBeforeMe?: boolean }
}): boolean {
  return project.autoDispatch?.reviewBeforeMe === true
}

/**
 * Where a session's latest review stands (N9.5b): `reviewOpen` says whether a
 * review of it is queued or running. Null when it was never reviewed.
 */
export function reviewWait(
  session: Pick<HarnessSession, 'reviewRequestedAt' | 'reviewerReports'>,
  reviewOpen: boolean,
  now: number
): HarnessReviewWait | null {
  const requestedAt = session.reviewRequestedAt ?? null
  if (reviewOpen) {
    const since = requestedAt ? Date.parse(requestedAt) : NaN
    const overdue = Number.isFinite(since) && now - since >= REVIEW_WAIT_MS
    return { status: overdue ? 'overdue' : 'running', requestedAt }
  }
  const latest = session.reviewerReports?.at(-1)
  if (!latest) return null
  return { status: latest.outcome === 'reported' ? 'reported' : 'failed', requestedAt }
}

/** Whether a session in review is still waiting for its reviewer, so it stays out of Needs you. */
export function waitingForReviewer(session: Pick<HarnessSession, 'review'>): boolean {
  return session.review?.status === 'running'
}

/** The latest review's findings the person has not dismissed (N9.5b). */
export function openFindings(
  session: Pick<HarnessSession, 'reviewerReports' | 'dismissedFindingIds'>
): HarnessReviewFinding[] {
  const latest = session.reviewerReports?.at(-1)
  if (!latest) return []
  const dismissed = new Set(session.dismissedFindingIds ?? [])
  return latest.findings.filter((finding) => !dismissed.has(finding.id))
}

/** How many findings of each severity (N9.5b). */
export function countFindings(
  findings: readonly HarnessReviewFinding[]
): Record<HarnessFindingSeverity, number> {
  const counts: Record<HarnessFindingSeverity, number> = { 'must-fix': 0, 'should-fix': 0, nit: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}
