import type { OstlerConfig } from '@shared/ostler-api'

/**
 * Returns the in-memory development override when provided, otherwise the
 * encrypted-and-decrypted value loaded by ConfigStore.
 *
 * OSTLER_AI_API_KEY is intentionally never written to the config file.
 */
export function getRuntimeApiKey(config: OstlerConfig): string {
  return process.env.OSTLER_AI_API_KEY?.trim() || config.ai.apiKey
}
