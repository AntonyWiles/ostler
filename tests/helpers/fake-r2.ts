/**
 * An in-memory S3/R2 bucket behind a `fetch`, for the advanced sync tests. It speaks the part of
 * the S3 API `R2Client` uses (ListObjectsV2, GET, HEAD, PUT with `If-None-Match: *`), checks each
 * request's SigV4 signature against the one secret it knows, and counts operations by R2's
 * billing class, so tests can hold the sync to its budget.
 */
import { createHash } from 'node:crypto'
import { signV4 } from '../../electron/services/sync/r2-transport'

export const FAKE_R2 = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'ostler-test',
  accessKeyId: 'test-key-id',
  secretAccessKey: 'test-secret' // hygiene-allow: a made-up key for the fake bucket
}

export class FakeR2 {
  readonly objects = new Map<string, { bytes: Buffer; etag: string }>()
  classA = 0
  classB = 0
  /** Keys a listing returns per page (S3 uses 1000). */
  pageSize = 1000
  /** When set, every request fails as if the network were down. */
  offline = false
  private counter = 0

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('fetch failed')
    const parsed = new URL(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v
      ])
    )
    if (!this.signedRight(parsed, method, headers)) return new Response('denied', { status: 403 })
    const [, bucket, ...rest] = parsed.pathname.split('/')
    if (bucket !== FAKE_R2.bucket) return new Response('no bucket', { status: 404 })
    const key = rest.map(decodeURIComponent).join('/')
    if (method === 'GET' && key === '') {
      this.classA += 1
      return this.list(parsed.searchParams)
    }
    if (method === 'PUT') {
      this.classA += 1
      if (headers['if-none-match'] === '*' && this.objects.has(key)) {
        return new Response('exists', { status: 412 })
      }
      const body = init.body as Uint8Array
      const etag = `"${++this.counter}"`
      this.objects.set(key, { bytes: Buffer.from(body), etag })
      return new Response(null, { status: 200, headers: { etag } })
    }
    this.classB += 1
    const object = this.objects.get(key)
    if (!object) return new Response(method === 'HEAD' ? null : 'missing', { status: 404 })
    if (method === 'HEAD')
      return new Response(null, { status: 200, headers: { etag: object.etag } })
    return new Response(new Uint8Array(object.bytes), {
      status: 200,
      headers: { etag: object.etag }
    })
  }

  /** Puts a file as another device would (no signature, not counted). */
  put(key: string, bytes: Buffer | string): void {
    this.objects.set(key, { bytes: Buffer.from(bytes), etag: `"${++this.counter}"` })
  }

  keys(): string[] {
    return [...this.objects.keys()].sort()
  }

  private list(params: URLSearchParams): Response {
    const prefix = params.get('prefix') ?? ''
    const after = params.get('continuation-token') ?? ''
    const max = Math.min(Number(params.get('max-keys') ?? this.pageSize), this.pageSize)
    const all = this.keys().filter((key) => key.startsWith(prefix) && key > after)
    const page = all.slice(0, max)
    const truncated = all.length > page.length
    const escape = (text: string) =>
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${FAKE_R2.bucket}</Name>` +
      page.map((key) => `<Contents><Key>${escape(key)}</Key></Contents>`).join('') +
      `<IsTruncated>${truncated}</IsTruncated>` +
      (truncated
        ? `<NextContinuationToken>${escape(page[page.length - 1])}</NextContinuationToken>`
        : '') +
      '</ListBucketResult>'
    return new Response(xml, { status: 200 })
  }

  private signedRight(url: URL, method: string, headers: Record<string, string>): boolean {
    const given = headers.authorization ?? ''
    const signed = /SignedHeaders=([^,]+)/.exec(given)?.[1]?.split(';') ?? []
    const all: Record<string, string> = { ...headers, host: url.host }
    const picked = Object.fromEntries(signed.map((name) => [name, all[name] ?? '']))
    const query = Object.fromEntries(url.searchParams.entries())
    const expected = signV4({
      method,
      path: url.pathname,
      query,
      headers: picked,
      payloadHash: headers['x-amz-content-sha256'] ?? '',
      accessKeyId: FAKE_R2.accessKeyId,
      secretAccessKey: FAKE_R2.secretAccessKey,
      region: 'auto',
      service: 's3',
      amzDate: headers['x-amz-date'] ?? ''
    })
    return expected === given && signed.includes('host')
  }
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
