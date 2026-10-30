import { useEffect, useState } from 'react'
import type { ActivityEntry, PlanningWorkItem } from '@shared/ostler-api'
import { COMMENT_SUMMARY_MIN_COMMENTS, type CommentSummary } from '@shared/writing-help'
import { formatDate } from '@shared/format'
import { useFeatures } from '../../navigation/features'
import { Button, InlineAlert, useToast } from '../../ui'
import { Sparkles } from '../../ui/icons'
import { CommentBody } from './ActivityList'
import '../../components/WritingHelp.css'
import { t } from '@shared/i18n'

/**
 * Summarise comments (N8.2): on a task with enough comments, asks Ostler AI
 * for a short summary and shows it above the thread. Nothing is stored
 * unless the person adds it, as a comment by Ostler AI, with undo.
 * `entries` is the thread as loaded; a change to it re-counts the comments.
 */
export function CommentSummaryPanel({
  item,
  entries,
  onAdded
}: {
  item: PlanningWorkItem
  entries: ActivityEntry[]
  onAdded: () => void
}) {
  const features = useFeatures()
  const { toastUndo } = useToast()
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CommentSummary | null>(null)

  useEffect(() => {
    if (!features.ai) return
    let cancelled = false
    void window.ostlerAPI.getPlanningCommentCounts(item.projectId).then((result) => {
      if (!cancelled && result.ok) setCount(result.value[item.id] ?? 0)
    })
    return () => {
      cancelled = true
    }
  }, [features.ai, item.projectId, item.id, entries])

  if (!features.ai || (count < COMMENT_SUMMARY_MIN_COMMENTS && !summary)) return null

  const summarise = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.summariseComments(item.projectId, item.id)
      if (!result.ok) setError(result.error)
      else setSummary(result.value)
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!summary) return
    setBusy(true)
    try {
      const result = await window.ostlerAPI.addCommentSummary(
        item.projectId,
        item.id,
        summary.summary
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSummary(null)
      onAdded()
      const commentId = result.value.id
      toastUndo(t('ai:commentSummary.added'), async () => {
        const removed = await window.ostlerAPI.deletePlanningComment(commentId)
        if (!removed.ok) setError(removed.error)
        onAdded()
      })
    } finally {
      setBusy(false)
    }
  }

  const range = summary
    ? t(
        summary.count < summary.total ? 'ai:commentSummary.latestOnly' : 'ai:commentSummary.range',
        {
          count: summary.count,
          total: summary.total,
          from: formatDate(summary.from),
          to: formatDate(summary.to)
        }
      )
    : ''

  return (
    <>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {summary ? (
        <section className="comment-summary" aria-label={t('ai:commentSummary.title')}>
          <h4 className="writing-help__title">{t('ai:commentSummary.title')}</h4>
          <p className="writing-help__muted">{range}</p>
          <CommentBody body={summary.summary} />
          <div className="writing-help__actions">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void add()}>
              {t('ai:commentSummary.addAsComment')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSummary(null)}>
              {t('ai:commentSummary.close')}
            </Button>
          </div>
        </section>
      ) : (
        <div className="comment-summary__bar">
          <Button
            size="sm"
            variant="ai"
            icon={Sparkles}
            loading={busy}
            title={t('ai:commentSummary.summariseHint')}
            onClick={() => void summarise()}
          >
            {busy ? t('ai:commentSummary.summarising') : t('ai:commentSummary.summarise')}
          </Button>
        </div>
      )}
    </>
  )
}
