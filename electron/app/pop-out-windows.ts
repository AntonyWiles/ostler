import type { Rectangle } from 'electron'
import {
  MAX_POP_OUTS,
  MAX_REMEMBERED_POP_OUTS,
  parsePopOutRoute,
  type PopOutOpenResult,
  type PopOutWindowState
} from '@shared/pop-out'
import { boundsOnScreen } from '../window-state'

/**
 * Pop out a view (N5.8a, N43): the pop-out windows that are open, at most
 * eight, and what `config.popOuts` remembers of each route (its size and
 * place, Reopen at start, and whether it was open at quit). Every window is
 * made by `deps.create`, which goes through `createOstlerWindow` like the main
 * window, so a pop-out has the main window's security settings and stays off
 * screen exactly when the main window does.
 */

/** What this needs of a window: Electron's `BrowserWindow`, or a test's fake. */
export interface PopOutWindowLike {
  on(event: 'close' | 'closed', listener: () => void): unknown
  getNormalBounds(): Rectangle
  isMaximized(): boolean
  isDestroyed(): boolean
  close(): void
  readonly webContents: unknown
}

/** Where a pop-out opens: its saved place, or a size alone (centred). */
export interface PopOutPlace {
  bounds: Partial<Rectangle> & { width: number; height: number }
  maximized: boolean
}

export interface PopOutWindowsDependencies<W extends PopOutWindowLike> {
  /** Opens a window on `route` at `place` (through `createPopOutWindow`). */
  create(route: string, place: PopOutPlace): W
  /** Brings an open pop-out forward (`focusWindow`, which stays off screen when Ostler does). */
  focus(win: W): void
  /** `config.popOuts.windows` as it is now. */
  read(): PopOutWindowState[]
  write(windows: PopOutWindowState[]): void
  /** The work areas of the displays connected now. */
  workAreas(): Rectangle[]
  /** Whether a project is registered: a pop-out never opens on one that is not. */
  projectExists(projectId: string): boolean
}

/** A pop-out's default size, centred, when its route has no place on screen. */
export const POP_OUT_DEFAULT_SIZE = { width: 1100, height: 800 }
export const POP_OUT_MIN_SIZE = { width: 480, height: 360 }

/**
 * Where `route` opens: where it was left, as `window-state.ts` does for the
 * main window, unless that place is no longer on a connected display (a
 * display was removed), when it opens at the default size, centred.
 */
export function popOutPlace(
  saved: PopOutWindowState | undefined,
  workAreas: readonly Rectangle[]
): PopOutPlace {
  const bounds = saved?.bounds
  if (bounds && boundsOnScreen(bounds, workAreas)) {
    return {
      bounds: {
        ...bounds,
        width: Math.max(POP_OUT_MIN_SIZE.width, bounds.width),
        height: Math.max(POP_OUT_MIN_SIZE.height, bounds.height)
      },
      maximized: saved.maximized
    }
  }
  return { bounds: { ...POP_OUT_DEFAULT_SIZE }, maximized: false }
}

export class PopOutWindows<W extends PopOutWindowLike> {
  /** Open pop-outs by route, oldest first. */
  private readonly windows = new Map<string, W>()
  private quitting = false

  constructor(private readonly deps: PopOutWindowsDependencies<W>) {}

  /** The routes open now, oldest first. */
  openRoutes(): string[] {
    return [...this.windows.keys()]
  }

  /** The route a window shows, or null when it is not a pop-out. */
  routeOf(contents: unknown): string | null {
    for (const [route, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents === contents) return route
    }
    return null
  }

  /** What a pop-out's title bar menu shows: Reopen at start. */
  reopenAtStart(route: string): boolean {
    return this.entry(route)?.reopenAtStart ?? false
  }

  /**
   * Opens `route` in a window of its own, or brings it forward when it is
   * already open. With eight open it opens nothing and names the oldest,
   * unless `closeOldest` says the person chose to close it.
   */
  open(route: string, closeOldest = false): PopOutOpenResult {
    const target = parsePopOutRoute(route)
    if (!target) throw new Error('Pop out Home or one project view')
    if (target.kind === 'project' && !this.deps.projectExists(target.projectId)) {
      throw new Error('That project is not in Ostler any more')
    }
    const already = this.windows.get(route)
    if (already && !already.isDestroyed()) {
      this.deps.focus(already)
      return { opened: true }
    }
    if (this.windows.size >= MAX_POP_OUTS) {
      const [oldest, oldestWindow] = this.windows.entries().next().value as [string, W]
      if (!closeOldest) return { opened: false, full: true, oldest }
      this.forget(oldest)
      oldestWindow.close()
    }
    const win = this.deps.create(route, popOutPlace(this.entry(route), this.deps.workAreas()))
    this.windows.set(route, win)
    win.on('close', () => this.rememberPlace(route, win))
    win.on('closed', () => this.forget(route))
    // Remembered from the first open, so Reopen at start can be ticked at once.
    this.update(route, (entry) => entry)
    return { opened: true }
  }

  /** Ticks or clears Reopen at start for `route`. */
  setReopenAtStart(route: string, reopen: boolean): void {
    this.update(route, (entry) => ({ ...entry, reopenAtStart: reopen }))
  }

  /**
   * At start: reopens the pop-outs that were open at the last quit and have
   * Reopen at start ticked, through the same `open`, so the same rules hold.
   */
  restore(): void {
    for (const entry of this.deps.read()) {
      if (!entry.reopenAtStart || !entry.openAtQuit) continue
      if (this.windows.size >= MAX_POP_OUTS) break
      try {
        this.open(entry.route)
      } catch {
        // A project removed since: nothing to reopen.
      }
    }
  }

  /**
   * A real quit is starting: remember which pop-outs are open, and where,
   * before they close with the app. Closing them then changes nothing.
   */
  beforeQuit(): void {
    if (this.quitting) return
    this.quitting = true
    const open = new Map<string, W>(this.windows)
    const windows = this.deps.read().map((entry) => {
      const win = open.get(entry.route)
      return win && !win.isDestroyed()
        ? { ...entry, ...placeOf(win), openAtQuit: true }
        : { ...entry, openAtQuit: false }
    })
    this.deps.write(windows)
  }

  private entry(route: string): PopOutWindowState | undefined {
    return this.deps.read().find((candidate) => candidate.route === route)
  }

  /** Changes `route`'s entry (adding it), keeping it newest and the list within its cap. */
  private update(route: string, change: (entry: PopOutWindowState) => PopOutWindowState): void {
    const current = this.deps.read()
    const entry = current.find((candidate) => candidate.route === route) ?? {
      route,
      bounds: null,
      maximized: false,
      reopenAtStart: false,
      openAtQuit: false
    }
    const others = current.filter((candidate) => candidate.route !== route)
    this.deps.write([...others, change(entry)].slice(-MAX_REMEMBERED_POP_OUTS))
  }

  private rememberPlace(route: string, win: W): void {
    if (win.isDestroyed()) return
    const place = placeOf(win)
    this.update(route, (entry) => ({ ...entry, ...place }))
  }

  private forget(route: string): void {
    this.windows.delete(route)
    if (this.quitting) return
    if (this.entry(route)?.openAtQuit) {
      this.update(route, (entry) => ({ ...entry, openAtQuit: false }))
    }
  }
}

function placeOf(win: PopOutWindowLike): Pick<PopOutWindowState, 'bounds' | 'maximized'> {
  const { x, y, width, height } = win.getNormalBounds()
  return { bounds: { x, y, width, height }, maximized: win.isMaximized() }
}
