import type { CalendarLinkFailure } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'

/**
 * Fetching a subscribed calendar link (N3.3b, decision N27 A): the one place
 * Ostler fetches a calendar address, and nothing else. `https` only (a
 * `webcal://` address is read as `https://`); at most three redirects, each
 * `https`; no cookies, no credentials, and no headers but a plain
 * `User-Agent` and the conditional `If-None-Match` and `If-Modified-Since`;
 * 30 seconds and 20 MB at most.
 *
 * The address is a secret: no error from here carries it, or the raw error
 * text it could hide in. A failure is a `CalendarLinkError` with a reason
 * code the app shows in plain words.
 */

export const CALENDAR_LINK_TIMEOUT_MS = 30_000
export const CALENDAR_LINK_MAX_BYTES = 20 * 1024 * 1024
export const CALENDAR_LINK_MAX_REDIRECTS = 3
/** The longest address accepted. */
export const MAX_CALENDAR_LINK_LENGTH = 4096

/** The fetch this module calls: the global one in the app, a stub in tests. */
export type CalendarFetch = (url: string, init: RequestInit) => Promise<Response>

export class CalendarLinkError extends Error {
  constructor(readonly reason: CalendarLinkFailure) {
    // Only the reason: never the address.
    super(`Calendar link failed: ${reason}`)
    this.name = 'CalendarLinkError'
  }
}

/** What a fetch gave: new text, or "not changed since" (a 304). */
export type CalendarLinkResult =
  | { notModified: true }
  | { notModified: false; text: string; etag: string | null; lastModified: string | null }

export interface CalendarLinkConditions {
  etag?: string | null
  lastModified?: string | null
}

export interface CalendarLinkFetchOptions {
  fetch?: CalendarFetch
  userAgent: string
  timeoutMs?: number
  maxBytes?: number
}

/**
 * The address a person pasted, as Ostler fetches it: trimmed, `webcal://`
 * (or `webcals://`) read as `https://`, and refused unless it is `https`
 * with no user name or password. The fragment is dropped (it is never sent).
 */
export function normaliseCalendarLink(input: unknown): string {
  if (typeof input !== 'string' || !input.trim())
    throw new Refusal(t('errors:calendarLinks.needsLink'))
  const trimmed = input.trim()
  if (trimmed.length > MAX_CALENDAR_LINK_LENGTH)
    throw new Refusal(t('errors:calendarLinks.badLink'))
  const rewritten = trimmed.replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(rewritten)
  } catch {
    throw new Refusal(t('errors:calendarLinks.badLink'))
  }
  if (url.protocol !== 'https:') throw new Refusal(t('errors:calendarLinks.notHttps'))
  if (url.username || url.password) throw new Refusal(t('errors:calendarLinks.credentials'))
  if (!url.hostname) throw new Refusal(t('errors:calendarLinks.badLink'))
  url.hash = ''
  return url.toString()
}

/**
 * The link as Settings shows it: its host and its last path part, with the
 * middle (where the secret usually is) left out:
 * "outlook.office365.com/…/calendar.ics". The query is never shown.
 */
export function shortenCalendarLink(link: string): string {
  const url = new URL(link)
  const parts = url.pathname.split('/').filter(Boolean)
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname
  if (parts.length === 0) return host
  const last = parts[parts.length - 1]
  const shortLast = last.length > 40 ? `${last.slice(0, 12)}…` : last
  return parts.length === 1 ? `${host}/${shortLast}` : `${host}/…/${shortLast}`
}

/** The real fetch, refusing anything but https before it reaches the network. */
export const httpsOnlyFetch: CalendarFetch = (url, init) => {
  if (!/^https:\/\//i.test(url)) return Promise.reject(new CalendarLinkError('notHttps'))
  return fetch(url, init)
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const REFUSED = new Set([401, 403, 404, 410])

/** Fetches a calendar link once, following up to three https redirects. */
export async function fetchCalendarLink(
  link: string,
  conditions: CalendarLinkConditions,
  options: CalendarLinkFetchOptions
): Promise<CalendarLinkResult> {
  const doFetch = options.fetch ?? httpsOnlyFetch
  const timeoutMs = options.timeoutMs ?? CALENDAR_LINK_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? CALENDAR_LINK_MAX_BYTES
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const failed = (error: unknown): never => {
    if (error instanceof CalendarLinkError) throw error
    throw new CalendarLinkError(timedOut ? 'timeout' : 'unreachable')
  }
  try {
    let url = link
    if (!/^https:\/\//i.test(url)) throw new CalendarLinkError('notHttps')
    for (let redirects = 0; ; redirects += 1) {
      const headers: Record<string, string> = { 'User-Agent': options.userAgent }
      if (conditions.etag) headers['If-None-Match'] = conditions.etag
      if (conditions.lastModified) headers['If-Modified-Since'] = conditions.lastModified
      const response = await doFetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      }).catch(failed)
      if (REDIRECTS.has(response.status)) {
        await response.body?.cancel().catch(() => {})
        if (redirects >= CALENDAR_LINK_MAX_REDIRECTS) throw new CalendarLinkError('redirects')
        const location = response.headers.get('location')
        if (!location) throw new CalendarLinkError('server')
        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          throw new CalendarLinkError('server')
        }
        if (next.protocol !== 'https:') throw new CalendarLinkError('notHttps')
        if (next.username || next.password) throw new CalendarLinkError('notHttps')
        url = next.toString()
        continue
      }
      if (response.status === 304) {
        await response.body?.cancel().catch(() => {})
        return { notModified: true }
      }
      if (REFUSED.has(response.status)) throw new CalendarLinkError('refused')
      if (!response.ok) throw new CalendarLinkError('server')
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => {})
        throw new CalendarLinkError('tooBig')
      }
      const text = await readCapped(response, maxBytes).catch(failed)
      return {
        notModified: false,
        text,
        etag: header(response, 'etag'),
        lastModified: header(response, 'last-modified')
      }
    }
  } catch (error) {
    return failed(error)
  } finally {
    clearTimeout(timer)
  }
}

function header(response: Response, name: string): string | null {
  const value = response.headers.get(name)
  // Kept only to send back, so only a plain, short value.
  return value && value.length <= 256 && /^[\x20-\x7e]+$/.test(value) ? value : null
}

/** Reads the body as UTF-8 text, stopping past `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let bytes = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new CalendarLinkError('tooBig')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}
