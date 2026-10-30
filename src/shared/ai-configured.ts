import type { RendererConfig } from '@shared/ostler-api'
import { isLoopbackUrl } from './ai-presets'

type AiSettings = Pick<RendererConfig['ai'], 'provider' | 'baseUrl' | 'model' | 'hasApiKey'>

/**
 * Whether Ostler AI is set up: a model is chosen, and either a key is saved or
 * the provider is a keyless local one (a custom endpoint on this computer,
 * such as Ollama or LM Studio). The one rule behind `features.ai`, the status
 * bar and main's AI gate (`ai-access.ts`), so they cannot disagree.
 */
export function isAiConfigured(ai: AiSettings): boolean {
  if (!ai.model.trim()) return false
  if (ai.hasApiKey) return true
  return isKeylessLocal(ai)
}

/** A custom endpoint on this computer with no key: Ollama, LM Studio and the like. */
export function isKeylessLocal(ai: Pick<AiSettings, 'provider' | 'baseUrl'>): boolean {
  return ai.provider === 'custom' && isLoopbackUrl(ai.baseUrl)
}
