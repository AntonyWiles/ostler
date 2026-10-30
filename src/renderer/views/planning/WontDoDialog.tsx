import { useRef, useState, type FormEvent } from 'react'
import { MAX_RESOLUTION_REASON_LENGTH, type PlanningWorkItem } from '@shared/ostler-api'
import { openSubtasksOf } from '@shared/planning/wont-do'
import { Button, Checkbox, Dialog, InlineAlert, TextField } from '../../ui'
import './WontDoDialog.css'
import { t } from '@shared/i18n'

/** What the dialog needs from the workspace; the tests pass a fake. */
export interface WontDoDialogWorkspace {
  workItems: PlanningWorkItem[]
  harnessTaskFor(item: PlanningWorkItem): { status: string } | null
  wontDoBlocker(item: PlanningWorkItem): string | null
  closeAsWontDo(
    items: PlanningWorkItem[],
    options: { reason: string; includeSubtasks: boolean; cancelQueuedWork: boolean }
  ): Promise<string | null>
  setWontDoTargets(items: PlanningWorkItem[] | null): void
}

/**
 * Won't do (N1.2, N8): asks for an optional one-line reason, offers to close
 * the tasks' open subtasks the same way, and says when queued agent work will
 * be cancelled: closing is the person's agreement to that. Running work and
 * work in review refuse, and the dialog says so before anything is sent.
 */
export function WontDoDialog({
  ws,
  targets
}: {
  ws: WontDoDialogWorkspace
  targets: PlanningWorkItem[]
}) {
  const reasonRef = useRef<HTMLInputElement | null>(null)
  const [reason, setReason] = useState('')
  const [includeSubtasks, setIncludeSubtasks] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetIds = new Set(targets.map((item) => item.id))
  const subtasks = new Map<string, PlanningWorkItem>()
  for (const item of targets)
    for (const child of openSubtasksOf(ws.workItems, item.id))
      if (!targetIds.has(child.id)) subtasks.set(child.id, child)
  const closing = [...targets, ...(includeSubtasks ? [...subtasks.values()] : [])]
  const queued = closing.filter((item) => ws.harnessTaskFor(item)?.status === 'pending')
  const blocked = closing
    .map((item) => ({ item, blocker: ws.wontDoBlocker(item) }))
    .find((entry) => entry.blocker !== null)

  const close = () => ws.setWontDoTargets(null)
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (blocked || busy) return
    setBusy(true)
    setError(null)
    const failure = await ws.closeAsWontDo(targets, {
      reason: reason.trim(),
      includeSubtasks,
      cancelQueuedWork: queued.length > 0
    })
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <Dialog
      open
      size="sm"
      title={
        targets.length === 1
          ? t('tasks:wontDo.dialogTitle', { title: targets[0].title })
          : t('tasks:wontDo.dialogTitleMany', { count: targets.length })
      }
      onClose={close}
      initialFocusRef={reasonRef}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common:confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || blocked !== undefined}
            onClick={() => void submit()}
          >
            {queued.length > 0 ? t('tasks:wontDo.closeAndCancel') : t('tasks:wontDo.close')}
          </Button>
        </>
      }
    >
      <form className="wont-do-dialog" onSubmit={(event) => void submit(event)}>
        <p>{t('tasks:wontDo.explain')}</p>
        <TextField
          ref={reasonRef}
          label={t('tasks:wontDo.reason')}
          hint={t('tasks:wontDo.reasonHint')}
          value={reason}
          maxLength={MAX_RESOLUTION_REASON_LENGTH}
          onChange={(event) => setReason(event.target.value)}
        />
        {subtasks.size > 0 && (
          <Checkbox
            label={t('tasks:wontDo.alsoSubtasks', { count: subtasks.size })}
            checked={includeSubtasks}
            onChange={(event) => setIncludeSubtasks(event.target.checked)}
          />
        )}
        {queued.length > 0 && (
          <InlineAlert tone="warning">
            {t('tasks:wontDo.queuedWarning', { count: queued.length })}
          </InlineAlert>
        )}
        {blocked && (
          <InlineAlert tone="danger">
            {t('tasks:wontDo.blocked', { title: blocked.item.title, reason: blocked.blocker })}
          </InlineAlert>
        )}
        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}
      </form>
    </Dialog>
  )
}
