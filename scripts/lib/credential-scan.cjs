/*
 * Finds bucket credentials (Cloudflare R2 / S3-style keys) in text or in a
 * built app bundle. Used by check-hygiene (commits and pushes) and by the
 * Android release build, which scans the finished Play bundle.
 *
 * Three kinds of hit:
 *  - a credential written out: `secretAccessKey: '…'`, `ACCESS_KEY_ID=…`
 *  - the same, base64-encoded (how a test build carries its bucket settings,
 *    see mobile/scripts/sideload-android.cjs --r2-config)
 *  - an exact value from this clone's own secret files. Their paths live in
 *    local git config, never in the repo:
 *      git config --add ostler.secretFile <file or folder>
 *    Every string of 12+ characters in those files (JSON leaves, or lines of
 *    other files) and the base64 form of each JSON file count as secret.
 *
 * Messages name the kind of secret and where it is, never the value.
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { Buffer } = require('node:buffer')
const { execFileSync } = require('node:child_process')

const CREDENTIAL =
  /(?<![A-Za-z0-9])(secret_?access_?key|access_?key_?id)["'`]?\s*[:=]\s*["'`]?[A-Za-z0-9/+=_-]{20,}/i
const BASE64_RUN = /[A-Za-z0-9+/]{60,}={0,2}/g
/** The variable a test build carries its bucket in; it must never hold a value in the repo. */
const BUILT_IN_ASSIGNMENT = /EXPO_PUBLIC_OSTLER_BUILT_IN_R2\s*[:=]\s*["'`]?[A-Za-z0-9+/]{20,}/

/** Returns the reason a piece of text holds a bucket credential, or null. */
function credentialReason(text) {
  if (CREDENTIAL.test(text)) return 'bucket credential'
  if (BUILT_IN_ASSIGNMENT.test(text)) return 'built-in bucket settings'
  // A bundle packs strings back to back, so a run can start with a neighbour's last characters:
  // try each of the four alignments.
  for (const run of text.match(BASE64_RUN) ?? []) {
    for (let shift = 0; shift < 4; shift++) {
      if (CREDENTIAL.test(Buffer.from(run.slice(shift), 'base64').toString('latin1'))) {
        return 'base64-encoded bucket credential'
      }
    }
  }
  return null
}

function leaves(value, out) {
  if (typeof value === 'string') out.push(value)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) leaves(v, out)
  return out
}

function filesUnder(target) {
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    return []
  }
  if (!stat.isDirectory()) return [target]
  return fs.readdirSync(target).flatMap((name) => filesUnder(path.join(target, name)))
}

/**
 * The exact secret values listed by `ostler.secretFile` in this clone's git
 * config, as [value, label] pairs. Empty when none are set up.
 */
function localSecrets(root) {
  let targets = []
  try {
    targets = execFileSync('git', ['config', '--get-all', 'ostler.secretFile'], {
      cwd: root,
      encoding: 'utf8'
    })
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    return []
  }
  const secrets = []
  for (const file of targets.flatMap(filesUnder)) {
    const label = `secret from ${path.basename(file)}`
    const text = fs.readFileSync(file, 'utf8')
    let values
    try {
      const parsed = JSON.parse(text)
      values = leaves(parsed, [])
      // The form a test build carries it in (sideload-android.cjs --r2-config).
      const encoded = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64')
      values.push(encoded.slice(0, 48))
    } catch {
      values = text.split(/\r?\n/).map((line) => line.trim())
    }
    for (const value of values) if (value.length >= 12) secrets.push([value, label])
  }
  return secrets
}

/** Messages for every credential or local secret in `buffer` (text or binary). */
function scanBuffer(buffer, secrets) {
  const problems = []
  for (const [value, label] of secrets) {
    if (buffer.includes(value)) problems.push(label)
  }
  const reason = credentialReason(buffer.toString('latin1'))
  if (reason) problems.push(reason)
  return [...new Set(problems)]
}

/** One file from a zip (an .aab or .apk), or null when it is not there. Stored or deflated only. */
function readZipEntry(zipFile, name) {
  const zip = fs.readFileSync(zipFile)
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let end = zip.length - 22
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error(`${zipFile} is not a zip`)
  let at = zip.readUInt32LE(end + 16)
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + size)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return zlib.inflateRawSync(data)
      throw new Error(`${name} in ${zipFile} uses zip method ${method}`)
    }
    at += 46 + skip
  }
  return null
}

module.exports = { credentialReason, localSecrets, readZipEntry, scanBuffer }
