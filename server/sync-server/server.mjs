#!/usr/bin/env node
/* global process, Buffer, console, fetch, URL */
/**
 * Ostler's reference sync server (docs/plans/integrations/overview.md, phase 7).
 *
 * It keeps the same write-once files a shared folder holds, in "spaces", one
 * per shared project. It can't read them: Ostler encrypts every file with the
 * project key, which only the invite carries. The server checks who is
 * calling, keeps files, and refuses to overwrite one. Nothing else.
 *
 * Node 22 or later, no packages. Settings are environment variables; see
 * README.md beside this file.
 *
 *   GET  /health                          → 200 "ok" (no sign-in)
 *   GET  /spaces/<id>/files?prefix=<dir>  → { "files": [ … ] }
 *   GET  /spaces/<id>/files/<path>        → the file
 *   PUT  /spaces/<id>/files/<path>        If-None-Match: * → 201, or 412 when it exists
 *   GET  /spaces/<id>/version             → { "version": "…" }
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SPACE = /^[\w-]{8,64}$/
const MAX_FILE_BYTES = 64 * 1024 * 1024
const JWKS_TTL_MS = 6 * 60 * 60 * 1000

/**
 * @param {{
 *   dataDir: string,
 *   keys?: string[],
 *   entra?: { tenant: string, audiences: string[] } | null,
 *   fetch?: typeof fetch,
 *   log?: (line: string) => void
 * }} options
 */
export function createSyncServer(options) {
  const dataDir = path.resolve(options.dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  const keys = (options.keys ?? []).filter(Boolean).map((key) => digest(key))
  const entra = options.entra ?? null
  const log = options.log ?? ((line) => console.log(line))
  const jwks = entra ? keySet(entra.tenant, options.fetch ?? fetch) : null
  if (keys.length === 0 && !entra) {
    throw new Error('Set OSTLER_SYNC_KEYS, or OSTLER_SYNC_TENANT and OSTLER_SYNC_AUDIENCE.')
  }

  async function signedIn(request) {
    const header = request.headers.authorization ?? ''
    const match = /^Bearer ([^\s]+)$/.exec(header)
    if (!match) return null
    const token = match[1]
    const hashed = digest(token)
    if (keys.some((key) => timingSafeEqual(key, hashed))) return 'key'
    if (entra && token.split('.').length === 3) {
      const claims = await checkJwt(token, entra, jwks)
      if (claims) return `entra:${claims.oid ?? claims.sub}`
    }
    return null
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://server')
    if (url.pathname === '/health') return send(response, 200, 'ok', 'text/plain')
    const route = /^\/spaces\/([^/]+)\/(files|version)(?:\/(.*))?$/.exec(url.pathname)
    if (!route || !SPACE.test(route[1])) return send(response, 404, { error: 'not-found' })
    const who = await signedIn(request)
    if (!who) {
      response.setHeader('WWW-Authenticate', 'Bearer')
      return send(response, 401, { error: 'sign-in' })
    }
    const space = path.join(dataDir, route[1])

    if (route[2] === 'version') {
      if (request.method !== 'GET') return send(response, 405, { error: 'method' })
      return send(response, 200, { version: readVersion(space) })
    }

    if (route[3] === undefined) {
      if (request.method !== 'GET') return send(response, 405, { error: 'method' })
      const prefix = url.searchParams.get('prefix') ?? ''
      const segments = prefix === '' ? [] : segmentsOf(prefix)
      if (!segments) return send(response, 400, { error: 'bad-path' })
      const files = []
      walk(path.join(space, ...segments), prefix, files)
      return send(response, 200, { files: files.sort() })
    }

    const segments = segmentsOf(decodePath(route[3]))
    if (!segments) return send(response, 400, { error: 'bad-path' })
    const file = path.join(space, ...segments)

    if (request.method === 'GET') {
      let bytes
      try {
        bytes = fs.readFileSync(file)
      } catch {
        return send(response, 404, { error: 'not-found' })
      }
      return send(response, 200, bytes, 'application/octet-stream')
    }

    if (request.method === 'PUT') {
      if (request.headers['if-none-match'] !== '*') {
        return send(response, 428, { error: 'if-none-match' })
      }
      const body = await readBody(request)
      if (!body) return send(response, 413, { error: 'too-big' })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = path.join(
        path.dirname(file),
        `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`
      )
      fs.writeFileSync(temp, body, { flag: 'wx' })
      try {
        // A hard link fails when the name is taken: written once, never replaced.
        fs.linkSync(temp, file)
      } catch (error) {
        if (error.code === 'EEXIST') return send(response, 412, { error: 'exists' })
        throw error
      } finally {
        fs.rmSync(temp, { force: true })
      }
      bumpVersion(space)
      log(`${new Date().toISOString()} ${who} wrote ${route[1]}/${segments.join('/')}`)
      return send(response, 201, { ok: true })
    }

    return send(response, 405, { error: 'method' })
  }

  return (request, response) => {
    handle(request, response).catch((error) => {
      log(`${new Date().toISOString()} error: ${error?.message ?? error}`)
      if (!response.headersSent) send(response, 500, { error: 'server' })
      else response.destroy()
    })
  }
}

function digest(text) {
  return createHash('sha256').update(text, 'utf8').digest()
}

function send(response, status, body, type = 'application/json') {
  const bytes = type === 'application/json' ? Buffer.from(JSON.stringify(body)) : Buffer.from(body)
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(bytes)
}

function decodePath(raw) {
  try {
    return raw
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return ''
  }
}

/** The same rules as Ostler's folder transport: relative, no `.`/`..`, no hidden or temp names. */
function segmentsOf(relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.startsWith('/')) {
    return null
  }
  const segments = relative.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.startsWith('.')) return null
    if (segment.endsWith('.tmp') || segment.includes('\0')) return null
  }
  return segments
}

function walk(folder, relative, files) {
  let entries
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.tmp') || entry.isSymbolicLink())
      continue
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) walk(path.join(folder, entry.name), next, files)
    else if (entry.isFile()) files.push(next)
  }
}

function readVersion(space) {
  try {
    return fs.readFileSync(path.join(space, '.version'), 'utf8')
  } catch {
    return '0'
  }
}

function bumpVersion(space) {
  const file = path.join(space, '.version')
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temp, `${Date.now()}-${randomBytes(4).toString('hex')}`)
  fs.renameSync(temp, file)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_FILE_BYTES) {
        request.destroy()
        resolve(null)
      } else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

// ─── Microsoft Entra sign-in ─────────────────────────────────────────────

function keySet(tenant, fetcher) {
  let cached = null
  let fetchedAt = 0
  return async (kid) => {
    if (!cached || Date.now() - fetchedAt > JWKS_TTL_MS || !cached.has(kid)) {
      const answer = await fetcher(
        `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`
      )
      if (!answer.ok) throw new Error(`JWKS ${answer.status}`)
      const { keys } = await answer.json()
      cached = new Map(keys.map((key) => [key.kid, key]))
      fetchedAt = Date.now()
    }
    return cached.get(kid) ?? null
  }
}

function part(text) {
  return JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
}

/** Checks an Entra access token: RS256, the tenant's own key, issuer, audience and time. */
export async function checkJwt(token, entra, jwks) {
  const [head, body, signature] = token.split('.')
  let header
  let claims
  try {
    header = part(head)
    claims = part(body)
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null
  const jwk = await jwks(header.kid)
  if (!jwk) return null
  const good = verify(
    'RSA-SHA256',
    Buffer.from(`${head}.${body}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url')
  )
  if (!good) return null
  const now = Math.floor(Date.now() / 1000)
  const issuers = [
    `https://login.microsoftonline.com/${entra.tenant}/v2.0`,
    `https://sts.windows.net/${entra.tenant}/`
  ]
  if (!issuers.includes(claims.iss)) return null
  if (!entra.audiences.includes(claims.aud)) return null
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) return null
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null
  return claims
}

// ─── Running it ──────────────────────────────────────────────────────────

function fromEnvironment() {
  const env = process.env
  const keys = [
    ...(env.OSTLER_SYNC_KEYS ?? '').split(','),
    ...(env.OSTLER_SYNC_KEYS_FILE
      ? fs.readFileSync(env.OSTLER_SYNC_KEYS_FILE, 'utf8').split(/\r?\n/)
      : [])
  ]
    .map((key) => key.trim())
    .filter((key) => key && !key.startsWith('#'))
  const entra =
    env.OSTLER_SYNC_TENANT && env.OSTLER_SYNC_AUDIENCE
      ? {
          tenant: env.OSTLER_SYNC_TENANT,
          audiences: env.OSTLER_SYNC_AUDIENCE.split(',').map((value) => value.trim())
        }
      : null
  return { dataDir: env.OSTLER_SYNC_DATA ?? './data', keys, entra }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const handler = createSyncServer(fromEnvironment())
  const port = Number(process.env.PORT ?? 8080)
  const server =
    process.env.TLS_CERT && process.env.TLS_KEY
      ? https.createServer(
          {
            cert: fs.readFileSync(process.env.TLS_CERT),
            key: fs.readFileSync(process.env.TLS_KEY)
          },
          handler
        )
      : http.createServer(handler)
  server.listen(port, () => console.log(`Ostler sync server listening on ${port}`))
}
