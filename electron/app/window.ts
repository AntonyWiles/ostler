import { BrowserWindow, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import {
  encodeAppearanceArgument,
  encodeLocaleArgument,
  type InitialAppearance
} from '@shared/ostler-api'
import { join } from 'path'
import { BRAND } from '@shared/brand'
import { loadWindowState, trackWindowState } from '../window-state'
import { windowBackground } from './appearance'
import { currentLocale } from './locale'
import { t } from '@shared/i18n'
import { offScreen, offScreenArguments, showDesktopNotification, showOffScreen } from './off-screen'
import { popOutHash } from '@shared/pop-out'
import { POP_OUT_MIN_SIZE, type PopOutPlace } from './pop-out-windows'
import { stickyTaskHash, type StickyTaskRef } from '@shared/sticky-task'
import { newTaskWindowHash } from '@shared/new-task-window'
import { taskWindowHash } from '@shared/task-window'
import { STICKY_MIN_SIZE } from './sticky-task-windows'
import { attachTextMenu } from './desktop/text-menu'

const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

// The off-screen switch and how an off-screen window is shown live in
// off-screen.ts, beside everything else it holds back.
export { offScreen, showOffScreen }

export interface WindowOptions {
  /** The title bar and icon (P8.2, `DesktopIntegration.windowOptions`). */
  chrome?: Partial<BrowserWindowConstructorOptions>
  /** Stay hidden in the tray: a start at sign-in with background mode on. */
  hidden?: boolean
}

/** Everything that differs between the main window and a pop-out (N5.8a). */
export interface OstlerWindowOptions extends WindowOptions {
  appearance: InitialAppearance
  /** Where it opens: saved bounds, or a size alone to be centred. */
  bounds: Partial<Rectangle> & { width: number; height: number }
  minSize: { width: number; height: number }
  maximized?: boolean
  /** The page's hash without `#` (a pop-out's route), or none for the main window. */
  hash?: string
  /**
   * A sticky task (N5.8b): on top of other windows at the normal level, and
   * shown without taking the focus. Off screen it is never on top.
   */
  sticky?: boolean
}

/**
 * The one way Ostler opens a window that shows its page, the main window and
 * every pop-out alike (N5.8a): sandboxed, isolated, no Node, the same preload
 * and page (so the same CSP), new windows and navigation refused. Off screen
 * (`offScreen`) it is placed left of every display, never focused, off the
 * taskbar and muted, and shown only with `showOffScreen`.
 */
export function createOstlerWindow(options: OstlerWindowOptions): BrowserWindow {
  const { appearance, minSize } = options
  const win = new BrowserWindow({
    ...options.bounds,
    minWidth: minSize.width,
    minHeight: minSize.height,
    title: BRAND.fullName,
    titleBarStyle: 'default',
    ...options.chrome,
    // Off screen it gets no taskbar button either (`showOffScreen` says so again once shown).
    skipTaskbar: offScreen || options.sticky === true,
    // Never on top of the person's other windows, whatever the chrome says;
    // a sticky task alone is, and never off screen (N5.8b).
    alwaysOnTop: options.sticky === true && !offScreen,
    backgroundColor: windowBackground(appearance),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [
        encodeAppearanceArgument(appearance),
        encodeLocaleArgument(currentLocale()),
        ...offScreenArguments()
      ],
      // Prevents Chromium's internal focus state from desyncing while the
      // window is backgrounded, which otherwise leaves native controls
      // (e.g. <select> dropdowns) unresponsive to clicks until the window
      // receives a real OS focus event (such as Alt-Tab).
      backgroundThrottling: false
    }
  })

  // A window driven by tests or agents stays silent too: no focus chime (N3.5).
  if (offScreen) win.webContents.setAudioMuted(true)

  // Show when ready to prevent flash
  win.on('ready-to-show', () => {
    if (options.hidden) return
    if (offScreen) return showOffScreen(win)
    // A sticky window never takes the focus by itself (N5.8b).
    if (options.sticky) return win.showInactive()
    if (options.maximized) win.maximize()
    win.show()
    win.focus()
  })

  // Resync Chromium's focus state whenever the OS hands focus back to the
  // window, so native popups (e.g. <select>) respond immediately instead of
  // requiring an Alt-Tab to "wake up".
  win.on('focus', () => {
    if (offScreen) return
    win.webContents.focus()
  })

  // Right-click in a text field: spelling suggestions, Cut, Copy and Paste.
  attachTextMenu(win)

  // Prevent new window creation
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }))

  // Prevent navigation away from the app
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Load the renderer
  const hash = options.hash
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash ? `#${hash}` : ''}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }

  return win
}

/**
 * Opens the main window in `appearance`: its background matches the theme, and
 * the preload hands the appearance to the page before it renders, so starting
 * in light never flashes dark.
 */
export function createWindow(
  appearance: InitialAppearance,
  options: WindowOptions = {}
): BrowserWindow {
  const minSize = { width: 900, height: 600 }
  const saved = loadWindowState(minSize)
  const win = createOstlerWindow({
    ...options,
    appearance,
    bounds: saved.bounds,
    minSize,
    maximized: saved.maximized
  })
  trackWindowState(win)
  return win
}

/**
 * Opens a pop-out (N5.8a) on `route`: the same window as the main one, through
 * `createOstlerWindow`, on the pop-out hash, so it draws that one view. Off
 * screen it stays off screen, unfocused, off the taskbar and muted.
 */
export function createPopOutWindow(options: {
  appearance: InitialAppearance
  chrome?: Partial<BrowserWindowConstructorOptions>
  route: string
  place: PopOutPlace
}): BrowserWindow {
  return createOstlerWindow({
    appearance: options.appearance,
    chrome: options.chrome,
    bounds: options.place.bounds,
    maximized: options.place.maximized,
    minSize: POP_OUT_MIN_SIZE,
    hash: popOutHash(options.route)
  })
}

/**
 * Opens a sticky task (N5.8b) on `ref`: through `createOstlerWindow`, on the
 * sticky hash, small, frameless (its header drags it), off the taskbar, on top
 * of other windows and shown without the focus. Off screen it stays off
 * screen, unfocused, off the taskbar, muted and never on top.
 */
export function createStickyTaskWindow(options: {
  appearance: InitialAppearance
  ref: StickyTaskRef
  bounds: Partial<Rectangle> & { width: number; height: number }
}): BrowserWindow {
  return createOstlerWindow({
    appearance: options.appearance,
    chrome: {
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true
    },
    bounds: options.bounds,
    minSize: STICKY_MIN_SIZE,
    hash: stickyTaskHash(options.ref),
    sticky: true
  })
}

/**
 * Opens New task for `projectId` in a window of its own: through `createOstlerWindow`, on the
 * New task hash, with the main window's title bar and icon (MOP-12). Off screen it stays off
 * screen, unfocused, off the taskbar and muted.
 */
export function createNewTaskWindow(options: {
  appearance: InitialAppearance
  chrome?: Partial<BrowserWindowConstructorOptions>
  projectId: string
}): BrowserWindow {
  return createOstlerWindow({
    appearance: options.appearance,
    chrome: options.chrome,
    bounds: { width: 760, height: 820 },
    minSize: { width: 520, height: 480 },
    hash: newTaskWindowHash(options.projectId)
  })
}

/**
 * Opens one task in a window of its own (MOP-12): through `createOstlerWindow`, on the task
 * window hash, with the main window's title bar and icon. Off screen it stays off screen,
 * unfocused, off the taskbar and muted.
 */
export function createTaskWindow(options: {
  appearance: InitialAppearance
  chrome?: Partial<BrowserWindowConstructorOptions>
  projectId: string
  taskId: string
}): BrowserWindow {
  return createOstlerWindow({
    appearance: options.appearance,
    chrome: options.chrome,
    bounds: { width: 720, height: 860 },
    minSize: { width: 480, height: 480 },
    hash: taskWindowHash({ projectId: options.projectId, taskId: options.taskId })
  })
}

/** Shows a sticky window again without taking the focus (N5.8b). */
export function revealStickyWindow(win: BrowserWindow): void {
  if (offScreen) return showOffScreen(win)
  win.showInactive()
}

/** Brings a window back to the front, restoring it first if it was minimised. */
export function focusWindow(win: BrowserWindow): void {
  if (offScreen) return showOffScreen(win)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const RECOVERY_WINDOW_MS = 60_000
const MAX_RECOVERIES_PER_WINDOW = 3
let recoveries: number[] = []

/**
 * Reloads a window whose renderer died and tells the user once that Ostler
 * recovered. A renderer that keeps dying is left alone after three reloads in
 * a minute, so a crash loop cannot spin forever.
 */
export function recoverFromRendererCrash(
  contents: Electron.WebContents,
  details: Electron.RenderProcessGoneDetails
): void {
  if (details.reason === 'clean-exit') return
  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  recoveries = recoveries.filter((time) => now - time < RECOVERY_WINDOW_MS)
  if (recoveries.length >= MAX_RECOVERIES_PER_WINDOW) return
  recoveries.push(now)
  contents.reload()
  showDesktopNotification({
    title: BRAND.name,
    body: t('desktop:window.hitProblemReloadedWindow')
  })
}
