/**
 * Advanced sync: the same write-once sync files, kept in a Cloudflare R2 bucket (or any other
 * S3-compatible store). The phone reads and writes the bucket directly; a PC copies its personal
 * space folder to and from it (r2-bridge.ts). Everything in the files is already sealed with the
 * project keys (envelope.ts), so the bucket's owner can't read them, and a key to the bucket alone
 * is not a way into the person's projects: a new device still pairs with the six-digit code.
 *
 * A place in the bucket is `r2:<path>`, a path below the configured prefix with `/` between
 * segments (`r2:Ostler/Projects/Garden (1a2b3c4d)`).
 *
 * R2's free tier counts operations: listing and writing are "class A" (a million a month), reading
 * and HEAD are "class B" (ten million). So nothing here lists on a timer. Every device that writes
 * also rewrites one small hidden marker, `.ostler-changed`, at the top of the prefix; the others
 * ask for its ETag (one HEAD) at the interval the person chose, and only list when it moved.
 *
 * Requests are signed with AWS Signature Version 4 (region `auto`), go only to the bucket's own
 * address over HTTPS and never follow a redirect. Keys are never logged.
 */
import { createHash, createHmac } from './platform'
import { isHiddenOrTemp, segmentsOf, SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import type { R2Usage } from './r2-usage'

export const R2_SCHEME = 'r2:'
/** The marker every writer rewrites; hidden, so no transport ever lists it. */
export const R2_CHANGED_MARKER = '.ostler-changed'

export interface R2Config {
  /** The Cloudflare account id (32 hex digits); names the endpoint unless `endpoint` is set. */
  accountId: string
  bucket: string
  /** A folder inside the bucket ('' for the top), so the bucket can hold other things too. */
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  /** Another S3-compatible endpoint (https), or R2's EU one; default `https://<accountId>.r2.cloudflarestorage.com`. */
  endpoint?: string
}

export class R2Error extends Error {
  constructor(
    /**
     * `signIn`: the bucket refused the keys; `noBucket`: there is no such bucket; `unreachable`: no
     * answer at all (no network, a timeout); `server`: the service answered with an error.
     */
    readonly reason:
      'bad-config' | 'signIn' | 'noBucket' | 'missing' | 'unreachable' | 'server' | 'bad-answer',
    readonly status: number | null = null
  ) {
    super(`R2: ${reason}${status ? ` (${status})` : ''}`)
    this.name = 'R2Error'
  }
}

export function isR2Location(place: string): boolean {
  return place.startsWith(R2_SCHEME)
}

export function r2Location(path: string): string {
  if (path !== '') segmentsOf(path, false)
  return `${R2_SCHEME}${path}`
}

/** The path inside the prefix that a place names. */
export function parseR2Location(place: string): string {
  if (!isR2Location(place)) throw new SyncTransportError('bad-path')
  const path = place.slice(R2_SCHEME.length)
  if (path !== '') segmentsOf(path, false)
  return path
}

/** Checks a config and gives it back tidied; throws `R2Error('bad-config')`. */
export function checkedR2Config(input: Partial<R2Config> | null | undefined): R2Config {
  const text = (value: unknown, max: number): string =>
    typeof value === 'string' && value.trim().length <= max ? value.trim() : ''
  let accountId = text(input?.accountId, 64).toLowerCase()
  let bucket = text(input?.bucket, 300)
  // Cloudflare shows the bucket's "S3 API" address beside its name; take a pasted one apart.
  const pasted = /^https:\/\/([0-9a-f]{32})\.r2\.cloudflarestorage\.com\/?([^/?#]*)\/?$/i.exec(
    bucket
  )
  if (pasted) {
    accountId ||= pasted[1].toLowerCase()
    bucket = pasted[2]
  }
  const accessKeyId = text(input?.accessKeyId, 256)
  const secretAccessKey = text(input?.secretAccessKey, 256)
  const prefix = text(input?.prefix, 200).replace(/^\/+|\/+$/g, '')
  const endpoint = text(input?.endpoint, 300).replace(/\/+$/, '')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new R2Error('bad-config')
  if (!accessKeyId || !secretAccessKey || /\s/.test(accessKeyId + secretAccessKey)) {
    throw new R2Error('bad-config')
  }
  if (prefix !== '') {
    try {
      segmentsOf(prefix, false)
    } catch {
      throw new R2Error('bad-config')
    }
  }
  if (endpoint) {
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      throw new R2Error('bad-config')
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new R2Error('bad-config')
    }
  } else if (!/^[0-9a-f]{32}$/.test(accountId)) {
    throw new R2Error('bad-config')
  }
  return {
    accountId,
    bucket,
    prefix,
    accessKeyId,
    secretAccessKey,
    ...(endpoint ? { endpoint } : {})
  }
}

// ─── Signature Version 4 ────────────────────────────────────────────────

/** RFC 3986 encoding, as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

export interface SignInput {
  method: string
  /** Already encoded, as it goes on the wire (`/bucket/a%20b`). */
  path: string
  query: Record<string, string>
  /** Lower-case names; `host` included. */
  headers: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
  /** `YYYYMMDDTHHMMSSZ`. */
  amzDate: string
}

/** The `Authorization` header for a request (exported for the published AWS test vectors). */
export function signV4(input: SignInput): string {
  const date = input.amzDate.slice(0, 8)
  const query = Object.keys(input.query)
    .sort()
    .map((key) => `${awsEncode(key)}=${awsEncode(input.query[key])}`)
    .join('&')
  const names = Object.keys(input.headers)
    .map((name) => name.toLowerCase())
    .sort()
  const canonicalHeaders = names
    .map((name) => `${name}:${input.headers[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('')
  const signedHeaders = names.join(';')
  const canonical = [
    input.method,
    input.path,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash
  ].join('\n')
  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonical)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), input.service),
    'aws4_request'
  )
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function amzDateOf(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

// ─── The bucket ─────────────────────────────────────────────────────────

export interface R2ClientOptions {
  fetch(url: string, init: RequestInit): Promise<Response>
  now?(): number
  timeoutMs?: number
  /** Counts the calls by billing class and keeps how the last one went. */
  usage?: R2Usage
}

const DEFAULT_TIMEOUT_MS = 30_000
/** No sync file is near this; a bigger answer is not one. */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const EMPTY_HASH = sha256Hex('')

interface Answer {
  status: number
  headers: Headers
  bytes: Buffer
}

export class R2Client {
  readonly config: R2Config
  private readonly origin: string
  private readonly host: string
  private readonly basePath: string

  constructor(
    config: R2Config,
    private readonly options: R2ClientOptions
  ) {
    this.config = checkedR2Config(config)
    const url = new URL(
      this.config.endpoint ?? `https://${this.config.accountId}.r2.cloudflarestorage.com`
    )
    this.origin = url.origin
    this.host = url.host
    this.basePath = url.pathname.replace(/\/+$/, '')
  }

  /** Every key below `keyPrefix` (a path inside the prefix), without the prefix, unsorted. */
  async list(keyPrefix: string): Promise<string[]> {
    const outer = this.config.prefix ? `${this.config.prefix}/` : ''
    const keys: string[] = []
    let token: string | null = null
    for (let page = 0; page < 10_000; page++) {
      const query: Record<string, string> = { 'list-type': '2', prefix: outer + keyPrefix }
      if (token) query['continuation-token'] = token
      const answer = await this.call('GET', '', query, {})
      if (answer.status !== 200) throw this.failure(answer, true)
      const xml = answer.bytes.toString('utf8')
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        const key = xmlText(match[1])
        if (key.startsWith(outer)) keys.push(key.slice(outer.length))
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)
      if (!truncated) return keys
      if (!next) throw new R2Error('bad-answer')
      token = xmlText(next[1])
    }
    throw new R2Error('bad-answer')
  }

  async get(key: string): Promise<Buffer> {
    const answer = await this.call('GET', key, {}, {})
    if (answer.status === 404 && !isNoBucket(answer)) throw new R2Error('missing', 404)
    if (answer.status !== 200) throw this.failure(answer, false)
    return answer.bytes
  }

  /** The object's ETag, or null when it isn't there. */
  async head(key: string): Promise<string | null> {
    const answer = await this.call('HEAD', key, {}, {})
    // A HEAD has no body to tell a missing bucket from a missing object; the next listing does.
    if (answer.status === 404) return null
    if (answer.status !== 200) throw this.failure(answer, false)
    return answer.headers.get('etag')
  }

  /** Writes a new object; 'exists' when one is already there (`If-None-Match: *`). */
  async putIfAbsent(key: string, bytes: Uint8Array): Promise<'written' | 'exists'> {
    const answer = await this.call('PUT', key, {}, { 'if-none-match': '*' }, bytes)
    if (answer.status === 412 || answer.status === 409) return 'exists'
    if (answer.status !== 200) throw this.failure(answer, false)
    return 'written'
  }

  /** Writes or replaces an object; returns its new ETag. */
  async put(key: string, bytes: Uint8Array): Promise<string | null> {
    const answer = await this.call('PUT', key, {}, {}, bytes)
    if (answer.status !== 200) throw this.failure(answer, false)
    return answer.headers.get('etag')
  }

  /** One small listing: proves the address, bucket and keys work. */
  async test(): Promise<void> {
    const outer = this.config.prefix ? `${this.config.prefix}/` : ''
    const answer = await this.call(
      'GET',
      '',
      { 'list-type': '2', prefix: outer, 'max-keys': '1' },
      {}
    )
    if (answer.status !== 200) throw this.failure(answer, true)
  }

  /** What a refused call means; `bucketCall` when it named no object, so a 404 is the bucket. */
  private failure(answer: Answer, bucketCall: boolean): R2Error {
    const code = errorCode(answer)
    const status = answer.status
    let error: R2Error
    if (SIGN_IN_CODES.has(code) || status === 401 || status === 403) {
      error = new R2Error('signIn', status)
    } else if (code === 'NoSuchBucket' || (status === 404 && bucketCall)) {
      error = new R2Error('noBucket', status)
    } else if (status === 404) {
      error = new R2Error('missing', status)
    } else {
      error = new R2Error('server', status)
    }
    if (error.reason !== 'missing') this.options.usage?.noteResult(error.reason)
    return error
  }

  private async call(
    method: 'GET' | 'HEAD' | 'PUT',
    key: string,
    query: Record<string, string>,
    extra: Record<string, string>,
    body?: Uint8Array
  ): Promise<Answer> {
    let path = `${this.basePath}/${awsEncode(this.config.bucket)}`
    if (key !== '') {
      const full = this.config.prefix ? `${this.config.prefix}/${key}` : key
      path += `/${segmentsOf(full, false).map(awsEncode).join('/')}`
    }
    const amzDate = amzDateOf(this.options.now?.() ?? Date.now())
    const payloadHash = body ? sha256Hex(body) : EMPTY_HASH
    const headers: Record<string, string> = {
      host: this.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extra
    }
    const authorization = signV4({
      method,
      path,
      query,
      headers,
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: 'auto',
      service: 's3',
      amzDate
    })
    const search = Object.keys(query)
      .sort()
      .map((name) => `${awsEncode(name)}=${awsEncode(query[name])}`)
      .join('&')
    const url = `${this.origin}${path}${search ? `?${search}` : ''}`
    if (new URL(url).origin !== this.origin) throw new R2Error('bad-config')
    const { host: _host, ...sent } = headers
    void _host
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    // Listings and writes are class A; reads and HEADs class B.
    this.options.usage?.count(method === 'PUT' || key === '' ? 'A' : 'B')
    try {
      const response = await this.options.fetch(url, {
        method,
        headers: {
          ...sent,
          Authorization: authorization,
          ...(body ? { 'Content-Type': 'application/octet-stream' } : {})
        },
        ...(body ? { body } : {}),
        redirect: 'error',
        signal: controller.signal
      } as RequestInit)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_FILE_BYTES) throw new R2Error('bad-answer')
      const bytes = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
      if (bytes.length > MAX_FILE_BYTES) throw new R2Error('bad-answer')
      if (response.status < 400 || (response.status === 404 && key !== '')) {
        this.options.usage?.noteResult(null)
      }
      return { status: response.status, headers: response.headers, bytes }
    } catch (error) {
      if (error instanceof R2Error) throw error
      // fetch failed or timed out: no answer came back at all.
      this.options.usage?.noteResult('unreachable')
      throw new R2Error('unreachable')
    } finally {
      clearTimeout(timer)
    }
  }
}

/** S3 error codes that mean the keys are wrong or may not use this bucket. */
const SIGN_IN_CODES = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'Unauthorized',
  'InvalidToken',
  'ExpiredToken'
])

/** The `<Code>` of an S3 error answer, or ''. */
function errorCode(answer: Answer): string {
  return /<Code>([^<]*)<\/Code>/.exec(answer.bytes.toString('utf8'))?.[1] ?? ''
}

function isNoBucket(answer: Answer): boolean {
  return errorCode(answer) === 'NoSuchBucket'
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

// ─── When to look ───────────────────────────────────────────────────────

export interface R2ChangesOptions {
  /** How often the marker is asked; null = only when `check` is called (Sync now, app opened). */
  intervalMs: number | null
  /** How long after a write the marker is rewritten, so a burst of files is one write. */
  markDelayMs?: number
  log?(message: string, error?: unknown): void
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
  setRepeat?(fn: () => void, ms: number): unknown
  clearRepeat?(handle: unknown): void
}

const DEFAULT_MARK_DELAY_MS = 3000

/**
 * One per bucket: asks whether anything changed (one HEAD of the marker) on the chosen interval,
 * tells every watcher when it did, and rewrites the marker after this device wrote.
 */
export class R2Changes {
  private readonly watchers = new Set<() => void>()
  private last: string | null | undefined = undefined
  private repeat: unknown = null
  private markTimer: unknown = null
  private checking: Promise<boolean> | null = null
  private intervalMs: number | null

  constructor(
    private readonly client: R2Client,
    private readonly options: R2ChangesOptions
  ) {
    this.intervalMs = options.intervalMs
  }

  /** Calls `onChange` whenever another device changed the bucket; returns the way to stop. */
  subscribe(onChange: () => void): () => void {
    this.watchers.add(onChange)
    this.arm()
    return () => {
      this.watchers.delete(onChange)
      if (this.watchers.size === 0) this.disarm()
    }
  }

  setInterval(ms: number | null): void {
    this.intervalMs = ms
    this.disarm()
    if (this.watchers.size > 0) this.arm()
  }

  /**
   * Asks the marker now. Tells the watchers when it moved since the last look, or always when
   * `force` is set (Sync now); resolves to whether they were told.
   */
  check(force = false): Promise<boolean> {
    if (this.checking && !force) return this.checking
    const run = (async () => {
      let tag: string | null
      try {
        tag = await this.client.head(R2_CHANGED_MARKER)
      } catch (error) {
        this.options.log?.('Could not ask R2 what changed:', error)
        if (!force) return false
        tag = this.last ?? null
      }
      const moved = this.last !== undefined && tag !== this.last
      this.last = tag
      if (moved || force) for (const watcher of [...this.watchers]) watcher()
      return moved || force
    })()
    this.checking = run
    void run.finally(() => {
      if (this.checking === run) this.checking = null
    })
    return run
  }

  /** This device wrote a file: the marker is rewritten shortly, so the others look. */
  noteWrite(): void {
    if (this.markTimer !== null) this.clear(this.markTimer)
    this.markTimer = (this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.markTimer = null
      void this.mark()
    }, this.options.markDelayMs ?? DEFAULT_MARK_DELAY_MS)
  }

  /** Rewrites the marker now (also what `noteWrite` does when its timer runs out). */
  async mark(): Promise<void> {
    if (this.markTimer !== null) this.clear(this.markTimer)
    this.markTimer = null
    try {
      // Only when nobody else moved it since this device last looked is the new tag taken as
      // seen; otherwise the next look still tells the watchers about the other device's change.
      const before = await this.client.head(R2_CHANGED_MARKER)
      const stamp = Buffer.from(`${Date.now()} ${Math.random().toString(36).slice(2)}\n`, 'utf8')
      const tag = await this.client.put(R2_CHANGED_MARKER, stamp)
      if (this.last === undefined || before === this.last) this.last = tag
    } catch (error) {
      this.options.log?.('Could not mark the R2 bucket as changed:', error)
    }
  }

  stop(): void {
    this.disarm()
    if (this.markTimer !== null) this.clear(this.markTimer)
    this.markTimer = null
  }

  private arm(): void {
    if (this.repeat !== null || this.intervalMs === null) return
    if (this.last === undefined) void this.check()
    this.repeat = (this.options.setRepeat ?? ((fn, ms) => setInterval(fn, ms)))(
      () => void this.check(),
      this.intervalMs
    )
  }

  private disarm(): void {
    if (this.repeat === null) return
    if (this.options.clearRepeat) this.options.clearRepeat(this.repeat)
    else clearInterval(this.repeat as ReturnType<typeof setInterval>)
    this.repeat = null
  }

  private clear(handle: unknown): void {
    if (this.options.clearTimer) this.options.clearTimer(handle)
    else clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

// ─── The transport ──────────────────────────────────────────────────────

export class R2Transport implements SyncTransport {
  private readonly base: string
  /** With a change marker, `watch` hears of every other device's write, so nothing lists on a timer. */
  readonly watchSeesAll: boolean

  constructor(
    private readonly client: R2Client,
    place: string,
    private readonly changes: R2Changes | null = null
  ) {
    this.base = parseR2Location(place)
    this.watchSeesAll = changes !== null
  }

  async list(prefix: string): Promise<string[]> {
    if (prefix !== '') segmentsOf(prefix, false)
    const folder = this.join(prefix)
    const inside = folder === '' ? '' : `${folder}/`
    const keys = await this.client.list(inside)
    const start = this.base === '' ? 0 : this.base.length + 1
    return keys
      .filter((key) => key.startsWith(inside))
      .map((key) => key.slice(start))
      .filter((file) => fits(file) && !isHiddenOrTemp(file.split('/').pop() ?? ''))
      .sort()
  }

  async read(path: string): Promise<Buffer> {
    segmentsOf(path, false)
    return this.client.get(this.join(path))
  }

  async writeOnce(path: string, bytes: Buffer): Promise<void> {
    segmentsOf(path, false)
    if (isHiddenOrTemp(path.split('/').pop() ?? '')) throw new SyncTransportError('bad-path')
    const result = await this.client.putIfAbsent(this.join(path), bytes)
    if (result === 'exists') throw new SyncTransportError('exists')
    this.changes?.noteWrite()
  }

  watch(onChange: () => void): () => void {
    return this.changes ? this.changes.subscribe(onChange) : () => undefined
  }

  private join(path: string): string {
    if (path === '') return this.base
    return this.base === '' ? path : `${this.base}/${path}`
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
