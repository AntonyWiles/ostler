import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkedR2Config,
  R2Changes,
  R2Client,
  R2Error,
  R2Transport,
  R2_CHANGED_MARKER,
  signV4
} from '../../electron/services/sync/r2-transport'
import {
  newSetupPassphrase,
  openR2Setup,
  R2SetupCodeError,
  sealR2Setup
} from '../../electron/services/sync/r2-setup-code'
import { R2Bridge } from '../../electron/services/sync/r2-bridge'
import { SyncTransportError } from '../../electron/services/sync/transport-paths'
import { FAKE_R2, FakeR2 } from '../helpers/fake-r2'
import { useTempDir } from '../helpers/temp-dir'

const config = { ...FAKE_R2, prefix: 'sync' }

describe('Signature Version 4', () => {
  it('matches the GET Object example in the Amazon S3 documentation', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "GET Object".
    const header = signV4({
      method: 'GET',
      path: '/test.txt',
      query: {},
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z'
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', // hygiene-allow: AWS's published example key
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', // hygiene-allow: AWS's published example key
      region: 'us-east-1',
      service: 's3',
      amzDate: '20130524T000000Z'
    })
    expect(header).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' + // hygiene-allow: AWS example
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })
})

describe('bucket settings', () => {
  it('accepts an R2 account and refuses what would send the keys elsewhere', () => {
    expect(checkedR2Config({ ...config, prefix: '/sync/' }).prefix).toBe('sync')
    // The S3 API address Cloudflare shows next to the bucket, pasted as the bucket.
    expect(
      checkedR2Config({
        ...config,
        accountId: '',
        bucket: `https://${FAKE_R2.accountId}.r2.cloudflarestorage.com/ostler-test`
      })
    ).toMatchObject({ accountId: FAKE_R2.accountId, bucket: 'ostler-test' })
    expect(() =>
      checkedR2Config({
        ...config,
        bucket: `https://${FAKE_R2.accountId}.r2.cloudflarestorage.com`
      })
    ).toThrow(R2Error)
    expect(() => checkedR2Config({ ...config, accountId: 'nope' })).toThrow(R2Error)
    expect(() => checkedR2Config({ ...config, bucket: 'Bad_Bucket' })).toThrow(R2Error)
    expect(() => checkedR2Config({ ...config, endpoint: 'http://example.com' })).toThrow(R2Error)
    expect(() => checkedR2Config({ ...config, prefix: '../up' })).toThrow(R2Error)
    expect(
      checkedR2Config({ ...config, accountId: '', endpoint: 'https://s3.example.com/' }).endpoint
    ).toBe('https://s3.example.com')
  })
})

describe('the R2 transport', () => {
  const make = (bucket = new FakeR2()) => {
    const client = new R2Client(config, { fetch: bucket.fetch })
    return {
      bucket,
      client,
      transport: new R2Transport(client, 'r2:Ostler/Projects/Garden (1a2b)')
    }
  }

  it('writes once, lists below its place and reads back', async () => {
    const { bucket, transport } = make()
    await transport.writeOnce('changes/a/1.ostlerchange', Buffer.from('one'))
    await transport.writeOnce('share.json', Buffer.from('{}'))
    await expect(transport.writeOnce('share.json', Buffer.from('again'))).rejects.toMatchObject({
      reason: 'exists'
    })
    bucket.put('sync/Ostler/Projects/Garden (1a2b)/.hidden', 'x')
    bucket.put('sync/Ostler/Projects/Other/share.json', 'x')
    expect(await transport.list('')).toEqual(['changes/a/1.ostlerchange', 'share.json'])
    expect(await transport.list('changes')).toEqual(['changes/a/1.ostlerchange'])
    expect((await transport.read('share.json')).toString()).toBe('{}')
    expect(bucket.keys()).toContain('sync/Ostler/Projects/Garden (1a2b)/share.json')
  })

  it('reads every page of a long listing', async () => {
    const { bucket, transport } = make()
    bucket.pageSize = 3
    for (let i = 0; i < 10; i++) bucket.put(`sync/Ostler/Projects/Garden (1a2b)/f${i}`, 'x')
    expect(await transport.list('')).toHaveLength(10)
  })

  it('refuses paths that leave its place, and says so when the keys are wrong', async () => {
    const { transport } = make()
    await expect(transport.read('../x')).rejects.toBeInstanceOf(SyncTransportError)
    await expect(transport.writeOnce('.marker', Buffer.from('x'))).rejects.toBeInstanceOf(
      SyncTransportError
    )
    const bucket = new FakeR2()
    const wrong = new R2Client({ ...config, secretAccessKey: 'wrong' }, { fetch: bucket.fetch })
    await expect(wrong.test()).rejects.toMatchObject({ reason: 'signIn' })
    bucket.offline = true
    await expect(new R2Client(config, { fetch: bucket.fetch }).test()).rejects.toMatchObject({
      reason: 'unreachable'
    })
  })
})

describe('looking for changes cheaply', () => {
  it('tells watchers only when another device moved the marker', async () => {
    const bucket = new FakeR2()
    const client = new R2Client(config, { fetch: bucket.fetch })
    const changes = new R2Changes(client, { intervalMs: null })
    let told = 0
    changes.subscribe(() => (told += 1))
    await changes.check() // the first look only learns the marker
    expect(told).toBe(0)
    await changes.mark() // this device's own write
    await changes.check()
    expect(told).toBe(0)
    bucket.put(`sync/${R2_CHANGED_MARKER}`, 'phone') // another device
    await changes.check()
    expect(told).toBe(1)
    await changes.check()
    expect(told).toBe(1)
    await changes.check(true) // Sync now
    expect(told).toBe(2)
  })

  it('costs one class B call per look and lists nothing', async () => {
    const bucket = new FakeR2()
    const changes = new R2Changes(new R2Client(config, { fetch: bucket.fetch }), {
      intervalMs: null
    })
    for (let i = 0; i < 20; i++) await changes.check()
    expect(bucket.classA).toBe(0)
    expect(bucket.classB).toBe(20)
  })
})

describe('setup codes', () => {
  it('carries the bucket sealed under a passphrase', () => {
    const passphrase = newSetupPassphrase()
    expect(passphrase).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    const code = sealR2Setup({ config, space: 'Ostler', checkMinutes: 15 }, passphrase)
    expect(code.startsWith('ostler-r2:1:')).toBe(true)
    expect(code).not.toContain(FAKE_R2.secretAccessKey)
    const opened = openR2Setup(` ${code}\n`, passphrase.toLowerCase().replace(/-/g, ' '))
    expect(opened).toEqual({ config: checkedR2Config(config), space: 'Ostler', checkMinutes: 15 })
    expect(() => openR2Setup(code, 'WRONG-WRON-GWRO-NGWR')).toThrow(R2SetupCodeError)
    expect(() => openR2Setup('hello', passphrase)).toThrow(R2SetupCodeError)
  })
})

describe('the PC copies its personal space to the bucket and back', () => {
  const tempDir = useTempDir('ostler-r2-bridge-')

  const setUp = () => {
    const root = tempDir()
    const space = path.join(root, 'Ostler')
    const outside = path.join(root, 'Shared', 'Garden')
    fs.mkdirSync(path.join(space, 'Personal', 'changes'), { recursive: true })
    fs.writeFileSync(path.join(space, 'Personal', 'share.json'), '{"personal":true}')
    fs.writeFileSync(path.join(space, 'Personal', 'changes', 'pc-1.ostlerchange'), 'pc')
    fs.writeFileSync(path.join(space, 'Personal', '.hidden.tmp'), 'temp')
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, 'share.json'), '{"garden":true}')
    const data = fs.mkdtempSync(path.join(root, 'data-'))
    const bucket = new FakeR2()
    const bridge = new R2Bridge({
      dataDir: data,
      seal: (secret) => `sealed:${Buffer.from(secret).toString('base64')}`,
      open: (sealed) => Buffer.from(sealed.slice(7), 'base64').toString(),
      fetch: bucket.fetch,
      spaceFolder: () => space,
      shareFolders: () => [outside, path.join(space, 'Projects', 'X'), 'gdrive:abc'],
      log: (message, error) => {
        throw new Error(`${message} ${String(error)}`)
      }
    })
    bridge.start()
    return { root, space, outside, data, bucket, bridge }
  }

  it('sends what the bucket lacks, brings down what this folder lacks, and keeps the secret sealed', async () => {
    const { space, outside, data, bucket, bridge } = setUp()
    bridge.set({ ...config, checkMinutes: 0, uploadSoon: false, enabled: true })
    const saved = fs.readFileSync(path.join(data, 'r2-sync.json'), 'utf8')
    expect(saved).not.toContain(FAKE_R2.secretAccessKey)
    expect(bridge.state()).toMatchObject({
      configured: true,
      hasSecret: true,
      bucket: 'ostler-test'
    })
    expect(JSON.stringify(bridge.state())).not.toContain(FAKE_R2.secretAccessKey)

    await bridge.syncNow()
    expect(bucket.keys()).toEqual([
      'sync/.ostler-changed',
      'sync/Ostler/Personal/changes/pc-1.ostlerchange',
      'sync/Ostler/Personal/share.json',
      'sync/Shared/Garden/share.json'
    ])

    // The phone writes into the bucket.
    bucket.put('sync/Ostler/Personal/changes/phone-1.ostlerchange', 'phone')
    bucket.put('sync/Ostler/devices/requests/abc.ostlerrequest', 'request')
    bucket.put('sync/Shared/Garden/changes/phone-2.ostlerchange', 'phone2')
    bucket.put('sync/Ostler/../escape', 'nope')
    const state = await bridge.syncNow()
    expect(state.lastError).toBeNull()
    expect(state.lastDownloaded).toBe(3)
    expect(
      fs.readFileSync(path.join(space, 'Personal', 'changes', 'phone-1.ostlerchange'), 'utf8')
    ).toBe('phone')
    expect(fs.existsSync(path.join(space, 'devices', 'requests', 'abc.ostlerrequest'))).toBe(true)
    expect(fs.existsSync(path.join(outside, 'changes', 'phone-2.ostlerchange'))).toBe(true)
    expect(fs.existsSync(path.join(path.dirname(space), 'escape'))).toBe(false)
    bridge.stop()
  })

  it('hands the bucket to another device with a setup code', async () => {
    const { bridge, data } = setUp()
    bridge.set({ ...config, checkMinutes: 15, uploadSoon: true, enabled: true })
    const { code, passphrase } = bridge.exportSetup()
    expect(openR2Setup(code, passphrase)).toMatchObject({ space: 'Ostler', checkMinutes: 15 })
    bridge.clear()
    expect(fs.existsSync(path.join(data, 'r2-sync.json'))).toBe(false)
    expect(() => bridge.importSetup(code, 'AAAA-AAAA-AAAA-AAAA')).toThrow()
    expect(bridge.importSetup(code, passphrase)).toMatchObject({
      configured: true,
      checkMinutes: 15
    })
  })
})
