import { AsyncLocalStorage } from 'node:async_hooks'
import type { BrowserWindow, WebContents } from 'electron'

/**
 * Sends to a window's renderer, if it is still there. Services keep emitting
 * while the app quits, after the window or its web contents are destroyed, and
 * sending to either then throws "Object has been destroyed".
 */
export function sendToWindow(
  win: BrowserWindow | null | undefined,
  channel: string,
  payload: unknown
): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

// ─── Every Ostler window (N5.8a) ──────────────────────────────────────────────

/** The main window and every pop-out: the windows a change event reaches. */
const ostlerWindows = new Set<BrowserWindow>()

/** Adds a window to the broadcast until it closes. */
export function registerOstlerWindow(win: BrowserWindow): void {
  ostlerWindows.add(win)
  win.on('closed', () => ostlerWindows.delete(win))
}

/** The Ostler windows still open, the main window first. */
export function openOstlerWindows(): BrowserWindow[] {
  return [...ostlerWindows].filter((win) => !win.isDestroyed())
}

/**
 * Sends a change event to every Ostler window, so a pop-out shows a change made
 * anywhere at once. Replies meant for one window (an AI stream, a navigation
 * request) use `sendToWindow` instead.
 */
export function broadcastToWindows(
  channel: string,
  payload: unknown,
  except: BrowserWindow | null = null
): void {
  for (const win of openOstlerWindows()) if (win !== except) sendToWindow(win, channel, payload)
}

/**
 * A change one window made through IPC, for the other windows (N5.8a): the
 * window that made it reloads itself, as it always has, and keeps its undo;
 * the others are told once, after the handler's writes, that the project's
 * tasks changed. Changes from the APIs and agents are pushed as before.
 */
export function createOtherWindowsNotifier(
  send: (projectId: string, except: BrowserWindow) => void
): (projectId: string) => void {
  let pending: { projectId: string; asker: BrowserWindow }[] = []
  return (projectId) => {
    const asker = askingWindow()
    if (!asker || openOstlerWindows().length < 2) return
    if (pending.some((entry) => entry.projectId === projectId && entry.asker === asker)) return
    pending.push({ projectId, asker })
    if (pending.length > 1) return
    setImmediate(() => {
      const due = pending
      pending = []
      for (const entry of due) send(entry.projectId, entry.asker)
    })
  }
}

// ─── The window that asked ───────────────────────────────────────────────────

const asking = new AsyncLocalStorage<WebContents>()

/**
 * Runs an IPC handler knowing which renderer asked (`handleIpc` wraps every
 * handler in it), across its awaits, so a dialog or a reply goes to that window.
 */
export function runAsking<T>(sender: WebContents | undefined, run: () => T): T {
  return sender ? asking.run(sender, run) : run()
}

/** The Ostler window whose IPC call is being handled, or null outside one. */
export function askingWindow(): BrowserWindow | null {
  const sender = asking.getStore()
  if (!sender) return null
  return openOstlerWindows().find((win) => win.webContents === sender) ?? null
}
