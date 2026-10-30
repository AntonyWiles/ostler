import { useEffect, useState } from 'react'
import type {
  AIConnectionDraft,
  AIEffortLevel,
  AIEffortSetting,
  AIModelEffortSupport
} from '@shared/ostler-api'
import { AI_EFFORT_LEVELS } from '@shared/ostler-api'
import { Button, Select } from '../../ui'
import { t } from '@shared/i18n'

export function effortLabel(level: AIEffortLevel): string {
  switch (level) {
    case 'minimal':
      return t('ai:aiSection.effortLevel_minimal')
    case 'low':
      return t('ai:aiSection.effortLevel_low')
    case 'medium':
      return t('ai:aiSection.effortLevel_medium')
    case 'high':
      return t('ai:aiSection.effortLevel_high')
    case 'xhigh':
      return t('ai:aiSection.effortLevel_xhigh')
    case 'max':
      return t('ai:aiSection.effortLevel_max')
  }
}

/**
 * What each provider said about a model's effort levels, kept for the session
 * so reopening Settings does not ask again (a check can send test requests).
 */
const effortSupportCache = new Map<string, AIModelEffortSupport>()

export interface EffortFieldProps {
  model: string
  /** Names the provider and address, so a cached answer is never reused for another. */
  cacheKey: string
  /** Which connection to ask about; left out, the saved Ostler AI settings. */
  draft?: AIConnectionDraft
  effort: AIEffortSetting
  onChange(effort: AIEffortSetting): void
}

/**
 * An "Effort" choice, for Ostler AI and the built-in agent alike. The levels
 * come from the model's provider (`getAIModelEffortSupport`); a level it did
 * not name is greyed out, and the whole field is when the model has none.
 */
export function EffortField({ model, cacheKey, draft, effort, onChange }: EffortFieldProps) {
  const key = `${cacheKey}\u0000${model}`
  const [support, setSupport] = useState<AIModelEffortSupport | null>(
    () => effortSupportCache.get(key) ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The draft is rebuilt on every render; its content is what matters.
  const draftJson = JSON.stringify(draft ?? null)

  useEffect(() => {
    const cached = attempt === 0 ? effortSupportCache.get(key) : undefined
    setSupport(cached ?? null)
    setError(null)
    if (cached || !model.trim()) return
    let cancelled = false
    const request = JSON.parse(draftJson) as AIConnectionDraft | null
    void window.ostlerAPI.getAIModelEffortSupport(request ?? undefined).then((result) => {
      if (cancelled) return
      if (result.ok) {
        effortSupportCache.set(key, result.value)
        setSupport(result.value)
      } else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [key, model, attempt, draftJson])

  // A saved level the model does not take is cleared, never sent.
  useEffect(() => {
    if (support && effort && !support.levels.includes(effort)) onChange('')
  }, [support, effort, onChange])

  const levels = support?.levels ?? []
  const hint = error
    ? t('ai:aiSection.effortCouldNotCheck', { model, error })
    : !support
      ? t('ai:aiSection.effortChecking', { model })
      : levels.length === 0
        ? t('ai:aiSection.effortNotSupported', { model })
        : support.source === 'listing'
          ? t('ai:aiSection.effortFromListing', { model })
          : t('ai:aiSection.effortFromTest', { model })

  return (
    <div>
      <Select
        label={t('ai:aiSection.effort')}
        value={effort && levels.includes(effort) ? effort : ''}
        disabled={levels.length === 0}
        options={[
          { value: '', label: t('ai:aiSection.effortDefault') },
          ...AI_EFFORT_LEVELS.map((level) => ({
            value: level,
            label: effortLabel(level),
            disabled: !levels.includes(level)
          }))
        ]}
        hint={hint}
        onChange={(event) => onChange(event.target.value as AIEffortSetting)}
      />
      {error && (
        <Button size="sm" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          {t('ai:aiSection.effortCheckAgain')}
        </Button>
      )}
    </div>
  )
}
