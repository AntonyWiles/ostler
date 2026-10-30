import { aiPreset } from '@shared/ai-presets'
import type { AIModelInfo, LocalAiDetection } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * "Find it" in the guided setup (P7.1): asks one local provider's default
 * address which models it has. Only a preset marked local is ever asked, at
 * its one known loopback address, and only because the person pressed the
 * button; nothing scans ports or runs by itself.
 */

const PROBE_TIMEOUT_MS = 3000

export async function findLocalAiProvider(
  presetId: string,
  fetchImpl: typeof fetch = fetch
): Promise<LocalAiDetection> {
  const preset = aiPreset(presetId)
  if (!preset || preset.kind !== 'local')
    throw new Error(t('errors:aiLocalDetect.onlyLocalProviderCan'))
  const baseUrl = preset.defaultBaseUrl
  const notFound: LocalAiDetection = {
    status: 'not-found',
    baseUrl,
    message: [
      t('errors:aiLocalDetect.nothingAnswering', { url: baseUrl, provider: preset.label }),
      preset.startHint ?? ''
    ]
      .join(' ')
      .trim(),
    downloadUrl: preset.docsUrl
  }

  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/models`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
  } catch {
    return notFound
  }

  const wrongService: LocalAiDetection = {
    status: 'wrong-service',
    baseUrl,
    message: t('errors:aiLocalDetect.somethingAnsweringButIsnt', {
      baseUrl,
      presetLabel: preset.label
    })
  }
  if (!response.ok) return wrongService
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return wrongService
  }
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return wrongService
  const models: AIModelInfo[] = data.flatMap((entry) => {
    const id = (entry as { id?: unknown } | null)?.id
    return typeof id === 'string' && id ? [{ id, label: id }] : []
  })
  return { status: 'found', baseUrl, models: models.sort((a, b) => a.id.localeCompare(b.id)) }
}
