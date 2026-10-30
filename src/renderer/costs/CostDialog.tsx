import { useState } from 'react'
import {
  MAX_COST_CATEGORY,
  MAX_COST_DESCRIPTION,
  moneyInputText,
  parseMoney,
  type Cost,
  type CostState,
  type CurrencyCode
} from '@shared/money'
import { todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { Button, DateField, Dialog, InlineAlert, Select, SuggestField, TextField } from '../ui'

export interface CostLinkOption {
  value: string
  label: string
}

/** The words for a cost's state. */
export function costStateLabel(state: CostState): string {
  return state === 'paid' ? t('projects:costs.statePaid') : t('projects:costs.statePlanned')
}

export function costStateOptions(): { value: CostState; label: string }[] {
  return [
    { value: 'planned', label: costStateLabel('planned') },
    { value: 'paid', label: costStateLabel('paid') }
  ]
}

/** The category field: free text, with the project's earlier categories offered. */
export function CategoryField({
  value,
  onChange,
  categories,
  hideLabel
}: {
  value: string
  onChange: (value: string) => void
  categories: readonly string[]
  hideLabel?: boolean
}) {
  return (
    <SuggestField
      label={t('projects:costs.category')}
      hideLabel={hideLabel}
      value={value}
      maxLength={MAX_COST_CATEGORY}
      suggestions={categories}
      onChange={onChange}
    />
  )
}

/**
 * Add a cost, or edit one (N6.3a): the drawer's Costs section uses it with
 * the task fixed. Amounts are typed with the person's own separators and
 * saved as minor units of the project's currency.
 */
export function CostDialog({
  projectId,
  currency,
  cost,
  categories,
  workItemId,
  milestoneOptions,
  onClose,
  onSaved
}: {
  projectId: string
  currency: CurrencyCode
  cost?: Cost
  categories: readonly string[]
  /** The task the cost is for, fixed: the drawer's. */
  workItemId?: string
  milestoneOptions: readonly CostLinkOption[]
  onClose: () => void
  onSaved: (saved: { cost: Cost; before?: Cost }) => void
}) {
  const [description, setDescription] = useState(cost?.description ?? '')
  const [amount, setAmount] = useState(cost ? moneyInputText(cost.amount, currency) : '')
  const [date, setDate] = useState(cost?.date ?? todayIsoDate())
  const [category, setCategory] = useState(cost?.category ?? '')
  const [state, setState] = useState<CostState>(cost?.state ?? 'planned')
  const [milestoneId, setMilestoneId] = useState(cost?.milestoneId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const minor = parseMoney(amount, currency)
    if (!description.trim()) {
      setError(t('projects:costs.descriptionRequired'))
      return
    }
    if (minor === null) {
      setError(t('projects:costs.amountInvalid'))
      return
    }
    const input = {
      description,
      amount: minor,
      date,
      category,
      state,
      milestoneId: milestoneId || null,
      ...(workItemId !== undefined ? { workItemId } : {})
    }
    setBusy(true)
    const result = cost
      ? await window.ostlerAPI.updateCost(projectId, cost.id, input)
      : await window.ostlerAPI.createCost(projectId, input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved(
      'after' in result.value
        ? { cost: result.value.after, before: result.value.before }
        : { cost: result.value }
    )
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={cost ? t('projects:costs.editCost') : t('projects:costs.addCost')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('projects:costs.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
            {cost ? t('projects:costs.save') : t('projects:costs.addCost')}
          </Button>
        </>
      }
    >
      <div className="costs-form">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:costs.description')}
          value={description}
          maxLength={MAX_COST_DESCRIPTION}
          autoFocus
          onChange={(event) => setDescription(event.target.value)}
        />
        <TextField
          label={t('projects:costs.amountIn', { currency })}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <DateField label={t('projects:costs.date')} value={date} onChange={setDate} due={false} />
        <CategoryField value={category} onChange={setCategory} categories={categories} />
        <Select
          label={t('projects:costs.state')}
          value={state}
          onChange={(event) => setState(event.target.value as CostState)}
          options={costStateOptions()}
        />
        {milestoneOptions.length > 0 && (
          <Select
            label={t('projects:costs.milestone')}
            value={milestoneId}
            onChange={(event) => setMilestoneId(event.target.value)}
            options={[{ value: '', label: t('projects:costs.noMilestone') }, ...milestoneOptions]}
          />
        )}
      </div>
    </Dialog>
  )
}

/** Mark as paid: the paid date (today by default) and amount (the planned one by default). */
export function MarkPaidDialog({
  projectId,
  currency,
  cost,
  onClose,
  onSaved
}: {
  projectId: string
  currency: CurrencyCode
  cost: Cost
  onClose: () => void
  onSaved: (saved: { cost: Cost; before: Cost }) => void
}) {
  const [amount, setAmount] = useState(moneyInputText(cost.amount, currency))
  const [date, setDate] = useState(todayIsoDate())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const minor = parseMoney(amount, currency)
    if (minor === null) {
      setError(t('projects:costs.amountInvalid'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.markCostPaid(projectId, cost.id, { date, amount: minor })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved({ cost: result.value, before: cost })
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('projects:costs.markPaidTitle', { description: cost.description })}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('projects:costs.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
            {t('projects:costs.markPaid')}
          </Button>
        </>
      }
    >
      <div className="costs-form">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <DateField label={t('projects:costs.paidOn')} value={date} onChange={setDate} due={false} />
        <TextField
          label={t('projects:costs.amountPaid', { currency })}
          inputMode="decimal"
          value={amount}
          autoFocus
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
      </div>
    </Dialog>
  )
}

/** Puts a cost back as it was (Undo of an edit or Mark as paid). */
export function revertCost(projectId: string, before: Cost) {
  return window.ostlerAPI.updateCost(projectId, before.id, {
    date: before.date,
    amount: before.amount,
    description: before.description,
    category: before.category,
    workItemId: before.workItemId,
    milestoneId: before.milestoneId,
    state: before.state
  })
}
