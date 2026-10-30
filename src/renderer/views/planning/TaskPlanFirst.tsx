import { useEffect, useState } from 'react'
import type { PlanningWorkItem, TaskPlanRecord } from '@shared/ostler-api'
import type { PlanFirstChoice } from '@shared/plan-first'
import { Select } from '../../ui'
import { formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import { PlanContent, planStatusLabel } from './PlanDialog'

/**
 * Plan first in the task drawer's agent section (N9.3b): the task's own
 * choice (Project default, Yes, No), then the latest approved plan and every
 * version kept with the task.
 */
export function TaskPlanFirst({
  projectId,
  item,
  onChanged,
  onError
}: {
  projectId: string
  item: PlanningWorkItem
  /** After the choice is saved: the drawer reads the task again. */
  onChanged: () => void
  onError: (error: string) => void
}) {
  const [projectDefault, setProjectDefault] = useState<boolean | null>(null)
  const [plans, setPlans] = useState<TaskPlanRecord[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getProjectAutoDispatchConfig(projectId).then((result) => {
      if (live && result.ok) setProjectDefault(result.value.agentsPlanFirst === true)
    })
    return () => {
      live = false
    }
  }, [projectId])

  // Read again when the task's run changes, so a decision shows here.
  const runKey = `${item.linkedHarnessTaskId ?? ''}:${item.updatedAt}`
  useEffect(() => {
    let live = true
    void window.ostlerAPI.listWorkItemPlans(item.id).then((result) => {
      if (live && result.ok) setPlans(result.value)
    })
    return () => {
      live = false
    }
  }, [item.id, runKey])

  const choice = item.planFirst ?? 'default'
  const queued = item.linkedHarnessTaskId !== null
  const save = async (next: PlanFirstChoice) => {
    setSaving(true)
    const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { planFirst: next })
    setSaving(false)
    if (result.ok) onChanged()
    else onError(result.error)
  }

  const approved = [...plans].reverse().find((plan) => plan.status === 'approved') ?? null

  return (
    <>
      <Select
        label={t('agents:planFirst.planFirst')}
        hint={queued ? t('agents:planFirst.planFirstLocked') : t('agents:planFirst.planFirstHint')}
        value={choice}
        disabled={queued || saving}
        options={[
          {
            value: 'default',
            label:
              projectDefault === true
                ? t('agents:planFirst.projectDefaultOn')
                : t('agents:planFirst.projectDefaultOff')
          },
          { value: 'yes', label: t('agents:planFirst.yes') },
          { value: 'no', label: t('agents:planFirst.no') }
        ]}
        onChange={(event) => void save(event.target.value as PlanFirstChoice)}
      />

      {approved && (
        <div className="task-drawer__panel" aria-label={t('agents:planFirst.approvedPlan')}>
          <strong>{t('agents:planFirst.approvedPlan')}</strong>
          <p className="task-drawer__muted">
            {t('agents:planFirst.approvedPlanMeta', {
              version: approved.version,
              when: formatRelativeTime(Date.parse(approved.decidedAt ?? approved.submittedAt))
            })}
          </p>
          <PlanContent plan={approved} />
        </div>
      )}

      {plans.length > 0 && (
        <details className="task-drawer__panel">
          <summary>{t('agents:planFirst.planHistory')}</summary>
          <ol className="dialog-list">
            {plans.map((plan) => (
              <li key={plan.id}>
                {t('agents:planFirst.historyRow', {
                  version: plan.version,
                  status: planStatusLabel(plan.status)
                })}
                {plan.changesNote && <p className="dialog-report">{plan.changesNote}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  )
}
