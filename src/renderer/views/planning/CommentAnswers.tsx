import type { HarnessCommentAnswer } from '@shared/ostler-api'
import type { CommentAnswerCounts, CommentWithAnswer } from '@shared/comment-answers'
import { Badge, Button, type BadgeTone } from '../../ui'
import { MessageSquare } from '../../ui/icons'
import { whereText } from './LineComments'
import { t } from '@shared/i18n'
import './LineComments.css'

/**
 * Comments from the last review as a checklist (N9.2b): each comment with
 * its excerpt and the agent's answer, which is the agent's claim and shown
 * as its words, beside the new diff so the person can judge. Notes are
 * untrusted text and only ever rendered as text.
 */

const STATUS: Record<'done' | 'not-done' | 'none', { key: string; tone: BadgeTone }> = {
  done: { key: 'agents:commentAnswers.done', tone: 'success' },
  'not-done': { key: 'agents:commentAnswers.notDone', tone: 'warning' },
  none: { key: 'agents:commentAnswers.noAnswer', tone: 'neutral' }
}

/** "3 done, 1 not done, 1 no answer", leaving out the parts that are zero. */
export function countsText(counts: CommentAnswerCounts): string {
  const parts = [
    counts.done > 0 ? t('agents:commentAnswers.countDone', { count: counts.done }) : null,
    counts.notDone > 0 ? t('agents:commentAnswers.countNotDone', { count: counts.notDone }) : null,
    counts.missing > 0 ? t('agents:commentAnswers.countMissing', { count: counts.missing }) : null
  ].filter((part): part is string => part !== null)
  return parts.join(t('agents:commentAnswers.separator'))
}

/** "3 of 4 comments answered", for next to Apply; null when every comment has an answer. */
export function answeredAlertText(counts: CommentAnswerCounts): string | null {
  if (counts.missing === 0) return null
  return t('agents:commentAnswers.answeredOf', {
    count: counts.total,
    answered: counts.total - counts.missing
  })
}

function AnswerStatus({ answer }: { answer: HarnessCommentAnswer | null }) {
  const status = STATUS[answer?.status ?? 'none']
  return <Badge tone={status.tone}>{t(status.key)}</Badge>
}

export function CommentAnswersChecklist({
  pairs,
  counts,
  answered,
  onShow,
  onCommentAgain,
  canCommentAgain,
  canShow
}: {
  pairs: CommentWithAnswer[]
  counts: CommentAnswerCounts
  /** False while the attempt has not finished: no answers can be there yet. */
  answered: boolean
  /** Jumps to where the change now is. */
  onShow: (pair: CommentWithAnswer) => void
  /** Carries the comment into a new draft; absent while new comments cannot be written. */
  onCommentAgain?: (pair: CommentWithAnswer) => void
  /** Whether a comment's lines are in the new diff, so it can be commented on again. */
  canCommentAgain?: (pair: CommentWithAnswer) => boolean
  /** Whether Show has somewhere to go. */
  canShow: (pair: CommentWithAnswer) => boolean
}) {
  return (
    <section className="line-comments" aria-label={t('agents:lineComments.lastReview')}>
      <h4 className="line-comments__title">{t('agents:lineComments.lastReview')}</h4>
      {answered && <p className="line-comments__counts">{countsText(counts)}</p>}
      <p className="dialog-muted">
        {answered ? t('agents:commentAnswers.hint') : t('agents:lineComments.lastReviewHint')}
      </p>
      <ol className="line-comments__list">
        {pairs.map((pair) => {
          const { comment, answer } = pair
          const where = whereText(comment)
          return (
            <li key={comment.id} className="line-comments__item">
              <div className="line-comments__head">
                <code className="line-comments__where">{where}</code>
                {answered && <AnswerStatus answer={answer} />}
              </div>
              <pre className="line-comments__excerpt">{comment.excerpt}</pre>
              <p className="line-comments__text">{comment.comment}</p>
              {answered && answer?.note && (
                <div className="line-comments__answer">
                  <span className="line-comments__answer-label">
                    {t('agents:commentAnswers.agentSays')}
                  </span>
                  <p className="line-comments__text">{answer.note}</p>
                </div>
              )}
              <div className="line-comments__actions">
                {canShow(pair) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('agents:commentAnswers.showLabel', { where })}
                    onClick={() => onShow(pair)}
                  >
                    {t('agents:lineComments.jumpTo')}
                  </Button>
                )}
                {onCommentAgain && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={MessageSquare}
                    disabled={canCommentAgain ? !canCommentAgain(pair) : false}
                    title={
                      canCommentAgain && !canCommentAgain(pair)
                        ? t('agents:commentAnswers.commentAgainGone')
                        : undefined
                    }
                    aria-label={t('agents:commentAnswers.commentAgainLabel', { where })}
                    onClick={() => onCommentAgain(pair)}
                  >
                    {t('agents:commentAnswers.commentAgain')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
