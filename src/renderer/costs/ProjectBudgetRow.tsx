import { useState } from 'react'
import { formatMoney } from '@shared/money'
import { t } from '@shared/i18n'
import { Button } from '../ui'
import { Wallet } from '../ui/icons'
import { BudgetDialog } from './BudgetDialog'
import { useMoneySummary } from './useMoney'
import './costs.css'

/** Project settings' Budget row (N6.3a): what is set, and Set a budget. */
export function ProjectBudgetRow({ projectId }: { projectId: string }) {
  const { summary, reload } = useMoneySummary(projectId)
  const [open, setOpen] = useState(false)
  return (
    <div className="project-budget-row">
      <p className="costs-view__intro">
        {summary === null
          ? null
          : summary.budget === null
            ? t('projects:costs.noBudgetSet', { currency: summary.currency })
            : t('projects:costs.budgetIs', {
                amount: formatMoney(summary.budget, summary.currency)
              })}
      </p>
      <Button icon={Wallet} onClick={() => setOpen(true)}>
        {summary?.budget === null
          ? t('projects:costs.setBudget')
          : t('projects:costs.changeBudget')}
      </Button>
      {open && (
        <BudgetDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  )
}
