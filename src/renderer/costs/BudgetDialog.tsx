import { useEffect, useState } from 'react'
import { CURRENCIES, moneyInputText, parseMoney, type ProjectBudget } from '@shared/money'
import { t } from '@shared/i18n'
import { Button, Dialog, InlineAlert, Select, TextField, useToast } from '../ui'

/** The currency picker's choices: the common codes, and the project's own if it is another. */
export function currencyOptions(current: string): { value: string; label: string }[] {
  const codes: string[] = CURRENCIES.includes(current as (typeof CURRENCIES)[number])
    ? [...CURRENCIES]
    : [current, ...CURRENCIES]
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames(undefined, { type: 'currency' })
  } catch {
    names = null
  }
  return codes.map((code) => ({
    value: code,
    label: names ? `${code} · ${names.of(code) ?? code}` : code
  }))
}

/**
 * Set a budget (N6.3a), from the Overview's Budget card, the Costs view and
 * Project settings: an amount typed with the person's own separators (empty
 * for no budget) and the project's currency. Every amount is in it; changing
 * it converts nothing.
 */
export function BudgetDialog({
  projectId,
  onClose,
  onSaved
}: {
  projectId: string
  onClose: () => void
  onSaved?: (budget: ProjectBudget) => void
}) {
  const { toast } = useToast()
  const [budget, setBudget] = useState<ProjectBudget | null>(null)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void window.ostlerAPI.getBudget(projectId).then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBudget(result.value)
      setCurrency(result.value.currency)
      setAmount(
        result.value.amount === null
          ? ''
          : moneyInputText(result.value.amount, result.value.currency)
      )
    })
    return () => {
      active = false
    }
  }, [projectId])

  const save = async () => {
    const minor = amount.trim() === '' ? null : parseMoney(amount, currency)
    if (amount.trim() !== '' && minor === null) {
      setError(t('projects:costs.amountInvalid'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.setBudget(projectId, { amount: minor, currency })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: t('projects:costs.budgetSaved'), tone: 'success' })
    onSaved?.(result.value)
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t('projects:costs.setBudget')}
      description={t('projects:costs.budgetDescription')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('projects:costs.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || budget === null}
            onClick={() => void save()}
          >
            {t('projects:costs.save')}
          </Button>
        </>
      }
    >
      <div className="costs-form">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:costs.budgetAmount')}
          hint={t('projects:costs.budgetAmountHint')}
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
        />
        {budget && (
          <Select
            label={t('projects:costs.currency')}
            hint={t('projects:costs.currencyHint')}
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            options={currencyOptions(budget.currency)}
          />
        )}
      </div>
    </Dialog>
  )
}
