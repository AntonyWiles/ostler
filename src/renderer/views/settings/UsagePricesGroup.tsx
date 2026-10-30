import { useEffect, useState } from 'react'
import type { AgentModelPrice } from '@shared/ostler-api'
import { normalizeModelPrices } from '@shared/agent-run-history'
import { t } from '@shared/i18n'
import { Button, NumberField, TextField } from '../../ui'
import { SettingsGroup, useSettings } from './settings-form'
import { useSavedDraft } from '../../hooks/useSavedDraft'

/**
 * Settings › Agents › Usage (R5.3, D43): an optional price per million input
 * and output tokens for each model, entered by the person. The run history
 * shows a cost only for runs whose model has a price; Ostler never guesses one.
 */
export function UsagePricesGroup() {
  const { config, saveConfig } = useSettings()
  const saved = normalizeModelPrices(config.harness.modelPrices)
  const [rows, setRows] = useState<AgentModelPrice[]>(saved)
  const [model, setModel] = useState('')
  useEffect(() => setRows(normalizeModelPrices(config.harness.modelPrices)), [config])

  const save = (next: AgentModelPrice[]) => {
    setRows(next)
    void saveConfig({ harness: { modelPrices: normalizeModelPrices(next) } })
  }

  const add = () => {
    const name = model.trim()
    if (!name) return
    if (!rows.some((row) => row.model === name)) {
      save([...rows, { model: name, inputPerMillion: 0, outputPerMillion: 0 }])
    }
    setModel('')
  }

  const setPrice = (index: number, key: 'inputPerMillion' | 'outputPerMillion', value: number) => {
    if (rows[index][key] === value) return
    save(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)))
  }

  return (
    <SettingsGroup id="usage-prices" description={t('agents:usagePrices.description')}>
      {rows.length === 0 && (
        <p className="ostler-settings-hint">{t('agents:usagePrices.noPrices')}</p>
      )}
      {rows.map((row, index) => (
        <div key={row.model} className="ostler-settings-inline-actions">
          <strong>{row.model}</strong>
          <PriceField
            label={t('agents:usagePrices.inputPrice', { model: row.model })}
            value={row.inputPerMillion}
            onCommit={(value) => setPrice(index, 'inputPerMillion', value)}
          />
          <PriceField
            label={t('agents:usagePrices.outputPrice', { model: row.model })}
            value={row.outputPerMillion}
            onCommit={(value) => setPrice(index, 'outputPerMillion', value)}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('agents:usagePrices.removePrice', { model: row.model })}
            onClick={() => save(rows.filter((_, at) => at !== index))}
          >
            {t('agents:usagePrices.remove')}
          </Button>
        </div>
      ))}
      <div className="ostler-settings-inline-actions">
        <TextField
          label={t('agents:usagePrices.model')}
          hint={t('agents:usagePrices.modelHint')}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
        <Button variant="secondary" disabled={!model.trim()} onClick={add}>
          {t('agents:usagePrices.addPrice')}
        </Button>
      </div>
    </SettingsGroup>
  )
}

/** A price saved when the field loses focus or Enter is pressed. */
function PriceField({
  label,
  value,
  onCommit
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useSavedDraft<number | null>(value)
  const commit = () => {
    if (draft === null || draft < 0) setDraft(value)
    else onCommit(draft)
  }
  return (
    <NumberField
      label={label}
      unit={t('agents:usagePrices.perMillion')}
      min={0}
      step={0.01}
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}
