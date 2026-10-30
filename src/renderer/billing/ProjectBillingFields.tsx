import { useCallback, useEffect, useState } from 'react'
import { moneyInputText, parseMoney } from '@shared/money'
import type { BillingSettings } from '@shared/time/billing'
import { t } from '@shared/i18n'
import { Checkbox, TextField, useToast } from '../ui'
import './billing.css'

/**
 * Project settings' billing fields (N6.4), beside the budget: the hourly rate
 * in the project's currency (saved when the field is left) and "New time is
 * billable" (saved when ticked). Neither changes time already logged.
 */
export function ProjectBillingFields({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [rate, setRate] = useState('')
  const [rateError, setRateError] = useState<string | undefined>(undefined)

  const show = useCallback((value: BillingSettings) => {
    setSettings(value)
    setRate(value.hourlyRate === null ? '' : moneyInputText(value.hourlyRate, value.currency))
  }, [])

  useEffect(() => {
    void window.ostlerAPI.getBillingSettings(projectId).then((result) => {
      if (result.ok) show(result.value)
    })
  }, [projectId, show])

  if (!settings) return null

  const save = async (input: { hourlyRate?: number | null; newTimeBillable?: boolean }) => {
    const result = await window.ostlerAPI.setBillingSettings(projectId, input)
    if (!result.ok) {
      toast({ title: t('projects:billing.couldNotSave'), body: result.error, tone: 'danger' })
      return
    }
    show(result.value)
  }

  const saveRate = () => {
    const text = rate.trim()
    const minor = text === '' ? null : parseMoney(text, settings.currency)
    if (text !== '' && minor === null) {
      setRateError(t('projects:billing.rateInvalid'))
      return
    }
    if (minor === settings.hourlyRate) return
    void save({ hourlyRate: minor })
  }

  return (
    <div className="billing-fields">
      <TextField
        label={t('projects:billing.hourlyRate')}
        hint={t('projects:billing.hourlyRateHint', { currency: settings.currency })}
        error={rateError}
        inputMode="decimal"
        value={rate}
        suffix={settings.currency}
        onChange={(event) => {
          setRate(event.target.value)
          setRateError(undefined)
        }}
        onBlur={saveRate}
        onKeyDown={(event) => {
          if (event.key === 'Enter') saveRate()
        }}
      />
      <Checkbox
        label={t('projects:billing.newTimeBillable')}
        hint={t('projects:billing.newTimeBillableHint')}
        checked={settings.newTimeBillable}
        onChange={(event) => void save({ newTimeBillable: event.target.checked })}
      />
    </div>
  )
}
