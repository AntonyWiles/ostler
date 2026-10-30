import { afterEach } from 'vitest'
import type { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { startOnFreePort } from './http-port'

interface Closable {
  close(): void
}

/** What a `/automation/:projectId` route answers, with the HTTP status beside it. */
export interface RouteAnswer<T> {
  status: number
  ok: boolean
  value: T
  error?: string
}

export interface RequestOptions {
  body?: unknown
  /** Sent as `Authorization: Bearer <token>`; no header when empty. */
  token?: string
  headers?: Record<string, string>
}

export interface AutomationServerFixture {
  /** The port the test's server listens on, once `start` has run. */
  readonly port: number
  /**
   * Starts the server on a free port. After the test it is stopped, then
   * each of `closeAfter` is closed in order (the services the server used).
   */
  start(server: AutomationHttpServer, ...closeAfter: (Closable | undefined)[]): Promise<number>
  /** A request to `urlPath` on the server, with a JSON body when one is given. */
  request(method: string, urlPath: string, options?: RequestOptions): Promise<Response>
  /** A request to `/automation/<projectId><route>`, its JSON envelope unwrapped. */
  route<T = unknown>(
    projectId: string,
    token: string | undefined,
    method: string,
    route: string,
    body?: unknown
  ): Promise<RouteAnswer<T>>
}

/**
 * The automation HTTP server every automation route test starts: one per
 * test, on a free port, stopped and its services closed after the test.
 *
 * Call it in the describe block after `useTempDir` (so the folder is removed
 * after the services in it are closed), then build the server in a
 * `beforeEach` and hand it to `start`.
 */
export function useAutomationServer(): AutomationServerFixture {
  let port = 0
  let running: AutomationHttpServer | null = null
  let closables: (Closable | undefined)[] = []

  afterEach(() => {
    running?.stop()
    for (const closable of closables) closable?.close()
    running = null
    closables = []
  })

  function request(method: string, urlPath: string, options: RequestOptions = {}) {
    const { body, token, headers = {} } = options
    return fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  return {
    get port() {
      return port
    },
    async start(server, ...closeAfter) {
      running = server
      closables = closeAfter
      port = await startOnFreePort((free) => server.start(free))
      return port
    },
    request,
    async route<T = unknown>(
      projectId: string,
      token: string | undefined,
      method: string,
      route: string,
      body?: unknown
    ) {
      const response = await request(method, `/automation/${projectId}${route}`, { body, token })
      const json = (await response.json()) as { ok: boolean; value: T; error?: string }
      return { status: response.status, ...json }
    }
  }
}

/** A response's JSON body, typed as the test expects it. */
export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}
