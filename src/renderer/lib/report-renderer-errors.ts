import type { RendererErrorReport } from '@shared/ostler-api'

const MAX_MESSAGE_CHARS = 2_000
const MAX_STACK_CHARS = 8_000

const clip = (text: string | undefined, max: number) =>
  text && text.length > max ? text.slice(0, max) : text

/** Sends one renderer error to main.log. Main rate-limits; this caps the size it sends. */
export function reportRendererError(report: RendererErrorReport): void {
  try {
    void window.ostlerAPI
      ?.logRendererError({
        ...report,
        message: clip(report.message, MAX_MESSAGE_CHARS) ?? '',
        stack: clip(report.stack, MAX_STACK_CHARS),
        location: report.location ?? window.location.hash
      })
      .catch(() => {})
  } catch {
    // Reporting an error must never raise another one.
  }
}

/** Forwards every uncaught renderer error and unhandled rejection to main.log. */
export function forwardRendererErrors(): void {
  window.addEventListener('error', (event) => {
    const error = event.error as unknown
    reportRendererError({
      kind: 'error',
      message: error instanceof Error ? error.message : event.message,
      stack:
        error instanceof Error ? error.stack : `${event.filename}:${event.lineno}:${event.colno}`
    })
  })
  // A CSP block is invisible to the user and silent outside devtools; logging
  // it is how a too-tight policy shows up in a bug report.
  window.addEventListener('securitypolicyviolation', (event) => {
    reportRendererError({
      kind: 'error',
      message: `Content Security Policy blocked ${event.blockedURI || 'an inline resource'} (${event.effectiveDirective})`,
      stack: event.sourceFile ? `${event.sourceFile}:${event.lineNumber}` : undefined
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    reportRendererError({
      kind: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    })
  })
}
