import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StickyTaskState } from '../../src/shared/sticky-task'

/**
 * Sticky task on the desktop (N5.8b): a sticky window is made by the same
 * function as the main window, so with the off-screen switch on
 * (OSTLER_OFF_SCREEN=1, as every e2e and agent run sets it) it is created
 * hidden, off the taskbar and muted, shown only left of every display without
 * focus, and never on top. That holds for one pinned from a menu and for one
 * reopened at start. On screen it is on top and still never takes the focus.
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
  const stickies = await import('../../electron/app/sticky-task-windows')
  return { ...window, ...stickies }
}

afterEach(() => {
  delete process.env['OSTLER_OFF_SCREEN']
})

type Fake = InstanceType<typeof fake.FakeWindow>

function expectKeptOffScreen(win: Fake) {
  expect(win.options.show).toBe(false)
  expect(win.options.skipTaskbar).toBe(true)
  expect(win.options.alwaysOnTop).toBe(false)
  expect(win.options.frame).toBe(false)
  expect(win.options.webPreferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true
  })
  expect(win.muted).toBe(true)
  win.emit('ready-to-show')
  win.emit('focus')
  expect(win.calls).toContain('showInactive')
  expect(win.calls).not.toContain('show')
  expect(win.calls).not.toContain('focus')
  expect(win.calls).not.toContain('webContents.focus')
  expect(win.calls).not.toContain('setAlwaysOnTop')
  expect(win.bounds.x + win.bounds.width).toBeLessThan(0)
  expect(win.skipTaskbar).toBe(true)
}

const REF = { projectId: 'p1', taskId: 't1' }

describe('a sticky task window off screen (N5.8b)', () => {
  it('is created off screen, unfocused, off the taskbar, muted and not on top', async () => {
    const { createStickyTaskWindow, revealStickyWindow } = await load(true)
    const win = createStickyTaskWindow({
      appearance: APPEARANCE,
      ref: REF,
      bounds: { x: 100, y: 100, width: 320, height: 240 }
    }) as unknown as Fake
    expect(win.loaded.hash).toBe('/sticky/p1/t1')
    expectKeptOffScreen(win)
    win.calls.length = 0
    revealStickyWindow(win as never)
    expect(win.calls).not.toContain('focus')
    expect(win.calls).not.toContain('show')
  })

  it('pinned or reopened at start, follows the same rule', async () => {
    const { createStickyTaskWindow, revealStickyWindow, StickyTaskWindows } = await load(true)
    let saved: StickyTaskState[] = [{ ...REF, bounds: { x: 200, y: 200, width: 320, height: 240 } }]
    const stickies = new StickyTaskWindows({
      create: (ref, bounds) => createStickyTaskWindow({ appearance: APPEARANCE, ref, bounds }),
      reveal: revealStickyWindow,
      read: () => saved,
      write: (windows) => {
        saved = windows
      },
      workAreas: () => [{ x: 0, y: 0, width: 1920, height: 1040 }],
      projectExists: () => true
    })
    stickies.restore()
    stickies.pin({ projectId: 'p1', taskId: 't2' })
    expect(fake.state.windows).toHaveLength(2)
    for (const win of fake.state.windows) expectKeptOffScreen(win)
  })

  it('on screen, it is on top and shown without taking the focus', async () => {
    const { createStickyTaskWindow } = await load(false)
    const win = createStickyTaskWindow({
      appearance: APPEARANCE,
      ref: REF,
      bounds: { x: 100, y: 120, width: 320, height: 240 }
    }) as unknown as Fake
    expect(win.options).toMatchObject({
      x: 100,
      y: 120,
      width: 320,
      height: 240,
      alwaysOnTop: true,
      skipTaskbar: true,
      frame: false
    })
    win.emit('ready-to-show')
    expect(win.calls).toEqual(['showInactive'])
  })
})
