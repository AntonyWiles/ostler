import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessSession, HarnessTask, PlanningWorkItem } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'

/**
 * A task's agent prompt (Copy agent prompt and the task's AI Agent section) comes from one
 * builder in the main process, for a task in any state, and reading it changes nothing.
 */
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const copied = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => undefined },
  session: {}
}))
vi.mock('../../electron/app/clipboard', () => ({ copyText: (text: string) => copied(text) }))

const { IPC_CHANNELS, DEFAULT_CONFIG } = await import('../../src/shared/ostler-api')
const { registerPlanningHandlers } = await import('../../electron/ipc/planning-handlers')

const TOKEN = 'automation-secret-1234' // hygiene-allow: made-up test token
const SESSION_TOKEN = 'session-secret-5678' // hygiene-allow: made-up test token

const item = (overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem =>
  ({
    id: 'item-1',
    projectId: 'project-1',
    title: 'Paint the hall',
    description: 'Two coats, white.',
    acceptanceCriteria: ['No streaks'],
    typeId: null,
    targetDate: null,
    linkedHarnessTaskId: null,
    ...overrides
  }) as PlanningWorkItem

const pendingTask = {
  id: 'task-1',
  title: 'Paint the hall',
  details: 'Two coats, white.',
  status: 'pending',
  claimedBy: null
} as unknown as HarnessTask

describe("a task's agent prompt", () => {
  let current: PlanningWorkItem
  let queue: HarnessTask[]
  let sessions: HarnessSession[]
  const startSessionForTask = vi.fn(async () => ({
    id: 'session-1',
    token: SESSION_TOKEN,
    workspace: null
  }))

  const call = <T = { kind: string; text: string }>(channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({}, ...args) as Promise<{ ok: boolean; value: T; error?: string }>

  beforeEach(() => {
    handlers.clear()
    copied.mockClear()
    startSessionForTask.mockClear()
    current = item()
    queue = []
    sessions = []
    const project = makeWatchedProject({ automationToken: TOKEN })
    registerPlanningHandlers({
      configStore: { get: () => DEFAULT_CONFIG },
      planningService: {
        getWorkItem: () => current,
        listWorkItems: () => [current],
        updateWorkItem: vi.fn(),
        taskTypes: { nameOf: () => null }
      },
      harnessService: {
        getState: () => ({ taskQueue: queue, activeSessions: sessions }),
        startSessionForTask
      },
      getProject: () => project,
      agentAttachmentsFor: () => [],
      notifyHarnessState: vi.fn(),
      notifyPlanningChanged: vi.fn()
    } as never)
  })

  it('shows and copies the automation prompt for a task not queued, without queueing it', async () => {
    const shown = await call(IPC_CHANNELS.GET_PLANNING_AGENT_PROMPT, 'project-1', 'item-1')
    expect(shown.ok).toBe(true)
    expect(shown.value.kind).toBe('automation')
    expect(shown.value.text).toContain('Task: Paint the hall')
    expect(shown.value.text).toContain('No streaks')
    expect(shown.value.text).not.toContain(TOKEN)
    expect(copied).not.toHaveBeenCalled()

    const copy = await call<string>(IPC_CHANNELS.COPY_PLANNING_AGENT_HANDOFF, 'project-1', 'item-1')
    expect(copy.ok).toBe(true)
    expect(copy.value).toBe(shown.value.text)
    expect(copied.mock.calls[0][0]).toContain(TOKEN)
    expect(startSessionForTask).not.toHaveBeenCalled()
  })

  it('shows a queued handoff without starting its session; copying starts it', async () => {
    current = item({ linkedHarnessTaskId: 'task-1' })
    queue = [pendingTask]
    const shown = await call(IPC_CHANNELS.GET_PLANNING_AGENT_PROMPT, 'project-1', 'item-1')
    expect(shown.value.kind).toBe('handoff')
    expect(shown.value.text).toContain('Task: Paint the hall')
    expect(startSessionForTask).not.toHaveBeenCalled()

    const copy = await call<string>(IPC_CHANNELS.COPY_PLANNING_AGENT_HANDOFF, 'project-1', 'item-1')
    expect(copy.ok).toBe(true)
    expect(startSessionForTask).toHaveBeenCalledWith(expect.anything(), 'task-1')
    expect(copied.mock.calls[0][0]).toContain(SESSION_TOKEN)
    expect(copy.value).not.toContain(SESSION_TOKEN)
  })

  it("shows a running task's session prompt", async () => {
    current = item({ linkedHarnessTaskId: 'task-1' })
    queue = [{ ...pendingTask, status: 'claimed', claimedBy: 'session-9' } as HarnessTask]
    sessions = [
      { id: 'session-9', taskId: 'task-1', token: SESSION_TOKEN, workspace: null } as never
    ]
    const shown = await call(IPC_CHANNELS.GET_PLANNING_AGENT_PROMPT, 'project-1', 'item-1')
    expect(shown.value.kind).toBe('session')
    expect(shown.value.text).toContain('Session ID: session-9')
    expect(shown.value.text).not.toContain(SESSION_TOKEN)
  })
})
