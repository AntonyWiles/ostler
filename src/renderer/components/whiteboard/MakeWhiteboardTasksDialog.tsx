import { useEffect, useMemo, useState } from 'react'
import type { PlanningMilestone } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { formatDate } from '@shared/format'
import { t } from '@shared/i18n'
import { TASK_PRIORITY_LABELS } from '@shared/task-labels'
import type { WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  WHITEBOARD_TASKS_MAX,
  whiteboardTaskDrafts,
  whiteboardTaskSkip,
  type MakeWhiteboardTasksResult,
  type WhiteboardTaskSkip
} from '@shared/whiteboard/tasks'
import { usePeople } from '../../context/PeopleContext'
import { useStatusLabelFor } from '../../context/ColumnsContext'
import { Badge, Button, Dialog, InlineAlert, Select, useToast } from '../../ui'
import '../line-tasks/MakeLineTasksDialog.css'

/** Milestones a task can go in: planned and active ones. */
export function openMilestones(milestones: readonly PlanningMilestone[]): PlanningMilestone[] {
  return milestones.filter(
    (milestone) => milestone.status === 'planned' || milestone.status === 'active'
  )
}

const LEFT_OUT_KEYS: Record<WhiteboardTaskSkip | 'tooMany', string> = {
  linked: 'library:whiteboard.tasks.leftOutLinked',
  noText: 'library:whiteboard.tasks.leftOutNoText',
  kind: 'library:whiteboard.tasks.leftOutKind',
  tooMany: 'library:whiteboard.tasks.leftOutTooMany'
}

export interface MakeWhiteboardTasksDialogProps {
  projectId: string
  whiteboardId: string
  /** The selected objects. */
  objects: readonly WhiteboardObjectInput[]
  /** The project's milestones; planned and active ones are offered. */
  milestones: readonly PlanningMilestone[]
  /** Saves the editor's changes, so main checks the objects as they are now. */
  flush(): Promise<void>
  onClose(): void
  /** Which object made which task: the editor links them, as one undo step. */
  onMade(made: MakeWhiteboardTasksResult['made']): void
}

/**
 * Make tasks from a whiteboard (prompt 13, D17), shaped like Make a task from
 * a line: the tasks the selected notes, shapes and mind-map nodes make, as
 * quick add reads them, and what was left out and why, before anything is
 * made. The toast's one undo deletes the tasks and clears the links, also
 * after the board was closed.
 */
export function MakeWhiteboardTasksDialog({
  projectId,
  whiteboardId,
  objects,
  milestones,
  flush,
  onClose,
  onMade
}: MakeWhiteboardTasksDialogProps) {
  const people = usePeople()
  const statusLabel = useStatusLabelFor()
  const { toast, toastUndo } = useToast()
  const [labels, setLabels] = useState<string[]>([])
  const [milestoneId, setMilestoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getPlanningLabels(projectId).then((result) => {
      if (live && result.ok) setLabels(result.value.map((label) => label.name))
    })
    return () => {
      live = false
    }
  }, [projectId])

  const offered = people.offered(projectId)
  const drafts = useMemo(
    () =>
      whiteboardTaskDrafts(objects, {
        today: todayIsoDate(),
        locale: navigator.language,
        people: offered.map((person) => ({ id: person.id, name: person.name, isMe: person.isMe })),
        labels,
        projects: []
      }),
    [objects, offered, labels]
  )
  const leftOut = useMemo(() => {
    const counts: Record<WhiteboardTaskSkip | 'tooMany', number> = {
      linked: 0,
      noText: 0,
      kind: 0,
      tooMany: 0
    }
    let taskable = 0
    for (const object of objects) {
      const skip = whiteboardTaskSkip(object)
      if (skip === null) taskable++
      else counts[skip]++
    }
    counts.tooMany = Math.max(0, taskable - WHITEBOARD_TASKS_MAX)
    return (Object.keys(LEFT_OUT_KEYS) as (keyof typeof LEFT_OUT_KEYS)[])
      .filter((reason) => counts[reason] > 0)
      .map((reason) =>
        t(LEFT_OUT_KEYS[reason], { count: counts[reason], max: WHITEBOARD_TASKS_MAX })
      )
  }, [objects])
  const choices = openMilestones(milestones)
  const personName = (id: string | null) =>
    id ? (offered.find((person) => person.id === id)?.name ?? null) : null

  const make = async () => {
    if (busy || drafts.length === 0) return
    setBusy(true)
    setError(null)
    await flush()
    const result = await window.ostlerAPI.makeWhiteboardTasks(projectId, {
      whiteboardId,
      milestoneId: milestoneId === '' ? null : milestoneId,
      tasks: drafts
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const { made } = result.value
    onMade(made)
    toastUndo(t('library:whiteboard.tasks.made', { count: made.length }), async () => {
      const undone = await window.ostlerAPI.undoWhiteboardTasks(projectId, {
        whiteboardId,
        taskIds: made.map((entry) => entry.taskId)
      })
      if (!undone.ok) toast({ title: undone.error, tone: 'danger' })
    })
    onClose()
  }

  const backlog = statusLabel('backlog', projectId)
  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('library:whiteboard.tasks.title')}
      description={t('library:whiteboard.tasks.description')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('library:whiteboard.tasks.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || drafts.length === 0}
            onClick={() => void make()}
          >
            {t('library:whiteboard.tasks.make', { count: drafts.length })}
          </Button>
        </>
      }
    >
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <Select
        label={t('library:whiteboard.tasks.milestone')}
        size="sm"
        value={milestoneId}
        onChange={(event) => setMilestoneId(event.target.value)}
        options={[
          { value: '', label: t('library:whiteboard.tasks.noMilestone') },
          ...choices.map((milestone) => ({ value: milestone.id, label: milestone.name }))
        ]}
      />
      {leftOut.length > 0 && <p className="ostler-line-tasks-empty">{leftOut.join(' ')}</p>}
      {drafts.length === 0 ? (
        <p className="ostler-line-tasks-empty">{t('library:whiteboard.tasks.nothing')}</p>
      ) : (
        <ul className="ostler-line-tasks" aria-label={t('library:whiteboard.tasks.previewList')}>
          {drafts.map((draft) => {
            const assignee = personName(draft.assigneeId)
            const lines = draft.description ? draft.description.split('\n').length : 0
            return (
              <li key={draft.objectId} className="ostler-line-tasks__row">
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
