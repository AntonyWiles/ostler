import * as fs from 'fs'
import * as path from 'path'
import type {
  HarnessReportPicture,
  HarnessReportPictureLeftOut,
  HarnessReportPictureRequest,
  HarnessTaskReport
} from '@shared/ostler-api'
import {
  MAX_REPORT_PICTURE_BYTES,
  MAX_REPORT_PICTURES,
  relativeReportPath
} from '@shared/agent-report-extras'

/**
 * Pictures in an agent's report (N9.1). They are copied out of the task's
 * copy the moment the report arrives, because Apply, Discard and Stop remove
 * the copy, into `<projectDir>/report-pictures/<sessionId>/`. A session's
 * folder goes when its record leaves the harness state, and the whole
 * project folder when the project is removed.
 *
 * The agent wrote the paths, so each is resolved against the copy's real
 * path (links followed) and refused if it ends up anywhere else, and a file
 * is an image only by its first bytes, never its name.
 */

export const REPORT_PICTURES_DIR = 'report-pictures'

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
} as const
type ImageExtension = keyof typeof IMAGE_TYPES

/** A stored picture's name: its number, a tidy stem and the extension its bytes say. */
const PICTURE_NAME = /^(\d{1,4})-[A-Za-z0-9_-]{0,40}\.(png|jpg|gif|webp)$/
const SESSION_FOLDER = /^[A-Za-z0-9_-]{1,100}$/

/** The image type of a file by its first bytes, or null. */
export function imageTypeOf(bytes: Uint8Array): ImageExtension | null {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

export function reportPicturesRoot(projectDir: string): string {
  return path.join(projectDir, REPORT_PICTURES_DIR)
}

export function sessionPicturesDir(projectDir: string, sessionId: string): string | null {
  return SESSION_FOLDER.test(sessionId)
    ? path.join(reportPicturesRoot(projectDir), sessionId)
    : null
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function stemOf(relativePath: string): string {
  return (
    path.posix
      .basename(relativePath)
      .replace(/\.[^.]*$/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'picture'
  )
}

/** The next free number in a session's folder: a session that auto-continues files several reports. */
function nextNumber(dir: string): number {
  let highest = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      const match = PICTURE_NAME.exec(name)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
  } catch {
    // No folder yet.
  }
  return highest + 1
}

/**
 * Copies the requested pictures out of the copy at `copyPath`. Returns what
 * was copied and what was left out, in the agent's order. Never throws for a
 * bad picture: a report is never refused over its pictures.
 */
export function copyReportPictures(
  copyPath: string | null,
  projectDir: string,
  sessionId: string,
  requests: HarnessReportPictureRequest[]
): { pictures: HarnessReportPicture[]; leftOut: HarnessReportPictureLeftOut[] } {
  const pictures: HarnessReportPicture[] = []
  const leftOut: HarnessReportPictureLeftOut[] = []
  const destination = sessionPicturesDir(projectDir, sessionId)
  let root: string | null = null
  try {
    root = copyPath ? fs.realpathSync(copyPath) : null
  } catch {
    root = null
  }
  let number = destination ? nextNumber(destination) : 1
  for (const request of requests) {
    const leave = (reason: HarnessReportPictureLeftOut['reason']) =>
      leftOut.push({ path: request.path, reason })
    const relative = relativeReportPath(request.path)
    if (!relative) {
      leave('outside-copy')
      continue
    }
    if (!root || !destination) {
      leave('not-found')
      continue
    }
    let real: string
    try {
      // realpath follows every link on the way, so a link out of the copy
      // (file or folder) resolves to where it really points.
      real = fs.realpathSync(path.resolve(root, relative))
    } catch {
      leave('not-found')
      continue
    }
    if (!inside(root, real)) {
      leave('outside-copy')
      continue
    }
    let size: number
    try {
      const stats = fs.statSync(real)
      if (!stats.isFile()) {
        leave('not-found')
        continue
      }
      size = stats.size
    } catch {
      leave('not-found')
      continue
    }
    if (size > MAX_REPORT_PICTURE_BYTES) {
      leave('too-large')
      continue
    }
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(real)
    } catch {
      leave('not-found')
      continue
    }
    const type = imageTypeOf(bytes)
    if (!type) {
      leave('not-image')
      continue
    }
    if (pictures.length >= MAX_REPORT_PICTURES) {
      leave('too-many')
      continue
    }
    const name = `${number}-${stemOf(relative)}.${type}`
    try {
      fs.mkdirSync(destination, { recursive: true })
      fs.writeFileSync(path.join(destination, name), bytes)
    } catch {
      leave('not-found')
      continue
    }
    number += 1
    pictures.push({
      name,
      path: relative,
      ...(request.caption ? { caption: request.caption } : {}),
      size: bytes.length
    })
  }
  return { pictures, leftOut }
}

/**
 * The report as it is stored: the pictures it named copied out and listed by
 * name, the requests themselves dropped. A report without requests passes
 * through unchanged.
 */
export function withCopiedPictures(
  report: HarnessTaskReport | null,
  copyPath: string | null,
  projectDir: string,
  sessionId: string
): HarnessTaskReport | null {
  if (!report) return report
  const { pictureRequests, ...rest } = report
  if (!pictureRequests || pictureRequests.length === 0) return rest
  const { pictures, leftOut } = copyReportPictures(copyPath, projectDir, sessionId, pictureRequests)
  return {
    ...rest,
    ...(pictures.length > 0 ? { pictures } : {}),
    ...(leftOut.length > 0 ? { picturesLeftOut: leftOut } : {})
  }
}

/** One stored picture's bytes and type, or null for anything that is not one. */
export function readReportPicture(
  projectDir: string,
  sessionId: string,
  name: string
): { bytes: Buffer; mimeType: string } | null {
  const dir = sessionPicturesDir(projectDir, sessionId)
  const match = PICTURE_NAME.exec(name)
  if (!dir || !match) return null
  try {
    const bytes = fs.readFileSync(path.join(dir, name))
    return { bytes, mimeType: IMAGE_TYPES[match[2] as ImageExtension] }
  } catch {
    return null
  }
}

/**
 * Deletes the picture folders of sessions no longer in the state, so a
 * session's pictures go with its record whichever way it leaves.
 */
export function sweepReportPictures(projectDir: string, sessionIds: Iterable<string>): void {
  const root = reportPicturesRoot(projectDir)
  let entries: string[]
  try {
    entries = fs.readdirSync(root)
  } catch {
    return
  }
  const keep = new Set(sessionIds)
  for (const entry of entries) {
    if (keep.has(entry)) continue
    try {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true })
    } catch (error) {
      console.warn(`[HarnessService] Could not delete report pictures ${entry}:`, error)
    }
  }
}
