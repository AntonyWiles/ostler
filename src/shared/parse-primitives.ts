/**
 * Checks shared by the parsers of untrusted input (project packages, rules, appearance). Each
 * parser decides for itself what a bad value means: a refusal with its own message, or a fallback.
 */

/** True if `value` is one of `allowed`. */
export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}
