import { parseReportExtras } from '@shared/agent-report-extras'
import type {
  HarnessReportedUsage,
  HarnessSessionDiff,
  HarnessTaskReport
} from '@shared/ostler-api'

/**
 * The rules for an agent's completion report, one copy for both ways in: an
 * external agent's `session/:id/update` (harness-http-server.ts) and an
 * embedded agent's `/complete` bridge call (opencode-runner-service.ts).
 */

/**
 * Whether a completion report's blockers field names a real blocker. Agents
 * write "none" or "n/a" when there is nothing outstanding; anything else is a
 * blocker a human has to look at. The one rule for the runner deciding a
 * session's outcome and the dispatcher deciding what it may auto-accept.
 */
export function reportHasBlockers(blockers: string | null | undefined): boolean {
  const text = (blockers ?? '').trim().toLowerCase()
  // "None. Assumption recorded: ..." is an agent with nothing blocking it that
  // also wrote down a note; only the leading word decides.
  return text !== '' && !/^(none|n\/a|no blockers?)(?![a-z])/.test(text)
}

const MAX_REPORT_FILES = 200
const MAX_REPORT_FILE_LENGTH = 500
/** The longest summary (and, for an embedded agent, verification or blockers) a report keeps. */
export const MAX_REPORT_TEXT_LENGTH = 2000
const MAX_REPORTED_TOKENS = 1_000_000_000_000

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A report's text field, trimmed and capped. */
export function reportText(value: unknown): string {
  return str(value).trim().slice(0, MAX_REPORT_TEXT_LENGTH)
}

/** A report's `filesChanged`: non-empty strings, trimmed, each and the list capped. */
export function reportFiles(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, MAX_REPORT_FILE_LENGTH))
        .slice(0, MAX_REPORT_FILES)
    : []
}

/**
 * Validates an agent-submitted completion report from `session/:id/update`.
 * A summary is required -- a report is only ever attached when the agent
 * actually supplied one, never synthesized by Ostler.
 */
export function parseTaskReport(value: unknown): HarnessTaskReport | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const filesChanged = reportFiles(candidate.filesChanged)
  const summary = reportText(candidate.summary)
  // An empty `filesChanged` used to void the whole report. That threw away the
  // one report a human most needs to read -- "this task needed no code change,
  // because ..." -- and left the agent no way to say so at all. A summary is
  // what makes a report a report.
  if (!summary) return null
  const usage = parseReportedUsage(candidate.usage)
  return {
    filesChanged,
    summary,
    submittedAt: new Date().toISOString(),
    ...(usage ? { usage } : {}),
    ...parseReportExtras(candidate)
  }
}

/**
 * The optional token usage an agent reports with its completion (R5.3, D43).
 * Self-reported and never checked: the app labels it as reported by the
 * agent. Anything that is not a number of tokens is left out.
 */
export function parseReportedUsage(value: unknown): HarnessReportedUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const tokens = (raw: unknown): number | undefined =>
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_REPORTED_TOKENS
      ? Math.round(raw)
      : undefined
  const inputTokens = tokens(candidate.inputTokens)
  const outputTokens = tokens(candidate.outputTokens)
  const model = str(candidate.model).trim().slice(0, 200)
  if (inputTokens === undefined && outputTokens === undefined) return null
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(model ? { model } : {})
  }
}

/**
 * The branch is the evidence, not the agent's word. An agent could mark its
 * task complete as its first action, having touched nothing. With no commits
 * and nothing even edited, a claim of changed files -- or no report at all --
 * is provably false, and this returns the refusal to send back, with what to do
 * instead. A task that genuinely needs no code change is still completable:
 * reported with an empty `filesChanged`, a claim a human can see and check.
 * Null when the work stands.
 */
export function checkWorkEvidence(
  diff: Pick<HarnessSessionDiff, 'committedFilesChanged' | 'hasUncommittedChanges'>,
  report: Pick<HarnessTaskReport, 'filesChanged'> | null
): string | null {
  if (diff.committedFilesChanged > 0 || diff.hasUncommittedChanges) return null
  if (report && report.filesChanged.length === 0) return null
  return 'Your workspace has no commits and no uncommitted edits, so this task shows no work at all. Do the task in your workspace and commit it, then complete the task again. If it genuinely needs no code change, complete it with an empty `filesChanged` and say why in the summary.'
}
