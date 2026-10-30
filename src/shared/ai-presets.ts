import type { AIProvider } from './ostler-api/ai-types'
import { t } from './i18n'

/**
 * The AI providers the guided setup offers (P7.1, D11), as data. Settings,
 * the setup dialog, local detection in main and the privacy page all read
 * this one list, so a provider is described once.
 */

export type AiPresetKind = 'local' | 'cloud' | 'other'

export const AI_PRESET_IDS = [
  'ollama',
  'lmstudio',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'other'
] as const
export type AiPresetId = (typeof AI_PRESET_IDS)[number]

export interface AiPreset {
  id: AiPresetId
  label: string
  /** "On this PC" (free, nothing leaves the computer), "Cloud", or "Other". */
  kind: AiPresetKind
  /** The wire protocol Ostler speaks to it. */
  provider: AIProvider
  /** The address used when the person does not type one; '' for Other. */
  defaultBaseUrl: string
  /** Whether a key is required. Local providers need none. */
  needsKey: boolean
  /** The official page to download it or create a key (https only); '' for Other. */
  docsUrl: string
  /** The model chosen in the list when it is there. */
  recommendedModel: string
  /** One plain line under the choice. */
  description: string
  /** Local only: what to do when nothing answers at the address. */
  startHint?: string
}

export const AI_PRESETS: readonly AiPreset[] = [
  {
    id: 'ollama',
    get label() {
      return t('ai:aiPresets.ollama')
    },
    kind: 'local',
    provider: 'custom',
    defaultBaseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    docsUrl: 'https://ollama.com/download',
    recommendedModel: 'llama3.2',
    get description() {
      return t('ai:aiPresets.freeNothingLeavesComputer')
    },
    get startHint() {
      return t('ai:aiPresets.installOllamaThenDownload')
    }
  },
  {
    id: 'lmstudio',
    get label() {
      return t('ai:aiPresets.lmStudio')
    },
    kind: 'local',
    provider: 'custom',
    defaultBaseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    docsUrl: 'https://lmstudio.ai/download',
    recommendedModel: '',
    get description() {
      return t('ai:aiPresets.freeNothingLeavesComputer')
    },
    get startHint() {
      return t('ai:aiPresets.openLmStudioDownload')
    }
  },
  {
    id: 'openai',
    get label() {
      return t('ai:aiPresets.openai')
    },
    kind: 'cloud',
    provider: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    docsUrl: 'https://platform.openai.com/api-keys',
    recommendedModel: 'gpt-4.1-mini',
    get description() {
      return t('ai:aiPresets.needsOpenaiAccountKey')
    }
  },
  {
    id: 'anthropic',
    get label() {
      return t('ai:aiPresets.anthropic')
    },
    kind: 'cloud',
    provider: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    needsKey: true,
    docsUrl: 'https://console.anthropic.com/settings/keys',
    recommendedModel: 'claude-sonnet-5-5',
    get description() {
      return t('ai:aiPresets.needsAnthropicAccountKey')
    }
  },
  {
    id: 'google',
    get label() {
      return t('ai:aiPresets.google')
    },
    kind: 'cloud',
    provider: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsKey: true,
    docsUrl: 'https://aistudio.google.com/app/apikey',
    recommendedModel: 'gemini-2.5-flash',
    get description() {
      return t('ai:aiPresets.needsGoogleAiStudio')
    }
  },
  {
    id: 'openrouter',
    get label() {
      return t('ai:aiPresets.openrouter')
    },
    kind: 'cloud',
    provider: 'custom',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    docsUrl: 'https://openrouter.ai/keys',
    recommendedModel: 'openai/gpt-4.1-mini',
    get description() {
      return t('ai:aiPresets.manyModelsThroughOne')
    }
  },
  {
    id: 'other',
    get label() {
      return t('ai:aiPresets.otherOpenaiCompatibleServer')
    },
    kind: 'other',
    provider: 'custom',
    defaultBaseUrl: '',
    needsKey: false,
    docsUrl: '',
    recommendedModel: '',
    get description() {
      return t('ai:aiPresets.anyServerSpeaksOpenai')
    }
  }
]

export function aiPreset(id: string): AiPreset | null {
  return AI_PRESETS.find((preset) => preset.id === id) ?? null
}

function normalizeUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses|messages)$/i, '')
    .toLowerCase()
}

/**
 * Which preset a saved provider and address are: the named one whose address
 * matches, else the provider's own preset, else Other.
 */
export function presetForSettings(ai: { provider: AIProvider; baseUrl: string }): AiPreset {
  const url = normalizeUrl(ai.baseUrl)
  const byUrl = AI_PRESETS.find(
    (preset) =>
      preset.id !== 'other' &&
      preset.provider === ai.provider &&
      normalizeUrl(preset.defaultBaseUrl) === url
  )
  if (byUrl) return byUrl
  if (ai.provider !== 'custom') {
    return AI_PRESETS.find((preset) => preset.provider === ai.provider && preset.kind === 'cloud')!
  }
  return aiPreset('other')!
}

/** True for an address on this computer: localhost, 127.x.x.x or ::1. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
  } catch {
    return false
  }
}

/** Problems with the preset list, for the test that keeps it honest. Empty when valid. */
export function aiPresetProblems(presets: readonly AiPreset[] = AI_PRESETS): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const preset of presets) {
    if (ids.has(preset.id)) problems.push(t('ai:aiPresets.duplicateId', { presetId: preset.id }))
    ids.add(preset.id)
    if (!preset.label.trim()) problems.push(t('ai:aiPresets.noLabel', { presetId: preset.id }))
    if (preset.docsUrl && !/^https:\/\//.test(preset.docsUrl)) {
      problems.push(t('ai:aiPresets.docsLinkMustHttps', { presetId: preset.id }))
    }
    if (preset.kind !== 'other' && !preset.docsUrl)
      problems.push(t('ai:aiPresets.noDocsLink', { presetId: preset.id }))
    if (preset.kind === 'local') {
      if (preset.needsKey)
        problems.push(t('ai:aiPresets.localProviderNeedsNo', { presetId: preset.id }))
      if (!isLoopbackUrl(preset.defaultBaseUrl)) {
        problems.push(t('ai:aiPresets.localProvidersAddressMust', { presetId: preset.id }))
      }
      if (!preset.startHint)
        problems.push(t('ai:aiPresets.noHintStarting', { presetId: preset.id }))
    }
    if (preset.kind === 'cloud') {
      if (!preset.needsKey)
        problems.push(t('ai:aiPresets.cloudProviderNeedsKey', { presetId: preset.id }))
      if (!/^https:\/\//.test(preset.defaultBaseUrl)) {
        problems.push(t('ai:aiPresets.cloudAddressMustHttps', { presetId: preset.id }))
      }
    }
    if (preset.kind === 'other' && preset.defaultBaseUrl) {
      problems.push(t('ai:aiPresets.otherHasNoDefault', { presetId: preset.id }))
    }
  }
  return problems
}
