import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const invoke = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true, value: null }))
let exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() },
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => (exposed = api)
  }
}))

const { API_CHANNELS } = await import('../../src/shared/ostler-api/api-channels')
const { IPC_CHANNELS } = await import('../../src/shared/ostler-api/ipc-types')
const { handleApi, projectIpcHandlers } = await import('../../electron/ipc/handle-ipc')
await import('../../electron/preload')

const methods = Object.keys(API_CHANNELS) as (keyof typeof API_CHANNELS)[]

describe('API_CHANNELS', () => {
  it('gives every call its own channel, one of IPC_CHANNELS', () => {
    const channels = Object.values(API_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
    const known = new Set<string>(Object.values(IPC_CHANNELS))
    expect(channels.filter((channel) => !known.has(channel))).toEqual([])
  })

  it('names every channel ostler: and its constant in kebab case', () => {
    const odd = Object.entries(IPC_CHANNELS).filter(
      ([name, channel]) => channel !== `ostler:${name.toLowerCase().replace(/_/g, '-')}`
    )
    expect(odd).toEqual([])
  })
})

describe('the preload', () => {
  beforeEach(() => invoke.mockClear())

  it('passes every call to its channel with the arguments unchanged', async () => {
    for (const method of methods) {
      const call = exposed[method] as (...args: unknown[]) => Promise<unknown>
      expect(typeof call, method).toBe('function')
      if (method === 'openInNewWindow' || method === 'pinTaskToDesktop') continue
      await call('a', 2, true)
      expect(invoke).toHaveBeenLastCalledWith(API_CHANNELS[method], 'a', 2, true)
    }
  })

  it('sends a real boolean for openInNewWindow and pinTaskToDesktop', async () => {
    await (exposed.openInNewWindow as (...args: unknown[]) => Promise<unknown>)('/home', 'yes')
    expect(invoke).toHaveBeenLastCalledWith(API_CHANNELS.openInNewWindow, '/home', false)
    await (exposed.pinTaskToDesktop as (...args: unknown[]) => Promise<unknown>)('p', 't', 1)
    expect(invoke).toHaveBeenLastCalledWith(API_CHANNELS.pinTaskToDesktop, 'p', 't', false)
  })

  it('keeps the subscriptions and initial values', () => {
    expect(typeof exposed.onWatchEvent).toBe('function')
    expect(exposed).toHaveProperty('initialAppearance')
    expect(exposed).toHaveProperty('initialLocale')
  })
})

describe('handleApi', () => {
  beforeEach(() => handlers.clear())

  it("registers on the method's channel", async () => {
    handleApi('getProjects', () => [])
    expect(await handlers.get(API_CHANNELS.getProjects)!({})).toEqual({ ok: true, value: [] })
  })

  it('resolves the project first for projectApi, and notifies for mutatingApi', async () => {
    const project = { id: 'p1' } as never
    const notify = vi.fn()
    const { projectApi, mutatingApi } = projectIpcHandlers(() => project, notify)
    projectApi('getPlanningLabels', (got) => {
      expect(got).toBe(project)
      return []
    })
    mutatingApi('deletePlanningLabel', () => undefined as never)
    await handlers.get(API_CHANNELS.getPlanningLabels)!({}, 'p1')
    expect(notify).not.toHaveBeenCalled()
    await handlers.get(API_CHANNELS.deletePlanningLabel)!({}, 'p1', 'bug')
    expect(notify).toHaveBeenCalledWith(project)
  })
})
