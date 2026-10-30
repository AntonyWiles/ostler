import type { AIEffortLevel, OstlerConfig, WatchedProject } from '@shared/ostler-api'
import { resolveAgentModel, type AgentRunChoice } from '@shared/agent-model'
import {
  resolveCustomProviderEndpointStyle,
  resolveCustomProviderModelId,
  type CustomProviderEndpointStyle
} from '../ai-provider'

/**
 * What goes into an embedded slot's opencode.json besides Ostler's plugin:
 * which provider and model the run talks to, how that provider is configured,
 * and opencode's own permission rules for the slot.
 */

/** Provider -> the environment variable opencode's own auth resolution reads. Per H0, env-sourced keys are never persisted to opencode's on-disk config. */
export const PROVIDER_ENV_VAR: Partial<Record<OstlerConfig['ai']['provider'], string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY'
}

/**
 * providerID synthesized into the slot's opencode.json for a "custom"
 * Ostler AI provider (see writeCustomProviderConfig). Distinct from
 * opencode's own built-in "opencode-go" identity, which points at
 * opencode's separate hosted zen marketplace and requires its own
 * device-login credential that Ostler never provisions into the sandboxed
 * slot -- routing a user's actual configured baseUrl/apiKey through it
 * silently fell back to whatever opencode-go's free tier allowed and
 * failed (HTTP 500) on anything else, even though the exact same
 * baseUrl/model/key work fine everywhere else in Ostler (AI Chat, the
 * connection test, task drafting).
 */
export const CUSTOM_PROVIDER_ID = 'ostler-custom'
export const CUSTOM_PROVIDER_API_KEY_ENV = 'OSTLER_CUSTOM_PROVIDER_API_KEY'

export function resolveOpenCodeTarget(
  config: OstlerConfig,
  project: WatchedProject,
  run?: Partial<AgentRunChoice> | null
): {
  providerID: string
  modelID: string
  provider: OstlerConfig['ai']['provider']
  /** The run's effort, in D42's order (`resolveAgentModel`); none is the provider's default. */
  effort?: AIEffortLevel
} {
  // The run's own choice, then the project's default, then Settings › Agents
  // (whose "Same as Ostler AI" uses Ostler AI's) -- D42, one rule for every run.
  const resolved = resolveAgentModel(config, project.autoDispatch, run)
  const provider = resolved.provider
  const model = resolved.model
  const effort = resolved.effort || undefined

  switch (provider) {
    case 'openai':
      return { providerID: 'openai', modelID: model, provider, effort }
    case 'anthropic':
      return { providerID: 'anthropic', modelID: model, provider, effort }
    case 'google':
      return { providerID: 'google', modelID: model, provider, effort }
    default: {
      if (config.ai.baseUrl && model) {
        return {
          providerID: CUSTOM_PROVIDER_ID,
          modelID: resolveCustomProviderModelId(config.ai.baseUrl, model),
          provider,
          effort
        }
      }
      // No custom endpoint configured at all: fall back to opencode's own
      // free-tier catalog rather than failing outright.
      return { providerID: 'opencode-go', modelID: model || 'hy3-free', provider }
    }
  }
}

function customProviderNpmPackage(style: CustomProviderEndpointStyle): string {
  switch (style) {
    case 'responses':
      return '@ai-sdk/openai'
    case 'messages':
      return '@ai-sdk/anthropic'
    default:
      return '@ai-sdk/openai-compatible'
  }
}

/**
 * Writes a `provider` block into the slot's opencode.json so the local
 * opencode server routes the CUSTOM_PROVIDER_ID target at the user's
 * actual configured baseUrl, using the same wire-format detection
 * (chat-completions/responses/messages) ai-provider.ts already uses for
 * direct calls. The API key is referenced via `{env:...}` and supplied
 * through the process environment only -- per H0, it is never written to
 * disk here either.
 */
function buildCustomProviderConfig(
  baseUrl: string,
  modelID: string,
  modelOptions?: Record<string, unknown>
): Record<string, unknown> {
  const style = resolveCustomProviderEndpointStyle(baseUrl, modelID)
  return {
    [CUSTOM_PROVIDER_ID]: {
      npm: customProviderNpmPackage(style),
      name: 'Ostler Custom Provider',
      options: {
        baseURL: baseUrl,
        apiKey: `{env:${CUSTOM_PROVIDER_API_KEY_ENV}}`
      },
      models: {
        [modelID]: modelOptions ? { options: modelOptions } : {}
      }
    }
  }
}

/**
 * The effort as the AI SDK package opencode uses for the target takes it, as
 * a model's `options` in opencode.json: `effort` for @ai-sdk/anthropic (sent
 * as `output_config.effort`), `thinkingConfig.thinkingLevel` for
 * @ai-sdk/google, and `reasoningEffort` for @ai-sdk/openai and
 * @ai-sdk/openai-compatible (sent as `reasoning_effort`).
 */
export function openCodeEffortOptions(
  target: { provider: OstlerConfig['ai']['provider']; modelID: string; effort?: AIEffortLevel },
  baseUrl: string
): Record<string, unknown> | undefined {
  const { effort } = target
  if (!effort) return undefined
  if (target.provider === 'google') return { thinkingConfig: { thinkingLevel: effort } }
  const anthropicStyle =
    target.provider === 'anthropic' ||
    (target.provider === 'custom' &&
      resolveCustomProviderEndpointStyle(baseUrl, target.modelID) === 'messages')
  return anthropicStyle ? { effort } : { reasoningEffort: effort }
}

/** opencode.json's `provider` block for the target, or none when nothing needs saying. */
export function openCodeProviderConfig(
  target: {
    providerID: string
    provider: OstlerConfig['ai']['provider']
    modelID: string
    effort?: AIEffortLevel
  },
  baseUrl: string
): Record<string, unknown> | undefined {
  const options = openCodeEffortOptions(target, baseUrl)
  if (target.providerID === CUSTOM_PROVIDER_ID && baseUrl) {
    return buildCustomProviderConfig(baseUrl, target.modelID, options)
  }
  if (!options || target.providerID === 'opencode-go') return undefined
  return { [target.providerID]: { models: { [target.modelID]: { options } } } }
}

/**
 * opencode's own permission rules for a slot. Its default for any path outside
 * the project is "ask", and nothing answers that prompt in a headless server,
 * so the tool call waited until the stall watchdog killed it -- every agent
 * that opened its attachments, which Ostler deliberately keeps outside the
 * worktree, lost five minutes per try. Allow that one folder and refuse the
 * rest outright, so a wrong path fails at once instead of hanging. The plugin's
 * own fence still decides what each tool may touch.
 */
export function slotPermissions(attachmentsDir: string): Record<string, unknown> {
  const backslashed = attachmentsDir.replace(/\//g, '\\')
  const slashed = attachmentsDir.replace(/\\/g, '/')
  return {
    // Last matching rule wins, so the catch-all comes first.
    external_directory: {
      '*': 'deny',
      [`${backslashed}\\*`]: 'allow',
      [`${slashed}/*`]: 'allow'
    },
    // Another prompt nobody can answer; Ostler has its own repeat detection.
    doom_loop: 'deny'
  }
}
