import Database from 'better-sqlite3'
import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { HttpTransport, SyncServerError } from '../../electron/services/sync/http-transport'
import { SyncTransportError } from '../../electron/services/sync/folder-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { parseInvite } from '../../electron/services/sync/sharing'
import { SyncService } from '../../electron/services/sync/sync-service'
import { SyncServerSettings } from '../../electron/services/sync/sync-server-settings'
// @ts-expect-error: the reference server is plain JavaScript with no types.
import { checkJwt, createSyncServer } from '../../server/sync-server/server.mjs'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const KEY = 'a-long-random-access-key'
const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}

describe('sharing through a sync server (integrations phase 7)', () => {
  const root = useTempDir('ostler-sync-server-')
  let server: http.Server
  let base: string
  const closers: (() => unknown)[] = []

  beforeEach(async () => {
    server = http.createServer(
      createSyncServer({ dataDir: path.join(root(), 'server'), keys: [KEY], log: () => undefined })
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  const transport = (key = KEY, space = 'space-0001') =>
    new HttpTransport(`${base}/spaces/${space}`, {
      fetch: (url, init) => fetch(url, init),
      authorization: async () => `Bearer ${key}`,
      pollMs: 50
    })

  it('keeps write-once files, lists them and refuses to replace one', async () => {
    const space = transport()
    expect(await space.list('')).toEqual([])
    await space.writeOnce('changes/a/1.ostlerchange', Buffer.from('one'))
    await space.writeOnce('share.json', Buffer.from('{}'))
    expect(await space.list('')).toEqual(['changes/a/1.ostlerchange', 'share.json'])
    expect(await space.list('changes')).toEqual(['changes/a/1.ostlerchange'])
    expect((await space.read('changes/a/1.ostlerchange')).toString()).toBe('one')
    await expect(space.writeOnce('share.json', Buffer.from('again'))).rejects.toEqual(
      new SyncTransportError('exists')
    )
    await expect(space.writeOnce('../escape', Buffer.from('x'))).rejects.toBeInstanceOf(
      SyncTransportError
    )
  })

  it('refuses a wrong key, and says when the space changes', async () => {
    await expect(transport('wrong').list('')).rejects.toEqual(new SyncServerError('signIn', 401))
    const space = transport()
    let changes = 0
    const stop = space.watch(() => changes++)
    closers.push(stop)
    await new Promise((resolve) => setTimeout(resolve, 120))
    await space.writeOnce('one', Buffer.from('1'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(changes).toBeGreaterThan(0)
  })

  it('shares and joins with no folder, and only ever signs in to its own server', async () => {
    const pc = async (name: string) => {
      const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(root(), name)))
      const settings = new SyncServerSettings(databasePath, {
        seal: (secret) => `sealed:${secret}`,
        open: (sealed) => sealed.replace(/^sealed:/, ''),
        policy: () => null,
        accessTokenFor: async () => 'unused',
        isMicrosoftAccount: () => false,
        fetch: (url, init) => fetch(url, init)
      })
      closers.push(() => settings.close())
      settings.set({ url: base, signIn: 'key', key: KEY })
      const service = new SyncService({
        databasePath,
        library: noLibrary,
        projectSettings: () => SETTINGS,
        onProjectChanged: () => undefined,
        onStateChanged: () => undefined,
        memberName: () => name,
        logError: () => undefined,
        openServer: (location) => settings.open(location),
        pushCheckMs: 60_000,
        scanIntervalMs: 60_000
      })
      const db = new Database(databasePath)
      attachChangeRecorder(db)
      closers.push(async () => {
        await service.stop()
        db.close()
      })
      return { settings, service, db }
    }

    const ann = await pc('ann-')
    const ben = await pc('ben-')
    expect(ann.settings.state()).toMatchObject({ url: base, hasKey: true, ready: true })
    ann.db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
      )
      .run(PROJECT)

    const location = ann.settings.newSpace('0f8fad5b-d9cb-469f-a165-70867728950e')
    await ann.service.share(PROJECT, location)
    const invite = ann.service.invite(PROJECT)!
    expect(parseInvite(invite).location).toBe(location)

    const joined = await ben.service.join(invite, parseInvite(invite).location!)
    expect(joined.project).toEqual(SETTINGS)
    const row = ben.db.prepare("SELECT title FROM planning_work_items WHERE id = 'item-1'").get()
    expect(row).toEqual({ title: 'Paint hall' })

    // A space on another server never gets this PC's key.
    const elsewhere = 'https://elsewhere.example.com/spaces/0f8fad5b-d9cb'
    expect(ben.settings.canOpen(elsewhere)).toBe(false)
    expect(() => ben.settings.open(elsewhere)).toThrow(SyncServerError)
    // A new address needs its own key.
    expect(() => ben.settings.set({ url: 'https://other.example.com', signIn: 'key' })).toThrow()
  })

  it('accepts only a work-account token from its own tenant, for itself, in date', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' }
    const jwks = async (kid: string) => (kid === 'k1' ? jwk : null)
    const entra = { tenant: 'tenant-1', audiences: ['api://ostler-sync'] }
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = (claims: Record<string, unknown>) => {
      const body = `${encode({ alg: 'RS256', kid: 'k1' })}.${encode(claims)}`
      return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`
    }
    const good = {
      iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
      aud: 'api://ostler-sync',
      exp: now + 600,
      oid: 'person-1'
    }
    expect(await checkJwt(token(good), entra, jwks)).toMatchObject({ oid: 'person-1' })
    expect(await checkJwt(token({ ...good, aud: 'other' }), entra, jwks)).toBeNull()
    const otherTenant = { ...good, iss: 'https://login.microsoftonline.com/x/v2.0' }
    expect(await checkJwt(token(otherTenant), entra, jwks)).toBeNull()
    expect(await checkJwt(token({ ...good, exp: now - 600 }), entra, jwks)).toBeNull()
    const forged = token(good).split('.')
    forged[1] = encode({ ...good, oid: 'someone-else' })
    expect(await checkJwt(forged.join('.'), entra, jwks)).toBeNull()
  })
})
