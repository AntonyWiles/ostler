/**
 * Every connected account, in one place (docs/plans/integrations/overview.md,
 * "Connected accounts", phase 0). It signs in (`oauth-loopback.ts`) or checks a
 * CalDAV password (`dav.ts`), keeps the tokens or password sealed in
 * `connected_accounts`, refreshes access tokens, revokes on disconnect, and
 * makes every call through `account-fetch.ts`, so an account reaches only its
 * provider's hosts.
 *
 * Surfaces ask `accountsWith(capability)`, never "is Google connected?". The
 * renderer sees `ConnectedAccount`: no token, password or address beyond a
 * CalDAV server's host.
 */
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  AccountAppInput,
  AccountCapability,
  AccountFailure,
  AccountProvider,
  AccountProviderInfo,
  ConnectAccountInput,
  ConnectedAccount
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import {
  accountJson,
  accountRequest,
  AccountCallError,
  type AccountFetch,
  type AccountResponse
} from './account-fetch'
import { davHosts, normaliseDavServer, verifyDavAccount } from './dav'
import {
  refreshAccessToken,
  signInWithBrowser,
  SignInError,
  type OAuthClient,
  type OAuthTokens
} from './oauth-loopback'
import {
  ACCOUNT_PROVIDERS,
  capabilitiesOf,
  defaultCapabilities,
  isAccountProvider,
  PROVIDERS,
  scopesFor,
  type OAuthProvider
} from './providers'

export interface ConnectedAccountsDependencies {
  fetch: AccountFetch
  userAgent: string
  openBrowser(url: string): Promise<void>
  /** Encrypts a secret for the database; throws when Windows cannot (`encryptApiKey`). */
  seal(secret: string): string
  /** Opens a sealed secret; throws on another computer (`decryptApiKey`). */
  open(sealed: string): string
  /** App registrations your organisation's policy sets (phase 7); none by default. */
  policyApps?(): Partial<Record<AccountProvider, OAuthClient & { tenant?: string }>>
  /** Kinds of account your organisation's policy doesn't allow (phase 7). */
  forbiddenProviders?(): AccountProvider[]
  /** Called when an account is added, changes state or goes. */
  onChanged?(): void
  now?(): number
}

interface AccountRow {
  id: string
  provider: AccountProvider
  label: string
  server: string | null
  capabilities: string
  secret: string
  status: ConnectedAccount['status']
  failure: AccountFailure | null
  created_at: number
  updated_at: number
  last_used_at: number | null
}

type OAuthSecret = OAuthTokens & { kind: 'oauth' }
interface PasswordSecret {
  kind: 'password'
  username: string
  password: string
}
type AccountSecret = OAuthSecret | PasswordSecret

/** A call an account makes on behalf of a surface. */
export interface AccountCall {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  timeoutMs?: number
  maxBytes?: number
}

export class ConnectedAccountsService {
  private readonly db: Database.Database
  /** One refresh per account at a time. */
  private readonly refreshing = new Map<string, Promise<string>>()
  /** Tokens for other APIs (`accessTokenFor`), by account and scope; never stored. */
  private readonly otherTokens = new Map<string, { token: string; expiresAt: number }>()

  constructor(
    dbPath: string,
    private readonly deps: ConnectedAccountsDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
  }

  close(): void {
    this.db.close()
  }

  /** The providers Settings offers, and whether each can sign in yet. */
  providers(): AccountProviderInfo[] {
    const forbidden = this.forbidden()
    return ACCOUNT_PROVIDERS.filter((provider) => !forbidden.includes(provider)).map((provider) => {
      const definition = PROVIDERS[provider]
      if (definition.method === 'password') {
        return {
          provider,
          method: 'password',
          capabilities: capabilitiesOf(provider),
          ready: true,
          registration: null
        }
      }
      const app = this.appFor(definition)
      return {
        provider,
        method: 'oauth',
        capabilities: capabilitiesOf(provider),
        ready: app !== null,
        registration: app?.source ?? null
      }
    })
  }

  /** Saves your own app registration for a provider Ostler has none for. */
  setApp(input: AccountAppInput): AccountProviderInfo[] {
    if (!isAccountProvider(input?.provider) || PROVIDERS[input.provider].method !== 'oauth') {
      throw new Refusal(t('errors:accounts.unknownProvider'))
    }
    const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : ''
    if (!clientId || clientId.length > 512 || /\s/.test(clientId)) {
      throw new Refusal(t('errors:accounts.badClientId'))
    }
    const clientSecret =
      typeof input.clientSecret === 'string' && input.clientSecret.trim()
        ? this.sealOrRefuse(input.clientSecret.trim())
        : null
    this.db
      .prepare(
        `INSERT INTO account_apps (provider, client_id, client_secret, updated_at)
         VALUES (@provider, @clientId, @clientSecret, @now)
         ON CONFLICT(provider) DO UPDATE SET client_id = excluded.client_id,
           client_secret = excluded.client_secret, updated_at = excluded.updated_at`
      )
      .run({ provider: input.provider, clientId, clientSecret, now: this.now() })
    return this.providers()
  }

  removeApp(provider: AccountProvider): AccountProviderInfo[] {
    this.db.prepare('DELETE FROM account_apps WHERE provider = @provider').run({ provider })
    return this.providers()
  }

  list(): ConnectedAccount[] {
    return (
      this.db
        .prepare('SELECT * FROM connected_accounts ORDER BY created_at, label')
        .all() as AccountRow[]
    ).map(shown)
  }

  get(id: string): ConnectedAccount {
    return shown(this.require(id))
  }

  /** The connected accounts that give a capability. */
  accountsWith(capability: AccountCapability): ConnectedAccount[] {
    return this.list().filter(
      (account) => account.status !== 'failed' && account.capabilities.includes(capability)
    )
  }

  /**
   * Connects an account: OAuth opens the browser; CalDAV checks the server,
   * user name and app password. Signing in to the same account again updates
   * it instead of adding a second.
   */
  async connect(input: ConnectAccountInput): Promise<ConnectedAccount> {
    if (!isAccountProvider(input?.provider)) throw new Refusal(t('errors:accounts.unknownProvider'))
    if (this.forbidden().includes(input.provider)) {
      throw new Refusal(t('errors:accounts.forbiddenByPolicy'))
    }
    const offered = capabilitiesOf(input.provider)
    const wanted = (input.capabilities ?? defaultCapabilities(input.provider)).filter(
      (capability) => offered.includes(capability)
    )
    if (wanted.length === 0) throw new Refusal(t('errors:accounts.nothingToAsk'))
    const definition = PROVIDERS[input.provider]
    if (definition.method === 'password') return this.connectDav(input, wanted)
    return this.connectOAuth(definition, wanted, null)
  }

  /** Asks an account for more (writing back, tasks): signs in again with the union. */
  async addCapabilities(id: string, capabilities: AccountCapability[]): Promise<ConnectedAccount> {
    const row = this.require(id)
    const current = parseCapabilities(row.capabilities)
    const offered = capabilitiesOf(row.provider)
    const union = [...new Set([...current, ...capabilities])].filter((capability) =>
      offered.includes(capability)
    )
    if (union.length === current.length) return shown(row)
    const definition = PROVIDERS[row.provider]
    if (definition.method === 'password') {
      this.db
        .prepare('UPDATE connected_accounts SET capabilities = @capabilities WHERE id = @id')
        .run({ id, capabilities: JSON.stringify(union) })
      this.changed()
      return this.get(id)
    }
    return this.connectOAuth(definition, union, id)
  }

  /** Revokes what can be revoked, and forgets the account. */
  async disconnect(id: string): Promise<void> {
    const row = this.require(id)
    const definition = PROVIDERS[row.provider]
    if (definition.method === 'oauth' && definition.revokeUrl) {
      try {
        const secret = this.secretOf(row)
        if (secret.kind === 'oauth') await this.revoke(definition, secret)
      } catch {
        // Revoking is a courtesy: the account goes either way.
      }
    }
    this.db.prepare('DELETE FROM connected_accounts WHERE id = @id').run({ id })
    this.changed()
  }

  /**
   * A call on behalf of an account, to its provider's hosts only. An expired
   * token is refreshed once; a refused refresh marks the account
   * `needs-reconnect` and the call fails with `expired`.
   */
  async call(id: string, url: string, call: AccountCall = {}): Promise<AccountResponse> {
    const row = this.require(id)
    if (row.status === 'needs-reconnect') throw new AccountCallError('expired')
    const hosts = this.hostsOf(row)
    const send = async (authorization: string) =>
      accountRequest(url, {
        ...call,
        headers: { ...call.headers, Authorization: authorization },
        hosts,
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent
      })
    try {
      let response: AccountResponse
      try {
        response = await send(await this.authorization(row, false))
      } catch (error) {
        if (!(error instanceof AccountCallError) || error.reason !== 'expired') throw error
        if (PROVIDERS[row.provider].method !== 'oauth') throw error
        response = await send(await this.authorization(this.require(id), true))
      }
      this.used(id)
      return response
    } catch (error) {
      if (error instanceof AccountCallError) this.recordFailure(id, error.reason)
      throw error
    }
  }

  /** A call whose answer is JSON. */
  async callJson<T = Record<string, unknown>>(
    id: string,
    url: string,
    call: AccountCall = {}
  ): Promise<T> {
    const response = await this.call(id, url, {
      ...call,
      headers: { Accept: 'application/json', ...call.headers }
    })
    if (!response.text) return {} as T
    try {
      return JSON.parse(response.text) as T
    } catch {
      throw new AccountCallError('server', response.status)
    }
  }

  /** A call whose answer is bytes, exactly as they came (a Drive file, say). */
  async callBytes(id: string, url: string, call: AccountCall = {}): Promise<Buffer> {
    return (await this.call(id, url, call)).bytes
  }

  /** A CalDAV account's server address (the full one, main only). */
  serverOf(id: string): string | null {
    return this.require(id).server
  }

  // ─── Signing in ───────────────────────────────────────────────────────

  private async connectOAuth(
    provider: OAuthProvider,
    capabilities: AccountCapability[],
    existingId: string | null
  ): Promise<ConnectedAccount> {
    const app = this.appFor(provider)
    if (!app) throw new Refusal(t('errors:accounts.needsApp'))
    let tokens: OAuthTokens
    try {
      tokens = await signInWithBrowser({
        provider: app.provider,
        client: app.client,
        scopes: scopesFor(provider, capabilities),
        openBrowser: this.deps.openBrowser,
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent,
        now: this.deps.now,
        page: {
          title: t('settings:accounts.browserTitle'),
          done: t('settings:accounts.browserDone'),
          failed: t('settings:accounts.browserFailed')
        }
      })
    } catch (error) {
      if (error instanceof SignInError) {
        throw new Refusal(t(`errors:accounts.signIn.${error.reason}`))
      }
      if (error instanceof AccountCallError) {
        throw new Refusal(t(`errors:accounts.failure.${error.reason}`))
      }
      throw error
    }
    const label = await this.profileLabel(provider, tokens.accessToken)
    const secret = this.sealOrRefuse(JSON.stringify({ kind: 'oauth', ...tokens }))
    const now = this.now()
    const sameAccount =
      existingId ??
      (
        this.db
          .prepare(
            'SELECT id FROM connected_accounts WHERE provider = @provider AND lower(label) = lower(@label)'
          )
          .get({ provider: provider.provider, label }) as { id: string } | undefined
      )?.id
    if (sameAccount) {
      const current = parseCapabilities(this.require(sameAccount).capabilities)
      const merged = existingId ? capabilities : [...new Set([...current, ...capabilities])]
      this.db
        .prepare(
          `UPDATE connected_accounts SET label = @label, capabilities = @capabilities, secret = @secret,
             status = 'connected', failure = NULL, updated_at = @now, last_used_at = @now
           WHERE id = @id`
        )
        .run({ id: sameAccount, label, capabilities: JSON.stringify(merged), secret, now })
      this.changed()
      return this.get(sameAccount)
    }
    const id = uuidv4()
    this.db
      .prepare(
        `INSERT INTO connected_accounts (id, provider, label, server, capabilities, secret, status,
           created_at, updated_at, last_used_at)
         VALUES (@id, @provider, @label, NULL, @capabilities, @secret, 'connected', @now, @now, @now)`
      )
      .run({
        id,
        provider: provider.provider,
        label,
        capabilities: JSON.stringify(capabilities),
        secret,
        now
      })
    this.changed()
    return this.get(id)
  }

  private async connectDav(
    input: ConnectAccountInput,
    capabilities: AccountCapability[]
  ): Promise<ConnectedAccount> {
    const server = normaliseDavServer(input.server)
    const username = typeof input.username === 'string' ? input.username.trim() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!username || !password) throw new Refusal(t('errors:accounts.needsPassword'))
    const secret = this.sealOrRefuse(JSON.stringify({ kind: 'password', username, password }))
    try {
      await verifyDavAccount(server, {
        authorization: basic(username, password),
        hosts: davHosts(server),
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent
      })
    } catch (error) {
      if (error instanceof AccountCallError) {
        throw new Refusal(
          t(
            error.reason === 'expired'
              ? 'errors:accounts.wrongPassword'
              : `errors:accounts.failure.${error.reason}`
          )
        )
      }
      throw error
    }
    const now = this.now()
    const existing = this.db
      .prepare(
        `SELECT id FROM connected_accounts WHERE provider = 'caldav' AND server = @server
           AND lower(label) = lower(@username)`
      )
      .get({ server, username }) as { id: string } | undefined
    const id = existing?.id ?? uuidv4()
    this.db
      .prepare(
        `INSERT INTO connected_accounts (id, provider, label, server, capabilities, secret, status,
           created_at, updated_at, last_used_at)
         VALUES (@id, 'caldav', @username, @server, @capabilities, @secret, 'connected', @now, @now, @now)
         ON CONFLICT(id) DO UPDATE SET capabilities = excluded.capabilities, secret = excluded.secret,
           status = 'connected', failure = NULL, updated_at = excluded.updated_at`
      )
      .run({ id, username, server, capabilities: JSON.stringify(capabilities), secret, now })
    this.changed()
    return this.get(id)
  }

  private async profileLabel(provider: OAuthProvider, accessToken: string): Promise<string> {
    try {
      const profile = await accountJson(provider.profileUrl, {
        method: provider.provider === 'dropbox' ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        hosts: provider.hosts,
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent
      })
      return provider.profileLabel(profile)?.slice(0, 320) ?? t('settings:accounts.unnamed')
    } catch {
      return t('settings:accounts.unnamed')
    }
  }

  private async revoke(provider: OAuthProvider, secret: OAuthSecret): Promise<void> {
    if (!provider.revokeUrl) return
    const token = secret.refreshToken ?? secret.accessToken
    if (provider.provider === 'dropbox') {
      await accountRequest(provider.revokeUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret.accessToken}` },
        hosts: provider.hosts,
        fetch: this.deps.fetch,
        userAgent: this.deps.userAgent
      })
      return
    }
    await accountRequest(provider.revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      hosts: provider.hosts,
      fetch: this.deps.fetch,
      userAgent: this.deps.userAgent
    })
  }

  /**
   * A token for another API the organisation runs, such as its sync server
   * (phase 7): Microsoft hands one out for a work account's refresh token and
   * the API's scope. Kept in memory until it lapses; never stored or logged.
   */
  async accessTokenFor(id: string, scope: string): Promise<string> {
    const row = this.require(id)
    if (row.provider !== 'microsoft') throw new AccountCallError('refused')
    const key = `${id} ${scope}`
    const held = this.otherTokens.get(key)
    if (held && held.expiresAt > this.now()) return held.token
    const secret = this.secretOf(row)
    const definition = PROVIDERS.microsoft as OAuthProvider
    const app = this.appFor(definition)
    if (secret.kind !== 'oauth' || !secret.refreshToken || !app) {
      throw new AccountCallError('expired')
    }
    let tokens: OAuthTokens
    try {
      tokens = await refreshAccessToken(
        {
          provider: app.provider,
          client: app.client,
          fetch: this.deps.fetch,
          userAgent: this.deps.userAgent,
          now: this.deps.now
        },
        secret.refreshToken,
        scope
      )
    } catch (error) {
      if (error instanceof SignInError) throw new AccountCallError('expired')
      throw error
    }
    this.otherTokens.set(key, { token: tokens.accessToken, expiresAt: tokens.expiresAt })
    return tokens.accessToken
  }

  // ─── Tokens ───────────────────────────────────────────────────────────

  private async authorization(row: AccountRow, forceRefresh: boolean): Promise<string> {
    const secret = this.secretOf(row)
    if (secret.kind === 'password') return basic(secret.username, secret.password)
    if (!forceRefresh && secret.expiresAt > this.now()) return `Bearer ${secret.accessToken}`
    const waiting = this.refreshing.get(row.id)
    if (waiting) return `Bearer ${await waiting}`
    const run = this.refresh(row, secret).finally(() => this.refreshing.delete(row.id))
    this.refreshing.set(row.id, run)
    return `Bearer ${await run}`
  }

  private async refresh(row: AccountRow, secret: OAuthSecret): Promise<string> {
    const definition = PROVIDERS[row.provider] as OAuthProvider
    const app = this.appFor(definition)
    if (!secret.refreshToken || !app) {
      this.needsReconnect(row.id)
      throw new AccountCallError('expired')
    }
    let tokens: OAuthTokens
    try {
      tokens = await refreshAccessToken(
        {
          provider: app.provider,
          client: app.client,
          fetch: this.deps.fetch,
          userAgent: this.deps.userAgent,
          now: this.deps.now
        },
        secret.refreshToken
      )
    } catch (error) {
      if (
        (error instanceof AccountCallError && error.reason === 'expired') ||
        error instanceof SignInError
      ) {
        this.needsReconnect(row.id)
        throw new AccountCallError('expired')
      }
      throw error
    }
    this.db
      .prepare('UPDATE connected_accounts SET secret = @secret, updated_at = @now WHERE id = @id')
      .run({
        id: row.id,
        secret: this.deps.seal(JSON.stringify({ kind: 'oauth', ...tokens })),
        now: this.now()
      })
    return tokens.accessToken
  }

  private secretOf(row: AccountRow): AccountSecret {
    let parsed: unknown
    try {
      parsed = JSON.parse(this.deps.open(row.secret))
    } catch {
      // A backup restored on another computer cannot open it: connect again.
      this.recordFailure(row.id, 'pasteAgain')
      throw new AccountCallError('pasteAgain')
    }
    const secret = parsed as AccountSecret
    if (secret?.kind !== 'oauth' && secret?.kind !== 'password') {
      throw new AccountCallError('pasteAgain')
    }
    return secret
  }

  private hostsOf(row: AccountRow): string[] {
    const definition = PROVIDERS[row.provider]
    if (definition.method === 'oauth') return definition.hosts
    return row.server ? davHosts(row.server) : []
  }

  private forbidden(): AccountProvider[] {
    return this.deps.forbiddenProviders?.() ?? []
  }

  /**
   * The app an account signs in with, and the provider as that app sees it: an
   * organisation's Microsoft tenant signs in at its own endpoints, not `common`.
   */
  private appFor(provider: OAuthProvider): {
    client: OAuthClient
    source: 'built-in' | 'policy' | 'yours'
    provider: OAuthProvider
  } | null {
    const policy = this.deps.policyApps?.()[provider.provider]
    if (policy?.clientId) {
      const { tenant, ...client } = policy
      return { client, source: 'policy', provider: withTenant(provider, tenant) }
    }
    if (provider.builtInClientId) {
      return { client: { clientId: provider.builtInClientId }, source: 'built-in', provider }
    }
    const row = this.db
      .prepare('SELECT client_id, client_secret FROM account_apps WHERE provider = @provider')
      .get({ provider: provider.provider }) as
      { client_id: string; client_secret: string | null } | undefined
    if (!row) return null
    let clientSecret: string | null = null
    try {
      clientSecret = row.client_secret ? this.deps.open(row.client_secret) : null
    } catch {
      clientSecret = null
    }
    return { client: { clientId: row.client_id, clientSecret }, source: 'yours', provider }
  }

  // ─── State ────────────────────────────────────────────────────────────

  private used(id: string): void {
    const row = this.require(id)
    this.db
      .prepare(
        `UPDATE connected_accounts SET last_used_at = @now, status = 'connected', failure = NULL
         WHERE id = @id`
      )
      .run({ id, now: this.now() })
    if (row.status !== 'connected' || row.failure !== null) this.changed()
  }

  private recordFailure(id: string, reason: AccountFailure): void {
    if (reason === 'expired') return this.needsReconnect(id)
    const status = reason === 'pasteAgain' ? 'failed' : 'connected'
    const result = this.db
      .prepare(
        `UPDATE connected_accounts SET failure = @reason, status = CASE WHEN status = 'needs-reconnect'
           THEN status ELSE @status END
         WHERE id = @id AND (failure IS NOT @reason)`
      )
      .run({ id, reason, status })
    if (result.changes > 0) this.changed()
  }

  private needsReconnect(id: string): void {
    const result = this.db
      .prepare(
        `UPDATE connected_accounts SET status = 'needs-reconnect', failure = 'expired'
         WHERE id = @id AND status != 'needs-reconnect'`
      )
      .run({ id })
    if (result.changes > 0) this.changed()
  }

  private require(id: string): AccountRow {
    if (typeof id !== 'string' || !id) throw new Refusal(t('errors:accounts.notFound'))
    const row = this.db.prepare('SELECT * FROM connected_accounts WHERE id = @id').get({ id }) as
      AccountRow | undefined
    if (!row) throw new Refusal(t('errors:accounts.notFound'))
    return row
  }

  private sealOrRefuse(secret: string): string {
    try {
      return this.deps.seal(secret)
    } catch {
      throw new Refusal(t('errors:accounts.failure.cannotEncrypt'))
    }
  }

  private changed(): void {
    this.deps.onChanged?.()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}

function shown(row: AccountRow): ConnectedAccount {
  let server: string | null = null
  if (row.server) {
    try {
      server = new URL(row.server).host
    } catch {
      server = null
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    server,
    capabilities: parseCapabilities(row.capabilities),
    status: row.status,
    failure: row.failure,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }
}

function parseCapabilities(text: string): AccountCapability[] {
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed)
      ? (parsed.filter((value) => typeof value === 'string') as AccountCapability[])
      : []
  } catch {
    return []
  }
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

/** Microsoft's `common` endpoints made the organisation's tenant's own. */
function withTenant(provider: OAuthProvider, tenant: string | undefined): OAuthProvider {
  if (!tenant || provider.provider !== 'microsoft') return provider
  const own = (url: string) => url.replace('/common/', `/${encodeURIComponent(tenant)}/`)
  return { ...provider, authorizeUrl: own(provider.authorizeUrl), tokenUrl: own(provider.tokenUrl) }
}
