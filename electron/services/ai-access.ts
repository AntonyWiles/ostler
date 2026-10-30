import { isAiConfigured } from '@shared/ai-configured'
import { aiPreset } from '@shared/ai-presets'
import type {
  AIConnectionDraft,
  AIConnectionTest,
  AIEffortLevel,
  AIModelEffortSupport,
  AIModelInfo,
  AIProvider,
  OstlerConfig,
  WatchedProject
} from '@shared/ostler-api'
import {
  createProvider,
  getModelEffortSupport,
  listProviderModels,
  type AIChatMessage,
  type AIProviderInterface
} from './ai-provider'
import { toFriendlyAiError, type AiErrorContext } from './ai-errors'
import { getRuntimeApiKey } from './runtime-credentials'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'

/**
 * The one gate every Ostler AI request passes through (P7.1). Chat, every
 * planning draft, summaries and reviews get their provider here and nowhere
 * else, so two rules hold everywhere at once:
 *
 * - Ostler AI must be set up (`isAiConfigured`: a model, and a key or a keyless
 *   local provider). Setting it up is the switch: it then reads every project.
 * - Failures come back as plain advice (`ai-errors.ts`).
 *
 * Built-in coding agents are not Ostler AI and do not come through here.
 */

/** What Ostler AI says before it is set up, in the interface language. */
export function aiNotSetUp(): string {
  return t('errors:aiNotSetUp')
}

export interface AiConnection {
  provider: AIProviderInterface
  providerId: AIProvider
  model: string
}

/** The projects a cross-project chat describes: the enabled ones. */
export function aiReadableProjects(config: OstlerConfig): WatchedProject[] {
  return config.projects.filter((project) => project.enabled)
}

/**
 * The gate. `projectId` is the project the request reads; null only for the
 * cross-project chat, which reads `aiReadableProjects` alone.
 */
export function requireAi(
  config: OstlerConfig,
  projectId: string | null,
  options: { sessionId?: string } = {}
): AiConnection {
  if (projectId !== null && !config.projects.some((project) => project.id === projectId)) {
    throw new Refusal('Project not found')
  }
  const apiKey = getRuntimeApiKey(config)
  const { provider, baseUrl, model, effort } = config.ai
  if (!isAiConfigured({ provider, baseUrl, model, hasApiKey: apiKey.length > 0 })) {
    throw new Refusal(aiNotSetUp())
  }
  return {
    provider: friendlyProvider(
      createProvider(provider, baseUrl || '', apiKey, model, options.sessionId),
      { provider, baseUrl },
      effort || undefined
    ),
    providerId: provider,
    model
  }
}

/**
 * A provider whose failures read as advice. `effort` is Settings › AI
 * "Effort", added here so every request the gate hands out carries it.
 */
function friendlyProvider(
  inner: AIProviderInterface,
  context: AiErrorContext,
  effort?: AIEffortLevel
): AIProviderInterface {
  return {
    async *chat(messages: AIChatMessage[], options) {
      try {
        yield* inner.chat(messages, effort ? { ...options, effort } : options)
      } catch (error) {
        throw toFriendlyAiError(error, context)
      }
    },
    async testConnection(model: string, testEffort?: AIEffortLevel) {
      try {
        return await inner.testConnection(model, testEffort)
      } catch (error) {
        throw toFriendlyAiError(error, context)
      }
    }
  }
}

/**
 * The connection a Settings or setup-dialog call means: the saved settings,
 * or a draft being set up. A draft's key is used when it brings one; otherwise
 * the saved key, but only while the draft talks to the same provider and
 * address, so a key never goes somewhere it was not saved for.
 */
function settingsConnection(
  config: OstlerConfig,
  draft?: AIConnectionDraft
): { provider: AIProvider; baseUrl: string; model: string; apiKey: string } {
  if (!draft) {
    return {
      provider: config.ai.provider,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
      apiKey: getRuntimeApiKey(config)
    }
  }
  const preset = draft.presetId ? aiPreset(draft.presetId) : null
  const provider = draft.provider ?? preset?.provider ?? config.ai.provider
  const baseUrl = (draft.baseUrl ?? preset?.defaultBaseUrl ?? '').trim()
  const sameEndpoint =
    provider === config.ai.provider &&
    baseUrl.replace(/\/+$/, '') === config.ai.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = draft.apiKey?.trim() || (sameEndpoint ? getRuntimeApiKey(config) : '')
  return { provider, baseUrl, model: draft.model?.trim() ?? config.ai.model, apiKey }
}

const PROVIDERS: readonly AIProvider[] = ['openai', 'anthropic', 'google', 'custom']

/** A draft from the renderer, checked field by field; anything else is dropped. */
export function normalizeConnectionDraft(value: unknown): AIConnectionDraft | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Refusal('Invalid connection')
  const raw = value as Record<string, unknown>
  const text = (key: string, max: number): string | undefined => {
    const entry = raw[key]
    if (entry === undefined || entry === null) return undefined
    if (typeof entry !== 'string' || entry.length > max) throw new Refusal(`Invalid ${key}`)
    return entry
  }
  const presetId = text('presetId', 40)
  if (presetId !== undefined && !aiPreset(presetId)) throw new Refusal('Unknown provider')
  const provider = text('provider', 20)
  if (provider !== undefined && !PROVIDERS.includes(provider as AIProvider)) {
    throw new Refusal('Unknown provider')
  }
  const baseUrl = text('baseUrl', 2000)
  if (baseUrl && !/^https?:\/\//i.test(baseUrl.trim())) {
    throw new Refusal(t('errors:aiAccess.addressMustStartHttp'))
  }
  return {
    presetId,
    provider: provider as AIProvider | undefined,
    baseUrl,
    model: text('model', 300),
    apiKey: text('apiKey', 2000)
  }
}

/** The models a provider offers, for the model picker. */
export async function listAiModels(
  config: OstlerConfig,
  draft?: AIConnectionDraft
): Promise<AIModelInfo[]> {
  const connection = settingsConnection(config, draft)
  try {
    return await listProviderModels(connection.provider, connection.baseUrl, connection.apiKey)
  } catch (error) {
    throw toFriendlyAiError(error, connection)
  }
}

/** Which effort levels the chosen model takes, as its provider reports them. */
export async function aiModelEffortSupport(
  config: OstlerConfig,
  draft?: AIConnectionDraft
): Promise<AIModelEffortSupport> {
  const connection = settingsConnection(config, draft)
  if (!connection.model) throw new Refusal(t('errors:aiAccess.chooseModelFirst'))
  try {
    return await getModelEffortSupport(
      connection.provider,
      connection.baseUrl,
      connection.apiKey,
      connection.model
    )
  } catch (error) {
    throw toFriendlyAiError(error, connection)
  }
}

/** One tiny request, to prove the settings work. */
export async function testAiConnection(
  config: OstlerConfig,
  draft?: AIConnectionDraft
): Promise<AIConnectionTest> {
  const connection = settingsConnection(config, draft)
  if (!connection.model) throw new Refusal(t('errors:aiAccess.chooseModelFirst'))
  const provider = friendlyProvider(
    createProvider(connection.provider, connection.baseUrl, connection.apiKey, connection.model),
    connection
  )
  // The saved settings are tested as chat uses them, effort included.
  return provider.testConnection(
    connection.model,
    draft ? undefined : config.ai.effort || undefined
  )
}
