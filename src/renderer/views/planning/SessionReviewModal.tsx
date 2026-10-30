import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HarnessSession, HarnessTask } from '@shared/ostler-api'
import { CodeWorkspaceRoot } from '../project-detail/types'
import { ProvenanceBadge } from '../../components/ProvenanceBadge'
import { LiveTranscriptModal } from './LiveTranscriptModal'
import {
  DiffPatch,
  DiffStat,
  highlightedIndexes,
  type DiffHighlight,
  type DiffLineSelection
} from '../../components/DiffPatch'
import { parseUnifiedDiff } from '@shared/diff/unified-diff'
import { commentedLines, latestReviewComments, sideOfLine } from '@shared/review-comments'
import {
  DraftsError,
  InlineComment,
  LineCommentForm,
  LineCommentsList,
  useReviewDrafts
} from './LineComments'
import { ReportPictures } from './ReportPictures'
import {
  copiedToDrafts,
  filterFindings,
  FindingCard,
  FindingsList,
  GeneralFindings,
  inReason,
  ReviewerSummary,
  useDismissedFindings,
  withFindingInReason,
  type SeverityFilter
} from './ReviewerFindings'
import { REVIEWER_RUNS_AVAILABLE } from '@shared/reviewer-runs'
import type { HarnessReviewFinding } from '@shared/ostler-api'
import { answeredAlertText, CommentAnswersChecklist } from './CommentAnswers'
import {
  answerTarget,
  countCommentAnswers,
  pairCommentAnswers,
  type CommentWithAnswer
} from '@shared/comment-answers'
import { WalkthroughBar } from './WalkthroughBar'
import { AgentReportModal } from './AgentReportModal'
import { RejectWorkForm } from './RejectWorkForm'
import { offerLessonAfterSendBack } from './RememberLesson'
import { PlanVsChanges } from './PlanVsChanges'
import { TryItPanel, useTryItProject } from './TryItPanel'
import { lazyNamed } from '../../lib/lazy-named'
import { ATTACHED_BY_LABEL } from './useWorkItemAttachments'
import { Badge, Button, Dialog, InlineAlert, useConfirm } from '../../ui'
import { Eye, FileDiff, FolderCode, ScrollText, Signpost } from '../../ui/icons'
import { stopAgent } from '../workspace/agents/stop-agent'
import { useTaskReview } from '../workspace/agents/useTaskReview'
import './planning-dialogs.css'
import './AgentsView.css'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'
import { formatDateTime, formatRelativeTime } from '@shared/format'

const ProjectSettingsDialog = lazyNamed(
  () => import('../../components/ProjectSettingsDialog'),
  'ProjectSettingsDialog'
)

interface SessionReviewModalProps {
  id: string
  session: HarnessSession
  /** The queued task this session worked on, for its completion report. */
  task?: HarnessTask | null
  harnessBusy: boolean
  openCodeWorkspace: (root: CodeWorkspaceRoot) => void
  runHarnessAction: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>
  onClose: () => void
  /** Where focus goes on close when the opener has gone with the run (see Dialog). */
  returnFocusTo?: () => HTMLElement | null
}

/**
 * One task's agent run, opened from Review… or Details wherever a task shows
 * its agent: the agent's report, its changes, its transcript and the files in
 * its copy, then the verdicts (simplify pass §3) -- Apply, Send back and
 * Discard once it has finished, Stop while it runs.
 */
export function SessionReviewModal({
  id,
  session: s,
  task,
  harnessBusy,
  openCodeWorkspace,
  runHarnessAction,
  onClose,
  returnFocusTo
}: SessionReviewModalProps) {
  const confirm = useConfirm()
  // Try it (N9.4): the project's command, and whether a run is going.
  const { project, reload: reloadProject } = useTryItProject(id)
  // A ref, read when the person closes: always the panel's latest word.
  const tryRunning = useRef(false)
  const [settingsWith, setSettingsWith] = useState<string | null>(null)
  const onTryRunningChange = useCallback((running: boolean) => {
    tryRunning.current = running
  }, [])
  /** Closing Review changes stops a running Try, after asking. */
  const closeReview = async () => {
    if (tryRunning.current) {
      // Ask once the Escape or click that asked to close has finished, or the
      // question's own dismiss handler would hear that same event.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const stop = await confirm({
        title: t('agents:tryIt.closeTitle'),
        body: t('agents:tryIt.closeBody'),
        confirmLabel: t('agents:tryIt.closeConfirm')
      })
      if (!stop) return
      await window.ostlerAPI.stopTryRun(id, s.id)
    }
    onClose()
  }
  // Line comments (N9.2a): drafts kept with the session until Send back takes them.
  const comments = useReviewDrafts(id, s.id, s.reviewDrafts ?? [])
  // The reviewer's findings (N9.5b): the latest review's, with the person's dismissals.
  const findingsOf = useDismissedFindings(id, s)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [asking, setAsking] = useState(false)
  const latestFindings = s.reviewerReports?.at(-1)?.findings ?? []
  const openMustFix = latestFindings.filter(
    (finding) => finding.severity === 'must-fix' && !findingsOf.dismissed.includes(finding.id)
  ).length
  const shownFindings = filterFindings(latestFindings, severityFilter)
  const { diff, diffError, nothingChanged, apply, discard } = useTaskReview({
    projectId: id,
    session: s,
    runHarnessAction,
    onDone: onClose,
    draftCount: comments.drafts.length,
    openMustFix
  })
  const [diffPanelOpen, setDiffPanelOpen] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  // Kept here so Send back as mine on a general finding can add to it.
  const [sendBackReason, setSendBackReason] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  // Walk through (N9.1): the stop shown, or null while the walkthrough is closed.
  const [stopIndex, setStopIndex] = useState<number | null>(null)
  const stops = task?.report?.walkthrough ?? []
  const pictures = task?.report?.pictures ?? []
  const picturesLeftOut = task?.report?.picturesLeftOut ?? []
  const stop = stopIndex === null ? null : (stops[stopIndex] ?? null)
  const parsedPatch = useMemo(() => (diff?.patch ? parseUnifiedDiff(diff.patch) : null), [diff])
  const stopInDiff = useMemo(
    () => Boolean(stop && parsedPatch && highlightedIndexes(parsedPatch, stop).size > 0),
    [stop, parsedPatch]
  )
  // The lines picked for a new comment, where the pick started, and whether its form is open.
  const [selection, setSelection] = useState<DiffLineSelection | null>(null)
  const [anchorLine, setAnchorLine] = useState(0)
  const [composing, setComposing] = useState(false)
  const [jumpTo, setJumpTo] = useState<DiffHighlight | null>(null)
  // The comments this task was last sent back with, when that was another session's work.
  const lastRejection = task?.rejections?.at(-1)
  const lastReview =
    lastRejection && lastRejection.sessionId !== s.id ? latestReviewComments(task?.rejections) : []
  // Each of those comments with the agent's answer (N9.2b), once this attempt has finished.
  const answered = s.status === 'done'
  const answerPairs = pairCommentAnswers(lastReview, answered ? task?.report : null)
  const answerCounts = countCommentAnswers(answerPairs)
  const answersAlert = answered && answerPairs.length > 0 ? answeredAlertText(answerCounts) : null
  /** Where the agent says the change now is, checked against the new diff. */
  const targetOf = (pair: CommentWithAnswer) =>
    parsedPatch ? answerTarget(parsedPatch, pair.comment, pair.answer) : null
  /** The lines a comment carried again goes on: the answer's, else the comment's own, if the diff shows them. */
  const againLinesOf = (pair: CommentWithAnswer): DiffLineSelection | null => {
    if (!parsedPatch) return null
    const target = targetOf(pair)
    if (target && 'startLine' in target) {
      const lines = {
        file: target.path,
        side: 'new' as const,
        firstLine: target.startLine,
        lastLine: target.endLine
      }
      if (commentedLines(parsedPatch, lines).length > 0) return lines
    }
    const own = {
      file: pair.comment.file,
      side: pair.comment.side,
      firstLine: pair.comment.firstLine,
      lastLine: pair.comment.lastLine
    }
    return commentedLines(parsedPatch, own).length > 0 ? own : null
  }
  const showAnswer = (pair: CommentWithAnswer) => {
    const target = targetOf(pair)
    if (!target) return
    setStopIndex(null)
    setDiffPanelOpen(true)
    // No lines given (or none the diff shows): the whole file.
    setJumpTo(
      'startLine' in target
        ? { path: target.path, startLine: target.startLine, endLine: target.endLine }
        : { path: target.path, startLine: 1, endLine: Number.MAX_SAFE_INTEGER }
    )
  }
  const commentAgain = (pair: CommentWithAnswer) => {
    const lines = againLinesOf(pair)
    if (!lines) return
    void comments.add(lines, pair.comment.comment)
    setStopIndex(null)
    setDiffPanelOpen(true)
    setJumpTo({
      path: lines.file,
      side: lines.side,
      startLine: lines.firstLine,
      endLine: lines.lastLine
    })
  }

  /** The patch line each comment ends on, and the selection's, to put them under. */
  const endIndex = (lines: DiffLineSelection) =>
    parsedPatch ? (commentedLines(parsedPatch, lines).at(-1)?.index ?? -1) : -1

  // Current revisions of the attachments this session was given, for "changed since".
  const [currentRevisions, setCurrentRevisions] = useState<Record<string, number | null>>({})
  useEffect(() => {
    const given = s.attachmentsGiven ?? []
    if (given.length === 0) return
    let live = true
    void Promise.all(
      given.map(async (entry) => {
        const result = await window.ostlerAPI.getLibraryItem(id, entry.libraryItemId)
        return [entry.libraryItemId, result.ok ? result.value.revision : null] as const
      })
    ).then((pairs) => {
      if (live) setCurrentRevisions(Object.fromEntries(pairs))
    })
    return () => {
      live = false
    }
  }, [id, s.id, s.attachmentsGiven])

  const finishedForComments = s.status === 'done' && Boolean(s.workspace) && !s.workspace?.closed
  const selectionEnd = selection && composing ? endIndex(selection) : -1
  const commentEnds = new Map<number, typeof comments.drafts>()
  for (const draft of comments.drafts) {
    const end = endIndex(draft)
    commentEnds.set(end, [...(commentEnds.get(end) ?? []), draft])
  }
  const findingEnds = new Map<number, HarnessReviewFinding[]>()
  for (const finding of shownFindings) {
    if (finding.general) continue
    const end = endIndex(finding)
    findingEnds.set(end, [...(findingEnds.get(end) ?? []), finding])
  }
  const jumpToLines = (lines: DiffLineSelection) => {
    setStopIndex(null)
    setDiffPanelOpen(true)
    setJumpTo({
      path: lines.file,
      side: lines.side,
      startLine: lines.firstLine,
      endLine: lines.lastLine
    })
  }
  /** Send back as mine: the finding's words become a draft of the person's, which they can edit. */
  const copyFinding = (finding: HarnessReviewFinding) => {
    void comments.add(
      {
        file: finding.file,
        side: finding.side,
        firstLine: finding.firstLine,
        lastLine: finding.lastLine
      },
      finding.comment
    )
    jumpToLines(finding)
  }
  /**
   * Send back as mine on a general finding: it has no lines to comment on, so
   * its words become a paragraph of the Send back reason, which the person can
   * edit before sending.
   */
  const addFindingToReason = (finding: HarnessReviewFinding) => {
    setSendBackReason((reason) => withFindingInReason(reason, finding))
    setRejectOpen(true)
  }
  const renderFinding = (finding: HarnessReviewFinding, showWhere: boolean) => (
    <FindingCard
      finding={finding}
      dismissed={findingsOf.dismissed.includes(finding.id)}
      copied={
        finding.general
          ? rejectOpen && inReason(finding, sendBackReason)
          : copiedToDrafts(finding, comments.drafts)
      }
      canCopy={finishedForComments && (finding.general ? !nothingChanged : !comments.full)}
      showWhere={showWhere}
      onCopy={() => (finding.general ? addFindingToReason(finding) : copyFinding(finding))}
      onDismiss={(on) => void findingsOf.toggle(finding.id, on)}
      onJump={finding.general ? undefined : () => jumpToLines(finding)}
    />
  )
  const askReviewer = async () => {
    setAsking(true)
    try {
      await runHarnessAction(() => window.ostlerAPI.startHarnessReview(id, s.id))
    } finally {
      setAsking(false)
    }
  }
  const commenting = finishedForComments
    ? {
        selection,
        onPick: (
          file: { path: string },
          line: Parameters<typeof sideOfLine>[0],
          extend: boolean
        ) => {
          const side = sideOfLine(line)
          const number = side === 'old' ? line.oldLine : line.newLine
          if (!side || number === null) return
          setJumpTo(null)
          if (extend && selection && selection.file === file.path && selection.side === side) {
            setSelection({
              file: file.path,
              side,
              firstLine: Math.min(anchorLine, number),
              lastLine: Math.max(anchorLine, number)
            })
          } else {
            setAnchorLine(number)
            setSelection({ file: file.path, side, firstLine: number, lastLine: number })
          }
          setComposing(true)
        },
        after: (index: number) => {
          const here = commentEnds.get(index) ?? []
          const found = findingEnds.get(index) ?? []
          const form = index === selectionEnd && selection
          if (here.length === 0 && found.length === 0 && !form) return null
          return (
            <div className="diff-patch__after">
              {found.map((finding) => (
                <div key={finding.id}>{renderFinding(finding, false)}</div>
              ))}
              {here.map((draft) => (
                <InlineComment key={draft.id} comment={draft} />
              ))}
              {form && (
                <LineCommentForm
                  key={`${selection.file}:${selection.side}:${selection.firstLine}:${selection.lastLine}`}
                  lines={selection}
                  onCancel={() => {
                    setComposing(false)
                    setSelection(null)
                  }}
                  onSave={(text) => {
                    void comments.add(selection, text)
                    setComposing(false)
                    setSelection(null)
                  }}
                />
              )}
            </div>
          )
        }
      }
    : undefined

  const checklist =
    lastReview.length > 0 ? (
      <CommentAnswersChecklist
        pairs={answerPairs}
        counts={answerCounts}
        answered={answered}
        onShow={showAnswer}
        canShow={(pair) => targetOf(pair) !== null}
        onCommentAgain={commenting && !comments.full ? commentAgain : undefined}
        canCommentAgain={(pair) => againLinesOf(pair) !== null}
      />
    ) : null
  const checklistBesideDiff = Boolean(diffPanelOpen && diff?.patch)

  const runAndClose = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    const succeeded = await runHarnessAction(action)
    if (succeeded) onClose()
  }

  const finished = s.status === 'done'
  const reviewable = finished && Boolean(s.workspace) && !s.workspace?.closed
  const applyLabel = nothingChanged
    ? t('agents:taskReview.closeNothingChanged')
    : t('agents:taskReview.apply')
  const applyConsequence = nothingChanged
    ? t('agents:taskReview.closeNothingChangedHint')
    : t('agents:taskReview.applyHint')

  const footer = (
    <>
      {!finished && (
        <Button
          variant="ghost"
          className="agents-danger-text"
          disabled={harnessBusy}
          onClick={() =>
            void stopAgent({ projectId: id, session: s, confirm, runHarnessAction }).then(
              (stopped) => {
                if (stopped) onClose()
              }
            )
          }
        >
          {t('agents:stopAgent.stop')}
        </Button>
      )}
      <span className="session-review__spacer" />
      <Button variant="ghost" onClick={() => void closeReview()}>
        {t('agents:sessionReviewModal.close')}
      </Button>
      {reviewable && !nothingChanged && (
        <Button
          variant="secondary"
          disabled={harnessBusy}
          title={t('agents:sessionReviewModal.sendWorkBackReason')}
          onClick={() => {
            // Cancel send back drops the reason, as closing the form always has.
            if (rejectOpen) setSendBackReason('')
            setRejectOpen(!rejectOpen)
          }}
        >
          {rejectOpen ? t('agents:taskReview.cancelSendBack') : t('agents:taskReview.sendBack')}
        </Button>
      )}
      {reviewable && !nothingChanged && (
        <Button variant="danger" disabled={harnessBusy} onClick={() => void discard()}>
          {t('agents:taskReview.discard')}
        </Button>
      )}
      {reviewable && answersAlert && (
        <Badge tone="warning" className="session-review__answers-alert">
          {answersAlert}
        </Badge>
      )}
      {reviewable && (
        <Button
          variant="primary"
          disabled={harnessBusy || !diff}
          title={applyConsequence}
          onClick={() => void apply()}
        >
          {applyLabel}
        </Button>
      )}
    </>
  )

  return (
    <>
      <Dialog
        open
        size="lg"
        onClose={() => void closeReview()}
        returnFocusTo={returnFocusTo}
        title={s.title}
        description={
          s.blocked
            ? t('agents:sessionReviewModal.blockedWaitingAnswer')
            : finished
              ? t('agents:needsYouSection.finished')
              : s.statusNote || t('agents:sessionReviewModal.running')
        }
        footer={footer}
        className="session-review"
      >
        <div className="dialog-form">
          <div className="session-review__meta">
            <ProvenanceBadge
              provenance={s.provenance ?? 'external'}
              embeddedRuntime={s.embeddedRuntime}
            />
            <span>
              {finished
                ? t('agents:sessionReviewModal.agentFinished')
                : s.lastSeenAt
                  ? t('agents:sessionReviewModal.agentLastConnectedAgo', {
                      when: formatRelativeTime(new Date(s.lastSeenAt).getTime())
                    })
                  : t('agents:sessionReviewModal.agentHasNotConnected')}
            </span>
            {s.workspace && diff && (
              <span>
                {t('agents:sessionReviewModal.changes')}{' '}
                <DiffStat insertions={diff.insertions} deletions={diff.deletions} />
              </span>
            )}
            {s.workspace && (
              <details>
                <summary>{t('agents:sessionReviewModal.details')}</summary>
                {t('agents:sessionReviewModal.agentCopy', {
                  worktreePath: s.workspace.worktreePath
                })}
              </details>
            )}
          </div>

          <div className="session-review__tools">
            <Button
              variant="secondary"
              size="sm"
              icon={Eye}
              disabled={harnessBusy}
              title={
                s.provenance === 'embedded'
                  ? t('agents:sessionReviewModal.watchWhatBuiltAgent')
                  : t('agents:sessionReviewModal.readWhatAgentDid')
              }
              onClick={() => setShowTranscript(true)}
            >
              {s.provenance === 'embedded' && !finished
                ? t('agents:sessionReviewModal.liveTranscript')
                : t('agents:sessionReviewModal.transcript')}
            </Button>
            {s.workspace && !s.workspace.closed && (
              <Button
                variant="secondary"
                size="sm"
                icon={FolderCode}
                disabled={harnessBusy}
                title={t('agents:sessionReviewModal.opensAgentWorkspaceCode')}
                onClick={() =>
                  openCodeWorkspace({ label: s.title, path: s.workspace!.worktreePath })
                }
              >
                {t('agents:sessionReviewModal.openCodeTab')}
              </Button>
            )}
          </div>

          {task?.report && (
            <section className="dialog-section" aria-label={t('agents:sessionReviewModal.report')}>
              <h3 className="dialog-section__title">{t('agents:sessionReviewModal.report')}</h3>
              {task.report.missing ? (
                <InlineAlert tone="warning">{task.report.summary}</InlineAlert>
              ) : (
                <p className="session-review__report">{task.report.summary}</p>
              )}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ScrollText}
                  onClick={() => setReportOpen(true)}
                >
                  {t('agents:sessionReviewModal.readFullReport')}
                </Button>
              </div>
            </section>
          )}

          {(pictures.length > 0 || picturesLeftOut.length > 0) && (
            <ReportPictures
              projectId={id}
              sessionId={task?.claimedBy ?? s.id}
              pictures={pictures}
              leftOut={picturesLeftOut}
            />
          )}

          {REVIEWER_RUNS_AVAILABLE && (
            <ReviewerSummary
              session={s}
              findings={latestFindings}
              filter={severityFilter}
              onFilter={setSeverityFilter}
              canAsk={finishedForComments && !s.reviewOf}
              asking={asking || harnessBusy}
              onAsk={() => void askReviewer()}
            />
          )}
          <DraftsError error={findingsOf.error} />
          <GeneralFindings
            findings={shownFindings.filter((finding) => finding.general)}
            render={renderFinding}
          />

          {s.plan?.status === 'approved' && (
            <PlanVsChanges
              plan={s.plan}
              changed={
                diff
                  ? [...diff.files.map((file) => file.path), ...(diff.uncommittedFiles ?? [])]
                  : null
              }
            />
          )}

          {s.workspace && (
            <section className="dialog-section" aria-label={t('agents:sessionReviewModal.changes')}>
              <div className="session-review__section-head">
                <h3 className="dialog-section__title">{t('agents:sessionReviewModal.changes')}</h3>
                <span className="session-review__spacer" />
                {stops.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Signpost}
                    disabled={harnessBusy || !diff}
                    aria-pressed={stopIndex !== null}
                    onClick={() => {
                      if (stopIndex !== null) {
                        setStopIndex(null)
                        return
                      }
                      setDiffPanelOpen(true)
                      setStopIndex(0)
                    }}
                  >
                    {t('agents:walkthrough.walkThrough', { count: stops.length })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={FileDiff}
                  disabled={harnessBusy || !diff}
                  onClick={() => {
                    // Hiding the changes ends a walkthrough through them.
                    if (diffPanelOpen) setStopIndex(null)
                    setDiffPanelOpen((open) => !open)
                  }}
                >
                  {!diff
                    ? diffError
                      ? t('agents:needsYouSection.couldntReadChanges')
                      : t('agents:sessionReviewModal.loadingChanges')
                    : diffPanelOpen
                      ? t('agents:sessionReviewModal.hideChanges')
                      : t('agents:sessionReviewModal.viewChanges')}
                </Button>
              </div>
              {diffPanelOpen && diff && (
                <>
                  <p className="dialog-muted">
                    <Trans
                      i18nKey="agents:sessionReviewModal.filesChanged"
                      count={diff.filesChanged}
                      values={{ count: diff.filesChanged }}
                      components={{ strong: <strong /> }}
                    />{' '}
                    <DiffStat insertions={diff.insertions} deletions={diff.deletions} />
                  </p>
                  {diff.files.length > 0 ? (
                    <ul className="session-review__files">
                      {diff.files.map((f) => (
                        <li key={f.path}>
                          <code>{f.path}</code>
                          {f.binary ? (
                            <span>{t('agents:sessionReviewModal.binary')}</span>
                          ) : (
                            <DiffStat insertions={f.insertions} deletions={f.deletions} />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dialog-muted">{t('agents:sessionReviewModal.noChangesYet')}</p>
                  )}
                  {diff.patch && commenting && (
                    <p className="dialog-muted">{t('agents:lineComments.help')}</p>
                  )}
                  {diff.patch && commenting && comments.full && (
                    <p className="dialog-muted">
                      {t('agents:lineComments.tooMany', { count: comments.drafts.length })}
                    </p>
                  )}
                  <DraftsError error={comments.error} />
                  {diff.patch && (
                    <div className="line-comments__layout">
                      <DiffPatch
                        patch={diff.patch}
                        highlight={stop ?? jumpTo}
                        commenting={
                          commenting && comments.full
                            ? { ...commenting, onPick: () => undefined }
                            : commenting
                        }
                      />
                      {(commenting || checklist || shownFindings.length > 0) && (
                        <div className="line-comments__side">
                          {checklist}
                          <FindingsList
                            findings={shownFindings.filter((finding) => !finding.general)}
                            render={renderFinding}
                          />
                          {commenting && (
                            <LineCommentsList
                              drafts={comments.drafts}
                              onJump={(comment) =>
                                setJumpTo({
                                  path: comment.file,
                                  side: comment.side,
                                  startLine: comment.firstLine,
                                  endLine: comment.lastLine
                                })
                              }
                              onEdit={(commentId, text) => void comments.edit(commentId, text)}
                              onDelete={comments.remove}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {diff.patch && diff.patchTruncated && (
                    <p className="dialog-muted">
                      {t('agents:sessionReviewModal.showingOnlyStartChanges')}
                    </p>
                  )}
                  {stopIndex !== null && (
                    <WalkthroughBar
                      stops={stops}
                      index={stopIndex}
                      inDiff={stopInDiff}
                      patchTruncated={diff.patchTruncated}
                      onIndex={setStopIndex}
                      onClose={() => setStopIndex(null)}
                    />
                  )}
                </>
              )}
            </section>
          )}

          {checklist && !checklistBesideDiff && <div className="dialog-section">{checklist}</div>}

          {reviewable && (
            <TryItPanel
              projectId={id}
              sessionId={s.id}
              tryCommand={project?.tryCommand ?? ''}
              tryItWarningSeen={project?.tryItWarningSeen === true}
              suggestion={task?.report?.tryCommand}
              onUseCommand={setSettingsWith}
              onRunningChange={onTryRunningChange}
            />
          )}

          {s.attachmentsGiven && s.attachmentsGiven.length > 0 && (
            <section
              className="dialog-section"
              aria-label={t('agents:sessionReviewModal.attachmentsGiven')}
            >
              <h3 className="dialog-section__title">
                {t('agents:sessionReviewModal.attachmentsGiven')}
              </h3>
              <ul className="session-review__files">
                {s.attachmentsGiven.map((entry) => {
                  const current = currentRevisions[entry.libraryItemId]
                  // An external session downloads each file itself; an embedded one had copies from the start.
                  const fetches = (s.attachmentFetches ?? []).filter(
                    (fetch) => fetch.libraryItemId === entry.libraryItemId
                  )
                  return (
                    <li key={entry.libraryItemId}>
                      <span>{entry.title}</span>
                      <span className="dialog-muted">
                        {current === null
                          ? t('agents:sessionReviewModal.attachedRevisionDeleted', {
                              revision: entry.revision,
                              by: ATTACHED_BY_LABEL[entry.attachedBy]
                            })
                          : t('agents:sessionReviewModal.attachedRevision', {
                              revision: entry.revision,
                              by: ATTACHED_BY_LABEL[entry.attachedBy]
                            })}
                      </span>
                      {typeof current === 'number' && current > entry.revision && (
                        <Badge tone="warning">
                          {t('agents:sessionReviewModal.changedSinceNowR', { current })}
                        </Badge>
                      )}
                      {s.provenance === 'external' && (
                        <span
                          className="dialog-muted"
                          title={fetches
                            .map(
                              (fetch) =>
                                `${formatDateTime(new Date(fetch.fetchedAt), { dateStyle: 'short', timeStyle: 'medium' })} (${fetch.form})`
                            )
                            .join('\n')}
                        >
                          {fetches.length === 0
                            ? t('agents:sessionReviewModal.notFetched')
                            : t('agents:sessionReviewModal.fetchedTimes', {
                                count: fetches.length,
                                when: formatRelativeTime(
                                  new Date(fetches[fetches.length - 1].fetchedAt).getTime()
                                )
                              })}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {reviewable && (
            <section
              className="dialog-section"
              aria-label={t('agents:sessionReviewModal.whatEachChoiceDoes')}
            >
              <h3 className="dialog-section__title">
                {t('agents:sessionReviewModal.whatEachChoiceDoes')}
              </h3>
              <dl className="session-review__choices">
                <div>
                  <dt>{applyLabel}</dt>
                  <dd>{applyConsequence}</dd>
                </div>
                {!nothingChanged && (
                  <div>
                    <dt>{t('agents:taskReview.sendBack')}</dt>
                    <dd>{t('agents:sessionReviewModal.sendWorkBackReason')}</dd>
                  </div>
                )}
                {!nothingChanged && (
                  <div>
                    <dt>{t('agents:taskReview.discard')}</dt>
                    <dd>{t('agents:taskReview.discardBody')}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {rejectOpen && (
            <RejectWorkForm
              projectId={id}
              busy={harnessBusy}
              initialChoice={{ model: task?.model ?? '', effort: task?.effort ?? '' }}
              commentCount={comments.drafts.length}
              reason={sendBackReason}
              onReasonChange={setSendBackReason}
              onReject={(reason, disposition, runAgainWith) => {
                const sent = comments.drafts
                void runAndClose(async () => {
                  const result = await window.ostlerAPI.sendBackHarnessTaskWork(
                    id,
                    s.id,
                    reason,
                    disposition,
                    runAgainWith
                  )
                  if (result.ok) offerLessonAfterSendBack(id, s, task, reason, sent)
                  return result
                })
              }}
            />
          )}
        </div>
      </Dialog>

      {showTranscript && (
        <LiveTranscriptModal projectId={id} session={s} onClose={() => setShowTranscript(false)} />
      )}
      {reportOpen && task && <AgentReportModal task={task} onClose={() => setReportOpen(false)} />}
      {settingsWith !== null && project && (
        <Suspense fallback={null}>
          <ProjectSettingsDialog
            project={project}
            suggestedTryCommand={settingsWith}
            onClose={() => setSettingsWith(null)}
            onChanged={reloadProject}
          />
        </Suspense>
      )}
    </>
  )
}
