import { useEffect, useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { InlineAlert, TextField } from '../../ui'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'

/**
 * A blocked task's reason, in the drawer: a few words saved when the field
 * loses focus, and a note when every task it waits on is done, so nothing
 * it waits on holds it back any more. Shown only while the task is blocked.
 */
export function TaskBlockedReason({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  const saved = item.blockedReason ?? ''
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved, item.id])
  if (item.status !== 'blocked') return null

  const waitingOn = item.dependencyIds
    .map((id) => ws.workItems.find((candidate) => candidate.id === id))
    .filter((found): found is PlanningWorkItem => Boolean(found))
  const clear = waitingOn.length > 0 && waitingOn.every((found) => found.status === 'done')

  const save = async () => {
    const next = text.trim()
    if (next === saved) return
    const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { blockedReason: next })
    if (result.ok) void ws.loadPlanning()
    else ws.setError(result.error)
  }

  return (
    <div className="task-drawer__panel">
      <TextField
        label={t('tasks:blockedReason.label')}
        placeholder={t('tasks:blockedReason.placeholder')}
        value={text}
        maxLength={200}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void save()}
      />
      {clear && <InlineAlert tone="info">{t('tasks:blockedReason.nothingLeft')}</InlineAlert>}
    </div>
  )
}
