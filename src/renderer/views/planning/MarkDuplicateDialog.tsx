import { useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { Button, Combobox, Dialog, InlineAlert } from '../../ui'
import { t } from '@shared/i18n'

/** What the dialog needs from the workspace; the tests pass a fake. */
export interface MarkDuplicateDialogWorkspace {
  workItems: PlanningWorkItem[]
  markAsDuplicate(item: PlanningWorkItem, originalId: string): Promise<string | null>
  setDuplicateTarget(item: PlanningWorkItem | null): void
}

/**
 * Mark as duplicate (N2.4, N19): pick the original from the project's tasks;
 * Ostler links the two and closes this one as won't do, "Duplicate of …".
 * Won't do's refusals come back from the main process and show here.
 */
export function MarkDuplicateDialog({
  ws,
  target
}: {
  ws: MarkDuplicateDialogWorkspace
  target: PlanningWorkItem
}) {
  const [originalId, setOriginalId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => ws.setDuplicateTarget(null)
  const submit = async () => {
    if (!originalId || busy) return
    setBusy(true)
    setError(null)
    const failure = await ws.markAsDuplicate(target, originalId)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Dialog
      open
      size="sm"
      title={t('tasks:taskLinks.markDuplicateTitle', { title: target.title })}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common:confirm.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !originalId} onClick={() => void submit()}>
            {t('tasks:taskLinks.markDuplicateConfirm')}
          </Button>
        </>
      }
    >
      <p>{t('tasks:taskLinks.markDuplicateExplain')}</p>
      <Combobox
        label={t('tasks:taskLinks.original')}
        placeholder={t('tasks:taskLinks.pickTask')}
        emptyText={t('tasks:taskLinks.noMatchingTasks')}
        options={ws.workItems
          .filter((candidate) => candidate.id !== target.id)
          .map((candidate) => ({ value: candidate.id, label: candidate.title }))}
        value={originalId}
        onChange={(id) => setOriginalId(id)}
      />
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
    </Dialog>
  )
}
