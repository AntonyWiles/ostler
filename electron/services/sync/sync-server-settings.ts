/**
 * The sync server this PC shares projects through (docs/plans/integrations/overview.md,
 * phase 7), and how it signs in there: an access key the server's owner gave
 * out, sealed with Windows' protection, or a Microsoft work account connected
 * in Settings › Connections. An organisation's policy can set the address,
 * the way of signing in and the scope; the key or the account stays the
 * person's own. The key is never logged or sent to the renderer, and a
 * sign-in only ever goes to the server's own address.
 */
import Database from 'better-sqlite3'
import type { PolicySyncServer, SetSyncServerInput, SyncServerState } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { HttpTransport, SyncServerError } from './http-transport'

export interface SyncServerSettingsDependencies {
  seal(secret: string): string
  open(sealed: string): string
  /** The organisation's server, when its policy sets one. */
  policy(): PolicySyncServer | null
  /** A token for the server from a connected Microsoft account. */
  accessTokenFor(accountId: string, scope: string): Promise<string>
  /** The account is a connected Microsoft one. */
  isMicrosoftAccount(accountId: string): boolean
  fetch(url: string, init: RequestInit): Promise<Response>
  now?(): number
}

interface Row {
  url: string | null
  sign_in: 'key' | 'microsoft'
  access_key: string | null
  account_id: string | null
  scope: string | null
}

export class SyncServerSettings {
  private readonly db: Database.Database

  constructor(
    dbPath: string,
    private readonly deps: SyncServerSettingsDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
  }

  close(): void {
    this.db.close()
  }

  state(): SyncServerState {
    const row = this.row()
    const policy = this.deps.policy()
    const url = policy?.url ?? row?.url ?? null
    const signIn = policy?.signIn ?? row?.sign_in ?? 'key'
    const scope = policy?.scope ?? row?.scope ?? null
    const accountId = row?.account_id ?? null
    const hasKey = Boolean(row?.access_key)
    const ready =
      url !== null &&
      (signIn === 'key'
        ? hasKey
        : Boolean(scope && accountId && this.deps.isMicrosoftAccount(accountId)))
    return { url, signIn, scope, accountId, hasKey, managed: policy !== null, ready }
  }

  set(input: SetSyncServerInput): SyncServerState {
    if (!input || typeof input !== 'object') throw new Refusal(t('errors:syncServer.badAddress'))
    const policy = this.deps.policy()
    const url = policy?.url ?? serverUrl(input.url)
    const signIn = policy?.signIn ?? (input.signIn === 'microsoft' ? 'microsoft' : 'key')
    const scope = policy?.scope ?? (typeof input.scope === 'string' ? input.scope.trim() : '')
    const before = this.row()
    // A key for one server is never sent to another: a new address needs its key.
    let accessKey = before?.url && before.url !== url ? null : (before?.access_key ?? null)
    let accountId: string | null = null
    if (signIn === 'key') {
      if (typeof input.key === 'string' && input.key.trim()) {
        const key = input.key.trim()
        if (key.length > 4096 || /\s/.test(key)) throw new Refusal(t('errors:syncServer.badKey'))
        try {
          accessKey = this.deps.seal(key)
        } catch {
          throw new Refusal(t('errors:syncServer.cannotSeal'))
        }
      }
      if (!accessKey) throw new Refusal(t('errors:syncServer.needsKey'))
    } else {
      if (!scope || scope.length > 500) throw new Refusal(t('errors:syncServer.needsScope'))
      if (typeof input.accountId !== 'string' || !this.deps.isMicrosoftAccount(input.accountId)) {
        throw new Refusal(t('errors:syncServer.needsAccount'))
      }
      accountId = input.accountId
      accessKey = null
    }
    this.db
      .prepare(
        `INSERT INTO sync_server (id, url, sign_in, access_key, account_id, scope, updated_at)
         VALUES (1, @url, @signIn, @accessKey, @accountId, @scope, @now)
         ON CONFLICT(id) DO UPDATE SET url = @url, sign_in = @signIn, access_key = @accessKey,
           account_id = @accountId, scope = @scope, updated_at = @now`
      )
      .run({
        url: policy ? null : url,
        signIn,
        accessKey,
        accountId,
        scope: policy ? null : scope || null,
        now: this.now()
      })
    return this.state()
  }

  clear(): SyncServerState {
    this.db.prepare('DELETE FROM sync_server').run()
    return this.state()
  }

  /** `https://server/spaces/<id>`: a new space for a project shared now. */
  newSpace(id: string): string {
    const { url, ready } = this.state()
    if (!url || !ready) throw new Refusal(t('errors:syncServer.notReady'))
    return `${url}/spaces/${id}`
  }

  /**
   * The transport for a space. A space on any other server is refused, so an
   * invite can't send this PC's sign-in somewhere else.
   */
  open(location: string): HttpTransport {
    const { url, ready } = this.state()
    if (!url || !ready || !insideServer(url, location)) {
      throw new SyncServerError('signIn')
    }
    return new HttpTransport(location, {
      fetch: this.deps.fetch,
      authorization: () => this.authorization()
    })
  }

  /** Whether a space is on this PC's server and it is ready. */
  canOpen(location: string): boolean {
    const { url, ready } = this.state()
    return Boolean(url && ready && insideServer(url, location))
  }

  private async authorization(): Promise<string> {
    const row = this.row()
    const state = this.state()
    if (state.signIn === 'microsoft') {
      if (!state.accountId || !state.scope) throw new SyncServerError('signIn')
      return `Bearer ${await this.deps.accessTokenFor(state.accountId, state.scope)}`
    }
    if (!row?.access_key) throw new SyncServerError('signIn')
    try {
      return `Bearer ${this.deps.open(row.access_key)}`
    } catch {
      throw new SyncServerError('signIn')
    }
  }

  private row(): Row | undefined {
    return this.db
      .prepare('SELECT url, sign_in, access_key, account_id, scope FROM sync_server WHERE id = 1')
      .get() as Row | undefined
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

/** A server address: https, or http on this computer; no user, query or fragment. */
export function serverUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) {
    throw new Refusal(t('errors:syncServer.badAddress'))
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Refusal(t('errors:syncServer.badAddress'))
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Refusal(t('errors:syncServer.badAddress'))
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function insideServer(server: string, location: string): boolean {
  try {
    const space = new URL(location)
    const base = new URL(server)
    if (space.origin !== base.origin) return false
    const prefix = `${base.pathname.replace(/\/+$/, '')}/spaces/`
    return (
      space.pathname.startsWith(prefix) && /^[\w-]{8,64}$/.test(space.pathname.slice(prefix.length))
    )
  } catch {
    return false
  }
}
