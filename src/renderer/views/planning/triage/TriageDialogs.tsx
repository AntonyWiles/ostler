import { useEffect, useState, type FormEvent } from 'react'
import { MAX_RESOLUTION_REASON_LENGTH, type PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, Dialog, Select, TextArea, useToast } from '../../../ui'
import { useProjectList } from '../../../context/OstlerContext'
import { markTriagedDuplicate } from './triage-actions'

/** The decisions that ask something first: a reason, the original, or the project. */
export interface TriageDialog {
  kind: 'wontDo' | 'duplicate' | 'move'
  item: PlanningWorkItem
  /** The row's place, where focus goes once it is decided. */
  index: number
}

/**
 * Won't do…, Duplicate of… and Move to project… for a task in To triage
 * (N4.3a): each goes through its own channel, which takes the task out of
 * To triage, and offers undo in its toast.
 */
export function TriageDialogs({
  dialog,
  projectId,
  workItems,
  onClose,
  onDone,
  onUndone
}: {
  dialog: TriageDialog | null
  projectId: string
  workItems: PlanningWorkItem[]
  onClose: () => void
  onDone: (index: number) => void
  /**
   * After an Undo has brought the task back: To triage reads its list again.
   * Undoing Won't do or Move to project leaves the planned tasks as they
   * were, so nothing else would tell it to.
   */
  onUndone?: () => void
}) {
  const { toast, toastUndo: showUndo } = useToast()
  const toastUndo = (title: string, undo: () => void | Promise<unknown>) =>
    showUndo(title, async () => {
      await undo()
      onUndone?.()
    })
  const projects = useProjectList()
  const [reason, setReason] = useState('')
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReason('')
    setChoice('')
  }, [dialog])

  if (!dialog) return null
  const { item, kind, index } = dialog
  const failed = (message: string) =>
    toast({ title: t('tasks:triage.couldntDecide'), body: message, tone: 'danger' })
  const backToTriage = () => window.ostlerAPI.updatePlanningWorkItem(item.id, { inTriage: true })

  const originals = workItems.filter((candidate) => candidate.id !== item.id)
  const otherProjects = projects.filter((project) => project.id !== projectId && project.enabled)
  // Where the moved task lands follows the chosen project's triage setting.
  const target = otherProjects.find((project) => project.id === choice)
  const moveHint = !target
    ? t('tasks:triage.moveHint')
    : target.triageCaptures === true
      ? t('tasks:triage.moveHintTriage')
      : t('tasks:triage.moveHintBacklog')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (kind === 'wontDo') {
        const result = await window.ostlerAPI.closePlanningWorkItemAsWontDo(item.id, {
          reason: reason.trim()
        })
        if (!result.ok) return failed(result.error)
        toastUndo(t('tasks:triage.closed', { title: item.title }), async () => {
          await window.ostlerAPI.unarchivePlanningWorkItem(item.id)
          await backToTriage()
        })
      } else if (kind === 'duplicate') {
        if (!choice) return
        const error = await markTriagedDuplicate(item, choice, toastUndo)
        if (error) return failed(error)
      } else {
        if (!choice) return
        const result = await window.ostlerAPI.moveTriagedWorkItem(projectId, item.id, choice)
        if (!result.ok) return failed(result.error)
        const move = result.value
        const to = projects.find((project) => project.id === choice)
        toastUndo(
          t(move.workItem.inTriage ? 'tasks:triage.moved' : 'tasks:triage.movedToBacklog', {
            title: item.title,
            project: to?.name ?? ''
          }),
          () => window.ostlerAPI.undoTriageMove(projectId, move)
        )
      }
      onClose()
      onDone(index)
    } finally {
      setBusy(false)
    }
  }

  const title =
    kind === 'wontDo'
      ? t('tasks:triage.wontDoTitle', { title: item.title })
      : kind === 'duplicate'
        ? t('tasks:triage.duplicateTitle', { title: item.title })
        : t('tasks:triage.moveTitle', { title: item.title })
  const formId = 'triage-decision-form'
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('tasks:triage.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={busy}
            disabled={busy || (kind !== 'wontDo' && !choice)}
          >
            {kind === 'wontDo'
              ? t('tasks:triage.wontDoConfirm')
              : kind === 'duplicate'
                ? t('tasks:triage.duplicateConfirm')
                : t('tasks:triage.moveConfirm')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)}>
        {kind === 'wontDo' && (
          <TextArea
            data-autofocus
            label={t('tasks:triage.reason')}
            hint={t('tasks:triage.reasonHint')}
            value={reason}
            maxLength={MAX_RESOLUTION_REASON_LENGTH}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
        {kind === 'duplicate' && (
          <Select
            data-autofocus
            label={t('tasks:triage.original')}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            options={[
              { value: '', label: t('tasks:triage.chooseOriginal') },
              ...originals.map((candidate) => ({ value: candidate.id, label: candidate.title }))
            ]}
          />
        )}
        {kind === 'move' &&
          (otherProjects.length === 0 ? (
            <p>{t('tasks:triage.noOtherProject')}</p>
          ) : (
            <Select
              data-autofocus
              label={t('tasks:triage.toProject')}
              hint={moveHint}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              options={[
                { value: '', label: t('tasks:triage.chooseProject') },
                ...otherProjects.map((project) => ({ value: project.id, label: project.name }))
              ]}
            />
          ))}
      </form>
    </Dialog>
  )
}
