import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { RendererConfig, Result } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  systemPreferences: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^enc:/, '')
  }
}))

const { ConfigStore } = await import('../../electron/config-store')
const { registerProjectHandlers } = await import('../../electron/ipc/project-handlers')
const { registerGithubHandlers } = await import('../../electron/ipc/github-handlers')
const { IPC_CHANNELS } = await import('../../src/shared/ostler-api')

describe('GET_CONFIG, UPDATE_CONFIG and CLEAR_AI_API_KEY', () => {
  const tempDir = useTempDir('ostler-config-ipc-')
  let store: InstanceType<typeof ConfigStore>
  let harnessServer: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
  let automationServer: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
  let harnessState: { taskQueue: unknown[]; activeSessions: unknown[]; reviewSessions: unknown[] }
  let showAgentColumns: ReturnType<typeof vi.fn<(projectId: string) => string[]>>

  const invoke = async (channel: string, ...args: unknown[]) =>
    (await handlers.get(channel)!({}, ...args)) as Result<RendererConfig>

  beforeEach(() => {
    handlers.clear()
    store = new ConfigStore(path.join(tempDir(), 'config.json'))
    const unused = {} as never
    harnessServer = { start: vi.fn(), stop: vi.fn() }
    automationServer = { start: vi.fn(), stop: vi.fn() }
    harnessState = { taskQueue: [], activeSessions: [], reviewSessions: [] }
    showAgentColumns = vi.fn((_projectId: string) => ['ready', 'review'])
    registerProjectHandlers({
      configStore: store,
      database: unused,
      fileWatcher: unused,
      gitReader: unused,
      harnessService: { getState: () => harnessState } as never,
      harnessHttpServer: harnessServer as never,
      automationHttpServer: automationServer as never,
      projectRemovalService: unused,
      projectScaffoldService: unused,
      projectPackageService: unused,
      showAgentColumns,
      runtimeController: { reconfigure: vi.fn(), start: vi.fn(), stop: vi.fn() } as never,
      getMainWindow: () => null,
      getProject: () => {
        throw new Error('not used')
      },
      validateProjectRelativePath: (_project, relativePath) => relativePath
    })
    registerGithubHandlers({
      configStore: store,
      githubLinks: unused,
      importService: unused,
      gitReader: unused,
      getProject: () => {
        throw new Error('not used')
      }
    })
  })

  it('starts and stops each server on its own switch, without a restart (D38)', async () => {
    let result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, {
      harness: { enabled: true },
      automationApi: { enabled: true }
    })
    expect(result.ok).toBe(true)
    expect(harnessServer.start).toHaveBeenCalledWith(store.get().harness.port)
    expect(automationServer.start).toHaveBeenCalledWith(store.get().automationApi.port)

    result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, { harness: { enabled: false } })
    expect(result.ok).toBe(true)
    expect(harnessServer.stop).toHaveBeenCalled()
    expect(automationServer.stop).not.toHaveBeenCalled()

    result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, { automationApi: { enabled: false } })
    expect(result.ok).toBe(true)
    expect(automationServer.stop).toHaveBeenCalled()
  })

  it('turning agents on shows Ready and In review in projects with a folder (R2.4)', async () => {
    const folder = fs.mkdtempSync(path.join(tempDir(), 'site-'))
    const site = store.registerProject({ name: 'Site', folder })
    store.registerProject({ name: 'Garden', folder: null })

    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { harness: { enabled: true } })

    expect(showAgentColumns.mock.calls).toEqual([[site.id]])
    // Already on: nothing more to show.
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { harness: { enabled: true } })
    expect(showAgentColumns).toHaveBeenCalledTimes(1)
  })

  it('refuses to turn agents off while agent work is queued, and lists it', async () => {
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { harness: { enabled: true } })
    store.registerProject({ name: 'Site', folder: null })
    harnessState.taskQueue = [{ status: 'pending' }]

    const result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, { harness: { enabled: false } })

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('Site: 1 agent run queued')
    })
    expect(store.get().harness.enabled).toBe(true)
  })

  it('keeps the saved key when an update has no key or an empty one', async () => {
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ai: { apiKey: 'sk-original-1234' } })
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ai: { baseUrl: 'https://example.test/v1' } })
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ai: { apiKey: '', model: 'gpt-x' } })

    expect(store.get().ai.apiKey).toBe('sk-original-1234')
    expect(store.get().ai.baseUrl).toBe('https://example.test/v1')
    const result = await invoke(IPC_CHANNELS.GET_CONFIG)
    expect(result.ok && result.value.ai).toMatchObject({ hasApiKey: true, apiKeyHint: '1234' })
    expect(JSON.stringify(result)).not.toContain('sk-original-1234')
  })

  it('replaces the key when a new one is sent, and removes it on CLEAR_AI_API_KEY', async () => {
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ai: { apiKey: 'sk-original-1234' } })
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ai: { apiKey: 'sk-replaced-5678' } })
    expect(store.get().ai.apiKey).toBe('sk-replaced-5678')

    const cleared = await invoke(IPC_CHANNELS.CLEAR_AI_API_KEY)
    expect(store.get().ai.apiKey).toBe('')
    expect(cleared.ok && cleared.value.ai).toMatchObject({ hasApiKey: false, apiKeyHint: '' })
  })

  it('keeps the GitHub token encrypted in main, never sent to the renderer (R4.4)', async () => {
    const token = 'github_pat_11ABCDEFG0123456789_secret'
    let result = await invoke(IPC_CHANNELS.GET_CONFIG)
    expect(result.ok && result.value.github).toEqual({ hasToken: false })

    result = await invoke(IPC_CHANNELS.SET_GITHUB_TOKEN, `  ${token} `)
    expect(result.ok && result.value.github).toEqual({ hasToken: true })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(store.get().github.token).toBe(token)
    // On disk, only safeStorage's encryption of it.
    const onDisk = fs.readFileSync(path.join(tempDir(), 'config.json'), 'utf-8')
    expect(onDisk).not.toContain(token)
    expect(new ConfigStore(path.join(tempDir(), 'config.json')).get().github.token).toBe(token)

    result = await invoke(IPC_CHANNELS.GET_CONFIG)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(result.ok && result.value.github).toEqual({ hasToken: true })

    // The renderer cannot set or wipe it through UPDATE_CONFIG.
    await invoke(IPC_CHANNELS.UPDATE_CONFIG, { github: { token: 'other' }, ui: { theme: 'light' } })
    expect(store.get().github.token).toBe(token)
    expect(store.get().ui.theme).toBe('light')

    const refused = await invoke(IPC_CHANNELS.SET_GITHUB_TOKEN, 'has spaces in it')
    expect(refused.ok).toBe(false)
    expect(store.get().github.token).toBe(token)

    const cleared = await invoke(IPC_CHANNELS.CLEAR_GITHUB_TOKEN)
    expect(cleared.ok && cleared.value.github).toEqual({ hasToken: false })
    expect(store.get().github.token).toBe('')
  })

  it('ignores projects sent through UPDATE_CONFIG, so tokens cannot be wiped', async () => {
    const project = store.generateAutomationToken(
      store.registerProject({ folder: tempDir(), name: 'Scratch' }).id
    )
    const result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, {
      projects: [],
      ui: { theme: 'light' }
    })
    expect(result.ok).toBe(true)
    expect(store.getProjects()).toHaveLength(1)
    expect(store.getProjects()[0].automationToken).toBe(project.automationToken)
    expect(store.get().ui.theme).toBe('light')
  })

  it('rejects an appearance value outside the settings', async () => {
    const result = await invoke(IPC_CHANNELS.UPDATE_CONFIG, { ui: { theme: 'sepia' } })
    expect(result.ok).toBe(false)
    expect(store.get().ui.theme).not.toBe('sepia')
  })
})
