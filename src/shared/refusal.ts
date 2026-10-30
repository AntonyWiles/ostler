/**
 * An expected "no": a validation message, a business rule, a feature that
 * needs a linked folder, a merge refused because the folder has changes or
 * conflicts. The person did something Ostler will not do, and the message says
 * why. Nothing broke, so the IPC layer and the HTTP servers log a refusal as
 * one `INFO` line without a stack, and Copy diagnostics does not count it.
 *
 * Only errors raised deliberately as refusals are refusals. An unexpected
 * exception inside a refusing code path is still an `Error`, logged as
 * `ERROR` with its stack.
 */
export class Refusal extends Error {
  /** Survives a bundler that renames classes, unlike `instanceof` alone. */
  readonly refusal = true

  constructor(message: string) {
    super(message)
    this.name = 'Refusal'
  }
}

export function isRefusal(error: unknown): error is Refusal {
  return (
    error instanceof Refusal ||
    (error instanceof Error && (error as { refusal?: unknown }).refusal === true)
  )
}

/** A refusal's message as one log line: newlines (such as a Details block) folded into spaces. */
export function refusalLogLine(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : String(error)
  return `${prefix}: ${message.replace(/\s*\r?\n\s*/g, ' ').trim()}`
}

/** The message the database guard raises on a Viewer's PC (electron/services/sync/capture.ts, D9). */
export const READ_ONLY_MESSAGE = 'ostler:read-only'

/** The message the guard raises on a Contributor's PC for a write outside their own work (D5). */
export const CONTRIBUTOR_ONLY_MESSAGE = 'ostler:contributor-only'

/** Whether a failed write was refused because this PC's person is a Contributor and the write is not theirs to make. */
export function isContributorOnlyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(CONTRIBUTOR_ONLY_MESSAGE)
}

/**
 * Whether a failed write was refused by the sharing guard: this PC only views the project,
 * or is a Contributor writing outside their own work. Background writers skip both alike.
 */
export function isReadOnlyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes(READ_ONLY_MESSAGE) || isContributorOnlyError(error))
  )
}
