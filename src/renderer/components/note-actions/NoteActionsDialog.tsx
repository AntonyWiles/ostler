import { useEffect, useState } from 'react'
import { todayIsoDate } from '@shared/dates'
import type { LibraryItem } from '@shared/ostler-api'
import type { NoteActionsDraft } from '@shared/note-actions'
import {
  Badge,
  Button,
  DateField,
  Dialog,
  InlineAlert,
  Skeleton,
  TextArea,
  useToast
} from '../../ui'
import { Sparkles } from '../../ui/icons'
import { localeWeekStart } from '../../ui/calendar-layout'
import { AssigneeField } from '../../views/planning/AssigneeField'
import { AiTaskReviewItem, AiTaskReviewList, aiSuggestionName } from '../AiTaskReview'
import { AiByline } from '../AiByline'
import { useFeatures } from '../../navigation/features'
import { t } from '@shared/i18n'
import './NoteActions.css'

/** One proposed task as the person is editing it. */
interface TaskReview {
  included: boolean
  already: boolean
  title: string
  description: string
  dueDate: string
  assigneeId: string | null
  personName: string | null
  checklist: string
}

/** One proposed decision as the person is editing it. */
interface DecisionReview {
  included: boolean
  title: string
  decision: string
  context: string
}

/** "3 tasks" and "1 decision", leaving out a kind with none (both when both are none). */
function counts(tasks: number, decisions: number): string[] {
  const taskText = t('tasks:noteActions.taskCount', { count: tasks })
  const decisionText = t('tasks:noteActions.decisionCount', { count: decisions })
  if (tasks > 0 && decisions > 0) return [taskText, decisionText]
  return [decisions > 0 ? decisionText : taskText]
}

/** "Add 3 tasks and 1 decision", "Add 2 tasks", "Add 1 decision". */
export function noteActionsAddLabel(tasks: number, decisions: number): string {
  const [first, second] = counts(tasks, decisions)
  return second
    ? t('tasks:noteActions.addBoth', { tasks: first, decisions: second })
    : t('tasks:noteActions.addOne', { what: first })
}

function addedText(tasks: number, decisions: number): string {
  const [first, second] = counts(tasks, decisions)
  return second
    ? t('tasks:noteActions.addedBoth', { tasks: first, decisions: second })
    : t('tasks:noteActions.added', { what: first })
}

/**
 * Find actions and decisions (N4.1b): opening it sends the note (the button
 * that opens it says so), then two review lists, tasks and decisions, each
 * ticked by default except proposals that are already tasks from this note.
 * Nothing is added before the Add button; one undo removes all it added.
 */
export function NoteActionsDialog({
  projectId,
  item,
  onClose
}: {
  projectId: string
  item: Pick<LibraryItem, 'id' | 'title'>
  onClose: () => void
}) {
  const { toast, toastUndo } = useToast()
  const [draft, setDraft] = useState<NoteActionsDraft | null>(null)
  const [tasks, setTasks] = useState<TaskReview[]>([])
  const [decisions, setDecisions] = useState<DecisionReview[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI
      .findNoteActions(projectId, {
        itemId: item.id,
        today: todayIsoDate(),
        weekStart: localeWeekStart()
      })
      .then((result) => {
        if (cancelled) return
        setBusy(false)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setDraft(result.value)
        setTasks(
          result.value.suggestions.map((suggestion) => ({
            included: suggestion.alreadyTaskId === null,
            already: suggestion.alreadyTaskId !== null,
            title: suggestion.title,
            description: suggestion.description,
            dueDate: suggestion.dueDate ?? '',
            assigneeId: suggestion.assigneeId,
            personName: suggestion.personName,
            checklist: suggestion.checklist.join('\n')
          }))
        )
        setDecisions(result.value.decisions.map((decision) => ({ included: true, ...decision })))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, item.id])

  const updateTask = (index: number, patch: Partial<TaskReview>) =>
    setTasks((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  const updateDecision = (index: number, patch: Partial<DecisionReview>) =>
    setDecisions((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  const tickedTasks = tasks.filter((row) => row.included)
  const tickedDecisions = decisions.filter((row) => row.included)
  const ticked = tickedTasks.length + tickedDecisions.length
  const missingText =
    tickedTasks.some((row) => !row.title.trim()) ||
    tickedDecisions.some((row) => !row.title.trim() || !row.decision.trim())

  const add = async () => {
    if (!draft || busy || ticked === 0 || missingText) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.addNoteActions(projectId, {
      draftId: draft.draftId,
      itemId: draft.itemId,
      tasks: tickedTasks.map((row) => ({
        title: row.title.trim(),
        description: row.description,
        dueDate: row.dueDate || null,
        assigneeId: row.assigneeId,
        checklist: row.checklist
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      })),
      decisions: tickedDecisions.map((row) => ({
        title: row.title.trim(),
        decision: row.decision.trim(),
        context: row.context
      }))
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const { taskIds, decisionIds } = result.value
    toastUndo(addedText(taskIds.length, decisionIds.length), async () => {
      for (const id of decisionIds) {
        const removed = await window.ostlerAPI.deletePlanningDecision(id)
        if (!removed.ok) {
          toast({ title: removed.error, tone: 'danger' })
          return
        }
      }
      for (const id of taskIds) {
        const removed = await window.ostlerAPI.deletePlanningWorkItem(id)
        if (!removed.ok) {
          toast({ title: removed.error, tone: 'danger' })
          return
        }
      }
    })
    onClose()
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      canDismiss={!busy || draft === null}
      closeOnBackdrop={false}
      title={t('tasks:noteActions.title', { title: item.title })}
      description={draft ? t('tasks:noteActions.description') : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy && draft !== null}>
            {t('tasks:noteActions.cancel')}
          </Button>
          {draft && (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || ticked === 0 || missingText}
              disabledReason={
                ticked === 0
                  ? t('tasks:noteActions.tickOne')
                  : missingText
                    ? t('tasks:noteActions.missingText')
                    : undefined
              }
              onClick={() => void add()}
            >
              {noteActionsAddLabel(tickedTasks.length, tickedDecisions.length)}
            </Button>
          )}
        </>
      }
    >
      <div className="dialog-form note-actions">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {!draft && busy && (
          <div role="status" aria-live="polite">
            <p className="dialog-muted">{t('tasks:noteActions.finding')}</p>
            <Skeleton lines={4} />
          </div>
        )}
        {draft && (
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

            <section aria-labelledby="note-actions-tasks">
              <h3 id="note-actions-tasks" className="note-actions__heading">
                {t('tasks:noteActions.tasksHeading')}
              </h3>
              {tasks.length === 0 ? (
                <p className="dialog-muted">{t('tasks:noteActions.noTasks')}</p>
              ) : (
                <AiTaskReviewList included={tickedTasks.length} total={tasks.length}>
                  {tasks.map((row, index) => {
                    const locked = busy || !row.included
                    return (
                      <AiTaskReviewItem
                        key={index}
                        name={aiSuggestionName(index)}
                        included={row.included}
                        onToggle={(included) => updateTask(index, { included })}
                        title={row.title}
                        onTitleChange={(title) => updateTask(index, { title })}
                        details={row.description}
                        onDetailsChange={(description) => updateTask(index, { description })}
                        disabled={busy}
                        fields={
                          row.already ? (
                            <Badge tone="info">{t('tasks:noteActions.alreadyTask')}</Badge>
                          ) : undefined
                        }
                      >
                        <div className="dialog-form__row">
                          <DateField
                            label={t('tasks:tasksFromText.dueDate')}
                            value={row.dueDate}
                            disabled={locked}
                            onChange={(dueDate) => updateTask(index, { dueDate })}
                          />
                          <AssigneeField
                            label={t('tasks:tasksFromText.person')}
                            projectId={projectId}
                            value={row.assigneeId}
                            onChange={(assigneeId) => updateTask(index, { assigneeId })}
                          />
                        </div>
                        {row.personName && !row.assigneeId && (
                          <p className="dialog-muted">
                            {t('tasks:tasksFromText.personNotFound', { name: row.personName })}
                          </p>
                        )}
                        <TextArea
                          label={t('tasks:tasksFromText.checklist')}
                          hint={t('tasks:tasksFromText.checklistHint')}
                          rows={3}
                          value={row.checklist}
                          disabled={locked}
                          onChange={(event) => updateTask(index, { checklist: event.target.value })}
                        />
                      </AiTaskReviewItem>
                    )
                  })}
                </AiTaskReviewList>
              )}
            </section>

            <section aria-labelledby="note-actions-decisions">
              <h3 id="note-actions-decisions" className="note-actions__heading">
                {t('tasks:noteActions.decisionsHeading')}
              </h3>
              {decisions.length === 0 ? (
                <p className="dialog-muted">{t('tasks:noteActions.noDecisions')}</p>
              ) : (
                <AiTaskReviewList included={tickedDecisions.length} total={decisions.length}>
                  {decisions.map((row, index) => (
                    <AiTaskReviewItem
                      key={index}
                      name={t('tasks:noteActions.decisionName', { number: index + 1 })}
                      included={row.included}
                      onToggle={(included) => updateDecision(index, { included })}
                      title={row.title}
                      onTitleChange={(title) => updateDecision(index, { title })}
                      details={row.decision}
                      onDetailsChange={(decision) => updateDecision(index, { decision })}
                      disabled={busy}
                    >
                      <TextArea
                        label={t('tasks:noteActions.decisionContext', {
                          name: t('tasks:noteActions.decisionName', { number: index + 1 })
                        })}
                        rows={2}
                        value={row.context}
                        disabled={busy || !row.included}
                        onChange={(event) => updateDecision(index, { context: event.target.value })}
                      />
                    </AiTaskReviewItem>
                  ))}
                </AiTaskReviewList>
              )}
            </section>
          </>
        )}
      </div>
    </Dialog>
  )
}

/**
 * "Find actions and decisions" on a Library note, brief or guide: shown only
 * while Ostler AI is set up. A Human only note says why it has no button.
 */
export function NoteActionsButton({
  projectId,
  item
}: {
  projectId: string
  item: Pick<LibraryItem, 'id' | 'title' | 'kind' | 'aiAccess' | 'archivedAt'>
}) {
  const { ai } = useFeatures()
  const [open, setOpen] = useState(false)
  if (!ai || item.archivedAt) return null
  if (item.kind !== 'note' && item.kind !== 'brief' && item.kind !== 'guide') return null
  if (item.aiAccess === 'human-only') {
    return <p className="ostler-library-muted">{t('tasks:noteActions.humanOnly')}</p>
  }
  return (
    <div className="note-actions__open">
      <Button variant="ai" size="sm" icon={Sparkles} onClick={() => setOpen(true)}>
        {t('tasks:noteActions.open')}
      </Button>
      <span className="ostler-library-muted">{t('tasks:noteActions.sent')}</span>
      {open && (
        <NoteActionsDialog projectId={projectId} item={item} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
