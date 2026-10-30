/**
 * The server transport (docs/plans/integrations/overview.md, phase 7): the
 * same write-once files as a shared folder, kept in a space on the
 * organisation's sync server (`server/sync-server/`). The server only stores
 * files it can't read: everything in them is sealed with the project key,
 * which the server never sees.
 *
 * A space is `https://server/spaces/<id>`; under it:
 *   GET  files?prefix=<folder>  → `{ "files": ["changes/…", …] }`
 *   GET  files/<path>           → the file
 *   PUT  files/<path>           with `If-None-Match: *`; 412 when it exists
 *   GET  version                → `{ "version": "…" }`, changing with every write
 * Every call carries the PC's sign-in as a bearer token, goes only to the
 * space's own origin and never follows a redirect.
 */
import { isHiddenOrTemp, segmentsOf, SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'

export interface HttpTransportOptions {
  fetch(url: string, init: RequestInit): Promise<Response>
  /** `Bearer …` for the server; asked before every call, so it can be renewed. */
  authorization(): Promise<string>
  /** How often `version` is asked when watching; default 15 000 ms. */
  pollMs?: number
  timeoutMs?: number
}

/** The server said no, or couldn't be reached: the share shows "can't reach". */
export class SyncServerError extends Error {
  constructor(
    readonly reason: 'signIn' | 'refused' | 'unreachable' | 'bad-answer',
    readonly status: number | null = null
  ) {
    super(`Sync server: ${reason}${status ? ` (${status})` : ''}`)
    this.name = 'SyncServerError'
  }
}

const DEFAULT_POLL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 30_000
/** No sync file is near this; a bigger answer is not one. */
const MAX_FILE_BYTES = 64 * 1024 * 1024

export class HttpTransport implements SyncTransport {
  private readonly base: string
  private readonly origin: string

  constructor(
    space: string,
    private readonly options: HttpTransportOptions
  ) {
    const url = new URL(space)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new SyncServerError('refused')
    }
    this.origin = url.origin
    this.base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  }

  async list(prefix: string): Promise<string[]> {
    if (prefix !== '') segmentsOf(prefix, false)
    const answer = await this.call(`files?prefix=${encodeURIComponent(prefix)}`, {})
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(await answer.arrayBuffer()).toString('utf8'))
    } catch {
      throw new SyncServerError('bad-answer')
    }
    const files = (parsed as { files?: unknown })?.files
    if (!Array.isArray(files)) throw new SyncServerError('bad-answer')
    const inside = prefix === '' ? '' : `${prefix}/`
    return files
      .filter(
        (file): file is string =>
          typeof file === 'string' &&
          file.startsWith(inside) &&
          fits(file) &&
          !isHiddenOrTemp(file.split('/').pop() ?? '')
      )
      .sort()
  }

  async read(path: string): Promise<Buffer> {
    const answer = await this.call(`files/${encoded(path)}`, {})
    const bytes = Buffer.from(await answer.arrayBuffer())
    if (bytes.length > MAX_FILE_BYTES) throw new SyncServerError('bad-answer')
    return bytes
  }

  async writeOnce(path: string, bytes: Buffer): Promise<void> {
    if (isHiddenOrTemp(path.split('/').pop() ?? '')) throw new SyncTransportError('bad-path')
    await this.call(
      `files/${encoded(path)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' },
        body: new Uint8Array(bytes)
      },
      true
    )
  }

  watch(onChange: () => void): () => void {
    let stopped = false
    let last: string | null = null
    let busy = false
    const ask = async (): Promise<void> => {
      if (stopped || busy) return
      busy = true
      try {
        const answer = await this.call('version', {})
        const version = String(
          ((await answer.json()) as { version?: unknown } | null)?.version ?? ''
        )
        if (last !== null && version !== last && !stopped) onChange()
        last = version
      } catch {
        // Unreachable for now; the share's own timer still pulls and says so.
      } finally {
        busy = false
      }
    }
    void ask()
    const timer = setInterval(() => void ask(), this.options.pollMs ?? DEFAULT_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  private async call(path: string, init: RequestInit, writing = false): Promise<Response> {
    const url = `${this.base}/${path}`
    if (new URL(url).origin !== this.origin) throw new SyncServerError('refused')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.options.fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: await this.options.authorization()
        },
        redirect: 'error',
        signal: controller.signal
      })
    } catch (error) {
      if (error instanceof SyncServerError) throw error
      throw new SyncServerError('unreachable')
    } finally {
      clearTimeout(timer)
    }
    if (writing && response.status === 412) throw new SyncTransportError('exists')
    if (response.status === 401) throw new SyncServerError('signIn', 401)
    if (response.status === 403) throw new SyncServerError('refused', 403)
    if (!response.ok) throw new SyncServerError('unreachable', response.status)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_FILE_BYTES) throw new SyncServerError('bad-answer')
    return response
  }
}

function fits(path: string): boolean {
  try {
    segmentsOf(path, false)
    return true
  } catch {
    return false
  }
}

/** A checked relative path, each segment escaped. */
function encoded(path: string): string {
  return segmentsOf(path, false).map(encodeURIComponent).join('/')
}
