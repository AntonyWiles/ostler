/**
 * When Ostler quits (P8.2). With background mode on, closing the window hides
 * it and everything keeps running: reminders fire, embedded agents carry on.
 * With it off, closing the window quits, as before. Either way the services
 * stop only on a real quit, before the app exits, in their existing order
 * (`stopServices` in services.ts), so a closed window never stops an
 * embedded agent mid-run. Before they stop, the window saves an edit still
 * waiting for its pause (R1.5, D30), within a short fixed wait.
 */

export interface QuitControllerDependencies {
  backgroundMode(): boolean
  /**
   * Asks the window to save edits typed in the last second. Resolves when it
   * has, or after a short fixed wait, so shutdown never hangs on it.
   */
  flushEdits(): Promise<void>
  /** Stops every service, in order. */
  stopServices(): Promise<void>
  /** Asks the app to quit (`app.quit`); called again once the services have stopped. */
  quit(): void
}

export interface QuitController {
  /**
   * The window's `close`: hides instead when background mode is on. Otherwise,
   * outside a quit, it holds the close and quits, so the window can save its
   * edits before it goes. Returns true when it hid.
   */
  onWindowClose(event: { preventDefault(): void }, hide: () => void): boolean
  /** `window-all-closed`: quits, unless the window only hid. */
  onWindowAllClosed(): void
  /** `before-quit`: holds the quit until the services have stopped, once. */
  onBeforeQuit(event: { preventDefault(): void }): void
  /**
   * Marks a real quit before one starts: restart-to-update (P10.1) closes the
   * window first, which must not hide it to the tray instead.
   */
  beginQuit(): void
  /** A real quit is under way (Exit, the tray's Quit, Windows signing out). */
  readonly quitting: boolean
}

export function createQuitController(deps: QuitControllerDependencies): QuitController {
  let quitting = false
  let stopping: Promise<void> | null = null
  let stopped = false
  return {
    get quitting() {
      return quitting
    },
    beginQuit() {
      quitting = true
    },
    onWindowClose(event, hide) {
      if (quitting) return false
      event.preventDefault()
      if (!deps.backgroundMode()) {
        deps.quit()
        return false
      }
      hide()
      return true
    },
    onWindowAllClosed() {
      deps.quit()
    },
    onBeforeQuit(event) {
      quitting = true
      if (stopped) return
      event.preventDefault()
      if (stopping) return
      stopping = deps
        .flushEdits()
        .catch((error) => console.error('Saving edits before quitting failed:', error))
        .then(() => deps.stopServices())
        .catch((error) => console.error('Stopping services failed:', error))
        .finally(() => {
          stopped = true
          deps.quit()
        })
    }
  }
}
