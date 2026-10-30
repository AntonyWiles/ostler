/**
 * Every call a connected account makes goes through here (overview,
 * "Connected accounts"): https only, only to the hosts its provider declares,
 * at most three redirects (each to an allowed host), 30 seconds and 20 MB at
 * most, no cookies. Main passes Electron's `net.fetch`, so system proxy
 * settings apply; tests pass recorded responses.
 *
 * Errors carry a reason code only: never the address (a CalDAV path or a
 * query can hold personal data), a token, or raw error text.
 */
import type { AccountFailure } from '@shared/ostler-api'

export const ACCOUNT_TIMEOUT_MS = 30_000
export const ACCOUNT_MAX_BYTES = 20 * 1024 * 1024
const MAX_REDIRECTS = 3

export type AccountFetch = (url: string, init: RequestInit) => Promise<Response>

export class AccountCallError extends Error {
  constructor(
    readonly reason: AccountFailure,
    /** The HTTP status, when there was one. */
    readonly status: number | null = null
  ) {
    super(`Account call failed: ${reason}`)
    this.name = 'AccountCallError'
  }
}

export interface AccountRequest {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  /**
   * Hosts the call may reach. An entry starting with a dot allows that
   * domain's subdomains (`.icloud.com`); anything else must match exactly.
   */
  hosts: string[]
  fetch: AccountFetch
  userAgent: string
  timeoutMs?: number
  maxBytes?: number
}

export interface AccountResponse {
  status: number
  headers: { get(name: string): string | null }
  /** The body as UTF-8. */
  text: string
  /** The body exactly as it came. */
  bytes: Buffer
}

/** True when `url` is https, has no user name or password, and its host is allowed. */
export function isAllowedUrl(url: string, hosts: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  return hosts.some((allowed) => {
    const entry = allowed.toLowerCase()
    return entry.startsWith('.')
      ? host.endsWith(entry) && host.length > entry.length
      : host === entry
  })
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

/** One request: a 2xx (207 included) comes back; anything else is an `AccountCallError`. */
export async function accountRequest(
  url: string,
  request: AccountRequest
): Promise<AccountResponse> {
  const timeoutMs = request.timeoutMs ?? ACCOUNT_TIMEOUT_MS
  const maxBytes = request.maxBytes ?? ACCOUNT_MAX_BYTES
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const failed = (error: unknown): never => {
    if (error instanceof AccountCallError) throw error
    throw new AccountCallError(timedOut ? 'timeout' : 'unreachable')
  }
  try {
    let current = url
    let method = request.method ?? 'GET'
    let body = request.body
    for (let redirects = 0; ; redirects++) {
      if (!isAllowedUrl(current, request.hosts)) throw new AccountCallError('refused')
      const response = await request
        .fetch(current, {
          method,
          headers: { 'User-Agent': request.userAgent, ...request.headers },
          body: body as RequestInit['body'],
          redirect: 'manual',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal
        })
        .catch(failed)
      if (REDIRECTS.has(response.status)) {
        await response.body?.cancel().catch(() => undefined)
        if (redirects >= MAX_REDIRECTS) throw new AccountCallError('server', response.status)
        const location = response.headers.get('location')
        if (!location) throw new AccountCallError('server', response.status)
        try {
          current = new URL(location, current).toString()
        } catch {
          throw new AccountCallError('server', response.status)
        }
        if (response.status === 303) {
          method = 'GET'
          body = undefined
        }
        continue
      }
      if (response.status === 401) {
        await response.body?.cancel().catch(() => undefined)
        throw new AccountCallError('expired', 401)
      }
      if (response.status === 403 || response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => undefined)
        throw new AccountCallError('refused', response.status)
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined)
        throw new AccountCallError('server', response.status)
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw new AccountCallError('tooBig', response.status)
      }
      const bytes = await readCapped(response, maxBytes).catch(failed)
      return {
        status: response.status,
        headers: response.headers,
        text: bytes.toString('utf8'),
        bytes
      }
    }
  } catch (error) {
    return failed(error)
  } finally {
    clearTimeout(timer)
  }
}

/** A request whose answer is JSON; an answer that isn't is a `server` failure. */
export async function accountJson<T = Record<string, unknown>>(
  url: string,
  request: AccountRequest
): Promise<T> {
  const response = await accountRequest(url, {
    ...request,
    headers: { Accept: 'application/json', ...request.headers }
  })
  if (!response.text) return {} as T
  try {
    return JSON.parse(response.text) as T
  } catch {
    throw new AccountCallError('server', response.status)
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new AccountCallError('tooBig')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, bytes)
}
