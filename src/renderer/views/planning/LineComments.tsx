import { useEffect, useRef, useState } from 'react'
import type { HarnessReviewComment } from '@shared/ostler-api'
import { MAX_REVIEW_COMMENT_LENGTH, MAX_REVIEW_COMMENTS } from '@shared/review-comments'
import { Button, InlineAlert, TextArea, useToast } from '../../ui'
import { Pencil, Trash2 } from '../../ui/icons'
import type { DiffLineSelection } from '../../components/DiffPatch'
import { t } from '@shared/i18n'
import './LineComments.css'

/**
 * Comments on lines of an agent's change (N9.2a): the drafts kept with the
 * session, the form that writes one, and the Comments list beside the diff.
 * The comments the last review sent are in `CommentAnswers.tsx` (N9.2b).
 */

type Lines = Pick<HarnessReviewComment, 'side' | 'firstLine' | 'lastLine'>

/** "lines 4 to 9", or "removed line 4". */
export function linesText(lines: Lines): string {
  const single = lines.firstLine === lines.lastLine
  if (lines.side === 'old') {
    return single
      ? t('agents:lineComments.oldLine', { line: lines.firstLine })
      : t('agents:lineComments.oldLines', { first: lines.firstLine, last: lines.lastLine })
  }
  return single
    ? t('agents:lineComments.newLine', { line: lines.firstLine })
    : t('agents:lineComments.newLines', { first: lines.firstLine, last: lines.lastLine })
}

/** "src/app.ts, lines 4 to 9". */
export function whereText(comment: Lines & { file: string }): string {
  return t('agents:lineComments.where', { file: comment.file, lines: linesText(comment) })
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2)}`
}

/**
 * A session's draft comments, kept with the session in main on every change,
 * so closing Review changes keeps them. Deleting offers undo.
 */
export function useReviewDrafts(
  projectId: string,
  sessionId: string,
  initial: HarnessReviewComment[]
) {
  const { toastUndo } = useToast()
  const [drafts, setDrafts] = useState<HarnessReviewComment[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(drafts)
  latest.current = drafts

  const keep = async (next: HarnessReviewComment[]) => {
    setDrafts(next)
    const result = await window.ostlerAPI.saveHarnessReviewDrafts(projectId, sessionId, next)
    setError(result.ok ? null : t('agents:lineComments.saveFailed', { message: result.error }))
  }

  const add = (selection: DiffLineSelection, comment: string) =>
    keep([...latest.current, { id: newId(), ...selection, comment: comment.trim() }])

  const edit = (id: string, comment: string) =>
    keep(
      latest.current.map((entry) =>
        entry.id === id ? { ...entry, comment: comment.trim() } : entry
      )
    )

  const remove = (id: string) => {
    const index = latest.current.findIndex((entry) => entry.id === id)
    if (index < 0) return
    const removed = latest.current[index]
    void keep(latest.current.filter((entry) => entry.id !== id))
    toastUndo(t('agents:lineComments.deleted'), () => {
      const next = [...latest.current]
      next.splice(Math.min(index, next.length), 0, removed)
      return keep(next)
    })
  }

  return { drafts, error, add, edit, remove, full: drafts.length >= MAX_REVIEW_COMMENTS }
}

/** Writing or editing one comment. */
export function LineCommentForm({
  lines,
  initial = '',
  onSave,
  onCancel
}: {
  lines: Lines
  initial?: string
  onSave: (comment: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const area = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    area.current?.focus()
  }, [])
  const empty = text.trim().length === 0
  return (
    <div className="line-comments__form">
      <TextArea
        ref={area}
        label={t('agents:lineComments.label', { lines: linesText(lines) })}
        hint={t('agents:lineComments.hint')}
        rows={2}
        maxLength={MAX_REVIEW_COMMENT_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="line-comments__actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('agents:lineComments.cancel')}
        </Button>
        <Button size="sm" variant="primary" disabled={empty} onClick={() => onSave(text)}>
          {t('agents:lineComments.save')}
        </Button>
      </div>
    </div>
  )
}

/** A draft comment under its lines in the diff. */
export function InlineComment({ comment }: { comment: HarnessReviewComment }) {
  return <p className="line-comments__inline">{comment.comment}</p>
}

/** The Comments list beside the diff: each can be shown, edited or deleted. */
export function LineCommentsList({
  drafts,
  onJump,
  onEdit,
  onDelete
}: {
  drafts: HarnessReviewComment[]
  onJump: (comment: HarnessReviewComment) => void
  onEdit: (id: string, comment: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <section className="line-comments" aria-label={t('agents:lineComments.title')}>
      <h4 className="line-comments__title">
        {t('agents:lineComments.title')} ({drafts.length})
      </h4>
      {drafts.length === 0 ? (
        <p className="dialog-muted">{t('agents:lineComments.none')}</p>
      ) : (
        <ul className="line-comments__list">
          {drafts.map((comment) => {
            const where = whereText(comment)
            return (
              <li key={comment.id} className="line-comments__item">
                <code className="line-comments__where">{where}</code>
                {editing === comment.id ? (
                  <LineCommentForm
                    lines={comment}
                    initial={comment.comment}
                    onCancel={() => setEditing(null)}
                    onSave={(text) => {
                      onEdit(comment.id, text)
                      setEditing(null)
                    }}
                  />
                ) : (
                  <>
                    <p className="line-comments__text">{comment.comment}</p>
                    <div className="line-comments__actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('agents:lineComments.jumpToLabel', { where })}
                        onClick={() => onJump(comment)}
                      >
                        {t('agents:lineComments.jumpTo')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Pencil}
                        aria-label={t('agents:lineComments.editLabel', { where })}
                        onClick={() => setEditing(comment.id)}
                      >
                        {t('agents:lineComments.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        aria-label={t('agents:lineComments.deleteLabel', { where })}
                        onClick={() => onDelete(comment.id)}
                      >
                        {t('agents:lineComments.delete')}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Shown when saving drafts failed. */
export function DraftsError({ error }: { error: string | null }) {
  return error ? <InlineAlert tone="danger">{error}</InlineAlert> : null
}
