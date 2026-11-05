import { useEffect, useState } from 'react'
import type { PlanningAgentPrompt, PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button } from '../../ui'
import { Copy } from '../../ui/icons'
import { t } from '@shared/i18n'

/**
 * The task's agent prompt, always: the whole text an agent gets for this task, read from the
 * main process's one builder (the same one Copy agent prompt copies from), in a collapsed,
 * scrollable block. Tokens are masked; nothing is queued or started by reading it.
 */
export function TaskAgentPrompt({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  const [prompt, setPrompt] = useState<PlanningAgentPrompt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const task = ws.selectedHarnessTask
  const session = ws.selectedHarnessSession
  // Rebuilt when anything it is made from changes: the task's text, its queue entry or its run.
  const taskState = `${task?.id ?? ''}:${task?.status ?? ''}:${task?.claimedBy ?? ''}:${session?.id ?? ''}`

  useEffect(() => {
    let current = true
    void window.ostlerAPI.getPlanningAgentPrompt(item.projectId, item.id).then((result) => {
      if (!current) return
      if (result.ok) {
        setPrompt(result.value)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      current = false
    }
  }, [
    item.projectId,
    item.id,
    item.updatedAt,
    item.linkedHarnessTaskId,
    taskState,
    ws.handoffCopiedId
  ])

  const hint =
    prompt?.kind === 'handoff'
      ? t('agents:taskAgentRunSection.copiesTaskConnectionDetails')
      : prompt?.kind === 'session'
        ? t('agents:agentPrompt.sessionHint')
        : t('agents:agentPrompt.automationHint')

  return (
    <div className="task-drawer__panel task-agent-prompt">
      <div className="task-drawer__panel--row">
        <div>
          <strong>{t('agents:agentPrompt.title')}</strong>
          <p className="task-drawer__muted">{hint}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={Copy}
          onClick={() => void ws.copyAgentHandoff(item)}
        >
          {ws.handoffCopiedId === item.id
            ? t('agents:taskAgentRunSection.copied')
            : t('agents:taskAgentRunSection.copyPrompt')}
        </Button>
      </div>
      {error ? (
        <p className="task-drawer__muted">{error}</p>
      ) : prompt ? (
        <details className="task-agent-prompt__details">
          <summary>{t('agents:agentPrompt.showFull')}</summary>
          <pre
            className="task-agent-prompt__text"
            tabIndex={0}
            aria-label={t('agents:agentPrompt.title')}
          >
            {prompt.text}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
