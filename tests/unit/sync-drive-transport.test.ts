import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncTransportError } from '../../electron/services/sync/folder-transport'
import {
  DriveTransport,
  driveLocation,
  isDriveLocation,
  parseDriveLocation
} from '../../electron/services/sync/drive-transport'
import {
  DriveError,
  GoogleDriveClient,
  MULTIPART_LIMIT,
  type DriveRequest,
  type DriveResponse
} from '../../electron/services/sync/drive-client'
import { FakeDrive } from '../helpers/fake-drive'

const bytes = (text: string): Buffer => Buffer.from(text)
const text = (b: Uint8Array): string => Buffer.from(b).toString()

function setup(): { drive: FakeDrive; transport: DriveTransport } {
  const drive = new FakeDrive()
  return { drive, transport: new DriveTransport(drive, `gdrive:${drive.rootFolderId}`) }
}

describe('drive locations', () => {
  it('accepts and refuses the right strings', () => {
    expect(isDriveLocation('gdrive:abcdefghij')).toBe(true)
    expect(isDriveLocation('gdrive:abc_DEF-123/Personal')).toBe(true)
    expect(isDriveLocation('gdrive:abcdefghij/Personal/devices')).toBe(true)
    expect(isDriveLocation('gdrive:short')).toBe(false)
    expect(isDriveLocation(`gdrive:${'a'.repeat(201)}`)).toBe(false)
    expect(isDriveLocation('gdrive:abcdefghij/../x')).toBe(false)
    expect(isDriveLocation('gdrive:abcdefghij/')).toBe(false)
    expect(isDriveLocation('gdrive:abc defghij')).toBe(false)
    expect(isDriveLocation('/some/folder')).toBe(false)
    expect(parseDriveLocation(driveLocation('abcdefghij', 'Personal'))).toEqual({
      folderId: 'abcdefghij',
      subPath: 'Personal'
    })
    expect(parseDriveLocation('gdrive:abcdefghij')).toEqual({
      folderId: 'abcdefghij',
      subPath: ''
    })
    expect(() => parseDriveLocation('nope')).toThrow(SyncTransportError)
  })
})

describe('DriveTransport', () => {
  it('writes, then lists and reads', async () => {
    const { transport } = setup()
    await transport.writeOnce('changes/b.json', bytes('b'))
    await transport.writeOnce('changes/a.json', bytes('a'))
    await transport.writeOnce('share.json', bytes('s'))
    expect(await transport.list('')).toEqual(['changes/a.json', 'changes/b.json', 'share.json'])
    expect(await transport.list('changes')).toEqual(['changes/a.json', 'changes/b.json'])
    expect(await transport.list('nothing')).toEqual([])
    expect((await transport.read('changes/a.json')).toString()).toBe('a')
  })

  it('makes each folder once', async () => {
    const { drive, transport } = setup()
    await transport.writeOnce('changes/device-1/1.bin', bytes('1'))
    await transport.writeOnce('changes/device-1/2.bin', bytes('2'))
    await transport.writeOnce('changes/device-2/1.bin', bytes('3'))
    const made = drive.calls.filter((c) => c.startsWith('createFolder'))
    expect(made).toEqual(['createFolder changes', 'createFolder device-1', 'createFolder device-2'])
  })

  it('refuses a name that exists', async () => {
    const { transport } = setup()
    await transport.writeOnce('a/1.bin', bytes('x'))
    await expect(transport.writeOnce('a/1.bin', bytes('y'))).rejects.toMatchObject({
      reason: 'exists'
    })
    expect((await transport.read('a/1.bin')).toString()).toBe('x')
  })

  it('serialises writes of the same name', async () => {
    const { transport } = setup()
    const results = await Promise.allSettled([
      transport.writeOnce('a/1.bin', bytes('x')),
      transport.writeOnce('a/1.bin', bytes('y'))
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
  })

  it('refuses bad paths', async () => {
    const { transport } = setup()
    for (const bad of ['', '/a', 'a//b', '../x', 'a\\b', 'a:b', '.hidden', 'x.tmp']) {
      await expect(transport.writeOnce(bad, bytes('x'))).rejects.toMatchObject({
        reason: 'bad-path'
      })
    }
    await expect(transport.read('../x')).rejects.toBeInstanceOf(SyncTransportError)
  })

  it('does not list hidden, temporary or Google-app files', async () => {
    const { drive, transport } = setup()
    const root = drive.rootFolderId
    drive.seedFile('.hidden', root, bytes('x'))
    drive.seedFile('a.tmp', root, bytes('x'))
    drive.seedFile('doc', root, bytes('x'), undefined, 'application/vnd.google-apps.document')
    const hiddenFolder = drive.seedFolder('.cache', root)
    drive.seedFile('inside.bin', hiddenFolder, bytes('x'))
    drive.seedFile('visible.bin', root, bytes('x'))
    expect(await transport.list('')).toEqual(['visible.bin'])
  })

  it('merges two same-named folders', async () => {
    const { drive, transport } = setup()
    const root = drive.rootFolderId
    const one = drive.seedFolder('changes', root)
    const two = drive.seedFolder('changes', root)
    drive.seedFile('1.bin', one, bytes('one'))
    drive.seedFile('2.bin', two, bytes('two'))
    expect(await transport.list('')).toEqual(['changes/1.bin', 'changes/2.bin'])
    expect((await transport.read('changes/2.bin')).toString()).toBe('two')
    await expect(transport.writeOnce('changes/2.bin', bytes('x'))).rejects.toMatchObject({
      reason: 'exists'
    })
  })

  it('reads the oldest of two same-named files', async () => {
    const { drive, transport } = setup()
    const root = drive.rootFolderId
    drive.seedFile('f.bin', root, bytes('newer'), '2026-06-01T00:00:00.000Z')
    drive.seedFile('f.bin', root, bytes('older'), '2026-05-01T00:00:00.000Z')
    expect((await transport.read('f.bin')).toString()).toBe('older')
    expect(await transport.list('')).toEqual(['f.bin'])
  })

  it('works under a sub-path of the Drive folder', async () => {
    const drive = new FakeDrive()
    const transport = new DriveTransport(drive, `gdrive:${drive.rootFolderId}/Personal/devices`)
    await transport.writeOnce('d1/1.bin', bytes('x'))
    expect(await transport.list('')).toEqual(['d1/1.bin'])
    const whole = new DriveTransport(drive, `gdrive:${drive.rootFolderId}`)
    expect(await whole.list('')).toEqual(['Personal/devices/d1/1.bin'])
  })

  it('forgets a cached folder that has gone', async () => {
    const { drive, transport } = setup()
    await transport.writeOnce('a/1.bin', bytes('x'))
    const a = [...drive.entries.values()].find((e) => e.name === 'a')!
    drive.entries.delete(a.id)
    await transport.writeOnce('a/2.bin', bytes('y'))
    expect(await transport.list('')).toEqual(['a/2.bin'])
  })

  describe('watch', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('fires once after a change when polling', async () => {
      const { drive, transport } = setup()
      const onChange = vi.fn()
      const stop = transport.watch(onChange)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onChange).not.toHaveBeenCalled()
      drive.seedFile('1.bin', drive.rootFolderId, bytes('x'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onChange).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(180_000)
      expect(onChange).toHaveBeenCalledTimes(1)
      stop()
      drive.seedFile('2.bin', drive.rootFolderId, bytes('x'))
      await vi.advanceTimersByTimeAsync(120_000)
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('uses the injected subscription and calls at most once per 500 ms', async () => {
      const drive = new FakeDrive()
      let trigger: () => void = () => undefined
      const stopSubscription = vi.fn()
      const transport = new DriveTransport(drive, `gdrive:${drive.rootFolderId}`, {
        subscribe: (cb) => {
          trigger = cb
          return stopSubscription
        }
      })
      const onChange = vi.fn()
      const stop = transport.watch(onChange)
      trigger()
      trigger()
      trigger()
      expect(onChange).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(500)
      expect(onChange).toHaveBeenCalledTimes(2)
      stop()
      expect(stopSubscription).toHaveBeenCalled()
    })
  })
})

describe('GoogleDriveClient', () => {
  function client(answer: (init: DriveRequest) => Partial<DriveResponse> & { json?: unknown }): {
    client: GoogleDriveClient
    sent: DriveRequest[]
  } {
    const sent: DriveRequest[] = []
    const c = new GoogleDriveClient(async (init) => {
      sent.push(init)
      const a = answer(init)
      return {
        status: a.status ?? 200,
        headers: a.headers ?? { get: () => null },
        bytes: a.bytes ?? Buffer.from(JSON.stringify(a.json ?? {}))
      }
    })
    return { client: c, sent }
  }

  it('sends a multipart body with both parts', async () => {
    const { client: c, sent } = client(() => ({ json: { id: 'new1' } }))
    const id = await c.upload('1.bin', 'parent1', Buffer.from('hello'))
    expect(id).toBe('new1')
    const [call] = sent
    expect(call.method).toBe('POST')
    expect(call.url).toContain('/upload/drive/v3/files?uploadType=multipart')
    const type = call.headers!['Content-Type']
    const edge = /boundary=(.+)$/.exec(type)![1]
    const body = text(call.body as Uint8Array)
    expect(body.startsWith(`--${edge}\r\n`)).toBe(true)
    expect(body.endsWith(`\r\n--${edge}--`)).toBe(true)
    expect(body.split(`--${edge}`)).toHaveLength(4)
    expect(body).toContain('Content-Type: application/json')
    expect(body).toContain(JSON.stringify({ name: '1.bin', parents: ['parent1'] }))
    expect(body).toContain('Content-Type: application/octet-stream\r\n\r\nhello\r\n')
  })

  it('uploads over 5 MB in the resumable flow', async () => {
    const { client: c, sent } = client((init) =>
      init.method === 'POST'
        ? { headers: { get: (n) => (n === 'Location' ? 'https://upload.example/session1' : null) } }
        : { json: { id: 'big1' } }
    )
    const big = new Uint8Array(MULTIPART_LIMIT + 1)
    expect(await c.upload('big.bin', 'p', big)).toBe('big1')
    expect(sent).toHaveLength(2)
    expect(sent[0].url).toContain('uploadType=resumable')
    expect(sent[0].body).toBe(JSON.stringify({ name: 'big.bin', parents: ['p'] }))
    expect(sent[1].method).toBe('PUT')
    expect(sent[1].url).toBe('https://upload.example/session1')
    expect(sent[1].body).toBe(big)
  })

  it('follows nextPageToken when listing', async () => {
    const { client: c, sent } = client((init) =>
      init.url.includes('pageToken=')
        ? { json: { files: [{ id: 'b', name: 'b', mimeType: 'x', createdTime: 't' }] } }
        : {
            json: {
              nextPageToken: 'tok 2',
              files: [{ id: 'a', name: 'a', mimeType: 'x', createdTime: 't' }]
            }
          }
    )
    const files = await c.listChildren("fo'lder")
    expect(files.map((f) => f.id)).toEqual(['a', 'b'])
    expect(sent).toHaveLength(2)
    expect(sent[1].url).toContain('pageToken=tok%202')
    expect(decodeURIComponent(sent[0].url)).toContain("'fo\\'lder' in parents and trashed=false")
    expect(sent[0].url).toContain('supportsAllDrives=true&includeItemsFromAllDrives=true')
  })

  it('builds the other calls and throws DriveError on failure', async () => {
    const { client: c, sent } = client((init) =>
      init.url.includes('/changes?')
        ? {
            json: {
              newStartPageToken: 'n',
              changes: [
                { fileId: 'f', removed: false, file: { parents: ['p'] } },
                { fileId: 'g', removed: true }
              ]
            }
          }
        : init.url.includes('startPageToken')
          ? { json: { startPageToken: '7' } }
          : { json: { id: 'f1' } }
    )
    expect(await c.createFolder('x', 'p')).toBe('f1')
    expect(JSON.parse(sent[0].body as string)).toEqual({
      name: 'x',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['p']
    })
    expect(await c.startPageToken()).toBe('7')
    expect(await c.changes('7')).toEqual({
      changes: [
        { fileId: 'f', removed: false, parents: ['p'] },
        { fileId: 'g', removed: true, parents: [] }
      ],
      newStartPageToken: 'n',
      nextPageToken: undefined
    })
    await c.grantAccess('f1', 'a@b.c', 'reader')
    const grant = sent[sent.length - 1]
    expect(grant.url).toContain('/files/f1/permissions?sendNotificationEmail=true')
    expect(JSON.parse(grant.body as string)).toEqual({
      type: 'user',
      role: 'reader',
      emailAddress: 'a@b.c'
    })
    await c.download('f1')
    expect(sent[sent.length - 1].url).toContain('/files/f1?alt=media')

    const { client: failing } = client(() => ({ status: 404 }))
    await expect(failing.download('x')).rejects.toBeInstanceOf(DriveError)
    await expect(failing.download('x')).rejects.toMatchObject({ status: 404 })
  })
})
