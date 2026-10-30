/**
 * An error message may carry the raw technical text behind it, after this
 * marker: the plain advice first, the provider's own words after. Main writes
 * it (`ai-errors.ts`); InlineAlert and toasts show the advice and put the rest
 * behind "Details".
 */
export const ERROR_DETAILS_MARKER = '\n\nDetails: '

export function withErrorDetails(message: string, details: string): string {
  const raw = details.trim()
  return raw && raw !== message ? `${message}${ERROR_DETAILS_MARKER}${raw}` : message
}

export function splitErrorDetails(text: string): { message: string; details: string | null } {
  const at = text.indexOf(ERROR_DETAILS_MARKER)
  if (at === -1) return { message: text, details: null }
  return {
    message: text.slice(0, at),
    details: text.slice(at + ERROR_DETAILS_MARKER.length) || null
  }
}
