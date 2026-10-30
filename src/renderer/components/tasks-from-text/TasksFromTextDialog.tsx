import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { todayIsoDate } from '@shared/dates'
import {
  isAcceptedPhoto,
  TEXT_TASKS_MAX_TEXT,
  type TasksFromTextDraft,
  type TasksFromTextPhoto
} from '@shared/tasks-from-text'
import { Button, Checkbox, DateField, Dialog, InlineAlert, TextArea, useToast } from '../../ui'
import { Image as ImageIcon, Sparkles, X } from '../../ui/icons'
import { localeWeekStart } from '../../ui/calendar-layout'
import { AssigneeField } from '../../views/planning/AssigneeField'
import {
  AiTaskReviewAddButton,
  AiTaskReviewItem,
  AiTaskReviewList,
  aiSuggestionName
} from '../AiTaskReview'
import { AiByline } from '../AiByline'
import { t } from '@shared/i18n'
import './TasksFromText.css'

/** One suggestion as the person is editing it. */
interface Review {
  included: boolean
  title: string
  description: string
  dueDate: string
  assigneeId: string | null
  personName: string | null
  checklist: string
}

/** The type Windows gave the file, or one read from its name (HEIC often has none). */
export function photoMimeType(file: { type: string; name: string }): string {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  if (extension === 'heic' || extension === 'heif') return `image/${extension}`
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  return ''
}

async function readPhoto(file: File): Promise<TasksFromTextPhoto | null> {
  const mimeType = photoMimeType(file)
  if (!isAcceptedPhoto({ mimeType, size: file.size })) return null
  return { fileName: file.name, mimeType, bytes: new Uint8Array(await file.arrayBuffer()) }
}

/**
 * Tasks from text or a photo (N4.1a): type, dictate (Windows + H) or paste a
 * list, or add a photo of one, then press Find tasks. Nothing is sent before
 * that press, and nothing is added before Add N tasks; the review list is
 * the same `AiTaskReview` every AI draft goes through.
 */
export function TasksFromTextDialog({
  projectId,
  onClose,
  onAdded
}: {
  projectId: string
  onClose: () => void
  onAdded?: () => void
}) {
  const { toast, toastUndo } = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<TasksFromTextPhoto | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [keepPhoto, setKeepPhoto] = useState(false)
  const [draft, setDraft] = useState<TasksFromTextDraft | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    },
    [photoUrl]
  )

  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    const read = await readPhoto(file)
    if (!read) {
      setError(t('tasks:tasksFromText.photoNotAccepted'))
      return
    }
    setError(null)
    setPhoto(read)
    setPhotoUrl(URL.createObjectURL(file))
  }

  const removePhoto = () => {
    setPhoto(null)
    setPhotoUrl(null)
    setKeepPhoto(false)
  }

  const onPaste = (event: ClipboardEvent) => {
    const file = [...event.clipboardData.files].find((entry) => entry.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void addPhoto(file)
  }

  const onDrop = (event: DragEvent) => {
    const file = event.dataTransfer.files[0]
    if (!file) return
    event.preventDefault()
    void addPhoto(file)
  }

  const findTasks = async () => {
    if (busy) return
    if (!text.trim() && !photo) {
      setError(t('tasks:tasksFromText.nothingToRead'))
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.findTasksFromText(projectId, {
      text,
      photo,
      today: todayIsoDate(),
      weekStart: localeWeekStart()
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft(result.value)
    setReviews(
      result.value.suggestions.map((suggestion) => ({
        included: true,
        title: suggestion.title,
        description: suggestion.description,
        dueDate: suggestion.dueDate ?? '',
        assigneeId: suggestion.assigneeId,
        personName: suggestion.personName,
        checklist: suggestion.checklist.join('\n')
      }))
    )
  }

  const update = (index: number, patch: Partial<Review>) =>
    setReviews((current) =>
      current.map((review, at) => (at === index ? { ...review, ...patch } : review))
    )

  const ticked = reviews.filter((review) => review.included)
  const missingTitle = ticked.some((review) => !review.title.trim())

  const addTasks = async () => {
    if (!draft || busy || ticked.length === 0) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.addTasksFromText(projectId, {
      draftId: draft.draftId,
      keepPhoto: keepPhoto ? photo : null,
      tasks: ticked.map((review) => ({
        title: review.title.trim(),
        description: review.description,
        dueDate: review.dueDate || null,
        assigneeId: review.assigneeId,
        checklist: review.checklist
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
      }))
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const created = result.value
    toastUndo(t('tasks:tasksFromText.added', { count: created.length }), async () => {
      for (const task of created) {
        const removed = await window.ostlerAPI.deletePlanningWorkItem(task.id)
        if (!removed.ok) {
          toast({ title: removed.error, tone: 'danger' })
          return
        }
      }
    })
    onAdded?.()
    onClose()
  }

  const reviewing = draft !== null

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('tasks:tasksFromText.title')}
      description={
        reviewing
          ? t('tasks:tasksFromText.reviewDescription')
          : t('tasks:tasksFromText.description')
      }
      footer={
        reviewing ? (
          <>
            <Button onClick={() => setDraft(null)} disabled={busy}>
              {t('tasks:tasksFromText.back')}
            </Button>
            <AiTaskReviewAddButton
              count={ticked.length}
              missingTitle={missingTitle}
              loading={busy}
              onClick={() => void addTasks()}
            />
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('tasks:tasksFromText.cancel')}
            </Button>
            <Button
              variant="ai"
              icon={Sparkles}
              loading={busy}
              disabled={busy}
              onClick={() => void findTasks()}
            >
              {t('tasks:tasksFromText.findTasks')}
            </Button>
          </>
        )
      }
    >
      <div className="dialog-form tasks-from-text" onPaste={onPaste}>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {!reviewing && (
          <>
            <TextArea
              label={t('tasks:tasksFromText.textLabel')}
              hint={t('tasks:tasksFromText.dictateHint')}
              data-autofocus
              rows={10}
              maxLength={TEXT_TASKS_MAX_TEXT}
              value={text}
              disabled={busy}
              placeholder={t('tasks:tasksFromText.placeholder')}
              onChange={(event) => {
                setText(event.target.value)
                setError(null)
              }}
            />
            <div
              className="tasks-from-text__photo"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              {photo && photoUrl ? (
                <div className="tasks-from-text__preview">
                  <img src={photoUrl} alt={t('tasks:tasksFromText.photoAlt')} />
                  <span>{photo.fileName}</span>
                  <Button icon={X} size="sm" onClick={removePhoto} disabled={busy}>
                    {t('tasks:tasksFromText.removePhoto')}
                  </Button>
                </div>
              ) : (
                <>
                  <Button icon={ImageIcon} onClick={() => fileRef.current?.click()} disabled={busy}>
                    {t('tasks:tasksFromText.addPhoto')}
                  </Button>
                  <span className="dialog-muted">{t('tasks:tasksFromText.photoHint')}</span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                hidden
                aria-label={t('tasks:tasksFromText.addPhoto')}
                data-testid="tasks-from-text-file"
                accept=".png,.jpg,.jpeg,.heic,.heif,image/png,image/jpeg,image/heic,image/heif"
                onChange={(event) => {
                  void addPhoto(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </div>
            {photo && (
              <Checkbox
                label={t('tasks:tasksFromText.keepPhoto')}
                hint={t('tasks:tasksFromText.keepPhotoHint')}
                checked={keepPhoto}
                disabled={busy}
                onChange={(event) => setKeepPhoto(event.target.checked)}
              />
            )}
            <p className="dialog-muted">
              {photo ? t('tasks:tasksFromText.sentWithPhoto') : t('tasks:tasksFromText.sent')}
            </p>
          </>
        )}
        {reviewing && draft && (
          <>
            <AiByline model={draft.model} at={draft.generatedAt} />
            {draft.unmatchedNames.length > 0 && (
              <InlineAlert tone="warning">
                {t('tasks:tasksFromText.unmatchedNames', {
                  names: draft.unmatchedNames.join(', ')
                })}
              </InlineAlert>
            )}
            {(draft.badDates > 0 || draft.dropped > 0) && (
              <p className="dialog-muted">
                {t('tasks:tasksFromText.leftOut', {
                  dates: draft.badDates,
                  tasks: draft.dropped
                })}
              </p>
            )}
            {reviews.length === 0 ? (
              <p>{t('tasks:tasksFromText.noneFound')}</p>
            ) : (
              <AiTaskReviewList included={ticked.length} total={reviews.length}>
                {reviews.map((review, index) => {
                  const locked = busy || !review.included
                  return (
                    <AiTaskReviewItem
                      key={index}
                      name={aiSuggestionName(index)}
                      included={review.included}
                      onToggle={(included) => update(index, { included })}
                      title={review.title}
                      onTitleChange={(title) => update(index, { title })}
                      details={review.description}
                      onDetailsChange={(description) => update(index, { description })}
                      disabled={busy}
                    >
                      <div className="dialog-form__row">
                        <DateField
                          label={t('tasks:tasksFromText.dueDate')}
                          value={review.dueDate}
                          disabled={locked}
                          onChange={(dueDate) => update(index, { dueDate })}
                        />
                        <AssigneeField
                          label={t('tasks:tasksFromText.person')}
                          projectId={projectId}
                          value={review.assigneeId}
                          onChange={(assigneeId) => update(index, { assigneeId })}
                        />
                      </div>
                      {review.personName && !review.assigneeId && (
                        <p className="dialog-muted">
                          {t('tasks:tasksFromText.personNotFound', { name: review.personName })}
                        </p>
                      )}
                      <TextArea
                        label={t('tasks:tasksFromText.checklist')}
                        hint={t('tasks:tasksFromText.checklistHint')}
                        rows={3}
                        value={review.checklist}
                        disabled={locked}
                        onChange={(event) => update(index, { checklist: event.target.value })}
                      />
                    </AiTaskReviewItem>
                  )
                })}
              </AiTaskReviewList>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

/**
 * "From text or a photo…": shown only while Ostler AI is set up. Beside the
 * title in New task and quick add, never in place of their own parsing.
 */
export function TasksFromTextButton({
  projectId,
  visible,
  onAdded
}: {
  projectId: string
  visible: boolean
  onAdded?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!visible || !projectId) return null
  return (
    <>
      <Button variant="ai" icon={Sparkles} onClick={() => setOpen(true)}>
        {t('tasks:tasksFromText.open')}
      </Button>
      {open && (
        <TasksFromTextDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onAdded={onAdded}
        />
      )}
    </>
  )
}
