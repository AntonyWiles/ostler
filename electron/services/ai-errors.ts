import { isLoopbackUrl, presetForSettings } from '@shared/ai-presets'
import type { AIProvider } from '@shared/ostler-api'
import { withErrorDetails } from '@shared/error-details'
import { t } from '@shared/i18n'

/**
 * The one place a failed AI request becomes plain advice (P7.1). Every model
 * call is made through the provider `ai-access.ts` hands out, which passes its
 * failures through here, so chat, planning, reviews and Settings all say the
 * same thing for the same failure. The provider's own words go behind
 * "Details" (`withErrorDetails`).
 */

export interface AiErrorContext {
  provider: AIProvider
  baseUrl: string
}

/** An error already turned into advice: mapping it again would only nest it. */
export class FriendlyAiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FriendlyAiError'
  }
}

/** Our own plain messages that need no mapping. */
const ALREADY_PLAIN = /^Stopped by the emergency stop\.|^The model's answer couldn't be used/

function errorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

function rawText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = errorCode(error)
  return code && !error.message.includes(code) ? `${error.message} (${code})` : error.message
}

/** Where requests go, as people would write it. */
function displayUrl(context: AiErrorContext): string {
  return (context.baseUrl || presetForSettings(context).defaultBaseUrl).trim().replace(/\/+$/, '')
}

/** The plain advice for a failed AI request, or null when the error is not one we know. */
export function friendlyAiMessage(error: unknown, context: AiErrorContext): string | null {
  const text = rawText(error)
  const code = errorCode(error)
  const url = displayUrl(context)
  const preset = presetForSettings(context)
  const status = /API error: (\d{3})/.exec(text)?.[1]

  if (status === '401' || status === '403') {
    return t('errors:aiErrors.keyWasRefusedCheck')
  }
  if (status === '404') {
    return /model/i.test(text)
      ? t('errors:aiErrors.modelIsntAvailableChoose')
      : t('errors:aiErrors.nothingUnderstandsTheseRequests', { url })
  }
  if (
    status === '400' &&
    /deprecated|not supported|unsupported (parameter|value)|unknown parameter|extra inputs are not permitted/i.test(
      text
    )
  ) {
    return t('errors:aiErrors.modelRefusedSetting')
  }
  if (status === '429') {
    return t('errors:aiErrors.providerLimitingRequestsRight')
  }
  if (status && status.startsWith('5')) {
    return t('errors:aiErrors.providerHadProblemSide')
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)) {
    return preset.kind === 'local'
      ? t('errors:aiErrors.nothingAnsweringRunning', { url, presetLabel: preset.label })
      : isLoopbackUrl(url)
        ? t('errors:aiErrors.nothingAnsweringServerRunning', { url })
        : t('errors:aiErrors.nothingAnsweringCheckAddress', { url })
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|EAI_AGAIN/.test(text)) {
    return t('errors:aiErrors.couldntFindCheckAddress', { url })
  }
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    /did not start responding|stopped sending output|TimeoutError|timed out|aborted due to timeout/i.test(
      text
    )
  ) {
    return preset.kind === 'local'
      ? t('errors:aiErrors.modelTookTooLong')
      : t('errors:aiErrors.providerTookTooLong')
  }
  if (/fetch failed|ECONNRESET|socket hang up|network/i.test(text)) {
    return t('errors:aiErrors.connectionFailedCheckAddress', { url })
  }
  return null
}

/** `error` as plain advice with the raw text behind Details, or unchanged when it is not one we know. */
export function toFriendlyAiError(error: unknown, context: AiErrorContext): Error {
  if (error instanceof FriendlyAiError) return error
  const raw = rawText(error)
  if (ALREADY_PLAIN.test(raw)) return error instanceof Error ? error : new Error(raw)
  const message = friendlyAiMessage(error, context)
  if (!message) return error instanceof Error ? error : new Error(raw)
  return new FriendlyAiError(withErrorDetails(message, raw))
}

/** What a draft that cannot be read says, whatever went wrong inside it. */
export const MODEL_ANSWER_UNUSABLE =
  "The model's answer couldn't be used; try again or pick a stronger model."

/** A malformed or incomplete draft, with what was wrong behind Details. */
export function unusableAnswer(detail: string): FriendlyAiError {
  return new FriendlyAiError(withErrorDetails(MODEL_ANSWER_UNUSABLE, detail))
}
