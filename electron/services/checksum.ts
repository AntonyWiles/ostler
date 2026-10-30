import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ChecksumVerdict } from '@shared/ostler-api'

/**
 * Checksum files (`<file>.sha256`) in the form `sha256sum` writes and
 * `sha256sum -c` (or PowerShell's Get-FileHash) checks: the hex digest, a
 * space, an asterisk for binary mode, and the file's name.
 */
export const CHECKSUM_EXTENSION = '.sha256'

export function checksumPathFor(filePath: string): string {
  return `${filePath}${CHECKSUM_EXTENSION}`
}

/** The file's SHA-256 as lower-case hex, read a piece at a time. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Writes `<file>.sha256` beside the file; returns its path and the digest. */
export async function writeChecksumFile(
  filePath: string
): Promise<{ checksumPath: string; sha256: string }> {
  const sha256 = await sha256File(filePath)
  const checksumPath = checksumPathFor(filePath)
  fs.writeFileSync(checksumPath, `${sha256} *${path.basename(filePath)}\n`, 'utf8')
  return { checksumPath, sha256 }
}

/** The digest a checksum file holds, or null when it holds none. */
export function readChecksumFile(checksumPath: string): string | null {
  const match = /^([0-9a-f]{64})\b/i.exec(fs.readFileSync(checksumPath, 'utf8').trim())
  return match ? match[1].toLowerCase() : null
}

/** Checks a file against the checksum file beside it. */
export async function verifyChecksumFile(filePath: string): Promise<ChecksumVerdict> {
  const checksumPath = checksumPathFor(filePath)
  if (!fs.existsSync(checksumPath)) return 'missing'
  const expected = readChecksumFile(checksumPath)
  if (expected === null) return 'differs'
  return (await sha256File(filePath)) === expected ? 'matches' : 'differs'
}
