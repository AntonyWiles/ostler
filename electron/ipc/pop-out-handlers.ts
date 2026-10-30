import type { PopOutInfo, PopOutOpenResult } from '@shared/pop-out'
import { handleApi } from './handle-ipc'

/** What the pop-out channels need: the open pop-outs and the main window. */
export interface PopOutHandlerDependencies {
  open(route: string, closeOldest: boolean): PopOutOpenResult
  /** The route of the pop-out whose renderer this is, or null for the main window. */
  routeOf(sender: unknown): string | null
  reopenAtStart(route: string): boolean
  setReopenAtStart(route: string, reopen: boolean): void
  /** Brings the main window forward and has it open `path`. */
  openInMainWindow(path: string): void
}

const MAX_PATH_LENGTH = 2000

/** An internal path a pop-out hands to the main window: `/…`, nothing else. */
export function normalizeMainWindowPath(path: unknown): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.length > MAX_PATH_LENGTH ||
    path.includes('\\') ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  ) {
    throw new Error('Open a path inside Ostler')
  }
  return path
}

/**
 * Pop out a view (N5.8a): open a view in a window of its own, a pop-out's
 * Reopen at start, and a link from a pop-out that opens in the main window.
 * Every route is checked in main before a window opens on it.
 */
export function registerPopOutHandlers(deps: PopOutHandlerDependencies): void {
  handleApi('openInNewWindow', (_event, route: unknown, closeOldest: unknown) => {
    if (typeof route !== 'string') throw new Error('Pop out Home or one project view')
    return deps.open(route, closeOldest === true)
  })
  handleApi('getPopOut', (event): PopOutInfo | null => {
    const route = deps.routeOf(event.sender)
    return route ? { route, reopenAtStart: deps.reopenAtStart(route) } : null
  })
  handleApi('setPopOutReopenAtStart', (event, reopen: unknown) => {
    if (typeof reopen !== 'boolean') throw new Error('Reopen at start is on or off')
    const route = deps.routeOf(event.sender)
    if (!route) throw new Error('Only a pop-out window reopens at start')
    deps.setReopenAtStart(route, reopen)
  })
  handleApi('openInMainWindow', (_event, path: unknown) => {
    deps.openInMainWindow(normalizeMainWindowPath(path))
  })
}
