/**
 * Try it (N9.4, decision N62): the project's try command, run in a finished
 * task's copy when the person clicks Try it in Review changes, so they can
 * see the change working before they apply it. Nothing is applied.
 *
 * Pure: the rules every surface shares. The main process runs the command
 * (`electron/services/harness/try-it.ts`); Project settings saves it through
 * `parseTryCommand`; Review changes links local addresses through
 * `outputSegments`. Only a command the person typed ever runs: an agent's
 * suggestion (`parseSuggestedTryCommand`) is shown, never run.
 */

export const MAX_TRY_COMMAND_LENGTH = 500

/** The output panel keeps the last lines only. */
export const TRY_OUTPUT_LINES = 2000

/** Where a run is: preparing the copy, running, or ended one of three ways. */
export type TryRunState = 'setting-up' | 'running' | 'exited' | 'stopped' | 'failed'

/** One Try in one session, as the renderer sees it. */
export interface TryRun {
  projectId: string
  sessionId: string
  command: string
  state: TryRunState
  /** The command's exit code once it `exited`. */
  exitCode: number | null
  /** One line, when the run `failed` before or instead of starting. */
  failure?: string
  /** The last `TRY_OUTPUT_LINES` lines, colour codes stripped. */
  lines: string[]
  startedAt: string
  endedAt?: string
  /**
   * Files the run changed or added that Git does not ignore, relative to the
   * copy, once it has ended. Files already changed before the run are never
   * listed. Emptied by Undo those changes or Keep them.
   */
  leftFiles: string[]
}

const NEWLINE = /[\r\n]/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/

/**
 * Checks a try command arriving from Project settings: one line of up to 500
 * characters, trimmed. An empty one clears it (Try it is then off).
 */
export function parseTryCommand(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The try command is text')
  if (NEWLINE.test(value.trim())) throw new Error('The try command is one line')
  const command = value.trim()
  if (CONTROL.test(command.replace(/\t/g, ' '))) {
    throw new Error('The try command cannot hold control characters')
  }
  if (command.length > MAX_TRY_COMMAND_LENGTH) {
    throw new Error(`A try command can be at most ${MAX_TRY_COMMAND_LENGTH} characters`)
  }
  return command
}

/**
 * The command an agent suggests in its report, as text to show beside
 * **Use this command**, or undefined when it is not one usable line. Shown
 * only: nothing an agent writes is ever run.
 */
export function parseSuggestedTryCommand(value: unknown): string | undefined {
  try {
    const command = parseTryCommand(value)
    return command || undefined
  } catch {
    return undefined
  }
}

/** Whether Try it asks before its first run in this project. */
export function needsTryWarning(project: { tryItWarningSeen?: boolean }): boolean {
  return project.tryItWarningSeen !== true
}

/** Strips terminal colour and cursor codes so output reads as text. */
export function stripTerminalCodes(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether `url` is an http address on this computer: localhost, 127.0.0.1 or [::1]. */
export function isLocalAddress(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOCAL_HOSTS.has(parsed.hostname) &&
      parsed.username === '' &&
      parsed.password === ''
    )
  } catch {
    return false
  }
}

const ADDRESS =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?![\w-]|\.[\w-])(?::\d{1,5})?(?:[/?#][^\s"'<>`]*)?/gi

/** A piece of an output line: text, or a local address to open. */
export interface OutputSegment {
  text: string
  url?: string
}

/**
 * Splits an output line into text and local addresses. Only
 * `http(s)://localhost`, `127.0.0.1` and `[::1]` addresses become links;
 * every other link stays text. Trailing punctuation is left out of a link.
 */
export function outputSegments(line: string): OutputSegment[] {
  const segments: OutputSegment[] = []
  let last = 0
  for (const match of line.matchAll(ADDRESS)) {
    const start = match.index ?? 0
    // An address glued to a word (`xhttp://localhost`) is not one.
    if (start > 0 && /[\w@.]/.test(line[start - 1])) continue
    let url = match[0]
    while (/[.,;:!?)\]}]$/.test(url) && !url.endsWith('[::1]')) url = url.slice(0, -1)
    if (!isLocalAddress(url)) continue
    if (start > last) segments.push({ text: line.slice(last, start) })
    segments.push({ text: url, url })
    last = start + url.length
  }
  if (last < line.length) segments.push({ text: line.slice(last) })
  return segments.length > 0 ? segments : [{ text: line }]
}

/** Keeps the last `TRY_OUTPUT_LINES` of a growing list, in place. */
export function trimOutput(lines: string[]): void {
  if (lines.length > TRY_OUTPUT_LINES) lines.splice(0, lines.length - TRY_OUTPUT_LINES)
}
