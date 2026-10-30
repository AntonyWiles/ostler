import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))

const { handleIpc, ipcErrorMessage } = await import('../../electron/ipc/handle-ipc')
const { createRendererErrorGate } = await import('../../electron/ipc/diagnostics-handlers')
const { initLogging } = await import('../../electron/app/logging')
const { Refusal } = await import('../../src/shared/refusal')

describe('handleIpc', () => {
  beforeEach(() => {
    handlers.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the value of a handler that succeeds', async () => {
    handleIpc('test:ok', () => 42)
    expect(await handlers.get('test:ok')!({})).toEqual({ ok: true, value: 42 })
  })

  it('returns the error message alone, without an "Error: " prefix or stack', async () => {
    handleIpc('test:fail', () => {
      throw new Error('Project not found')
    })
    expect(await handlers.get('test:fail')!({})).toEqual({ ok: false, error: 'Project not found' })
  })

  it('says a write refused on a Viewer PC in plain words (D9)', () => {
    expect(ipcErrorMessage(new Error('ostler:read-only'))).toBe(
      'You can view this project but not change it. Ask an owner if you need to edit it.'
    )
  })

  it('renders thrown values that are not errors', () => {
    expect(ipcErrorMessage('plain text')).toBe('plain text')
    expect(ipcErrorMessage(new TypeError(''))).toBe('TypeError')
  })
})

describe('handleIpc logging', () => {
  let logFile = ''
  beforeEach(() => {
    handlers.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-handle-ipc-'))
    logFile = initLogging(dir).path
  })
  const logLines = () => fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean)

  it('logs a refusal as one INFO line without a stack, and returns its message as before', async () => {
    handleIpc('test:refuse', () => {
      throw new Refusal('Title is required\n\nDetails: more')
    })
    expect(await handlers.get('test:refuse')!({})).toEqual({
      ok: false,
      error: 'Title is required\n\nDetails: more'
    })
    const lines = logLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/ INFO IPC test:refuse refused: Title is required Details: more$/)
    expect(lines[0]).not.toContain('ERROR')
  })

  it('logs an unexpected error as ERROR with its stack', async () => {
    handleIpc('test:crash', () => {
      throw new Error('database is locked')
    })
    expect(await handlers.get('test:crash')!({})).toEqual({
      ok: false,
      error: 'database is locked'
    })
    const text = fs.readFileSync(logFile, 'utf8')
    expect(text).toMatch(/ ERROR IPC test:crash failed\r?\nError: database is locked\r?\n\s+at /)
  })
})

describe('renderer error rate limit', () => {
  it('admits a burst up to the limit, then reports what it dropped', () => {
    let time = 0
    const gate = createRendererErrorGate(2, 1000, () => time)
    expect(gate.admit()).toEqual({ ok: true, dropped: 0 })
    expect(gate.admit()).toEqual({ ok: true, dropped: 0 })
    expect(gate.admit().ok).toBe(false)
    expect(gate.admit().ok).toBe(false)
    time = 1000
    expect(gate.admit()).toEqual({ ok: true, dropped: 2 })
  })
})
