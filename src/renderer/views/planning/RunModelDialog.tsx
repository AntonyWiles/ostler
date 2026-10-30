import { useState } from 'react'
import type { AgentRunChoice } from '@shared/agent-model'
import { t } from '@shared/i18n'
import { Button, Dialog } from '../../ui'
import { useAgentModelSettings } from '../../hooks/planning/useAgentModelSettings'
import { RunModelPicker } from './RunModelPicker'

/**
 * Asks which model and effort the built-in agent should use for one run of a
 * task (D42): when queueing it, or while it waits in the queue.
 */
export function RunModelDialog({
  projectId,
  taskTitle,
  initial,
  mode,
  busy,
  onSubmit,
  onClose
}: {
  projectId: string
  taskTitle: string
  initial: AgentRunChoice
  /** `queue` queues the task with this choice; `change` changes a queued task's. */
  mode: 'queue' | 'change'
  busy: boolean
  onSubmit: (choice: AgentRunChoice) => void
  onClose: () => void
}) {
  const settings = useAgentModelSettings(projectId)
  const [choice, setChoice] = useState<AgentRunChoice>(initial)
  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      size="sm"
      title={
        mode === 'queue'
          ? t('agents:runModel.queueTitle', { taskTitle })
          : t('agents:runModel.changeTitle', { taskTitle })
      }
      description={t('agents:runModel.dialogDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('agents:runModel.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !settings} onClick={() => onSubmit(choice)}>
            {mode === 'queue' ? t('agents:runModel.queue') : t('agents:runModel.save')}
          </Button>
        </>
      }
    >
      {settings ? (
        <RunModelPicker settings={settings} value={choice} onChange={setChoice} />
      ) : (
        <p className="task-drawer__muted">{t('agents:runModel.loading')}</p>
      )}
    </Dialog>
  )
}
