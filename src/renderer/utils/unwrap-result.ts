import type { Result } from '@shared/ostler-api'

/** Returns a successful IPC value or turns the structured failure into an Error. */
export function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Narrows a result in-place for call sites that continue to use `result.value`. */
export function assertResult<T>(result: Result<T>): asserts result is { ok: true; value: T } {
  if (!result.ok) throw new Error(result.error)
}
