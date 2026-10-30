import type { DriveRequest, DriveResponse } from '../../../electron/services/sync/drive-client'

/** The only host Ostler talks to for Drive; the desktop allows the same (accounts/providers.ts). */
export const DRIVE_HOST = 'www.googleapis.com'

/** Thrown when Google refuses the token; the person has to sign in again. */
export class SignInRequiredError extends Error {
  constructor() {
    super('Google asked for a new sign-in')
    this.name = 'SignInRequiredError'
  }
}

export interface DriveRequestDeps {
  /** A fresh access token, or null when nobody is signed in. */
  accessToken(): Promise<string | null>
  /** Drops a token Google refused, so the next `accessToken()` fetches a new one. */
  discardToken(token: string): Promise<void>
  fetch: typeof fetch
}

function assertHost(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Refusing a request to an address that is not a URL')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== DRIVE_HOST) {
    throw new Error(`Refusing a request to ${parsed.hostname}: only ${DRIVE_HOST} is allowed`)
  }
}

/**
 * Builds the `request` function `GoogleDriveClient` needs, on `fetch`. A 401 gets one retry with a
 * new token; a second 401 means the person must sign in again. The token goes only in the
 * `Authorization` header and is never logged.
 */
export function createDriveRequest(deps: DriveRequestDeps) {
  async function send(init: DriveRequest, token: string): Promise<DriveResponse> {
    const response = await deps.fetch(init.url, {
      method: init.method,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      body: init.body as BodyInit | undefined
    })
    return {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer())
    }
  }

  return async function request(init: DriveRequest): Promise<DriveResponse> {
    assertHost(init.url)
    const token = await deps.accessToken()
    if (!token) throw new SignInRequiredError()
    const first = await send(init, token)
    if (first.status !== 401) return first
    await deps.discardToken(token)
    const fresh = await deps.accessToken()
    if (!fresh) throw new SignInRequiredError()
    const second = await send(init, fresh)
    if (second.status === 401) throw new SignInRequiredError()
    return second
  }
}
