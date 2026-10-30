import type {
  HarnessCommentAnswer,
  HarnessReportPictureRequest,
  HarnessWalkthroughStop
} from './ostler-api/harness-types'
import { parseCommentAnswers } from './comment-answers'
import { REVIEWER_RUNS_AVAILABLE } from './reviewer-runs'
import { parseSuggestedTryCommand } from './try-it'

/**
 * Pictures and a walkthrough in an agent's completion report (N9.1, decision
 * N59). A report is written by an agent, so everything here is untrusted
 * text: this is the one place both agent paths (the embedded plugin and the
 * harness HTTP API) read them, and it only bounds and shapes them. Whether a
 * picture's path really lies inside the copy is checked against the disk
 * when Ostler copies it out (`electron/services/harness/report-pictures.ts`).
 */

/** The folder in a copy where an agent saves its pictures; Ostler keeps it out of the changes. */
export const REPORT_PICTURES_FOLDER = '.ostler-pictures'
export const MAX_REPORT_PICTURES = 10
export const MAX_REPORT_PICTURE_BYTES = 5 * 1024 * 1024
export const MAX_PICTURE_CAPTION_LENGTH = 200
export const MAX_WALKTHROUGH_STOPS = 30
export const MAX_WALKTHROUGH_NOTE_LENGTH = 1000
const MAX_PATH_LENGTH = 500
/** Requests read beyond the limit, so the extras are listed as left out rather than lost. */
const MAX_PICTURE_REQUESTS = 50
const MAX_LINE = 10_000_000

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Removes control characters (newlines in a caption included); a note keeps its newlines. */
function plain(value: string, keepNewlines: boolean): string {
  const pattern = keepNewlines
    ? // eslint-disable-next-line no-control-regex
      /[\u0000-\u0009\u000B-\u001F\u007F]/g
    : // eslint-disable-next-line no-control-regex
      /[\u0000-\u001F\u007F]+/g
  return value.replace(pattern, keepNewlines ? '' : ' ')
}

/**
 * A path relative to the copy, with forward slashes, or null when it is
 * absolute or climbs out with `..`.
 */
export function relativeReportPath(value: unknown): string | null {
  const raw = text(value)
  if (!raw || raw.length > MAX_PATH_LENGTH || raw.includes('\0')) return null
  const slashed = raw.replace(/\\/g, '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return null
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  return parts.join('/')
}

/**
 * The pictures an agent named: a list of paths, or of `{ path, caption }`.
 * Paths are kept as given here (a bad one is reported as left out when the
 * copy is made); captions are cut to 200 characters.
 */
export function parsePictureRequests(value: unknown): HarnessReportPictureRequest[] {
  if (!Array.isArray(value)) return []
  const requests: HarnessReportPictureRequest[] = []
  for (const entry of value.slice(0, MAX_PICTURE_REQUESTS)) {
    const candidate =
      typeof entry === 'string'
        ? { path: entry }
        : entry && typeof entry === 'object'
          ? entry
          : null
    if (!candidate) continue
    const path = text((candidate as Record<string, unknown>).path).slice(0, MAX_PATH_LENGTH)
    if (!path) continue
    const caption = plain(text((candidate as Record<string, unknown>).caption), false)
      .trim()
      .slice(0, MAX_PICTURE_CAPTION_LENGTH)
    requests.push({ path, ...(caption ? { caption } : {}) })
  }
  return requests
}

function lineNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return null
  const whole = Math.floor(number)
  return whole >= 1 && whole <= MAX_LINE ? whole : null
}

/**
 * The walkthrough: at most 30 stops, each a relative path, a first and last
 * line (from 1; swapped when given backwards, the last defaulting to the
 * first) and a note cut to 1,000 characters. A stop without a usable path,
 * first line or note is dropped.
 */
export function parseWalkthrough(value: unknown): HarnessWalkthroughStop[] {
  if (!Array.isArray(value)) return []
  const stops: HarnessWalkthroughStop[] = []
  for (const entry of value) {
    if (stops.length >= MAX_WALKTHROUGH_STOPS) break
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const path = relativeReportPath(candidate.path ?? candidate.file)
    const first = lineNumber(candidate.startLine ?? candidate.line)
    const note = plain(text(candidate.note), true).trim().slice(0, MAX_WALKTHROUGH_NOTE_LENGTH)
    if (!path || first === null || !note) continue
    const last = lineNumber(candidate.endLine) ?? first
    stops.push({
      path,
      startLine: Math.min(first, last),
      endLine: Math.max(first, last),
      note
    })
  }
  return stops
}

/**
 * The extras of a raw report (pictures, a walkthrough, answers to line
 * comments, N9.2b, and a suggested try command, N9.4), as the report fields they become; empty ones are left out.
 */
export function parseReportExtras(candidate: Record<string, unknown>): {
  pictureRequests?: HarnessReportPictureRequest[]
  walkthrough?: HarnessWalkthroughStop[]
  commentAnswers?: HarnessCommentAnswer[]
  findingRequests?: unknown[]
  tryCommand?: string
} {
  const pictureRequests = parsePictureRequests(candidate.pictures)
  // A reviewer's findings (N9.5a), checked against the diff when the review ends.
  const findingRequests =
    REVIEWER_RUNS_AVAILABLE && Array.isArray(candidate.findings)
      ? candidate.findings.slice(0, 200)
      : []
  const walkthrough = parseWalkthrough(candidate.walkthrough)
  const commentAnswers = parseCommentAnswers(candidate.commentAnswers)
  // A suggestion only (N9.4): shown to the person, never run.
  const tryCommand = parseSuggestedTryCommand(candidate.tryCommand)
  return {
    ...(pictureRequests.length > 0 ? { pictureRequests } : {}),
    ...(walkthrough.length > 0 ? { walkthrough } : {}),
    ...(commentAnswers.length > 0 ? { commentAnswers } : {}),
    ...(findingRequests.length > 0 ? { findingRequests } : {}),
    ...(tryCommand ? { tryCommand } : {})
  }
}

/** What an agent is told about both, in the harness help and the embedded instructions. */
export const REPORT_EXTRAS_GUIDANCE = {
  pictures:
    'pictures (optional): up to 10 screenshots you took of your work, when the change is something a person can see. Each is a path relative to your folder (PNG, JPEG, GIF or WebP, 5 MB at most), as a string or { path, caption } with a caption of up to 200 characters. Save them in the .ostler-pictures folder inside your folder: Ostler keeps that folder out of your changes and copies the pictures out when your report arrives.',
  walkthrough:
    'walkthrough (optional): for a large change, where to start reading. An ordered list of up to 30 stops, each { path, startLine, endLine, note }: a changed file relative to your folder, the first and last line in its new version, and a note of up to 1000 characters on what those lines do and why.',
  tryCommand:
    'tryCommand (optional): one command, up to 500 characters on one line, that lets a person see your change working, such as "npm run dev" or "npm test". Ostler shows it as a suggestion; it never runs it. The person decides whether to save it as the try command of the project.'
} as const
