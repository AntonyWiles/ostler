/** Small value helpers the config store and its migrations share. */

/** A plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A project's secrets in config.json: encrypted on disk, plain in memory. */
export const PROJECT_TOKEN_FIELDS = ['automationToken'] as const
