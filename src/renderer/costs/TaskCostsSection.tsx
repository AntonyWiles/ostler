import { useState } from 'react'
import type { PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { formatMoney, summarizeCosts, type Cost } from '@shared/money'
import { t } from '@shared/i18n'
import { Button, IconButton, useToast } from '../ui'
import { CircleCheck, Pencil, Plus, Trash2 } from '../ui/icons'
import { TaskDrawerSection } from '../views/planning/TaskDrawerSection'
import { CostDialog, MarkPaidDialog, costStateLabel, revertCost } from './CostDialog'
import { useCosts, useMoneySummary } from './useMoney'
import './costs.css'

/**
 * The drawer's Costs section (N6.3a): the task's costs, with their total,
 * Add a cost, edit, Mark as paid and delete with Undo. Costs are their own
 * records, so they save at once, like time entries.
 */
export function TaskCostsSection({
  item,
  milestones
}: {
  item: PlanningWorkItem
  milestones: readonly PlanningMilestone[]
}) {
  const { toast, toastUndo } = useToast()
  const { costs, categories, reload } = useCosts(item.projectId, { workItemId: item.id })
  const { summary } = useMoneySummary(item.projectId)
  const [editing, setEditing] = useState<Cost | 'new' | null>(null)
  const [paying, setPaying] = useState<Cost | null>(null)
  const currency = summary?.currency
  const closed = Boolean(item.archivedAt) || Boolean(item.deletedAt)

  const remove = async (cost: Cost) => {
    const result = await window.ostlerAPI.deleteCost(item.projectId, cost.id)
    if (!result.ok) {
      toast({ title: t('projects:costs.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    void reload()
    toastUndo(t('projects:costs.deleted'), () =>
      window.ostlerAPI.restoreCost(item.projectId, result.value).then(() => reload())
    )
  }

  if (!currency) return null
  const total = summarizeCosts(costs ?? [], null, currency)

  return (
    <TaskDrawerSection
      title={t('projects:costs.costs')}
      className="task-costs"
      part={{
        id: 'costs',
        inUse: (costs ?? []).length > 0,
        start: closed ? undefined : () => setEditing('new')
      }}
      actions={
        !closed && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing('new')}>
            {t('projects:costs.addACost')}
          </Button>
        )
      }
    >
      {(costs ?? []).length === 0 ? (
        <p className="task-costs__summary">{t('projects:costs.noCostsTask')}</p>
      ) : (
        <>
          <p className="task-costs__summary">
            {t('projects:costs.taskTotal', {
              paid: formatMoney(total.paid, currency),
              planned: formatMoney(total.planned, currency)
            })}
          </p>
          <ul className="task-costs__list" aria-label={t('projects:costs.taskCosts')}>
            {(costs ?? []).map((cost) => {
              const amount = formatMoney(cost.amount, currency)
              return (
                <li key={cost.id} className="task-costs__entry">
                  <span className="task-costs__date">
                    {formatIsoDate(cost.date, { day: 'numeric', month: 'short' })}
                  </span>
                  <span className="task-costs__description">
                    {cost.description}
                    <span className="task-costs__meta">
                      {[costStateLabel(cost.state), cost.category].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="costs-amount">{amount}</span>
                  <span className="task-costs__actions">
                    {cost.state === 'planned' && (
                      <IconButton
                        size="sm"
                        icon={CircleCheck}
                        label={t('projects:costs.markPaidNamed', { description: cost.description })}
                        onClick={() => setPaying(cost)}
                      />
                    )}
                    <IconButton
                      size="sm"
                      icon={Pencil}
                      label={t('projects:costs.editNamed', { description: cost.description })}
                      onClick={() => setEditing(cost)}
                    />
                    <IconButton
                      size="sm"
                      icon={Trash2}
                      label={t('projects:costs.deleteNamed', { description: cost.description })}
                      onClick={() => void remove(cost)}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {editing && (
        <CostDialog
          projectId={item.projectId}
          currency={currency}
          cost={editing === 'new' ? undefined : editing}
          categories={categories}
          workItemId={item.id}
          milestoneOptions={milestones.map((milestone) => ({
            value: milestone.id,
            label: milestone.name
          }))}
          onClose={() => setEditing(null)}
          onSaved={({ before }) => {
            setEditing(null)
            void reload()
            if (before)
              toastUndo(t('projects:costs.edited'), () =>
                revertCost(item.projectId, before).then(() => reload())
              )
          }}
        />
      )}
      {paying && (
        <MarkPaidDialog
          projectId={item.projectId}
          currency={currency}
          cost={paying}
          onClose={() => setPaying(null)}
          onSaved={({ before }) => {
            setPaying(null)
            void reload()
            toastUndo(t('projects:costs.markedPaid'), () =>
              revertCost(item.projectId, before).then(() => reload())
            )
          }}
        />
      )}
    </TaskDrawerSection>
  )
}
