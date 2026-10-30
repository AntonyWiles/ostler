/**
 * Signing in to an OAuth provider through the system browser (overview,
 * "Connected accounts"): never an embedded window, which Google blocks.
 *
 * It listens on 127.0.0.1 on a port the system picks, opens the provider's
 * sign-in page in the default browser with PKCE (S256) and a random state,
 * takes the one redirect back, and trades the code for tokens. No client
 * secret is relied on: a Google desktop registration has one, but it is not
 * secret, and the others have none. The listener answers only its callback
 * path, closes after the first answer, and gives up after five minutes.
 *
 * Tokens are returned to the caller, which seals them; nothing here logs a
 * code, a token or the address.
 */
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { accountJson, AccountCallError, type AccountFetch } from './account-fetch'
import type { OAuthProvider } from './providers'

export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000
const CALLBACK_PATH = '/callback'

export type SignInFailure = 'cancelled' | 'denied' | 'timeout' | 'mismatch' | 'exchange'

export class SignInError extends Error {
  constructor(readonly reason: SignInFailure) {
    super(`Signing in failed: ${reason}`)
    this.name = 'SignInError'
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** When the access token stops working, ms. */
  expiresAt: number
  /** The scopes granted, space-separated, when the provider says. */
  scope: string | null
}

export interface OAuthClient {
  clientId: string
  clientSecret?: string | null
}

export interface SignInOptions {
  provider: OAuthProvider
  client: OAuthClient
  scopes: string[]
  /** Opens the address in the default browser (`shell.openExternal`). */
  openBrowser(url: string): Promise<void>
  fetch: AccountFetch
  userAgent: string
  /** The page the browser shows after the redirect, in the person's language. */
  page: { title: string; done: string; failed: string }
  timeoutMs?: number
  now?(): number
  /** Lets a caller stop waiting (the person closed the dialog). */
  signal?: AbortSignal
}

/** PKCE: a random verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Opens the browser, waits for the redirect, and returns the tokens. */
export async function signInWithBrowser(options: SignInOptions): Promise<OAuthTokens> {
  const { verifier, challenge } = pkcePair()
  const state = randomBytes(16).toString('base64url')
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new SignInError('timeout')),
        options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
      )
      const stop = (error: SignInError) => {
        clearTimeout(timer)
        reject(error)
      }
      options.signal?.addEventListener('abort', () => stop(new SignInError('cancelled')), {
        once: true
      })
      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', redirectUri)
        if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
          response.writeHead(404).end()
          return
        }
        const answer = (ok: boolean) => {
          response.writeHead(ok ? 200 : 400, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          })
          response.end(page(options.page.title, ok ? options.page.done : options.page.failed))
        }
        if (url.searchParams.get('state') !== state) {
          answer(false)
          return stop(new SignInError('mismatch'))
        }
        const error = url.searchParams.get('error')
        const received = url.searchParams.get('code')
        if (error || !received) {
          answer(false)
          return stop(new SignInError(error === 'access_denied' ? 'denied' : 'mismatch'))
        }
        answer(true)
        clearTimeout(timer)
        resolve(received)
      })
      const authorize = new URL(options.provider.authorizeUrl)
      const params: Record<string, string> = {
        client_id: options.client.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: options.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...options.provider.authorizeParams
      }
      for (const [key, value] of Object.entries(params)) authorize.searchParams.set(key, value)
      options.openBrowser(authorize.toString()).catch(() => stop(new SignInError('cancelled')))
    })

    return await tokenRequest(options, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  } finally {
    server.close()
    server.closeAllConnections?.()
  }
}

/** A new access token from a refresh token. A refused refresh means signing in again. */
export async function refreshAccessToken(
  options: Pick<SignInOptions, 'provider' | 'client' | 'fetch' | 'userAgent' | 'now'>,
  refreshToken: string,
  /** Another resource's scope (Microsoft): a token for that API, not the account's own. */
  scope?: string
): Promise<OAuthTokens> {
  const tokens = await tokenRequest(options, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...(scope ? { scope } : {})
  })
  // Most providers send the refresh token only once.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}

async function tokenRequest(
  options: Pick<SignInOptions, 'provider' | 'client' | 'fetch' | 'userAgent' | 'now'>,
  fields: Record<string, string>
): Promise<OAuthTokens> {
  const form = new URLSearchParams({ client_id: options.client.clientId, ...fields })
  if (options.client.clientSecret) form.set('client_secret', options.client.clientSecret)
  let answer: Record<string, unknown>
  try {
    answer = await accountJson(options.provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      hosts: [new URL(options.provider.tokenUrl).hostname],
      fetch: options.fetch,
      userAgent: options.userAgent
    })
  } catch (error) {
    // 400 invalid_grant: the refresh token was revoked or expired.
    if (error instanceof AccountCallError && error.status === 400) {
      throw new AccountCallError('expired', 400)
    }
    throw error
  }
  const accessToken = answer.access_token
  if (typeof accessToken !== 'string' || !accessToken) throw new SignInError('exchange')
  const expiresIn = typeof answer.expires_in === 'number' ? answer.expires_in : 3600
  return {
    accessToken,
    refreshToken: typeof answer.refresh_token === 'string' ? answer.refresh_token : null,
    // A minute early, so a call never starts with a token about to lapse.
    expiresAt: (options.now?.() ?? Date.now()) + Math.max(0, expiresIn - 60) * 1000,
    scope: typeof answer.scope === 'string' ? answer.scope : null
  }
}

function page(title: string, message: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font:15px system-ui,sans-serif;margin:4rem auto;max-width:28rem;color:#1f2328}</style>
</head><body><h1 style="font-size:1.2rem">${escape(title)}</h1><p>${escape(message)}</p></body></html>`
}
