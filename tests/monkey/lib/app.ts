import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'fs'
import * as net from 'node:net'
import * as path from 'path'
import { createRequire } from 'module'
import type { MonkeyOptions } from './options'
import type { Recorder } from './recorder'
import { PAGE_PROBE_SCRIPT } from './page-probe'
import { electronArgs } from '../../e2e/electron-args'
import { copiedText } from '../../e2e/copied-text'

/**
 * Starting, restarting and stopping Ostler for a monkey run: always on the
 * run's own data folder, with both local servers moved off the default ports,
 * and with the operating system's dialogs and the browser replaced by stubs
 * that record what Ostler asked for. A monkey must never open Explorer, a web
 * page or a real file picker, and must never block on one.
 */

const moduleRequire = createRequire(__filename)
export const REPO_ROOT = path.resolve(__dirname, '../../..')

export interface Ports {
  harness: number
  automation: number
}

export interface RunningApp {
  app: ElectronApplication
  page: Page
  /** The main process's id, for tools/window-screenshot. */
  pid: number
}

export function freePort(preferred = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (preferred && error.code === 'EADDRINUSE') resolve(freePort(0))
      else reject(error)
    })
    probe.listen(preferred, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Could not reserve a port'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The ports a new install listens on once agents are turned on. */
const DEFAULT_PORTS: Ports = { harness: 8934, automation: 8935 }

/**
 * Makes sure the data folder exists and both servers will listen on free
 * ports. A journey on a new folder is a true new install (no config.json at
 * all, exactly as a person's first launch) whenever Ostler's default ports are
 * free; when they are taken, by an everyday Ostler for instance, it gets
 * the minimal config `npm run dev:scratch` writes instead, which Ostler treats
 * as an existing install with no projects. An existing folder keeps
 * everything, ports included, unless a port is now taken by something else.
 */
export async function prepareDataDir(
  options: MonkeyOptions,
  extra: { ai?: Record<string, unknown> } = {}
): Promise<{ ports: Ports; trueNewInstall: boolean }> {
  fs.mkdirSync(options.dataDir, { recursive: true })
  fs.mkdirSync(options.projectsDir, { recursive: true })
  const configPath = path.join(options.dataDir, 'config.json')
  if (options.fresh && options.mode === 'journey' && !extra.ai && !fs.existsSync(configPath)) {
    const harness = await freePort(DEFAULT_PORTS.harness)
    const automation = await freePort(DEFAULT_PORTS.automation)
    if (harness === DEFAULT_PORTS.harness && automation === DEFAULT_PORTS.automation) {
      return { ports: DEFAULT_PORTS, trueNewInstall: true }
    }
  }
  const config = readJson(configPath) ?? {}
  const harness = (config.harness as Record<string, unknown> | undefined) ?? { enabled: false }
  const automation = (config.automationApi as Record<string, unknown> | undefined) ?? {
    enabled: false
  }
  const ports: Ports = {
    harness: await freePort(typeof harness.port === 'number' ? harness.port : 0),
    automation: await freePort(typeof automation.port === 'number' ? automation.port : 0)
  }
  config.harness = { ...harness, port: ports.harness }
  config.automationApi = { ...automation, port: ports.automation }
  if (extra.ai) config.ai = { ...((config.ai as Record<string, unknown>) ?? {}), ...extra.ai }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { ports, trueNewInstall: false }
}

/** Reads the app's own config from the run's data folder (the monkey owns this folder). */
export function readConfig(options: MonkeyOptions): Record<string, unknown> {
  return readJson(path.join(options.dataDir, 'config.json')) ?? {}
}

export interface LaunchSettings {
  /** Extra environment for the app, e.g. OSTLER_AI_API_KEY for a preconfigured fake AI. */
  environment?: Record<string, string>
}

export async function launchApp(
  options: MonkeyOptions,
  recorder: Recorder,
  settings: LaunchSettings = {}
): Promise<RunningApp> {
  const started = Date.now()
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  // Your own API key must never reach a monkey's app unless asked for.
  delete environment.OSTLER_AI_API_KEY
  const app = await electron.launch({
    executablePath: moduleRequire('electron') as string,
    args: electronArgs(REPO_ROOT),
    env: {
      ...environment,
      NODE_ENV: 'production',
      OSTLER_USER_DATA: options.dataDir,
      ELECTRON_DISABLE_GPU: '1',
      // Ostler keeps its own windows off screen and out of the focus when
      // driven (electron/app/off-screen.ts); --on-screen asks it not to.
      ...(options.onScreen ? { OSTLER_ON_SCREEN: '1' } : { OSTLER_OFF_SCREEN: '1' }),
      ...settings.environment
    }
  })
  // Every page load gets the probe: the key log, the click log and the change counter.
  await app.context().addInitScript(PAGE_PROBE_SCRIPT)
  // The main process takes evaluate() only once its first window is up.
  const page = await app.firstWindow()
  await installNativeStubs(app, options)
  await setWindowSize(app, page, options.viewport)
  await page.waitForLoadState('domcontentloaded')
  // The first window loaded before the init script was registered.
  await page.evaluate(PAGE_PROBE_SCRIPT).catch(() => {})
  const pid = app.process().pid ?? 0
  recorder.action({
    kind: 'launch',
    target: `Ostler (pid ${pid})`,
    durationMs: Date.now() - started,
    ok: true
  })
  recorder.journal(`- Launched Ostler, pid ${pid}, data folder \`${options.dataDir}\``)
  return { app, page, pid }
}

/**
 * Sizes the real window, not just the page: the title bar and Windows' own
 * buttons are laid out from the window width, so a page
 * emulated smaller than its window shows things no person ever sees.
 */
export async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  size: { width: number; height: number }
): Promise<void> {
  await app
    .evaluate(({ BrowserWindow }, { width, height }) => {
      const windows = BrowserWindow.getAllWindows()
      // Before its first paint the main window is not shown yet; it is the only one then.
      const win = windows.find((entry) => entry.isVisible()) ?? windows[0]
      if (!win) return
      if (win.isMaximized()) win.unmaximize()
      win.setContentSize(width, height)
    }, size)
    .catch(() => {})
  await page.setViewportSize(size)
}

export async function closeApp(running: RunningApp | null): Promise<void> {
  if (!running) return
  await running.app.close().catch(() => {})
}

/** Where saved files go: the run's exports folder, under the name Ostler suggested. */
export function exportsDir(options: MonkeyOptions): string {
  return path.join(options.runDir, 'exports')
}

/**
 * Replaces the native file pickers, message boxes and shell calls in the main
 * process with recorders. Open dialogs take the next path from a queue the
 * journey fills (`queueOpenFile`), and cancel when it is empty, as a person
 * closing the picker would. Save dialogs save into the run's exports folder.
 */
async function installNativeStubs(app: ElectronApplication, options: MonkeyOptions): Promise<void> {
  const saveDir = exportsDir(options)
  fs.mkdirSync(saveDir, { recursive: true })
  await app.evaluate(
    ({ dialog, shell }, { saveDir: directory }) => {
      type NativeCall = { at: string; kind: string; detail: string }
      const state = globalThis as unknown as {
        __monkeyNative: NativeCall[]
        __monkeyOpenQueue: string[][]
      }
      state.__monkeyNative = []
      state.__monkeyOpenQueue = []
      const record = (kind: string, detail: unknown) =>
        state.__monkeyNative.push({
          at: new Date().toISOString(),
          kind,
          detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
        })
      const describe = (args: unknown[]) =>
        args.find((arg) => arg && typeof arg === 'object' && !('webContents' in (arg as object)))
      const replace = (target: object, name: string, value: unknown) =>
        Object.defineProperty(target, name, { value, configurable: true, writable: true })

      replace(dialog, 'showOpenDialog', async (...args: unknown[]) => {
        const next = state.__monkeyOpenQueue.shift()
        record('open-dialog', { request: describe(args), answered: next ?? 'cancelled' })
        return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] }
      })
      replace(dialog, 'showOpenDialogSync', (...args: unknown[]) => {
        const next = state.__monkeyOpenQueue.shift()
        record('open-dialog-sync', { request: describe(args), answered: next ?? 'cancelled' })
        return next
      })
      replace(dialog, 'showSaveDialog', async (...args: unknown[]) => {
        const request = describe(args) as { defaultPath?: string } | undefined
        const suggested = (request?.defaultPath ?? 'ostler-export').split(/[\\/]/).pop()
        const separator = process.platform === 'win32' ? '\\' : '/'
        const filePath = `${directory}${separator}${Date.now()}-${suggested}`
        record('save-dialog', { request, answered: filePath })
        return { canceled: false, filePath }
      })
      replace(dialog, 'showMessageBox', async (...args: unknown[]) => {
        record('message-box', describe(args))
        return { response: 0, checkboxChecked: false }
      })
      replace(dialog, 'showMessageBoxSync', (...args: unknown[]) => {
        record('message-box-sync', describe(args))
        return 0
      })
      replace(dialog, 'showErrorBox', (title: string, content: string) => {
        record('error-box', { title, content })
      })
      replace(shell, 'openExternal', async (url: string) => {
        record('open-external', url)
      })
      replace(shell, 'openPath', async (target: string) => {
        record('open-path', target)
        return ''
      })
      replace(shell, 'showItemInFolder', (target: string) => {
        record('show-in-folder', target)
      })
    },
    { saveDir }
  )
}

/** The next open dialog answers with these files. */
export async function queueOpenFile(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate((_electron, paths) => {
    const state = globalThis as unknown as { __monkeyOpenQueue: string[][] }
    state.__monkeyOpenQueue.push(paths)
  }, filePaths)
}

export interface NativeCall {
  at: string
  kind: string
  detail: string
}

/** What Ostler asked the operating system for since the last call. */
export async function drainNativeCalls(app: ElectronApplication): Promise<NativeCall[]> {
  return app
    .evaluate(() => {
      const state = globalThis as unknown as { __monkeyNative?: NativeCall[] }
      return state.__monkeyNative ? state.__monkeyNative.splice(0) : []
    })
    .catch(() => [])
}

/** What Ostler last copied: off screen, as the monkey runs it, its own clipboard, never the Windows one. */
export async function readClipboard(app: ElectronApplication): Promise<string> {
  return copiedText(app).catch(() => '')
}

/**
 * New lines in `<dataDir>/logs/main.log` since the last read, grouped so a
 * stack trace stays with the line it belongs to.
 */
export class MainLogTail {
  private offset = 0
  constructor(private readonly file: string) {
    try {
      this.offset = fs.statSync(file).size
    } catch {
      this.offset = 0
    }
  }

  read(): { level: string; text: string }[] {
    let size = 0
    try {
      size = fs.statSync(this.file).size
    } catch {
      return []
    }
    // The log rotated: start from the top of the new file.
    if (size < this.offset) this.offset = 0
    if (size === this.offset) return []
    const fd = fs.openSync(this.file, 'r')
    try {
      const buffer = Buffer.alloc(size - this.offset)
      fs.readSync(fd, buffer, 0, buffer.length, this.offset)
      this.offset = size
      const entries: { level: string; text: string }[] = []
      for (const line of buffer.toString('utf8').split(/\r?\n/)) {
        const match = /^\d{4}-\d\d-\d\dT[\d:.]+Z (ERROR|WARN|INFO) (.*)$/.exec(line)
        if (match) entries.push({ level: match[1], text: match[2] })
        else if (line.trim() && entries.length) entries[entries.length - 1].text += `\n${line}`
      }
      return entries
    } finally {
      fs.closeSync(fd)
    }
  }
}
