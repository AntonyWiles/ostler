import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountRequest,
  AccountCallError,
  isAllowedUrl,
  type AccountFetch
} from '../../electron/services/accounts/account-fetch'
import { ConnectedAccountsService } from '../../electron/services/accounts/connected-accounts-service'
import { parseXml, findAll, textOf } from '../../electron/services/accounts/dav-xml'
import { pkcePair, signInWithBrowser } from '../../electron/services/accounts/oauth-loopback'
import {
  capabilitiesOf,
  defaultCapabilities,
  PROVIDERS,
  type OAuthProvider
} from '../../electron/services/accounts/providers'
import { createMigratedDatabase } from '../helpers/database'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** A fetch that answers by URL prefix and records every call. */
function fakeFetch(routes: [string, Handler][]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch: AccountFetch = async (url, init) => {
    calls.push({ url, init })
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (!route) return new Response('not found', { status: 404 })
    return route[1](url, init)
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Plays the browser: follows the sign-in address straight to the redirect with a code. */
const browserThatSignsIn = (code = 'the-code') =>
  vi.fn(async (address: string) => {
    const url = new URL(address)
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', url.searchParams.get('state')!)
    await globalThis.fetch(redirect.toString())
  })

const PAGE = { title: 'Ostler', done: 'Done', failed: 'Failed' }

describe('account fetch', () => {
  it('allows only https to the declared hosts', () => {
    expect(isAllowedUrl('https://graph.microsoft.com/v1.0/me', ['graph.microsoft.com'])).toBe(true)
    expect(isAllowedUrl('http://graph.microsoft.com/', ['graph.microsoft.com'])).toBe(false)
    expect(isAllowedUrl('https://evil.example/', ['graph.microsoft.com'])).toBe(false)
    expect(isAllowedUrl('https://u:p@graph.microsoft.com/', ['graph.microsoft.com'])).toBe(false)
    expect(isAllowedUrl('https://p42-caldav.icloud.com/x', ['.icloud.com'])).toBe(true)
    expect(isAllowedUrl('https://icloud.com.evil.example/', ['.icloud.com'])).toBe(false)
  })

  it('refuses a redirect to another host and reads 401 as expired', async () => {
    const { fetch } = fakeFetch([
      [
        'https://a.example/redirect',
        () => new Response(null, { status: 302, headers: { Location: 'https://b.example/' } })
      ],
      ['https://a.example/private', () => new Response('', { status: 401 })]
    ])
    const request = { hosts: ['a.example'], fetch, userAgent: 'Ostler' }
    await expect(accountRequest('https://a.example/redirect', request)).rejects.toMatchObject({
      reason: 'refused'
    })
    await expect(accountRequest('https://a.example/private', request)).rejects.toMatchObject({
      reason: 'expired',
      status: 401
    })
  })

  it('sends a binary body byte for byte and gives back the exact bytes', async () => {
    const sent = new Uint8Array([0, 1, 2, 0xfe, 0xff, 0x1f, 0x8b])
    const back = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xc3, 0x28])
    const { fetch, calls } = fakeFetch([['https://a.example/upload', () => new Response(back)]])
    const response = await accountRequest('https://a.example/upload', {
      method: 'POST',
      body: sent,
      hosts: ['a.example'],
      fetch,
      userAgent: 'Ostler'
    })
    expect(new Uint8Array(await new Response(calls[0].init.body).arrayBuffer())).toEqual(sent)
    expect(Buffer.isBuffer(response.bytes)).toBe(true)
    expect([...response.bytes]).toEqual([...back])
    await expect(
      accountRequest('https://a.example/upload', {
        body: sent,
        hosts: ['a.example'],
        fetch,
        userAgent: 'Ostler',
        maxBytes: 4
      })
    ).rejects.toMatchObject({ reason: 'tooBig' })
  })
})

describe('signing in through the browser', () => {
  it('sends PKCE and state, takes the redirect, and trades the code', async () => {
    const provider = PROVIDERS.microsoft as OAuthProvider
    let verifier = ''
    const { fetch } = fakeFetch([
      [
        provider.tokenUrl,
        (_url, init) => {
          const form = new URLSearchParams(String(init.body))
          verifier = form.get('code_verifier') ?? ''
          expect(form.get('code')).toBe('the-code')
          expect(form.get('client_id')).toBe('client-1')
          return json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
        }
      ]
    ])
    const openBrowser = browserThatSignsIn()
    const tokens = await signInWithBrowser({
      provider,
      client: { clientId: 'client-1' },
      scopes: ['openid', 'Calendars.Read'],
      openBrowser,
      fetch,
      userAgent: 'Ostler',
      page: PAGE,
      now: () => 1_000_000
    })
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    expect(tokens.expiresAt).toBe(1_000_000 + 3540 * 1000)
    const opened = new URL(openBrowser.mock.calls[0][0])
    expect(opened.origin + opened.pathname).toBe(provider.authorizeUrl)
    expect(opened.searchParams.get('code_challenge_method')).toBe('S256')
    expect(opened.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      opened.searchParams.get('code_challenge')
    )
  })

  it('refuses a redirect whose state does not match', async () => {
    const provider = PROVIDERS.google as OAuthProvider
    const openBrowser = vi.fn(async (address: string) => {
      const url = new URL(address)
      const redirect = new URL(url.searchParams.get('redirect_uri')!)
      redirect.searchParams.set('code', 'x')
      redirect.searchParams.set('state', 'not-the-state')
      await globalThis.fetch(redirect.toString())
    })
    await expect(
      signInWithBrowser({
        provider,
        client: { clientId: 'c' },
        scopes: [],
        openBrowser,
        fetch: fakeFetch([]).fetch,
        userAgent: 'Ostler',
        page: PAGE
      })
    ).rejects.toMatchObject({ reason: 'mismatch' })
  })

  it('makes a verifier whose challenge is its SHA-256', async () => {
    const { verifier, challenge } = pkcePair()
    const { createHash } = await import('node:crypto')
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
  })
})

describe('connected accounts', () => {
  let tempDir: string
  let databasePath: string
  let now: number
  const services: ConnectedAccountsService[] = []

  const seal = (secret: string) => `sealed:${Buffer.from(secret).toString('base64')}`
  const open = (sealed: string) => {
    if (!sealed.startsWith('sealed:')) throw new Error('not sealed')
    return Buffer.from(sealed.slice(7), 'base64').toString('utf8')
  }

  const make = (fetch: AccountFetch, openBrowser = browserThatSignsIn()) => {
    const service = new ConnectedAccountsService(databasePath, {
      fetch,
      userAgent: 'Ostler',
      openBrowser,
      seal,
      open,
      now: () => now
    })
    services.push(service)
    return service
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-accounts-'))
    databasePath = await createMigratedDatabase(tempDir)
    now = 1_000_000
  })

  afterEach(() => {
    for (const service of services.splice(0)) service.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const microsoftRoutes = (tokens: Handler): [string, Handler][] => [
    [(PROVIDERS.microsoft as OAuthProvider).tokenUrl, tokens],
    ['https://graph.microsoft.com/v1.0/me?', () => json({ mail: 'ann@example.com' })],
    ['https://graph.microsoft.com/v1.0/me/events', () => json({ value: [] })]
  ]

  it('needs an app registration first, then signs in and keeps only sealed tokens', async () => {
    const { fetch } = fakeFetch(
      microsoftRoutes(() => json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }))
    )
    const service = make(fetch)
    expect(service.providers().find((p) => p.provider === 'microsoft')).toMatchObject({
      ready: false,
      registration: null
    })
    await expect(service.connect({ provider: 'microsoft' })).rejects.toThrow(/client ID|needsApp/)

    service.setApp({ provider: 'microsoft', clientId: 'my-client' })
    expect(service.providers().find((p) => p.provider === 'microsoft')).toMatchObject({
      ready: true,
      registration: 'yours'
    })
    const account = await service.connect({ provider: 'microsoft' })
    expect(account).toMatchObject({
      provider: 'microsoft',
      label: 'ann@example.com',
      capabilities: ['calendar.read', 'contacts.read', 'files.pick'],
      status: 'connected'
    })
    expect(JSON.stringify(service.list())).not.toContain('at-1')
    const db = new Database(databasePath)
    const stored = db.prepare('SELECT secret FROM connected_accounts').get() as { secret: string }
    db.close()
    expect(stored.secret.startsWith('sealed:')).toBe(true)
    expect(stored.secret).not.toContain('at-1')
    expect(service.accountsWith('calendar.read').map((a) => a.id)).toEqual([account.id])
    expect(service.accountsWith('tasks.sync')).toEqual([])
  })

  it('refreshes an expired token once, and asks to sign in again when the refresh is refused', async () => {
    let refreshes = 0
    const { fetch, calls } = fakeFetch(
      microsoftRoutes((_url, init) => {
        const form = new URLSearchParams(String(init.body))
        if (form.get('grant_type') === 'authorization_code') {
          return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
        }
        refreshes++
        return refreshes === 1
          ? json({ access_token: 'at-2', expires_in: 3600 })
          : json({ error: 'invalid_grant' }, 400)
      })
    )
    const service = make(fetch)
    service.setApp({ provider: 'microsoft', clientId: 'my-client' })
    const account = await service.connect({ provider: 'microsoft' })

    now += 2 * 3600 * 1000
    await service.call(account.id, 'https://graph.microsoft.com/v1.0/me/events')
    const last = calls[calls.length - 1]
    expect((last.init.headers as Record<string, string>).Authorization).toBe('Bearer at-2')

    now += 2 * 3600 * 1000
    await expect(
      service.call(account.id, 'https://graph.microsoft.com/v1.0/me/events')
    ).rejects.toMatchObject({ reason: 'expired' })
    expect(service.get(account.id).status).toBe('needs-reconnect')
    // Not to another host, whatever a caller asks.
    await expect(service.call(account.id, 'https://evil.example/')).rejects.toBeInstanceOf(
      AccountCallError
    )
  })

  it('gives back the bytes of a call, refusing other hosts and missing files', async () => {
    const file = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0xff, 0x80, 0x7f])
    const { fetch } = fakeFetch([
      ...microsoftRoutes(() =>
        json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
      ),
      ['https://graph.microsoft.com/v1.0/me/drive/items/change', () => new Response(file)]
    ])
    const service = make(fetch)
    service.setApp({ provider: 'microsoft', clientId: 'my-client' })
    const account = await service.connect({ provider: 'microsoft' })

    const bytes = await service.callBytes(
      account.id,
      'https://graph.microsoft.com/v1.0/me/drive/items/change'
    )
    expect([...bytes]).toEqual([...file])
    await expect(service.callBytes(account.id, 'https://evil.example/file')).rejects.toMatchObject({
      reason: 'refused'
    })
    const missing = service.callBytes(
      account.id,
      'https://graph.microsoft.com/v1.0/me/drive/items/gone'
    )
    await expect(missing).rejects.toBeInstanceOf(AccountCallError)
    await expect(missing).rejects.toMatchObject({ status: 404 })
  })

  it('offers sync through Drive for Google only, on the full Drive scope, never by default', () => {
    expect((PROVIDERS.google as OAuthProvider).scopes['sync.drive']).toEqual([
      'https://www.googleapis.com/auth/drive'
    ])
    expect((PROVIDERS.microsoft as OAuthProvider).scopes['sync.drive']).toBeUndefined()
    expect((PROVIDERS.dropbox as OAuthProvider).scopes['sync.drive']).toBeUndefined()
    expect(capabilitiesOf('google')).toContain('sync.drive')
    expect(defaultCapabilities('google')).not.toContain('sync.drive')
  })

  it('connects a CalDAV account after the server accepts the password', async () => {
    const principal = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href>
      <d:propstat><d:prop><d:current-user-principal><d:href>/principals/ann/</d:href></d:current-user-principal></d:prop></d:propstat>
      </d:response></d:multistatus>`
    const { fetch, calls } = fakeFetch([
      [
        'https://dav.example.com/',
        (_url, init) => {
          const auth = (init.headers as Record<string, string>).Authorization
          return auth === `Basic ${Buffer.from('ann:right').toString('base64')}`
            ? new Response(principal, { status: 207 })
            : new Response('', { status: 401 })
        }
      ]
    ])
    const service = make(fetch)
    await expect(
      service.connect({
        provider: 'caldav',
        server: 'dav.example.com',
        username: 'ann',
        password: 'wrong'
      })
    ).rejects.toThrow(/didn't accept|wrongPassword/)
    const account = await service.connect({
      provider: 'caldav',
      server: 'dav.example.com',
      username: 'ann',
      password: 'right'
    })
    expect(account).toMatchObject({
      provider: 'caldav',
      label: 'ann',
      server: 'dav.example.com',
      capabilities: ['calendar.read', 'contacts.read']
    })
    expect(calls.every((call) => call.url.startsWith('https://dav.example.com/'))).toBe(true)
    await service.disconnect(account.id)
    expect(service.list()).toEqual([])
  })
})

describe('the DAV XML reader', () => {
  it('reads prefixed elements, CDATA and entities', () => {
    const xml = parseXml(`<?xml version="1.0"?>
      <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:response><D:href>/cal/a.ics</D:href><D:propstat><D:prop>
          <D:getetag>"1"</D:getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR
END:VCALENDAR]]></C:calendar-data></D:prop></D:propstat></D:response>
        <D:response><D:href>/cal/b&amp;c.ics</D:href><D:propstat><D:prop>
          <C:calendar-data>BEGIN:VCALENDAR&#13;
SUMMARY:Tom &amp; Ann
END:VCALENDAR</C:calendar-data></D:prop></D:propstat></D:response>
      </D:multistatus>`)
    const responses = findAll(xml, 'response')
    expect(responses.map((r) => textOf(r, 'href'))).toEqual(['/cal/a.ics', '/cal/b&c.ics'])
    expect(textOf(responses[0], 'getetag')).toBe('"1"')
    expect(textOf(responses[1], 'calendar-data')).toContain('SUMMARY:Tom & Ann')
  })
})

describe("connected accounts under an organisation's policy (phase 7)", () => {
  let tempDir: string
  let databasePath: string

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-accounts-policy-'))
    databasePath = await createMigratedDatabase(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("signs in at the organisation's tenant, hides forbidden kinds, and gets its server a token", async () => {
    const tenantToken =
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token'
    const scopes: (string | null)[] = []
    const { fetch } = fakeFetch([
      [
        tenantToken,
        (_url, init) => {
          const form = new URLSearchParams(String(init.body))
          scopes.push(form.get('grant_type') === 'refresh_token' ? form.get('scope') : null)
          return form.get('grant_type') === 'authorization_code'
            ? json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
            : json({ access_token: 'server-token', expires_in: 3600 })
        }
      ],
      ['https://graph.microsoft.com/v1.0/me?', () => json({ mail: 'ann@contoso.com' })]
    ])
    const openBrowser = browserThatSignsIn()
    const service = new ConnectedAccountsService(databasePath, {
      fetch,
      userAgent: 'Ostler',
      openBrowser,
      seal: (secret) => `sealed:${secret}`,
      open: (sealed) => sealed.slice(7),
      policyApps: () => ({
        microsoft: { clientId: 'org-client', tenant: 'contoso.onmicrosoft.com' }
      }),
      forbiddenProviders: () => ['dropbox']
    })
    try {
      expect(service.providers().map((info) => info.provider)).not.toContain('dropbox')
      await expect(service.connect({ provider: 'dropbox' })).rejects.toThrow()
      expect(service.providers().find((info) => info.provider === 'microsoft')).toMatchObject({
        ready: true,
        registration: 'policy'
      })

      const account = await service.connect({ provider: 'microsoft' })
      expect(openBrowser.mock.calls[0][0]).toMatch(
        /^https:\/\/login\.microsoftonline\.com\/contoso\.onmicrosoft\.com\/oauth2\/v2\.0\/authorize\?/
      )

      expect(await service.accessTokenFor(account.id, 'api://ostler-sync/sync')).toBe(
        'server-token'
      )
      // Held until it lapses: one token request for the server, not one per call.
      expect(await service.accessTokenFor(account.id, 'api://ostler-sync/sync')).toBe(
        'server-token'
      )
      expect(scopes.filter((scope) => scope !== null)).toEqual(['api://ostler-sync/sync'])
    } finally {
      service.close()
    }
  })
})
