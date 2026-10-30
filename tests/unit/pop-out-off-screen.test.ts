import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PopOutWindowState } from '../../src/shared/pop-out'

/**
 * Pop out a view (N5.8a): a pop-out is made by the same function as the main
 * window, so with the off-screen switch on (OSTLER_OFF_SCREEN=1, as every
 * e2e and agent run sets it) it is created hidden, off the taskbar and muted,
 * shown only left of every display without focus, and never on top. That
 * holds for one opened from a menu and for one reopened at start. Each test
 * loads the modules fresh with the switch set.
 */

const fake = vi.hoisted(() => {
  const state = {
    windows: [] as FakeWindow[]
  }
  class FakeWindow {
    options: Record<string, unknown>
    calls: string[] = []
    listeners = new Map<string, (() => void)[]>()
    bounds = { x: 0, y: 0, width: 1100, height: 800 }
    muted = false
    skipTaskbar: boolean | null = null
    loaded: { file?: string; hash?: string; url?: string } = {}
    webContents = {
      setAudioMuted: (muted: boolean) => {
        this.muted = muted
      },
      setWindowOpenHandler: () => {},
      on: () => {},
      focus: () => this.calls.push('webContents.focus'),
      isDestroyed: () => false,
      send: () => {}
    }
    constructor(options: Record<string, unknown>) {
      this.options = options
      if (typeof options.x === 'number') this.bounds.x = options.x
      if (typeof options.y === 'number') this.bounds.y = options.y
      state.windows.push(this)
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
      return this
    }
    emit(event: string) {
      for (const listener of this.listeners.get(event) ?? []) listener()
    }
    getBounds() {
      return { ...this.bounds }
    }
    getNormalBounds() {
      return { ...this.bounds }
    }
    setPosition(x: number, y: number) {
      this.bounds = { ...this.bounds, x, y }
      this.calls.push('setPosition')
    }
    setSkipTaskbar(skip: boolean) {
      this.skipTaskbar = skip
    }
    show() {
      this.calls.push('show')
    }
    showInactive() {
      this.calls.push('showInactive')
    }
    focus() {
      this.calls.push('focus')
    }
    maximize() {
      this.calls.push('maximize')
    }
    restore() {}
    isMinimized() {
      return false
    }
    isMaximized() {
      return false
    }
    isDestroyed() {
      return false
    }
    close() {}
    setAlwaysOnTop() {
      this.calls.push('setAlwaysOnTop')
    }
    loadFile(file: string, options?: { hash?: string }) {
      this.loaded = { file, hash: options?.hash }
    }
    loadURL(url: string) {
      this.loaded = { url }
    }
  }
  const electron = {
    BrowserWindow: Object.assign(FakeWindow, {
      getAllWindows: () => state.windows,
      fromWebContents: () => null
    }),
    app: {
      isPackaged: true,
      getPath: () => process.cwd(),
      getLocale: () => 'en-GB',
      getSystemLocale: () => 'en-GB',
      getPreferredSystemLanguages: () => ['en-GB'],
      on: () => {}
    },
    screen: {
      getAllDisplays: () => [
        {
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 }
        }
      ]
    },
    nativeTheme: { shouldUseDarkColors: false, themeSource: 'system', on: () => {} },
    systemPreferences: { getAccentColor: () => '0078d4ff', on: () => {} },
    dialog: {},
    shell: {},
    Notification: class {
      static isSupported = () => false
    }
  }
  return { state, electron, FakeWindow }
})

vi.mock('electron', () => ({ ...fake.electron, default: fake.electron }))

// `showOffScreen` requires Electron lazily (its `screen` needs a ready app): the same fake.
const nodeRequire = createRequire(import.meta.url)
const electronId = nodeRequire.resolve('electron')
nodeRequire.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: fake.electron
} as unknown as NodeJS.Module

const APPEARANCE = {
  theme: 'light',
  density: 'comfortable',
  accent: 'ostler',
  windowsAccent: null,
  systemDark: false
} as const

async function load(offScreenOn: boolean) {
  vi.resetModules()
  fake.state.windows.length = 0
  if (offScreenOn) process.env['OSTLER_OFF_SCREEN'] = '1'
  else delete process.env['OSTLER_OFF_SCREEN']
  delete process.env['OSTLER_ON_SCREEN']
  const window = await import('../../electron/app/window')
  const popOuts = await import('../../electron/app/pop-out-windows')
  return { ...window, ...popOuts }
}

afterEach(() => {
  delete process.env['OSTLER_OFF_SCREEN']
})

type Fake = InstanceType<typeof fake.FakeWindow>

function expectKeptOffScreen(win: Fake) {
  // Created hidden, off the taskbar, never on top, with the main window's web preferences.
  expect(win.options.show).toBe(false)
  expect(win.options.skipTaskbar).toBe(true)
  expect(win.options.alwaysOnTop).toBe(false)
  expect(win.options.webPreferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true
  })
  expect(win.muted).toBe(true)
  win.emit('ready-to-show')
  win.emit('focus')
  // Shown only inactive, left of every display, and never focused.
  expect(win.calls).toContain('showInactive')
  expect(win.calls).not.toContain('show')
  expect(win.calls).not.toContain('focus')
  expect(win.calls).not.toContain('webContents.focus')
  expect(win.calls).not.toContain('setAlwaysOnTop')
  expect(win.bounds.x + win.bounds.width).toBeLessThan(0)
  expect(win.skipTaskbar).toBe(true)
}

describe('a popped-out window off screen (N5.8a)', () => {
  it('is created off screen, unfocused, off the taskbar and muted', async () => {
    const { createPopOutWindow, focusWindow } = await load(true)
    const win = createPopOutWindow({
      appearance: APPEARANCE,
      route: '/projects/p1/board',
      place: { bounds: { x: 100, y: 100, width: 1100, height: 800 }, maximized: true }
    }) as unknown as Fake
    expect(win.loaded.hash).toBe('/pop-out/projects/p1/board')
    expectKeptOffScreen(win)
    // Not even maximised onto a display, and bringing it forward keeps it off screen.
    expect(win.calls).not.toContain('maximize')
    win.calls.length = 0
    focusWindow(win as never)
    expect(win.calls).not.toContain('focus')
    expect(win.calls).not.toContain('show')
  })

  it('reopened at start, follows the same rule', async () => {
    const { createPopOutWindow, focusWindow, PopOutWindows } = await load(true)
    let saved: PopOutWindowState[] = [
      {
        route: '/home',
        bounds: { x: 200, y: 200, width: 900, height: 700 },
        maximized: false,
        reopenAtStart: true,
        openAtQuit: true
      }
    ]
    const popOuts = new PopOutWindows({
      create: (route, place) => createPopOutWindow({ appearance: APPEARANCE, route, place }),
      focus: focusWindow,
      read: () => saved,
      write: (windows) => {
        saved = windows
      },
      workAreas: () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      projectExists: () => true
    })
    popOuts.restore()
    expect(fake.state.windows).toHaveLength(1)
    expectKeptOffScreen(fake.state.windows[0])
  })

  it('on screen, opens where it was and takes the focus', async () => {
    const { createPopOutWindow } = await load(false)
    const win = createPopOutWindow({
      appearance: APPEARANCE,
      route: '/home',
      place: { bounds: { x: 100, y: 120, width: 1100, height: 800 }, maximized: false }
    }) as unknown as Fake
    expect(win.options.skipTaskbar).toBe(false)
    expect(win.options).toMatchObject({ x: 100, y: 120 })
    expect(win.muted).toBe(false)
    win.emit('ready-to-show')
    expect(win.calls).toEqual(['show', 'focus'])
  })
})
