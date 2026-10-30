import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectAiSettings, Result, WatchedProject } from '../../src/shared/ostler-api'
import { IPC_CHANNELS } from '../../src/shared/ostler-api'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => undefined },
  session: {}
}))

const { AutomationHttpServer } = await import('../../electron/services/automation-http-server')
const { ProjectAiSettingsService } = await import('../../electron/services/project-ai-settings')
const { registerAiHandlers } = await import('../../electron/ipc/ai-handlers')

let PORT = 0

/** One rule for every surface: Settings (IPC) and the automation API read and change the same settings. */
describe('project AI settings: IPC and /ai-settings', () => {
  const root = useTempDir('ostler-ai-settings-')
  let project: WatchedProject
  let server: InstanceType<typeof AutomationHttpServer>

  beforeEach(async () => {
    project = makeWatchedProject({
      id: 'ai-project',
      name: 'AI project',
      addedAt: Date.now(),
      automationToken: 'automation-token',
      aiProfile: 'auto'
    })
    const getProject = (id: string) => {
      if (id !== project.id) throw new Error('Project not found')
      return project
    }
    const settings = new ProjectAiSettingsService({
      getProject,
      updateProject: (_id, updates) => Object.assign(project, updates),
      isGitRepo: async () => false
    })
    handlers.clear()
    registerAiHandlers({
      dataDir: root(),
      configStore: { get: () => ({ projects: [project] }) } as never,
      database: {} as never,
      planningService: {} as never,
      libraryService: {} as never,
      taskReviewService: {} as never,
      openCodeRunnerService: {} as never,
      getMainWindow: () => null,
      getProject,
      queueWorkItemForHarness: () => {
        throw new Error('not used')
      },
      notifyHarnessState: () => undefined,
      projectAiSettings: settings,
      stopAllAi: async () => ({ halted: true })
    })
    const unused = undefined
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'runtime'),
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      settings
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
  })

  const http = async (method: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}/ai-settings`, {
      method,
      headers: {
        Authorization: `Bearer ${project.automationToken}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: (await response.json()) as Result<ProjectAiSettings> }
  }

  it('reads and changes the same settings as the desktop app', async () => {
    const ipc = (await handlers.get(IPC_CHANNELS.GET_PROJECT_AI_SETTINGS)!(
      {},
      project.id
    )) as Result<ProjectAiSettings>
    expect(ipc).toEqual({
      ok: true,
      value: { projectId: project.id, profileSetting: 'auto', profile: 'general' }
    })
    expect((await http('GET')).body).toEqual(ipc)

    const changed = await http('PATCH', { profileSetting: 'software' })
    expect(changed.status).toBe(200)
    expect(changed.body).toEqual({
      ok: true,
      value: { projectId: project.id, profileSetting: 'software', profile: 'software' }
    })
    expect(project).toMatchObject({ aiProfile: 'software' })

    const back = (await handlers.get(IPC_CHANNELS.UPDATE_PROJECT_AI_SETTINGS)!({}, project.id, {
      profileSetting: 'auto'
    })) as Result<ProjectAiSettings>
    expect(back.ok && back.value.profileSetting).toBe('auto')
  })

  it('refuses a bad value and an empty change', async () => {
    expect((await http('PATCH', { profileSetting: 'robots' })).body.ok).toBe(false)
    expect((await http('PATCH', {})).body.ok).toBe(false)
    expect(project).toMatchObject({ aiProfile: 'auto' })
  })

  it('lists both routes in /help', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}/help`)
    const text = await response.text()
    expect(text).toContain('/ai-settings')
    expect(text).toContain('PATCH')
  })
})
