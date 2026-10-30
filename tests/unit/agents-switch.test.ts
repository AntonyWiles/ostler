import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  type HarnessProjectState,
  type WatchedProject
} from '../../src/shared/ostler-api'
import {
  assertAgentsCanTurnOff,
  httpServerPorts,
  syncHttpServers
} from '../../electron/services/agents-switch'

function project(id: string, name: string): WatchedProject {
  return { id, name, path: null } as unknown as WatchedProject
}

function state(overrides: Partial<Record<keyof HarnessProjectState, unknown[]>> = {}) {
  return {
    activeSessions: [],
    reviewSessions: [],
    taskQueue: [],
    ...overrides
  } as unknown as HarnessProjectState
}

function config(harness: boolean, automation: boolean) {
  return {
    harness: { ...DEFAULT_CONFIG.harness, enabled: harness, port: 9001 },
    automationApi: { enabled: automation, port: 9002 }
  }
}

describe('assertAgentsCanTurnOff', () => {
  it('allows turning agents off when no project has agent work', () => {
    expect(() =>
      assertAgentsCanTurnOff([project('a', 'Site'), project('b', 'Thesis')], () => state())
    ).not.toThrow()
  })

  it('refuses while work is queued or running, and lists it by project', () => {
    const states: Record<string, HarnessProjectState> = {
      a: state({ taskQueue: [{ status: 'pending' }, { status: 'complete' }] }),
      b: state(),
      c: state({ activeSessions: [{ id: 's1' }], reviewSessions: [{ id: 's2' }] })
    }
    expect(() =>
      assertAgentsCanTurnOff(
        [project('a', 'Site'), project('b', 'Thesis'), project('c', 'App')],
        (p) => states[p.id]
      )
    ).toThrow(
      "Agents can't be turned off while they have work. Site: 1 agent run queued; " +
        'App: 1 agent run in progress, 1 agent run waiting for review. Cancel the queued ' +
        'runs, and stop, accept or discard the others, then try again.'
    )
  })
})

describe('httpServerPorts', () => {
  it('listens on neither port when both switches are off', () => {
    expect(httpServerPorts(config(false, false))).toEqual({ harness: null, automation: null })
  })

  it('listens on the automation port with agents off: it has its own switch (D38)', () => {
    expect(httpServerPorts(config(false, true))).toEqual({ harness: null, automation: 9002 })
  })

  it('listens on the harness port only while the automation API is off', () => {
    expect(httpServerPorts(config(true, false))).toEqual({ harness: 9001, automation: null })
  })

  it('listens on both when both switches are on', () => {
    expect(httpServerPorts(config(true, true))).toEqual({ harness: 9001, automation: 9002 })
  })
})

describe('syncHttpServers', () => {
  const servers = () => ({
    harness: { start: vi.fn(), stop: vi.fn() },
    automation: { start: vi.fn(), stop: vi.fn() }
  })

  it('starts what is on at launch and stops the rest', () => {
    const s = servers()
    syncHttpServers(null, config(true, false), s)
    expect(s.harness.start).toHaveBeenCalledWith(9001)
    expect(s.automation.stop).toHaveBeenCalled()
    expect(s.automation.start).not.toHaveBeenCalled()
  })

  it('stops only the agent API when agents are turned off (D38)', () => {
    const s = servers()
    syncHttpServers(config(true, true), config(false, true), s)
    expect(s.harness.stop).toHaveBeenCalled()
    expect(s.automation.stop).not.toHaveBeenCalled()
  })

  it('starts the agent API again when agents are turned back on, without a restart', () => {
    const s = servers()
    syncHttpServers(config(false, true), config(true, true), s)
    expect(s.harness.start).toHaveBeenCalledWith(9001)
    expect(s.automation.start).not.toHaveBeenCalled()
  })

  it('starts and stops the automation API on its own switch', () => {
    const s = servers()
    syncHttpServers(config(false, false), config(false, true), s)
    expect(s.automation.start).toHaveBeenCalledWith(9002)
    syncHttpServers(config(false, true), config(false, false), s)
    expect(s.automation.stop).toHaveBeenCalled()
    expect(s.harness.start).not.toHaveBeenCalled()
  })

  it('leaves a server alone when its port and switch did not change', () => {
    const s = servers()
    syncHttpServers(config(true, true), config(true, true), s)
    expect(s.harness.start).not.toHaveBeenCalled()
    expect(s.harness.stop).not.toHaveBeenCalled()
  })
})
