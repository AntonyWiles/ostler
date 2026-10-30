import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * The main window's size, position and maximised flag, kept in userData so
 * the window reopens where it was left. Window housekeeping, not a setting,
 * so it stays out of config.json.
 */
interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const DEFAULT_SIZE = { width: 1600, height: 1000 }

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** True when enough of the bounds lands on a connected display to grab the title bar. */
function isVisible(bounds: Rectangle): boolean {
  return boundsOnScreen(
    bounds,
    screen.getAllDisplays().map(({ workArea }) => workArea)
  )
}

/**
 * True when enough of `bounds` lands on one of `workAreas` to grab the title
 * bar. A pop-out's saved place (N5.8a) is checked the same way, so one left on
 * a display that was removed opens at its default place instead.
 */
export function boundsOnScreen(bounds: Rectangle, workAreas: readonly Rectangle[]): boolean {
  return workAreas.some((workArea) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x)
    const titleBarOnScreen = bounds.y >= workArea.y && bounds.y < workArea.y + workArea.height
    return overlapX >= 100 && titleBarOnScreen
  })
}

/** Saved state, or the default centred size when there is none or it is off-screen. */
export function loadWindowState(min: { width: number; height: number }): {
  bounds: Partial<Rectangle> & { width: number; height: number }
  maximized: boolean
} {
  try {
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as WindowState
    const { x, y, width, height } = saved.bounds
    if ([x, y, width, height].every(Number.isFinite)) {
      const bounds = {
        x,
        y,
        width: Math.max(min.width, width),
        height: Math.max(min.height, height)
      }
      if (isVisible(bounds)) return { bounds, maximized: Boolean(saved.maximized) }
    }
  } catch {
    // No saved state yet, or it is unreadable: open at the default size.
  }
  return { bounds: { ...DEFAULT_SIZE }, maximized: false }
}

/** Saves the window's state when it closes. Uses the normal bounds so a maximised window restores to its last unmaximised size. */
export function trackWindowState(win: BrowserWindow): void {
  win.on('close', () => {
    const state: WindowState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized()
    }
    try {
      writeFileSync(statePath(), JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save window state:', error)
    }
  })
}
