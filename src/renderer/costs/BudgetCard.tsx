import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatMoney, type MoneySummary } from '@shared/money'
import { t } from '@shared/i18n'
import { projectPath } from '../navigation/paths'
import { Button, Section } from '../ui'
import { Wallet } from '../ui/icons'
import { BudgetDialog } from './BudgetDialog'
import { useMoneySummary } from './useMoney'
import './costs.css'

/** How much of the bar paid and planned fill: of the budget, or of the total when over or without one. */
export function budgetBarShares(summary: MoneySummary): { paid: number; planned: number } {
  const scale = Math.max(summary.budget ?? 0, summary.total, 1)
  return { paid: summary.paid / scale, planned: summary.planned / scale }
}

/** "Left: £380" or "Over by £120"; null without a budget. */
export function budgetLeftText(summary: MoneySummary): string | null {
  if (summary.left === null) return null
  return summary.over > 0
    ? t('projects:costs.overBy', { amount: formatMoney(summary.over, summary.currency) })
    : formatMoney(summary.left, summary.currency)
}

const CATEGORIES_SHOWN = 5

/**
 * The Overview's Budget card (N6.3a), when the project has a budget or
 * costs: budget, paid, planned and left (or "Over by", with the warning
 * token and the words), a bar of paid and planned against the budget, and
 * the largest categories, and what the shopping list still has to buy
 * (N6.3b), apart from planned costs. One call (`getMoneySummary`), so the Overview
 * stays fast.
 */
export function BudgetCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { summary, reload } = useMoneySummary(projectId)
  const [setting, setSetting] = useState(false)
  if (
    !summary ||
    (summary.budget === null && summary.count === 0 && (summary.stillToBuy ?? 0) === 0)
  )
    return null
  const money = (minor: number) => formatMoney(minor, summary.currency)
  const shares = budgetBarShares(summary)
  const left = budgetLeftText(summary)
  const over = summary.over > 0

  return (
    <Section
      title={t('projects:costs.budget')}
      className="budget-card"
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => setSetting(true)}>
            {summary.budget === null
              ? t('projects:costs.setBudget')
              : t('projects:costs.changeBudget')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Wallet}
            onClick={() => navigate(projectPath(projectId, 'costs'))}
          >
            {t('projects:costs.openCosts')}
          </Button>
        </>
      }
    >
      <dl className="budget-card__numbers">
        <div>
          <dt>{t('projects:costs.budget')}</dt>
          <dd>{summary.budget === null ? t('projects:costs.noBudget') : money(summary.budget)}</dd>
        </div>
        <div>
          <dt>{t('projects:costs.paid')}</dt>
          <dd>{money(summary.paid)}</dd>
        </div>
        <div>
          <dt>{t('projects:costs.planned')}</dt>
          <dd>{money(summary.planned)}</dd>
        </div>
        {left !== null && (
          <div data-tone={over ? 'warning' : undefined}>
            <dt>{over ? t('projects:costs.over') : t('projects:costs.left')}</dt>
            <dd>{left}</dd>
          </div>
        )}
      </dl>
      {(summary.stillToBuy ?? 0) > 0 && (
        // Kept apart from planned costs (N6.3b): an item becomes a cost only when it is bought.
        <p className="budget-card__still-to-buy">
          {t('projects:shopping.stillToBuy', { amount: money(summary.stillToBuy) })}
        </p>
      )}
      <div
        className="budget-card__bar"
        role="img"
        aria-label={t('projects:costs.barLabel', {
          paid: money(summary.paid),
          planned: money(summary.planned),
          budget: summary.budget === null ? t('projects:costs.noBudget') : money(summary.budget)
        })}
        data-over={over || undefined}
      >
        <span className="budget-card__bar-paid" style={{ width: `${shares.paid * 100}%` }} />
        <span className="budget-card__bar-planned" style={{ width: `${shares.planned * 100}%` }} />
      </div>
      {summary.byCategory.length > 0 && (
        <ul className="budget-card__categories" aria-label={t('projects:costs.byCategory')}>
          {summary.byCategory.slice(0, CATEGORIES_SHOWN).map((entry) => (
            <li key={entry.category}>
              <span>{entry.category || t('projects:costs.noCategory')}</span>
              <span className="costs-amount">{money(entry.total)}</span>
            </li>
          ))}
        </ul>
      )}
      {setting && (
        <BudgetDialog
          projectId={projectId}
          onClose={() => setSetting(false)}
          onSaved={() => void reload()}
        />
      )}
    </Section>
  )
}
