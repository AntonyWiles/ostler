import { BrowserWindow } from 'electron'
import {
  normalizeMenuContext,
  WINDOW_CONTROLS,
  type WatchedProject,
  type WindowControl
} from '@shared/ostler-api'
import type { SnipSelection } from '@shared/snip'
import type { DesktopIntegration } from '../app/desktop/desktop'
import { controlWindow, windowState } from '../app/desktop/window-controls'
import type { SnipController } from '../app/desktop/snip'
import type { EditFlusher } from '../app/desktop/edit-flush'
import { handleApi } from './handle-ipc'

/**
 * Windows integration (P8.2): the renderer says where the person is (the
 * menu's Go list and deep links follow it), pops up the application menu from
 * the title bar, and asks which title bar its window has.
 */
export function registerDesktopHandlers(desktop: DesktopIntegration): void {
  handleApi('setMenuContext', (_event, context: unknown) => {
    desktop.setMenuContext(normalizeMenuContext(context))
  })
  handleApi('popupAppMenu', (_event, position: unknown) => {
    const { x, y } = (position ?? {}) as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x + y)) {
      throw new Error('Pop the menu up at a point in the window')
    }
    desktop.popupMenu(x, y)
  })
  handleApi('getWindowChrome', () => ({
    customTitleBar: desktop.usesCustomTitleBar
  }))
  // The title bar's own buttons act on the window that pressed them.
  handleApi('windowControl', (event, control: unknown) => {
    if (!WINDOW_CONTROLS.includes(control as WindowControl)) {
      throw new Error('Minimise, maximise or close the window')
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) controlWindow(win, control as WindowControl)
  })
  handleApi('getWindowState', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? windowState(win) : { maximized: false, fullScreen: false }
  })
}

/** The window's answer when it has saved its edits on quit (R1.5). */
export function registerEditFlushHandler(flusher: EditFlusher): void {
  handleApi('editsFlushed', (_event, requestId: unknown) => {
    flusher.acknowledge(requestId)
  })
}

/** An overlay's choice, checked before main crops anything with it. */
export function normalizeSnipSelection(value: unknown): SnipSelection {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (raw.whole === true) return { whole: true }
  const rect = (raw.rect ?? {}) as Record<string, unknown>
  const numbers = [raw.displayId, rect.x, rect.y, rect.width, rect.height]
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error('A snip is a display and a rectangle on it')
  }
  const [displayId, x, y, width, height] = numbers as number[]
  return { displayId, rect: { x, y, width, height } }
}

/**
 * Snip to task (N4.2a): the command palette starts a snip, each overlay asks
 * for its picture and answers with a rectangle or a cancel, and quick add
 * stores the waiting snip with its task or drops it. Saving resolves the
 * project first, like every project channel.
 */
export function registerSnipHandlers(
  snip: SnipController,
  getProject: (projectId: string) => WatchedProject
): void {
  handleApi('startSnip', () => snip.start())
  handleApi('getSnipPicture', (_event, displayId: unknown) => {
    if (typeof displayId !== 'number' || !Number.isFinite(displayId)) {
      throw new Error('Name the display')
    }
    return snip.overlayPicture(displayId)
  })
  handleApi('selectSnip', (_event, selection: unknown) =>
    snip.select(normalizeSnipSelection(selection))
  )
  handleApi('cancelSnip', () => snip.cancel())
  handleApi('saveSnipToTask', (_event, projectId: string, workItemId: unknown, snipId: unknown) => {
    const project = getProject(projectId)
    if (typeof workItemId !== 'string' || typeof snipId !== 'string') {
      throw new Error('Name the task and the snip')
    }
    return snip.save(project.id, workItemId, snipId)
  })
  handleApi('discardSnip', (_event, snipId: unknown) => {
    if (typeof snipId === 'string') snip.discard(snipId)
  })
  // Mark up (N4.2b): the waiting snip goes to the editor and comes back marked up.
  handleApi('getSnipFullPicture', (_event, snipId: unknown) => {
    if (typeof snipId !== 'string') throw new Error('Name the snip')
    return { bytes: snip.picture(snipId), mimeType: 'image/png' }
  })
  handleApi('replaceSnip', (_event, snipId: unknown, png: unknown) => {
    if (typeof snipId !== 'string') throw new Error('Name the snip')
    if (!(png instanceof Uint8Array)) throw new Error('A marked-up snip is a PNG')
    return snip.replace(snipId, png)
  })
}
