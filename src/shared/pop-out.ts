/**
 * Pop out a view (N5.8a, N43): Home or one project view in a window of its
 * own. A pop-out opens the same page as the main window on the pop-out hash,
 * `#/pop-out` followed by the view's own path, so it draws that one view
 * without the sidebar. Shared by main (which checks every route it is handed)
 * and the renderer.
 */

/** At most this many pop-outs are open at once; the next asks to close one. */
export const MAX_POP_OUTS = 8

/** Pop-outs remembered in `config.json`, open or not: the oldest go first. */
export const MAX_REMEMBERED_POP_OUTS = 40

const PREFIX = '/pop-out'

/** What a pop-out shows: Home, or one view of one project. */
export type PopOutTarget = { kind: 'home' } | { kind: 'project'; projectId: string; view: string }

const ID = /^[A-Za-z0-9_-]{1,100}$/
const VIEW = /^[a-z][a-z-]{0,29}$/

/** A pop-out's route (`/home` or `/projects/<id>/<view>`), or null for anything else. */
export function parsePopOutRoute(route: unknown): PopOutTarget | null {
  if (typeof route !== 'string') return null
  if (route === '/home') return { kind: 'home' }
  const parts = route.split('/')
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'projects') return null
  const [, , projectId, view] = parts
  if (!ID.test(projectId) || !VIEW.test(view)) return null
  return { kind: 'project', projectId, view }
}

/** The route of a target, the key a pop-out is remembered by. */
export function popOutRoute(target: PopOutTarget): string {
  return target.kind === 'home' ? '/home' : `/projects/${target.projectId}/${target.view}`
}

/** The hash a pop-out window opens on. */
export function popOutHash(route: string): string {
  return `${PREFIX}${route}`
}

/** The route inside a pop-out hash (without the leading `#`), or null when it is not one. */
export function parsePopOutHash(hash: string): string | null {
  if (!hash.startsWith(`${PREFIX}/`)) return null
  const route = hash.slice(PREFIX.length).split('?')[0]
  return parsePopOutRoute(route) ? route : null
}

/**
 * Whether `pathname` stays inside the pop-out showing `route`: the view
 * itself (its drawer and dialogs live in its query). Anywhere else opens in
 * the main window.
 */
export function staysInPopOut(route: string, pathname: string): boolean {
  return pathname === route
}

/** One remembered pop-out in `config.json` (config migration 37). */
export interface PopOutWindowState {
  /** `/home` or `/projects/<id>/<view>`: one entry per route. */
  route: string
  /** Its size and place when it last closed, or null before it has closed. */
  bounds: { x: number; y: number; width: number; height: number } | null
  maximized: boolean
  /** Reopen at start, ticked in its title bar menu. */
  reopenAtStart: boolean
  /** It was open when Ostler last quit. */
  openAtQuit: boolean
}

/** `config.popOuts` as config migration 37 writes it. */
export interface PopOutSettings {
  windows: PopOutWindowState[]
}

export const DEFAULT_POP_OUT_SETTINGS: PopOutSettings = { windows: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBounds(value: unknown): PopOutWindowState['bounds'] {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  const numbers = [x, y, width, height]
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number)
  }
}

/** `config.popOuts` within its bounds: valid routes only, one entry each, the newest kept. */
export function normalizePopOutSettings(value: unknown): PopOutSettings {
  const raw = isRecord(value) && Array.isArray(value.windows) ? value.windows : []
  const seen = new Set<string>()
  const windows: PopOutWindowState[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || !parsePopOutRoute(entry.route)) continue
    const route = entry.route as string
    if (seen.has(route)) continue
    seen.add(route)
    windows.push({
      route,
      bounds: normalizeBounds(entry.bounds),
      maximized: entry.maximized === true,
      reopenAtStart: entry.reopenAtStart === true,
      openAtQuit: entry.openAtQuit === true
    })
  }
  return { windows: windows.slice(-MAX_REMEMBERED_POP_OUTS) }
}

/** What opening a pop-out did (`openInNewWindow`). */
export type PopOutOpenResult =
  | { opened: true }
  /** Eight are open: the person is asked to close one, the oldest offered. */
  | { opened: false; full: true; oldest: string }

/** A pop-out window's own state, for its title bar (`getPopOut`). */
export interface PopOutInfo {
  route: string
  reopenAtStart: boolean
}
