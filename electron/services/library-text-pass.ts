import type { LibraryTextProgress } from '@shared/ostler-api'

/**
 * The background pass that reads, once, the Library files the current text
 * reader has not read (N4.5): Word, PowerPoint and Excel files imported
 * before it, and PDFs read before page breaks.
 *
 * One file at a time, started after start-up is over, waiting while the
 * person is using the keyboard or mouse. What has been read is recorded in
 * each file's own details (`textReader`), so a restart carries on where it
 * stopped and nothing is read twice.
 */

export interface LibraryTextPassLibrary {
  listUnreadDocuments(): { projectId: string; itemId: string }[]
  readStoredText(projectId: string, itemId: string): Promise<boolean>
}

export interface LibraryTextPassOptions {
  library: LibraryTextPassLibrary
  /** True while the person is typing, scrolling or otherwise using the PC. */
  isBusy(): boolean
  /** Waits `ms` milliseconds. */
  wait?(ms: number): Promise<void>
  onProgress?(progress: LibraryTextProgress | null): void
  /** A file of this project was read: its Library may show new details. */
  onRead?(projectId: string): void
  logError?(message: string, error: unknown): void
}

/** How long to wait while the person is busy before looking again. */
export const BUSY_RECHECK_MS = 1_000
/** A breath between files, so reading never runs back to back. */
export const BETWEEN_FILES_MS = 200

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })

export class LibraryTextPass {
  private running: Promise<void> | null = null
  private stopped = false
  private state: LibraryTextProgress | null = null

  constructor(private readonly options: LibraryTextPassOptions) {}

  /** Where the pass is, or null when it is not running. */
  get progress(): LibraryTextProgress | null {
    return this.state ? { ...this.state } : null
  }

  /** Starts the pass; a second call while it runs returns the same run. */
  start(): Promise<void> {
    if (!this.running) {
      this.stopped = false
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  /** Stops after the file being read, if any; settles once it has. */
  stop(): Promise<void> {
    this.stopped = true
    return this.running ?? Promise.resolve()
  }

  private async run(): Promise<void> {
    const wait = this.options.wait ?? defaultWait
    let queue: { projectId: string; itemId: string }[]
    try {
      queue = this.options.library.listUnreadDocuments()
    } catch (error) {
      this.options.logError?.('Could not list Library files to read', error)
      return
    }
    if (queue.length === 0) return
    this.setState({ done: 0, total: queue.length })
    try {
      for (const entry of queue) {
        while (!this.stopped && this.options.isBusy()) await wait(BUSY_RECHECK_MS)
        if (this.stopped) return
        try {
          if (await this.options.library.readStoredText(entry.projectId, entry.itemId)) {
            this.options.onRead?.(entry.projectId)
          }
        } catch (error) {
          // One file failing never stops the pass; it is tried again next start.
          this.options.logError?.(`Could not read Library item ${entry.itemId}`, error)
        }
        this.setState({ done: (this.state?.done ?? 0) + 1, total: queue.length })
        await wait(BETWEEN_FILES_MS)
      }
    } finally {
      this.setState(null)
    }
  }

  private setState(state: LibraryTextProgress | null): void {
    this.state = state
    this.options.onProgress?.(state ? { ...state } : null)
  }
}
