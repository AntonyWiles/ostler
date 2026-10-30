import { useEffect, useState } from 'react'
import { PlanningWorkItem, TaskReview } from '@shared/ostler-api'
import { taskPriorityLabel } from '@shared/task-labels'
import { AiByline } from '../../components/AiByline'
import { Button, Checkbox, Dialog, InlineAlert, PriorityIcon, Skeleton, TextArea } from '../../ui'
import './planning-dialogs.css'
import { t } from '@shared/i18n'

interface TaskReviewPanelProps {
  task: PlanningWorkItem
  planningWorkItems: PlanningWorkItem[]
  onClose: () => void
  onWorkItemCreated: (workItem: PlanningWorkItem) => void
  onOpenWorkItem: (workItemId: string) => void
}

/**
 * Async, per-task AI review panel: renders the latest review's diagnosis,
 * optional proposal, and downstream effects, and lets a human comment,
 * dismiss, or accept. Accepting always goes through an explicit
 * preview/confirm step before the new work item is actually created.
 */
export function TaskReviewPanel({
  task,
  planningWorkItems,
  onClose,
  onWorkItemCreated,
  onOpenWorkItem
}: TaskReviewPanelProps) {
  const [history, setHistory] = useState<TaskReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [confirmingAccept, setConfirmingAccept] = useState(false)
  const [createdWorkItemId, setCreatedWorkItemId] = useState<string | null>(null)
  const [includeNotesInResolution, setIncludeNotesInResolution] = useState(true)
  const [resolving, setResolving] = useState(false)

  const latest = history.length ? history[history.length - 1] : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.ostlerAPI.getTaskReviews(task.id).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setHistory(result.value)
        const current = result.value[result.value.length - 1]
        setComment(current?.humanComment ?? '')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [task.id])

  const runReview = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.refreshTaskReview(task.projectId, task.id)
      if (!result.ok) setError(result.error)
      else {
        setHistory((current) => [...current, result.value])
        setComment('')
        setCreatedWorkItemId(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const saveComment = async () => {
    if (!latest) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.annotateTaskReview(latest.id, task.id, comment)
      if (!result.ok) setError(result.error)
      else
        setHistory((current) =>
          current.map((item) => (item.id === latest.id ? result.value : item))
        )
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    if (!latest) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.dismissTaskReview(latest.id, task.id)
      if (!result.ok) setError(result.error)
      else
        setHistory((current) =>
          current.map((item) => (item.id === latest.id ? result.value : item))
        )
    } finally {
      setBusy(false)
    }
  }

  const confirmAccept = async () => {
    if (!latest) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.acceptTaskReview(latest.id, task.id)
      if (!result.ok) setError(result.error)
      else {
        setHistory((current) =>
          current.map((item) => (item.id === latest.id ? result.value.review : item))
        )
        setCreatedWorkItemId(result.value.createdWorkItem.id)
        onWorkItemCreated(result.value.createdWorkItem)
      }
    } finally {
      setBusy(false)
      setConfirmingAccept(false)
    }
  }

  const generateResolutionTask = async () => {
    if (!latest) return
    setBusy(true)
    setResolving(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.resolveTaskReview(
        latest.id,
        task.id,
        includeNotesInResolution
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      onWorkItemCreated(result.value.createdWorkItem)
      onClose()
    } finally {
      setBusy(false)
      setResolving(false)
    }
  }

  const undoCreate = async () => {
    if (!createdWorkItemId) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.deletePlanningWorkItem(createdWorkItemId)
      if (!result.ok) setError(result.error)
      else setCreatedWorkItemId(null)
    } finally {
      setBusy(false)
    }
  }

  const proposal = latest?.proposal ?? null
  const proposalBlock = proposal && (
    <div className="suggestion">
      <div className="suggestion__head">
        <strong>{proposal.title}</strong>
        <span className="task-review__priority">
          <PriorityIcon priority={proposal.priority} />
          {taskPriorityLabel(proposal.priority)}
        </span>
      </div>
      <p className="dialog-report">{proposal.description}</p>
      {proposal.acceptanceCriteria.length > 0 && (
        <ul className="dialog-list">
          {proposal.acceptanceCriteria.map((criterion, index) => (
            <li key={index}>{criterion}</li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <>
      <Dialog
        open
        size="lg"
        onClose={onClose}
        canDismiss={!busy}
        title={task.title}
        description={t('tasks:taskReviewPanel.sReviewHowTask')}
        footer={
          <>
            <Button
              variant="ai"
              loading={busy && !latest}
              disabled={busy}
              onClick={() => void runReview()}
            >
              {latest
                ? t('tasks:taskReviewPanel.reviewAgain')
                : t('tasks:taskReviewPanel.reviewAi')}
            </Button>
            <Button variant="primary" onClick={onClose} disabled={busy}>
              {t('tasks:taskReviewPanel.close')}
            </Button>
          </>
        }
      >
        <div className="dialog-form">
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}

          {loading ? (
            <Skeleton lines={3} />
          ) : !latest ? (
            <p className="dialog-muted">{t('tasks:taskReviewPanel.noReviewYetCan')}</p>
          ) : (
            <>
              <AiByline verb="reviewed" at={latest.generatedAt} />
              <p className="dialog-muted">
                {t('tasks:taskReviewPanel.status', { status: REVIEW_STATUS[latest.status] })}
              </p>
              {latest.error ? (
                <InlineAlert tone="danger">{latest.error}</InlineAlert>
              ) : (
                <>
                  <p className="dialog-report">{latest.diagnosis}</p>

                  {proposal && (
                    <section className="dialog-section">
                      <h3 className="dialog-section__title">
                        {t('tasks:taskReviewPanel.proposedTask')}
                      </h3>
                      {proposalBlock}
                      {latest.status === 'open' && !createdWorkItemId && (
                        <div>
                          <Button disabled={busy} onClick={() => setConfirmingAccept(true)}>
                            {t('tasks:taskReviewPanel.acceptProposal')}
                          </Button>
                        </div>
                      )}
                      {latest.status === 'accepted' &&
                        latest.createdWorkItemId &&
                        !createdWorkItemId && (
                          <InlineAlert
                            tone="success"
                            action={{
                              label: t('tasks:taskReviewPanel.open'),
                              onClick: () => onOpenWorkItem(latest.createdWorkItemId!)
                            }}
                          >
                            {t('tasks:taskReviewPanel.acceptedNewTaskWas')}
                          </InlineAlert>
                        )}
                      {createdWorkItemId && (
                        <InlineAlert
                          tone="success"
                          action={{
                            label: t('tasks:taskReviewPanel.open'),
                            onClick: () => onOpenWorkItem(createdWorkItemId)
                          }}
                        >
                          {t('tasks:taskReviewPanel.createdNewTaskProposal')}{' '}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void undoCreate()}
                          >
                            {t('tasks:taskReviewPanel.undoMoveRecycleBin')}
                          </Button>
                        </InlineAlert>
                      )}
                    </section>
                  )}

                  {latest.downstreamEffects.length > 0 && (
                    <section className="dialog-section">
                      <h3 className="dialog-section__title">
                        {t('tasks:taskReviewPanel.downstreamEffects')}
                      </h3>
                      <ul className="dialog-list">
                        {latest.downstreamEffects.map((effect) => {
                          const known = planningWorkItems.some(
                            (item) => item.id === effect.workItemId
                          )
                          return (
                            <li key={effect.workItemId}>
                              {known ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onOpenWorkItem(effect.workItemId)}
                                >
                                  {effect.workItemTitle}
                                </Button>
                              ) : (
                                <strong>{effect.workItemTitle}</strong>
                              )}
                              : {effect.impact}
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  )}

                  <TextArea
                    label={t('tasks:taskReviewPanel.comment')}
                    hint={t('tasks:taskReviewPanel.notesLaterSavingOne')}
                    rows={2}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <div className="dialog-actions">
                    <Button size="sm" disabled={busy} onClick={() => void saveComment()}>
                      {t('tasks:taskReviewPanel.saveComment')}
                    </Button>
                    {latest.status === 'open' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void dismiss()}
                      >
                        {t('tasks:taskReviewPanel.dismissReview')}
                      </Button>
                    )}
                  </div>

                  {latest.status === 'open' && !createdWorkItemId && (
                    <section className="dialog-section">
                      <h3 className="dialog-section__title">
                        {t('tasks:taskReviewPanel.fixNewTask')}
                      </h3>
                      <Checkbox
                        label={t('tasks:taskReviewPanel.includeMyNotesNew')}
                        checked={includeNotesInResolution}
                        onChange={(event) => setIncludeNotesInResolution(event.target.checked)}
                      />
                      <div>
                        <Button
                          variant="ai"
                          loading={resolving}
                          disabled={busy}
                          onClick={() => void generateResolutionTask()}
                        >
                          {t('tasks:taskReviewPanel.writeQueueTaskResolve')}
                        </Button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={confirmingAccept && Boolean(proposal)}
        onClose={() => setConfirmingAccept(false)}
        canDismiss={!busy}
        title={t('tasks:taskReviewPanel.createTask')}
        description={t('tasks:taskReviewPanel.createdExactlyShownNothing')}
        footer={
          <>
            <Button disabled={busy} onClick={() => setConfirmingAccept(false)}>
              {t('tasks:taskReviewPanel.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void confirmAccept()}>
              {t('tasks:taskReviewPanel.createTask2')}
            </Button>
          </>
        }
      >
        {proposalBlock}
      </Dialog>
    </>
  )
}

const REVIEW_STATUS: Record<TaskReview['status'], string> = {
  get open() {
    return t('tasks:taskReviewPanel.reviewStatus.open')
  },
  get accepted() {
    return t('tasks:taskReviewPanel.reviewStatus.accepted')
  },
  get dismissed() {
    return t('tasks:taskReviewPanel.reviewStatus.dismissed')
  }
}
