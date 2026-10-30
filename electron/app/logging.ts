import * as fs from 'fs'
import { join } from 'path'
import { inspect } from 'util'

/**
 * Ostler's own log, `<dataDir>/logs/main.log`, for errors a user can send when
 * something breaks (Settings › About › Copy diagnostics reads its tail).
 * Writes are synchronous so the line about a crash is on disk before the
 * process goes. The file rotates at `maxBytes`, keeping `keepFiles` files in
 * all: main.log, main.1.log, main.2.log.
 */
export class FileLog {
  readonly path: string
  private size: number

  constructor(
    readonly directory: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly keepFiles = 3
  ) {
    fs.mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'main.log')
    this.size = fs.existsSync(this.path) ? fs.statSync(this.path).size : 0
  }

  error(message: string, error?: unknown): void {
    this.write('ERROR', message, error)
  }

  warn(message: string, error?: unknown): void {
    this.write('WARN', message, error)
  }

  info(message: string): void {
    this.write('INFO', message)
  }

  /** The last `count` lines across the current file and, if needed, the one before it. */
  tail(count: number): string[] {
    const read = (file: string) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []
    const current = read(this.path)
    const lines = current.length >= count ? current : [...read(this.rotatedPath(1)), ...current]
    return lines.slice(-count)
  }

  private write(level: string, message: string, error?: unknown): void {
    const detail = error === undefined ? '' : `\n${describeError(error)}`
    const line = `${new Date().toISOString()} ${level} ${message}${detail}\n`
    try {
      const bytes = Buffer.byteLength(line)
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate()
      fs.appendFileSync(this.path, line)
      this.size += bytes
    } catch {
      // A log that cannot be written must never take the app down with it.
    }
  }

  private rotate(): void {
    const oldest = this.rotatedPath(this.keepFiles - 1)
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true })
    for (let index = this.keepFiles - 2; index >= 1; index -= 1) {
      const from = this.rotatedPath(index)
      if (fs.existsSync(from)) fs.renameSync(from, this.rotatedPath(index + 1))
    }
    if (this.keepFiles > 1) fs.renameSync(this.path, this.rotatedPath(1))
    else fs.rmSync(this.path, { force: true })
    this.size = 0
  }

  private rotatedPath(index: number): string {
    return join(this.directory, `main.${index}.log`)
  }
}

/** An error's stack when it has one, otherwise a readable rendering of the value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return typeof error === 'string' ? error : inspect(error, { depth: 4 })
}

let current: FileLog | null = null

/** Opens `<dataDir>/logs/main.log`. Until this runs, `appLog` writes only to the console. */
export function initLogging(dataDir: string): FileLog {
  current = new FileLog(join(dataDir, 'logs'))
  return current
}

/** The open log, or null before `initLogging`. */
export function getLog(): FileLog | null {
  return current
}

/** Logs to main.log and the console; safe to call before `initLogging`. */
export const appLog = {
  error(message: string, error?: unknown): void {
    console.error(message, ...(error === undefined ? [] : [error]))
    current?.error(message, error)
  },
  warn(message: string, error?: unknown): void {
    console.warn(message, ...(error === undefined ? [] : [error]))
    current?.warn(message, error)
  },
  info(message: string): void {
    console.log(message)
    current?.info(message)
  }
}

/**
 * Records what Electron and Node report about a crash: uncaught exceptions,
 * unhandled rejections, a renderer that died, and a child process that died.
 * `onRenderProcessGone` is where main reloads the window.
 */
export function recordProcessFailures(
  app: Electron.App,
  onRenderProcessGone: (
    contents: Electron.WebContents,
    details: Electron.RenderProcessGoneDetails
  ) => void
): void {
  process.on('uncaughtException', (error) => appLog.error('Uncaught exception', error))
  process.on('unhandledRejection', (reason) => appLog.error('Unhandled promise rejection', reason))
  app.on('render-process-gone', (_event, contents, details) => {
    appLog.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
    onRenderProcessGone(contents, details)
  })
  app.on('child-process-gone', (_event, details) => {
    appLog.error(
      `Child process gone: ${details.type}${details.name ? ` (${details.name})` : ''}: ${details.reason} (exit code ${details.exitCode})`
    )
  })
}
