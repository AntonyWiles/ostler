import { useState, type ReactNode } from 'react'
import type { HarnessSession, HarnessTask } from '@shared/ostler-api'
import { runCanRunAgain, sessionOwnsTask } from '@shared/agent-run-state'
import { DiffStat } from '../../../components/DiffPatch'
import { Badge, Button } from '../../../ui'
import { RejectWorkForm } from '../../planning/RejectWorkForm'
import { offerLessonAfterSendBack } from '../../planning/RememberLesson'
import { useTaskReview } from './useTaskReview'
import { t } from '@shared/i18n'

type RunAction = (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

/**
 * The Agents view's "Ready for you to review" (simplify pass §7): agent
 * questions, answered inline (`questions`), then every finished task with its
 * changes and the verdicts: Apply (or "Nothing changed: Close"), Send back
 * with a reason, and Discard. Review… opens the full dialog.
 */
export function NeedsYouSection({
  projectId,
  questions,
  reviewSessions,
  tasks = [],
  busy,
  runHarnessAction,
  openSessionReview
}: {
  projectId: string
  /** The inline question panel, or null when no agent is asking. */
  questions: ReactNode
  reviewSessions: HarnessSession[]
  /** The project's queued tasks, to find each run's task. */
  tasks?: HarnessTask[]
  busy: boolean
  runHarnessAction: RunAction
  openSessionReview: (sessionId: string) => void
}) {
  const nothing = !questions && reviewSessions.length === 0
  return (
    <section className="agents-section agents-needs-you" aria-labelledby="agents-needs-you">
      <header className="agents-section__header">
        <h3 id="agents-needs-you" tabIndex={-1}>
          {t('agents:needsYouSection.needs')}
        </h3>
        {reviewSessions.length > 0 && (
          <span className="agents-section__meta">
            {t('agents:needsYouSection.runsWaitingReview', { count: reviewSessions.length })}
          </span>
        )}
      </header>
      {nothing && (
        <p className="agents-muted">{t('agents:needsYouSection.nothingNeedsRightNow')}</p>
      )}
      {questions}
      {reviewSessions.length > 0 && (
        <ul className="agents-list" aria-label={t('agents:needsYouSection.runsWaitingReview2')}>
          {reviewSessions.map((session) => (
            <ReviewRow
              key={session.id}
              projectId={projectId}
              session={session}
              task={tasks.find((task) => sessionOwnsTask(session, task))}
              busy={busy}
              runHarnessAction={runHarnessAction}
              openSessionReview={openSessionReview}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Where focus goes when a run's review closes with the run gone from this list
 * (applied, sent back, discarded): the next run's Review…, else this
 * section's heading.
 */
export function reviewFocusFallback(): HTMLElement | null {
  const heading = document.getElementById('agents-needs-you')
  const section = heading?.closest('.agents-needs-you')
  return section?.querySelector<HTMLElement>('.agents-review__actions button') ?? heading
}

function ReviewRow({
  projectId,
  session,
  task,
  busy,
  runHarnessAction,
  openSessionReview
}: {
  projectId: string
  session: HarnessSession
  task: HarnessTask | undefined
  busy: boolean
  runHarnessAction: RunAction
  openSessionReview: (sessionId: string) => void
}) {
  const [sendingBack, setSendingBack] = useState<'sendBack' | 'runAgain' | null>(null)
  const { diff, diffError, nothingChanged, apply, discard } = useTaskReview({
    projectId,
    session,
    runHarnessAction
  })

  return (
    <li className="agents-list__row agents-review">
      <div className="agents-review__top">
        <div className="agents-list__text">
          <strong>{session.title}</strong>
          <small>{session.statusNote || t('agents:needsYouSection.finished')}</small>
          {/* Its reviewer at work (N9.5b); Review changes can be opened meanwhile. */}
          {(session.review?.status === 'running' || session.review?.status === 'overdue') && (
            <small>
              <Badge tone="info">
                {session.review.status === 'running'
                  ? t('agents:reviewer.beingReviewedBadge')
                  : t('agents:reviewer.overdueBadge')}
              </Badge>
            </small>
          )}
          <small className="agents-review__diff">
            {!session.workspace ? (
              t('agents:needsYouSection.noAgentWorkspace')
            ) : diff ? (
              diff.filesChanged === 0 ? (
                t('agents:needsYouSection.noChanges')
              ) : (
                <>
                  {t('agents:needsYouSection.filesChanged', { count: diff.filesChanged })}{' '}
                  <DiffStat insertions={diff.insertions} deletions={diff.deletions} />
                </>
              )
            ) : diffError ? (
              t('agents:needsYouSection.couldntReadChanges')
            ) : (
              t('agents:needsYouSection.readingChanges')
            )}
          </small>
          {diff?.versionChanged && (
            <small>
              {t('agents:needsYouSection.versionChangedNote', {
                task: diff.taskVersion,
                folder: diff.folderVersion
              })}
            </small>
          )}
        </div>
        <div className="agents-review__actions">
          <Button size="sm" variant="ghost" onClick={() => openSessionReview(session.id)}>
            {t('agents:needsYouSection.review')}
          </Button>
          {session.workspace && (
            <>
              {!nothingChanged && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-expanded={sendingBack === 'sendBack'}
                  onClick={() =>
                    setSendingBack((open) => (open === 'sendBack' ? null : 'sendBack'))
                  }
                >
                  {sendingBack === 'sendBack'
                    ? t('agents:taskReview.cancelSendBack')
                    : t('agents:taskReview.sendBack')}
                </Button>
              )}
              {runCanRunAgain(session, task) && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-expanded={sendingBack === 'runAgain'}
                  title={t('agents:runModel.runAgainWithHint')}
                  onClick={() =>
                    setSendingBack((open) => (open === 'runAgain' ? null : 'runAgain'))
                  }
                >
                  {t('agents:runModel.runAgainWith')}
                </Button>
              )}
              {!nothingChanged && (
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void discard()}>
                  {t('agents:taskReview.discard')}
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !diff}
                title={
                  nothingChanged
                    ? t('agents:taskReview.closeNothingChangedHint')
                    : t('agents:taskReview.applyHint')
                }
                onClick={() => void apply()}
              >
                {nothingChanged
                  ? t('agents:taskReview.closeNothingChanged')
                  : t('agents:taskReview.apply')}
              </Button>
            </>
          )}
        </div>
      </div>
      {sendingBack && (
        <RejectWorkForm
          key={sendingBack}
          projectId={projectId}
          busy={busy}
          runAgain={sendingBack === 'runAgain'}
          initialChoice={{ model: task?.model ?? '', effort: task?.effort ?? '' }}
          commentCount={session.reviewDrafts?.length ?? 0}
          onReject={(reason, disposition, runAgainWith) =>
            void runHarnessAction(async () => {
              const drafts = session.reviewDrafts
              const result = await window.ostlerAPI.sendBackHarnessTaskWork(
                projectId,
                session.id,
                reason,
                disposition,
                runAgainWith
              )
              if (result.ok) offerLessonAfterSendBack(projectId, session, task, reason, drafts)
              return result
            }).then((sent) => {
              if (sent) setSendingBack(null)
            })
          }
        />
      )}
    </li>
  )
}
