import { useEffect, useMemo, useState } from 'react'
import type { HarnessReviewComment } from '@shared/ostler-api'
import { addLesson, MAX_LESSON_LENGTH, projectLessons } from '@shared/project-lessons'
import { Button, Dialog, InlineAlert, TextArea, useToast } from '../../ui'
import { whereText } from './LineComments'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'
import './RememberLesson.css'

/**
 * Remember this for next time (N9.6a, N64): after a Send back with a reason
 * or line comments, a toast offers to turn it into a lesson. The dialog
 * drafts the lesson from the reason, offers each comment instead, and saves
 * only what the person writes and saves. Lessons are saved as Project
 * settings saves them, through `updateProject` and `project-lessons.ts`.
 */

/** What a Send back leaves to learn from. */
export interface LessonOffer {
  projectId: string
  sessionId: string
  taskTitle: string
  reason: string
  comments: HarnessReviewComment[]
}

type Listener = (offer: LessonOffer) => void

/** The mounted host, if any: one, in App.tsx. */
let host: Listener | null = null

/**
 * Offers a lesson after a Send back: a toast whose action opens the dialog.
 * Review changes closes on Send back, so the dialog lives in the host. Does
 * nothing without the host, or when the Send back left nothing to learn from.
 */
export function offerLesson(offer: LessonOffer): void {
  if (hasLessonToOffer(offer)) host?.(offer)
}

/**
 * Every Send back (Review changes, the task drawer, Needs you) calls this once
 * it went through, with the reason and the line comments it carried.
 */
export function offerLessonAfterSendBack(
  projectId: string,
  session: { id: string; title?: string },
  task: { title: string } | null | undefined,
  reason: string,
  comments: HarnessReviewComment[] | undefined
): void {
  offerLesson({
    projectId,
    sessionId: session.id,
    taskTitle: task?.title ?? session.title ?? '',
    reason,
    comments: comments ?? []
  })
}

/** Whether a Send back left anything to learn from. */
export function hasLessonToOffer(offer: Pick<LessonOffer, 'reason' | 'comments'>): boolean {
  return offer.reason.trim().length > 0 || offer.comments.some((c) => c.comment.trim())
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `l${Date.now()}${Math.random().toString(36).slice(2)}`
}

/** Hosts the offer's toast and its dialog. Mounted once, in App.tsx, inside the toast provider. */
export function LessonOfferHost() {
  const { toast } = useToast()
  const [open, setOpen] = useState<LessonOffer | null>(null)
  useEffect(() => {
    const listener: Listener = (offer) => {
      toast({
        title: t('agents:lessons.offerTitle'),
        body: t('agents:lessons.offerBody'),
        action: { label: t('agents:lessons.remember'), onClick: () => setOpen(offer) }
      })
    }
    host = listener
    return () => {
      if (host === listener) host = null
    }
  }, [toast])
  return open ? <RememberLessonDialog offer={open} onClose={() => setOpen(null)} /> : null
}

/** The dialog: the draft from the reason, each comment to use instead, then save or cancel. */
export function RememberLessonDialog({
  offer,
  onClose
}: {
  offer: LessonOffer
  onClose: () => void
}) {
  const { toast } = useToast()
  const reason = offer.reason.trim()
  const [text, setText] = useState(reason || (offer.comments[0]?.comment.trim() ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tooLong = text.trim().length > MAX_LESSON_LENGTH
  const empty = text.trim().length === 0
  const comments = useMemo(() => offer.comments.filter((c) => c.comment.trim()), [offer.comments])

  const save = async () => {
    if (empty || tooLong) return
    setBusy(true)
    setError(null)
    try {
      const projects = await window.ostlerAPI.getProjects()
      if (!projects.ok) throw new Error(projects.error)
      const project = projects.value.find((entry) => entry.id === offer.projectId)
      if (!project) throw new Error(offer.projectId)
      const agentLessons = addLesson(
        projectLessons(project),
        { text, source: { sessionId: offer.sessionId, taskTitle: offer.taskTitle } },
        { id: newId(), now: Date.now() }
      )
      const result = await window.ostlerAPI.updateProject(offer.projectId, { agentLessons })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: t('agents:lessons.saved'),
        body: t('agents:lessons.savedBody'),
        tone: 'success'
      })
      onClose()
    } catch (caught) {
      setError(
        t('agents:lessons.saveFailed', {
          message: caught instanceof Error ? caught.message : String(caught)
        })
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('agents:lessons.dialogTitle')}
      description={t('agents:lessons.dialogDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('agents:lessons.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || empty || tooLong}>
            {t('agents:lessons.save')}
          </Button>
        </>
      }
    >
      <div className="remember-lesson">
        <TextArea
          label={t('agents:lessons.lessonLabel')}
          hint={t('agents:lessons.lessonHint')}
          rows={3}
          data-autofocus
          value={text}
          error={
            tooLong
              ? t('agents:lessons.tooLong', { max: formatNumber(MAX_LESSON_LENGTH) })
              : undefined
          }
          onChange={(event) => setText(event.target.value)}
        />
        {reason && comments.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setText(reason)}>
            {t('agents:lessons.useReason')}
          </Button>
        )}
        {comments.length > 0 && (
          <section aria-label={t('agents:lessons.fromComments')}>
            <h3 className="remember-lesson__heading">{t('agents:lessons.fromComments')}</h3>
            <ul className="remember-lesson__comments">
              {comments.map((comment) => (
                <li key={comment.id} className="remember-lesson__comment">
                  <span className="remember-lesson__where">{whereText(comment)}</span>
                  <p className="remember-lesson__text">{comment.comment}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${t('agents:lessons.useThisComment')}: ${whereText(comment)}`}
                    onClick={() => setText(comment.comment.trim())}
                  >
                    {t('agents:lessons.useThisComment')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  )
}
