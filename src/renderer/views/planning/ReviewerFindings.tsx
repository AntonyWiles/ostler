import { useState, type ReactNode } from 'react'
import type {
  HarnessFindingSeverity,
  HarnessReviewComment,
  HarnessReviewFinding,
  HarnessSession
} from '@shared/ostler-api'
import { countFindings, FINDING_SEVERITIES } from '@shared/reviewer-runs'
import { Badge, Button, InlineAlert, Select, type BadgeTone } from '../../ui'
import { whereText } from './LineComments'
import { t } from '@shared/i18n'
import './LineComments.css'

/**
 * A reviewer's findings in Review changes (N9.5b, decision N63): the summary
 * with Ask a reviewer and the severity filter, general findings above the
 * diff, and each line finding under its lines and in the list beside it.
 * Always labelled as the reviewer's, with the severity in words. A finding
 * reaches the agent only when the person makes it their own (Send back as
 * mine): a line finding becomes a line comment, a general finding a paragraph
 * of the Send back reason, both editable before sending. Ostler never sends
 * findings on.
 */

/** Severity filter: every severity, or one. */
export type SeverityFilter = 'all' | HarnessFindingSeverity

const SEVERITY_TONE: Record<HarnessFindingSeverity, BadgeTone> = {
  'must-fix': 'danger',
  'should-fix': 'warning',
  nit: 'neutral'
}

/** "Must fix", "Should fix", "Nit". */
export function severityText(severity: HarnessFindingSeverity): string {
  switch (severity) {
    case 'must-fix':
      return t('agents:reviewer.mustFix')
    case 'should-fix':
      return t('agents:reviewer.shouldFix')
    default:
      return t('agents:reviewer.nit')
  }
}

/** The findings a filter shows. */
export function filterFindings(
  findings: HarnessReviewFinding[],
  filter: SeverityFilter
): HarnessReviewFinding[] {
  return filter === 'all' ? findings : findings.filter((finding) => finding.severity === filter)
}

/** Whether a draft of the person's already holds this finding (Send back as mine done). */
export function copiedToDrafts(
  finding: HarnessReviewFinding,
  drafts: HarnessReviewComment[]
): boolean {
  return drafts.some(
    (draft) =>
      draft.file === finding.file &&
      draft.side === finding.side &&
      draft.firstLine === finding.firstLine &&
      draft.lastLine === finding.lastLine &&
      draft.comment === finding.comment
  )
}

/** Whether the Send back reason still holds a general finding's words as they were added. */
export function inReason(finding: HarnessReviewFinding, reason: string): boolean {
  const words = finding.comment.trim()
  return words.length > 0 && reason.includes(words)
}

/** The reason with a general finding's words added as a paragraph of their own, at the end. */
export function withFindingInReason(reason: string, finding: HarnessReviewFinding): string {
  if (inReason(finding, reason)) return reason
  const before = reason.trimEnd()
  const words = finding.comment.trim()
  return before ? `${before}\n\n${words}` : words
}

/** The top of Review changes: where the review stands, its counts, Ask a reviewer and the filter. */
export function ReviewerSummary({
  session,
  findings,
  filter,
  onFilter,
  canAsk,
  asking,
  onAsk
}: {
  session: HarnessSession
  /** The latest review's findings, dismissed ones included. */
  findings: HarnessReviewFinding[]
  filter: SeverityFilter
  onFilter: (filter: SeverityFilter) => void
  canAsk: boolean
  asking: boolean
  onAsk: () => void
}) {
  const review = session.review
  const latest = session.reviewerReports?.at(-1)
  const waiting = review?.status === 'running' || review?.status === 'overdue'
  if (!review && !canAsk) return null
  const counts = countFindings(findings)
  return (
    <section className="dialog-section" aria-label={t('agents:reviewer.title')}>
      <div className="session-review__section-head">
        <h3 className="dialog-section__title">{t('agents:reviewer.title')}</h3>
        <span className="session-review__spacer" />
        {canAsk && !waiting && (
          <Button variant="secondary" size="sm" disabled={asking} onClick={onAsk}>
            {t('agents:reviewer.ask')}
          </Button>
        )}
      </div>
      {!review && <p className="dialog-muted">{t('agents:reviewer.askHint')}</p>}
      {review?.status === 'running' && (
        <p className="dialog-muted" role="status">
          {t('agents:reviewer.beingReviewed')}
        </p>
      )}
      {review?.status === 'overdue' && (
        <InlineAlert tone="warning">{t('agents:reviewer.overdue')}</InlineAlert>
      )}
      {review?.status === 'failed' && (
        <InlineAlert tone="warning">
          {latest?.outcome === 'stopped'
            ? t('agents:reviewer.stopped')
            : t('agents:reviewer.notReported')}
        </InlineAlert>
      )}
      {latest && !waiting && review?.status === 'reported' && (
        <>
          <p>
            <strong>
              {findings.length === 0
                ? t('agents:reviewer.noFindings')
                : t('agents:reviewer.counts', {
                    mustFix: counts['must-fix'],
                    shouldFix: counts['should-fix'],
                    nit: counts.nit
                  })}
            </strong>
          </p>
          <p className="session-review__report">
            {t('agents:reviewer.summary', { summary: latest.summary })}
          </p>
          {findings.length > 0 && (
            <Select
              label={t('agents:reviewer.filter')}
              size="sm"
              value={filter}
              onChange={(event) => onFilter(event.target.value as SeverityFilter)}
              options={[
                { value: 'all', label: t('agents:reviewer.filterAll') },
                ...FINDING_SEVERITIES.map((severity) => ({
                  value: severity,
                  label: `${severityText(severity)} (${counts[severity]})`
                }))
              ]}
            />
          )}
        </>
      )}
    </section>
  )
}

/** One finding: labelled as the reviewer's, its severity in words, and what the person can do. */
export function FindingCard({
  finding,
  dismissed,
  copied,
  canCopy,
  showWhere,
  onCopy,
  onDismiss,
  onJump
}: {
  finding: HarnessReviewFinding
  dismissed: boolean
  copied: boolean
  /**
   * Send back as mine is offered: the work still in review, and for a line
   * finding room for a draft.
   */
  canCopy: boolean
  showWhere: boolean
  onCopy: () => void
  onDismiss: (dismissed: boolean) => void
  onJump?: () => void
}) {
  const where = finding.general ? finding.file : whereText(finding)
  const severity = severityText(finding.severity)
  return (
    <div
      className={`line-comments__item reviewer-finding${dismissed ? ' reviewer-finding--dismissed' : ''}`}
      aria-label={t('agents:reviewer.findingLabel', { severity, where })}
    >
      <div className="reviewer-finding__head">
        <Badge tone={SEVERITY_TONE[finding.severity]}>{severity}</Badge>
        <span className="line-comments__where">{t('agents:reviewer.byReviewer')}</span>
        {dismissed && <Badge tone="neutral">{t('agents:reviewer.dismissed')}</Badge>}
      </div>
      {showWhere && <code className="line-comments__where">{where}</code>}
      <p className="line-comments__text">{finding.comment}</p>
      <div className="line-comments__actions">
        {onJump && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('agents:lineComments.jumpToLabel', { where })}
            onClick={onJump}
          >
            {t('agents:lineComments.jumpTo')}
          </Button>
        )}
        {canCopy && !dismissed && (
          <Button
            size="sm"
            variant="secondary"
            disabled={copied}
            aria-label={
              finding.general
                ? t('agents:reviewer.sendBackAsMineGeneralLabel', { where })
                : t('agents:reviewer.sendBackAsMineLabel', { where })
            }
            onClick={onCopy}
          >
            {copied
              ? finding.general
                ? t('agents:reviewer.inReason')
                : t('agents:reviewer.copied')
              : t('agents:reviewer.sendBackAsMine')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={
            dismissed
              ? t('agents:reviewer.restoreLabel', { where })
              : t('agents:reviewer.dismissLabel', { where })
          }
          onClick={() => onDismiss(!dismissed)}
        >
          {dismissed ? t('agents:reviewer.restore') : t('agents:reviewer.dismiss')}
        </Button>
      </div>
    </div>
  )
}

/** General findings: the reviewer's words on the change as a whole or lines the diff does not show. */
export function GeneralFindings({
  findings,
  render
}: {
  findings: HarnessReviewFinding[]
  render: (finding: HarnessReviewFinding, showWhere: boolean) => ReactNode
}) {
  if (findings.length === 0) return null
  return (
    <section className="line-comments" aria-label={t('agents:reviewer.general')}>
      <h4 className="line-comments__title">
        {t('agents:reviewer.general')} ({findings.length})
      </h4>
      <ul className="line-comments__list">
        {findings.map((finding) => (
          <li key={finding.id}>{render(finding, true)}</li>
        ))}
      </ul>
    </section>
  )
}

/** The reviewer's line findings in the list beside the diff. */
export function FindingsList({
  findings,
  render
}: {
  findings: HarnessReviewFinding[]
  render: (finding: HarnessReviewFinding, showWhere: boolean) => ReactNode
}) {
  if (findings.length === 0) return null
  return (
    <section className="line-comments" aria-label={t('agents:reviewer.findings')}>
      <h4 className="line-comments__title">
        {t('agents:reviewer.findings')} ({findings.length})
      </h4>
      <ul className="line-comments__list">
        {findings.map((finding) => (
          <li key={finding.id}>{render(finding, true)}</li>
        ))}
      </ul>
    </section>
  )
}

/** Dismissed ids, kept in main; shown at once and put right if saving fails. */
export function useDismissedFindings(projectId: string, session: HarnessSession) {
  const [dismissed, setDismissed] = useState<string[]>(session.dismissedFindingIds ?? [])
  const [error, setError] = useState<string | null>(null)
  const toggle = async (findingId: string, on: boolean) => {
    const before = dismissed
    setDismissed(on ? [...before, findingId] : before.filter((id) => id !== findingId))
    const result = await window.ostlerAPI.dismissHarnessReviewFinding(
      projectId,
      session.id,
      findingId,
      on
    )
    if (result.ok) {
      setDismissed(result.value.dismissedFindingIds ?? [])
      setError(null)
    } else {
      setDismissed(before)
      setError(t('agents:reviewer.dismissFailed', { message: result.error }))
    }
  }
  return { dismissed, toggle, error }
}
