import fs from 'node:fs'
import path from 'node:path'
import { Inflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { LIBRARY_MAX_FILE_BYTES } from '@shared/ostler-api'
import { MAX_IMPORT_FILE_BYTES } from '@shared/import/import-plan'
import { t } from '@shared/i18n'

/**
 * The one-file project export (D29): a zip whose contents are exactly the
 * export folder's layout, `project.json` and `library/<file>`. Written and
 * read in chunks, so a large Library never sits in memory whole.
 *
 * Every archive is hostile. Its central directory is checked in full before
 * anything is written: only `project.json` and files directly in `library/`,
 * no absolute paths, drive letters, `..`, links or encrypted entries, and
 * limits on the number of entries and their uncompressed size (counted as
 * they inflate too, since a zip can lie about its sizes). It is extracted
 * only into a new folder the caller names, under the data folder, which is
 * removed again if anything fails.
 */

export const PROJECT_FILE_EXTENSION = '.ostler-project'

export interface ArchiveLimits {
  maxEntries: number
  maxTotalBytes: number
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024
}

const CHUNK = 1024 * 1024
const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_DIRECTORY = 0x06054b50
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** A file the archive will hold: its name inside, and where it comes from. */
export type ArchiveSource = { name: string; filePath: string } | { name: string; text: string }

/** Writes the archive to `target`; a failed write leaves nothing behind. */
export function writeProjectArchive(target: string, sources: ArchiveSource[]): void {
  const fd = fs.openSync(target, 'w')
  let failure: Error | null = null
  try {
    const zip = new Zip((error, chunk) => {
      if (error) failure = error
      else fs.writeSync(fd, chunk)
    })
    for (const source of sources) {
      if ('text' in source) {
        const entry = new ZipDeflate(source.name, { level: 6 })
        zip.add(entry)
        entry.push(new TextEncoder().encode(source.text), true)
      } else {
        // Library files are mostly compressed already (images, PDFs): stored as they are.
        const entry = new ZipPassThrough(source.name)
        zip.add(entry)
        const input = fs.openSync(source.filePath, 'r')
        try {
          const buffer = Buffer.alloc(CHUNK)
          let read: number
          do {
            read = fs.readSync(input, buffer, 0, CHUNK, null)
            entry.push(Uint8Array.prototype.slice.call(buffer, 0, read), read < CHUNK)
          } while (read === CHUNK)
        } finally {
          fs.closeSync(input)
        }
      }
      if (failure) throw failure
    }
    zip.end()
    if (failure) throw failure
    fs.closeSync(fd)
  } catch (error) {
    try {
      fs.closeSync(fd)
    } catch {
      // Already closed.
    }
    fs.rmSync(target, { force: true })
    throw error
  }
}

/** Whether a file starts like a zip. */
export function looksLikeArchive(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(4)
    return fs.readSync(fd, head, 0, 4, 0) === 4 && head.readUInt32LE(0) === LOCAL_HEADER
  } finally {
    fs.closeSync(fd)
  }
}

interface ArchiveEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
}

/**
 * Extracts a project file into `folder`, which must not exist yet. Returns
 * the folder, laid out as an export folder. On any refusal or failure the
 * folder is removed and the error says why in plain words.
 */
export function extractProjectArchive(
  archivePath: string,
  folder: string,
  limits: ArchiveLimits = ARCHIVE_LIMITS
): string {
  const fd = fs.openSync(archivePath, 'r')
  let created = false
  try {
    const entries = readDirectory(fd, fs.fstatSync(fd).size, limits)
    if (!entries.some((entry) => entry.name === 'project.json'))
      throw new Error(t('errors:projectArchive.noProjectJson'))
    fs.mkdirSync(folder, { recursive: false })
    created = true
    fs.mkdirSync(path.join(folder, 'library'))
    let total = 0
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue
      const target = path.join(folder, ...entry.name.split('/'))
      const resolved = path.resolve(target)
      if (!resolved.startsWith(path.resolve(folder) + path.sep)) throw refusal('unsafePath', entry)
      total = extractEntry(fd, entry, resolved, total, limits)
    }
    return folder
  } catch (error) {
    if (created) fs.rmSync(folder, { recursive: true, force: true })
    throw error
  } finally {
    fs.closeSync(fd)
  }
}

function refusal(key: string, entry?: { name: string }): Error {
  return new Error(t(`errors:projectArchive.${key}`, { name: entry?.name ?? '' }))
}

/** The central directory, every entry checked before anything is written. */
function readDirectory(fd: number, fileSize: number, limits: ArchiveLimits): ArchiveEntry[] {
  const tailSize = Math.min(fileSize, 65_557)
  const tail = Buffer.alloc(tailSize)
  fs.readSync(fd, tail, 0, tailSize, fileSize - tailSize)
  let end = -1
  for (let index = tailSize - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) === END_OF_DIRECTORY) {
      end = index
      break
    }
  }
  if (end < 0) throw refusal('notProjectFile')
  const count = tail.readUInt16LE(end + 10)
  const directorySize = tail.readUInt32LE(end + 12)
  const directoryOffset = tail.readUInt32LE(end + 16)
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff)
    throw refusal('tooLarge')
  if (count > limits.maxEntries)
    throw new Error(t('errors:projectArchive.tooManyEntries', { max: limits.maxEntries }))
  if (directoryOffset + directorySize > fileSize) throw refusal('damaged')

  const directory = Buffer.alloc(directorySize)
  fs.readSync(fd, directory, 0, directorySize, directoryOffset)
  const entries: ArchiveEntry[] = []
  const seen = new Set<string>()
  let declared = 0
  let at = 0
  for (let index = 0; index < count; index++) {
    if (at + 46 > directorySize || directory.readUInt32LE(at) !== CENTRAL_HEADER)
      throw refusal('damaged')
    const madeBy = directory.readUInt16LE(at + 4) >> 8
    const flags = directory.readUInt16LE(at + 8)
    const method = directory.readUInt16LE(at + 10)
    const crc = directory.readUInt32LE(at + 16)
    const compressedSize = directory.readUInt32LE(at + 20)
    const size = directory.readUInt32LE(at + 24)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const external = directory.readUInt32LE(at + 38)
    const localOffset = directory.readUInt32LE(at + 42)
    const raw = directory.subarray(at + 46, at + 46 + nameLength)
    const name = new TextDecoder('utf-8').decode(raw)
    at += 46 + nameLength + extraLength + commentLength

    const entry = { name }
    checkName(name)
    // Unix-made zips keep the file mode in the high bits: a symbolic link is refused.
    const mode = external >>> 16
    if ((madeBy === 3 || madeBy === 19) && (mode & 0o170000) === 0o120000)
      throw refusal('link', entry)
    if (flags & 0x1) throw refusal('encrypted', entry)
    if (method !== 0 && method !== 8) throw refusal('unsupported', entry)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw refusal('tooLarge')
    const key = name.toLowerCase()
    if (seen.has(key)) throw refusal('duplicate', entry)
    seen.add(key)
    declared += size
    if (declared > limits.maxTotalBytes) throw tooLarge(limits)
    entries.push({ name, method, crc, compressedSize, size, localOffset })
  }
  return entries
}

function tooLarge(limits: ArchiveLimits): Error {
  return new Error(
    t('errors:projectArchive.tooLargeUncompressed', {
      size: `${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB`
    })
  )
}

/**
 * Zip names use `/`; a Windows zipper may write `\`. Both are separators
 * here. Only `project.json`, `library/` and files directly in it pass.
 */
export function checkName(name: string): void {
  const entry = { name }
  const normal = name.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normal)) throw refusal('driveLetter', entry)
  if (normal.startsWith('/')) throw refusal('absolute', entry)
  if (normal.split('/').some((part) => part === '..')) throw refusal('parent', entry)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(normal) || normal !== name) throw refusal('unsafePath', entry)
  if (normal === 'project.json' || normal === 'library/') return
  const match = /^library\/([^/]+)$/.exec(normal)
  const file = match?.[1]
  if (!file || /[<>:"|?*]/.test(file) || /[. ]$/.test(file) || file === '.' || RESERVED.test(file))
    throw refusal('notPartOfProject', entry)
}

function extractEntry(
  fd: number,
  entry: ArchiveEntry,
  target: string,
  total: number,
  limits: ArchiveLimits
): number {
  const header = Buffer.alloc(30)
  if (fs.readSync(fd, header, 0, 30, entry.localOffset) !== 30) throw refusal('damaged')
  if (header.readUInt32LE(0) !== LOCAL_HEADER) throw refusal('damaged')
  const dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
  const entryLimit = entry.name === 'project.json' ? MAX_IMPORT_FILE_BYTES : LIBRARY_MAX_FILE_BYTES
  if (entry.size > entryLimit) throw entryTooLarge(entry)

  const out = fs.openSync(target, 'wx')
  let written = 0
  let crc = 0xffffffff
  const write = (chunk: Uint8Array) => {
    written += chunk.length
    total += chunk.length
    if (written > entryLimit) throw entryTooLarge(entry)
    if (total > limits.maxTotalBytes) throw tooLarge(limits)
    if (written > entry.size) throw refusal('damaged')
    crc = crc32(chunk, crc)
    fs.writeSync(out, chunk)
  }
  try {
    const inflate = entry.method === 8 ? new Inflate((chunk) => write(chunk)) : null
    const buffer = Buffer.alloc(CHUNK)
    let remaining = entry.compressedSize
    let position = dataStart
    while (remaining > 0) {
      const want = Math.min(CHUNK, remaining)
      const read = fs.readSync(fd, buffer, 0, want, position)
      if (read <= 0) throw refusal('damaged')
      remaining -= read
      position += read
      const chunk = Uint8Array.prototype.slice.call(buffer, 0, read) as Uint8Array
      if (inflate) inflate.push(chunk, remaining === 0)
      else write(chunk)
    }
    if (inflate && entry.compressedSize === 0) inflate.push(new Uint8Array(0), true)
    if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) throw refusal('damaged')
  } catch (error) {
    // fflate's own errors carry a numeric code: the data does not inflate.
    if (typeof (error as { code?: unknown } | null)?.code === 'number') throw refusal('damaged')
    throw error
  } finally {
    fs.closeSync(out)
  }
  return total
}

function entryTooLarge(entry: ArchiveEntry): Error {
  return entry.name === 'project.json'
    ? new Error(t('errors:importService.fileLargerThan50'))
    : new Error(t('errors:importService.largerThanLibraryTakes', { file: entry.name }))
}

let CRC_TABLE: Uint32Array | null = null

function crc32(data: Uint8Array, crc: number): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  for (let index = 0; index < data.length; index++)
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  return crc >>> 0
}
