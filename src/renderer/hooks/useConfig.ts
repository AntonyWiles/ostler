import { useCallback, useState } from 'react'
import type { RendererConfig, RendererConfigUpdate } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { useIpcQuery } from './useIpcQuery'

const CONFIG_FIELDS = ['config'] as const

/**
 * The settings, read once and again whenever main says a setting changed, so
 * every screen that reads them stays live. `updateConfig` writes and puts the
 * saved settings in place at once.
 */
export function useConfig(options: { enabled?: boolean } = {}) {
  const query = useIpcQuery(() => window.ostlerAPI.getConfig(), [], {
    fields: CONFIG_FIELDS,
    enabled: options.enabled
  })
  const { setValue } = query
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const updateConfig = useCallback(
    async (updates: RendererConfigUpdate) => {
      setSaving(true)
      try {
        const result = await window.ostlerAPI.updateConfig(updates)
        if (result.ok) {
          setValue(result.value)
          return true
        }
        setSaveError(result.error)
        return false
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : t('common:useConfig.unknownError'))
        return false
      } finally {
        setSaving(false)
      }
    },
    [setValue]
  )

  const config: RendererConfig | null = query.value ?? null
  return {
    config,
    loading: !query.loaded || saving,
    error: saveError ?? query.error,
    reload: query.reload,
    /** Puts settings main returned in place at once. */
    setConfig: setValue,
    updateConfig
  }
}
