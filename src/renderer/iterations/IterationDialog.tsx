import { useState } from 'react'
import type { PlanningIteration } from '@shared/ostler-api'
import { MAX_ITERATION_GOAL_LENGTH, MAX_ITERATION_NAME_LENGTH } from '@shared/planning/iterations'
import { Button, DateField, Dialog, InlineAlert, TextField } from '../ui'
import { nextIterationDraft } from './iteration-words'
import '../views/planning/planning-dialogs.css'
import { t } from '@shared/i18n'

export interface IterationDraft {
  name: string
  startDate: string
  endDate: string
  goal: string
}

/**
 * New iteration, or Edit iteration: name, start and end (local days, the end
 * included) and an optional goal. Main refuses overlaps; the refusal shows in
 * the workspace's error line and the dialog stays open.
 */
export function IterationDialog({
  iteration,
  iterations,
  busy,
  error,
  onClose,
  onSave
}: {
  /** The iteration being edited, or null for a new one. */
  iteration: PlanningIteration | null
  iterations: readonly PlanningIteration[]
  busy: boolean
  /** The workspace's error line: a refusal from main shows here, in the dialog. */
  error?: string | null
  onClose: () => void
  onSave: (draft: IterationDraft) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<IterationDraft>(() =>
    iteration
      ? {
          name: iteration.name,
          startDate: iteration.startDate,
          endDate: iteration.endDate,
          goal: iteration.goal
        }
      : { ...nextIterationDraft(iterations), goal: '' }
  )
  const formId = `iteration-${iteration?.id ?? 'new'}`
  const datesWrong =
    draft.startDate !== '' && draft.endDate !== '' && draft.endDate < draft.startDate
  const incomplete = !draft.name.trim() || !draft.startDate || !draft.endDate || datesWrong

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={iteration ? t('tasks:iterations.editTitle') : t('tasks:iterations.newTitle')}
      description={t('tasks:iterations.dialogDescription')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:iterations.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={busy}
            disabled={incomplete}
          >
            {iteration ? t('tasks:iterations.save') : t('tasks:iterations.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (incomplete) return
          void onSave(draft).then((saved) => {
            if (saved) onClose()
          })
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('tasks:iterations.name')}
          data-autofocus
          required
          maxLength={MAX_ITERATION_NAME_LENGTH}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <DateField
          label={t('tasks:iterations.start')}
          due={false}
          value={draft.startDate}
          onChange={(startDate) => setDraft({ ...draft, startDate })}
        />
        <DateField
          label={t('tasks:iterations.end')}
          hint={t('tasks:iterations.endHint')}
          error={datesWrong ? t('tasks:iterations.endBeforeStart') : undefined}
          due={false}
          min={draft.startDate || undefined}
          value={draft.endDate}
          onChange={(endDate) => setDraft({ ...draft, endDate })}
        />
        <TextField
          label={t('tasks:iterations.goal')}
          hint={t('tasks:iterations.goalHint')}
          maxLength={MAX_ITERATION_GOAL_LENGTH}
          value={draft.goal}
          onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
        />
      </form>
    </Dialog>
  )
}
