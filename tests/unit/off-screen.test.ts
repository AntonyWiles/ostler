import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, IPC_CHANNELS, type OstlerConfig } from '../../src/shared/ostler-api'

/**
 * Off screen (OSTLER_OFF_SCREEN=1, a remote-debugging port or Playwright) Ostler
 * puts nothing in front of the person: no desktop notification from any of its
 * three call sites, no tray icon, taskbar flash, system-wide key, title bar
 * menu, print dialog, system dialog or other app; it never writes the Windows
 * clipboard (it has its own) or reads the screen. On screen every one of them
 * still happens. Each test loads Ostler's modules fresh with the switch set.
 */

const fake = vi.hoisted(() => {
  const state = {
    notifications: [] as { title?: string; body?: string }[],
    shown: [] as { title?: string; body?: string }[],
    trays: 0,
    registered: [] as string[],
    registerResult: true,
    flashes: [] as boolean[],
    popups: 0,
    spawned: [] as string[],
    real: [] as string[],
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    /** Every write to the Windows clipboard. */
    systemClipboard: [] as string[],
    /** Every time the real screen was read. */
    screenReads: 0
  }
  const reset = () => {
    state.systemClipboard.length = 0
    state.screenReads = 0
    delete (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for('ostler.offScreenClipboard')
    ]
    state.notifications.length = 0
    state.shown.length = 0
    state.trays = 0
    state.registered.length = 0
    state.registerResult = true
    state.flashes.length = 0
    state.popups = 0
    state.spawned.length = 0
    state.real.length = 0
    state.handlers.clear()
  }
  class Notification {
    static isSupported = () => true
    constructor(readonly options: { title?: string; body?: string }) {
      state.notifications.push(options)
    }
    on() {
      return this
    }
    show() {
      state.shown.push(this.options)
    }
  }
  class Tray {
    constructor() {
      state.trays += 1
    }
    setToolTip() {}
    setContextMenu() {}
    on() {}
    destroy() {}
  }
  const fakeWindow = {
    isDestroyed: () => false,
    isFocused: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    flashFrame: (flag: boolean) => state.flashes.push(flag),
    setOverlayIcon: () => {},
    setProgressBar: () => {},
    on: () => {},
    webContents: { on: () => {}, send: () => {}, isDestroyed: () => false }
  }
  // Each stands for the real Electron call: a test fails if one runs off screen.
  const dialog = {
    showOpenDialog: async () => {
      state.real.push('showOpenDialog')
      return { canceled: false, filePaths: ['picked'] }
    },
    showOpenDialogSync: () => (state.real.push('showOpenDialogSync'), ['picked']),
    showSaveDialog: async () => {
      state.real.push('showSaveDialog')
      return { canceled: false, filePath: 'saved' }
    },
    showSaveDialogSync: () => (state.real.push('showSaveDialogSync'), 'saved'),
    showMessageBox: async () => {
      state.real.push('showMessageBox')
      return { response: 1, checkboxChecked: false }
    },
    showMessageBoxSync: () => (state.real.push('showMessageBoxSync'), 1),
    showErrorBox: () => void state.real.push('showErrorBox'),
    showCertificateTrustDialog: async () => void state.real.push('showCertificateTrustDialog')
  }
  const shell = {
    openExternal: async () => void state.real.push('openExternal'),
    openPath: async () => (state.real.push('openPath'), ''),
    showItemInFolder: () => void state.real.push('showItemInFolder'),
    beep: () => void state.real.push('beep')
  }
  const electron = {
    Notification,
    Tray,
    dialog,
    shell,
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getPath: () => process.cwd(),
      getLocale: () => 'en-GB',
      getVersion: () => '0.1.0',
      on: () => {}
    },
    globalShortcut: {
      register: (accelerator: string) => {
        state.registered.push(accelerator)
        return state.registerResult
      },
      unregister: () => {}
    },
    Menu: {
      buildFromTemplate: () => ({ popup: () => (state.popups += 1) }),
      setApplicationMenu: () => {},
      getApplicationMenu: () => ({ popup: () => (state.popups += 1) })
    },
    nativeTheme: { on: () => {}, shouldUseDarkColors: false },
    nativeImage: {
      createFromBuffer: () => ({ isEmpty: () => true }),
      createFromBitmap: (pixels: Buffer, size: { width: number; height: number }) => ({
        isEmpty: () => false,
        getSize: () => ({ width: size.width, height: size.height }),
        pixels
      })
    },
    screen: {
      getAllDisplays: () => [
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 },
        { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1 }
      ],
      getCursorScreenPoint: () => ({ x: 0, y: 0 })
    },
    // The real screen: a test fails if it is read off screen.
    desktopCapturer: {
      getSources: async () => {
        state.screenReads += 1
        return []
      }
    },
    systemPreferences: { getAccentColor: () => '0078d4ff', on: () => {} },
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        state.handlers.set(channel, handler)
    },
    // The Windows clipboard: a test fails if it is written off screen.
    clipboard: {
      writeText: (text: string) => void state.systemClipboard.push(text),
      readText: () => state.systemClipboard.at(-1) ?? ''
    },
    BrowserWindow: Object.assign(function BrowserWindow() {}, {
      fromWebContents: () => fakeWindow,
      getAllWindows: () => []
    })
  }
  return { state, reset, electron, fakeWindow }
})

vi.mock('electron', () => fake.electron)
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (command: string) => {
    fake.state.spawned.push(command)
    const handlers: Record<string, () => void> = {}
    const child = {
      once: (event: string, handler: () => void) => {
        handlers[event] = handler
        if (event === 'spawn') queueMicrotask(handler)
        return child
      },
      unref: () => {}
    }
    return child
  }
}))

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
}

/** Loads Ostler's modules fresh, with OSTLER_OFF_SCREEN set or not (and never OSTLER_ON_SCREEN). */
async function load(off: boolean) {
  vi.resetModules()
  fake.reset()
  vi.stubEnv('OSTLER_ON_SCREEN', '')
  vi.stubEnv('OSTLER_OFF_SCREEN', off ? '1' : '')
  quiet()
  const offScreenModule = await import('../../electron/app/off-screen')
  expect(offScreenModule.offScreen).toBe(off)
  return offScreenModule
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function notificationService(
  NotificationService: typeof import('../../electron/services/notification-service').NotificationService,
  sent: unknown[]
) {
  const config = { ...DEFAULT_CONFIG, notifications: { ...DEFAULT_CONFIG.notifications } }
  return new NotificationService(() => config as OstlerConfig, {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => sent.push(payload)
    }
  } as never)
}

function desktopConfig(desktop: Partial<OstlerConfig['desktop']>): OstlerConfig {
  return { ...DEFAULT_CONFIG, desktop: { ...DEFAULT_CONFIG.desktop, ...desktop } } as OstlerConfig
}

async function desktopIntegration(config: OstlerConfig) {
  const { DesktopIntegration } = await import('../../electron/app/desktop/desktop')
  return new DesktopIntegration({
    getConfig: () => config,
    unreadInboxCount: () => 0,
    stopAllAi: async () => undefined,
    pauseReminders: () => {},
    remindersPausedUntil: () => null,
    runningTimerTitle: () => null,
    stopTimer: () => {},
    focus: () => null,
    stopFocus: () => {},
    saveZoom: () => {},
    saveSnip: async () => undefined as never,
    dataDir: os.tmpdir(),
    isDev: false
  })
}

describe.each([
  { off: true, label: 'off screen' },
  { off: false, label: 'on screen' }
])('$label', ({ off }) => {
  it(`NotificationService ${off ? 'shows no' : 'shows a'} desktop notification, and the in-app one and rate limit still apply`, async () => {
    await load(off)
    const { NotificationService } = await import('../../electron/services/notification-service')
    const sent: unknown[] = []
    const service = notificationService(NotificationService, sent)

    service.notify('reminder', 'Call the venue', 'Due at 3pm', null)
    // 'info' is rate-limited: the second within 30 seconds is dropped either way.
    service.notify('info', 'First', '', null)
    service.notify('info', 'Second', '', null)

    const expected = off ? [] : [{ title: 'Call the venue' }, { title: 'First' }]
    expect(fake.state.notifications.map(({ title }) => ({ title }))).toEqual(expected)
    expect(fake.state.shown.map(({ title }) => ({ title }))).toEqual(expected)
    expect(sent.map((payload) => (payload as { title: string }).title)).toEqual([
      'Call the venue',
      'First'
    ])
  })

  it(`the window's crash recovery reloads and ${off ? 'shows no' : 'shows a'} notification`, async () => {
    await load(off)
    const { recoverFromRendererCrash } = await import('../../electron/app/window')
    const reload = vi.fn()
    recoverFromRendererCrash({ reload } as never, { reason: 'crashed', exitCode: 1 } as never)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(fake.state.notifications).toHaveLength(off ? 0 : 1)
    expect(fake.state.shown).toHaveLength(off ? 0 : 1)
  })

  it(`a Quick add key in use ${off ? 'is not registered and shows no' : 'shows a'} notification`, async () => {
    await load(off)
    fake.state.registerResult = false
    const desktop = await desktopIntegration(
      desktopConfig({ quickAddHotkeyEnabled: true, quickAddHotkey: 'Ctrl+Alt+Space' })
    )
    desktop.start([])
    expect(fake.state.registered).toEqual(off ? [] : ['Ctrl+Alt+Space'])
    expect(fake.state.notifications).toHaveLength(off ? 0 : 1)
    expect(fake.state.shown).toHaveLength(off ? 0 : 1)
  })

  it(`background mode ${off ? 'makes no' : 'makes a'} tray icon`, async () => {
    await load(off)
    const desktop = await desktopIntegration(desktopConfig({ backgroundMode: true }))
    desktop.start([])
    expect(fake.state.trays).toBe(off ? 0 : 1)
  })

  it(`an agent question ${off ? 'does not flash' : 'flashes'} the taskbar, and the title bar menu ${off ? 'stays shut' : 'opens'}`, async () => {
    await load(off)
    const desktop = await desktopIntegration(desktopConfig({}))
    desktop.attachWindow(fake.fakeWindow as never)
    desktop.agentQuestionArrived()
    expect(fake.state.flashes).toEqual(off ? [] : [true])
    desktop.popupMenu(10, 10)
    expect(fake.state.popups).toBe(off ? 0 : 1)
  })

  it(`system dialogs and the shell ${off ? 'answer without showing anything' : 'are left alone'}`, async () => {
    const { holdBackSystemUiOffScreen } = await load(off)
    const electron = fake.electron
    const originals = { ...electron.dialog, ...electron.shell }
    try {
      holdBackSystemUiOffScreen()
      const open = await electron.dialog.showOpenDialog()
      const save = await electron.dialog.showSaveDialog()
      const box = await (
        electron.dialog.showMessageBox as (...args: unknown[]) => Promise<unknown>
      )(fake.fakeWindow, { message: 'Discard?', buttons: ['Discard', 'Keep'], cancelId: 1 })
      electron.dialog.showErrorBox()
      await electron.shell.openExternal()
      await electron.shell.openPath()
      electron.shell.showItemInFolder()
      if (off) {
        expect(fake.state.real).toEqual([])
        expect(open).toEqual({ canceled: true, filePaths: [] })
        expect(save).toEqual({ canceled: true, filePath: '' })
        expect(box).toEqual({ response: 1, checkboxChecked: false })
      } else {
        expect(fake.state.real).toEqual([
          'showOpenDialog',
          'showSaveDialog',
          'showMessageBox',
          'showErrorBox',
          'openExternal',
          'openPath',
          'showItemInFolder'
        ])
        expect(open).toEqual({ canceled: false, filePaths: ['picked'] })
      }
      // A test can still put its own answer in, as the e2e suite and the monkey do.
      electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['stub'] })
      expect(await electron.dialog.showOpenDialog()).toEqual({
        canceled: false,
        filePaths: ['stub']
      })
    } finally {
      for (const [name, value] of Object.entries(originals)) {
        const target = name in electron.dialog ? electron.dialog : electron.shell
        Object.defineProperty(target, name, { value, configurable: true, writable: true })
      }
    }
  })

  it(`Print ${off ? 'opens no' : 'opens the'} print dialog`, async () => {
    await load(off)
    const { printContents } = await import('../../electron/app/print-window')
    const print = vi.fn((_options: unknown, done: (success: boolean, reason: string) => void) =>
      done(true, '')
    )
    expect(await printContents({ print } as never)).toBe(!off)
    expect(print).toHaveBeenCalledTimes(off ? 0 : 1)
  })

  it.runIf(process.platform === 'win32')(
    `Open with ${off ? 'starts no' : 'starts the'} other app`,
    async () => {
      await load(off)
      const { registerSystemHandlers } = await import('../../electron/ipc/system-handlers')
      const folder = path.join(os.tmpdir(), 'ostler-off-screen-project')
      registerSystemHandlers({
        configStore: { getProjects: () => [{ id: 'p1', path: folder }] } as never,
        database: {} as never
      })
      const handler = fake.state.handlers.get(IPC_CHANNELS.OPEN_CHECKOUT)!
      const result = await handler({}, path.join(folder, 'README.md'), 'other')
      expect(result).toEqual({ ok: true, value: undefined })
      expect(fake.state.spawned).toEqual(off ? [] : ['rundll32.exe'])
      // A bad request is refused either way.
      expect(await handler({}, path.join(folder, 'README.md'), 'nope')).toMatchObject({ ok: false })
    }
  )

  it(`Copy, a prompt with its token and Copy diagnostics ${off ? "go to Ostler's own clipboard" : 'go to the Windows clipboard'}`, async () => {
    await load(off)
    const { offScreenCopiedText } = await import('../../electron/app/clipboard')
    const { registerSystemHandlers } = await import('../../electron/ipc/system-handlers')
    const { registerDiagnosticsHandlers } = await import('../../electron/ipc/diagnostics-handlers')
    const { copyPromptWithSecrets } = await import('../../electron/ipc/agent-prompt-handlers')
    registerSystemHandlers({ configStore: {} as never, database: {} as never })
    registerDiagnosticsHandlers({ configStore: { get: () => DEFAULT_CONFIG } as never })

    const copy = fake.state.handlers.get(IPC_CHANNELS.COPY_TEXT)!
    expect(await copy({}, 'SHOP-12')).toEqual({ ok: true, value: undefined })
    if (off) expect(offScreenCopiedText()).toBe('SHOP-12')
    expect(copyPromptWithSecrets('Token: s3cret', ['s3cret'])).not.toContain('s3cret')
    if (off) expect(offScreenCopiedText()).toBe('Token: s3cret')
    const diagnostics = fake.state.handlers.get(IPC_CHANNELS.COPY_DIAGNOSTICS)!
    expect(await diagnostics({})).toEqual({ ok: true, value: undefined })

    if (off) {
      expect(fake.state.systemClipboard).toEqual([])
      expect(offScreenCopiedText()).toContain('0.1.0')
    } else {
      expect(fake.state.systemClipboard.slice(0, 2)).toEqual(['SHOP-12', 'Token: s3cret'])
      expect(fake.state.systemClipboard).toHaveLength(3)
      expect(fake.state.systemClipboard[2]).toContain('0.1.0')
      expect(offScreenCopiedText()).toBe('')
    }
  })

  it(`pages ${off ? "are told to paste from Ostler's own clipboard" : 'paste from the Windows clipboard, as Chromium does'}`, async () => {
    const { offScreenArguments } = await load(off)
    expect(offScreenArguments()).toEqual(off ? ['--ostler-off-screen'] : [])
    const { registerSystemHandlers } = await import('../../electron/ipc/system-handlers')
    registerSystemHandlers({ configStore: {} as never, database: {} as never })
    await fake.state.handlers.get(IPC_CHANNELS.COPY_TEXT)!({}, 'Book the venue')
    const read = await fake.state.handlers.get(IPC_CHANNELS.READ_OFF_SCREEN_CLIPBOARD)!({})
    if (off) expect(read).toEqual({ ok: true, value: 'Book the venue' })
    else expect(read).toMatchObject({ ok: false })
  })

  it(`Snip to task ${off ? 'never reads the screen: each display gets a generated picture of its size' : 'reads the screen'}`, async () => {
    await load(off)
    const { captureDisplays } = await import('../../electron/app/desktop/snip-electron')
    const captured = await captureDisplays()
    expect(fake.state.screenReads).toBe(off ? 0 : 1)
    if (off) {
      expect(captured.map(({ display, image }) => [display.id, image.getSize()])).toEqual([
        [1, { width: 2400, height: 1350 }],
        [2, { width: 1280, height: 720 }]
      ])
    }
  })
})
