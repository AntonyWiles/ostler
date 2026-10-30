import { useEffect, useMemo, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { formatDate } from '@shared/format'
import { t } from '@shared/i18n'
import { lineTaskDrafts, type LineTaskMode } from '@shared/note-line-tasks'
import { TASK_PRIORITY_LABELS } from '@shared/task-labels'
import { usePeople } from '../../context/PeopleContext'
import { useStatusLabelFor } from '../../context/ColumnsContext'
import { Badge, Button, Dialog, InlineAlert, SegmentedControl, useToast } from '../../ui'
import './MakeLineTasksDialog.css'

export interface MakeLineTasksRequest {
  /** The text the lines were selected in. */
  body: string
  from: number
  to: number
  mode: LineTaskMode
}

interface MakeLineTasksDialogProps {
  item: LibraryItem
  request: MakeLineTasksRequest
  onClose(): void
  /** The note as saved with its lines turned into links. */
  onMade(item: LibraryItem): void
  /** After the undo put the note's text back. */
  onUndone?(item: LibraryItem): void
}

/**
 * Make a task from a line (N4.4b): the tasks the selected lines make, as
 * quick add reads them, before anything is made. Making them turns each line
 * into a link to its task; the toast's one undo takes the tasks and the
 * links back.
 */
export function MakeLineTasksDialog({
  item,
  request,
  onClose,
  onMade,
  onUndone
}: MakeLineTasksDialogProps) {
  const people = usePeople()
  const statusLabel = useStatusLabelFor()
  const { toast, toastUndo } = useToast()
  const [mode, setMode] = useState<LineTaskMode>(request.mode)
  const [labels, setLabels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getPlanningLabels(item.projectId).then((result) => {
      if (live && result.ok) setLabels(result.value.map((label) => label.name))
    })
    return () => {
      live = false
    }
  }, [item.projectId])

  const drafts = useMemo(
    () =>
      lineTaskDrafts(request.body, request.from, request.to, mode, {
        today: todayIsoDate(),
        locale: navigator.language,
        people: people.offered(item.projectId).map((person) => ({
          id: person.id,
          name: person.name,
          isMe: person.isMe
        })),
        labels,
        projects: []
      }),
    [request, mode, people.offered(item.projectId), labels]
  )
  const personName = (id: string | null) =>
    id ? (people.offered(item.projectId).find((person) => person.id === id)?.name ?? null) : null

  const make = async () => {
    if (busy || drafts.length === 0) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.makeLineTasks(item.projectId, {
      itemId: item.id,
      revision: item.revision,
      body: request.body,
      tasks: drafts
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const made = result.value
    onMade(made.item)
    toastUndo(t('library:lineTasks.made', { count: made.taskIds.length }), async () => {
      const undone = await window.ostlerAPI.undoLineTasks(item.projectId, {
        itemId: item.id,
        taskIds: made.taskIds,
        revision: made.item.revision,
        body: request.body
      })
      if (!undone.ok) {
        toast({ title: undone.error, tone: 'danger' })
        return
      }
      onUndone?.(undone.value)
    })
    onClose()
  }

  const backlog = statusLabel('backlog', item.projectId)
  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('library:lineTasks.title')}
      description={t('library:lineTasks.description')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('library:lineTasks.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || drafts.length === 0}
            onClick={() => void make()}
          >
            {t('library:lineTasks.make', { count: drafts.length })}
          </Button>
        </>
      }
    >
      {request.to > request.from && (
        <SegmentedControl
          label={t('library:lineTasks.how')}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'one', label: t('library:lineTasks.one') },
            { value: 'each', label: t('library:lineTasks.each') }
          ]}
        />
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {drafts.length === 0 ? (
        <p className="ostler-line-tasks-empty">{t('library:lineTasks.nothing')}</p>
      ) : (
        <ul className="ostler-line-tasks" aria-label={t('library:lineTasks.previewList')}>
          {drafts.map((draft) => {
            const assignee = personName(draft.assigneeId)
            const lines = draft.description ? draft.description.split('\n').length : 0
            return (
              <li key={draft.line} className="ostler-line-tasks__row">
                <span className="ostler-line-tasks__title">{draft.title}</span>
                <span className="ostler-line-tasks__fields">
                  <Badge>{backlog}</Badge>
                  {draft.labels.map((label) => (
                    <Badge key={label}>#{label}</Badge>
                  ))}
                  {assignee && <Badge>@{assignee}</Badge>}
                  {draft.priority && <Badge>{TASK_PRIORITY_LABELS[draft.priority]}</Badge>}
                  {draft.dueDate && (
                    <Badge>
                      {t('library:lineTasks.due', {
                        date: formatDate(new Date(`${draft.dueDate}T00:00:00`))
                      })}
                    </Badge>
                  )}
                  {lines > 0 && (
                    <span className="ostler-line-tasks__more">
                      {t('library:lineTasks.descriptionLines', { count: lines })}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
