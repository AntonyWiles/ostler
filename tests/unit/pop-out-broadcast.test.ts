import { describe, expect, it, vi } from 'vitest'

/**
 * Live everywhere (N5.8a): a change event reaches every Ostler window, and a
 * reply meant for one window (an AI stream, a dialog's parent) reaches only
 * the window whose IPC call it answers, across the handler's awaits.
 */

const fake = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  return {
    handlers,
    electron: {
      ipcMain: {
        handle: (
          channel: string,
          handler: (event: unknown, ...args: unknown[]) => Promise<unknown>
        ) => handlers.set(channel, handler)
      },
      app: { getPath: () => process.cwd(), on: () => {} }
    }
  }
})

vi.mock('electron', () => ({ ...fake.electron, default: fake.electron }))

import {
  askingWindow,
  broadcastToWindows,
  createOtherWindowsNotifier,
  openOstlerWindows,
  registerOstlerWindow,
  sendToWindow
} from '../../electron/services/send-to-window'
import { handleIpc } from '../../electron/ipc/handle-ipc'

function fakeWindow(name: string) {
  const sent: { channel: string; payload: unknown }[] = []
  const listeners = new Map<string, () => void>()
  let destroyed = false
  const win = {
    name,
    sent,
    isDestroyed: () => destroyed,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    close: () => {
      destroyed = true
      listeners.get('closed')?.()
    },
    webContents: {
      isDestroyed: () => destroyed,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload })
    }
  }
  return win
}

describe('every Ostler window (N5.8a)', () => {
  it('broadcasts a change to the main window and every pop-out, and stops at a closed one', () => {
    const main = fakeWindow('main')
    const board = fakeWindow('board')
    const home = fakeWindow('home')
    for (const win of [main, board, home]) registerOstlerWindow(win as never)
    broadcastToWindows('ostler:on-project-state-change', { projectId: 'p1' })
    for (const win of [main, board, home]) expect(win.sent).toHaveLength(1)

    home.close()
    expect(openOstlerWindows()).not.toContain(home)
    broadcastToWindows('ostler:on-project-state-change', { projectId: 'p1' })
    expect(main.sent).toHaveLength(2)
    expect(board.sent).toHaveLength(2)
    expect(home.sent).toHaveLength(1)
    main.close()
    board.close()
  })

  it('answers only the window that asked, across awaits', async () => {
    const main = fakeWindow('main')
    const popOut = fakeWindow('pop-out')
    registerOstlerWindow(main as never)
    registerOstlerWindow(popOut as never)
    const seen: unknown[] = []
    handleIpc('test:ask', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const replyTo = askingWindow()
      seen.push(replyTo)
      // As the AI stream does: to the asker, not to every window.
      sendToWindow(replyTo, 'ostler:on-ai-stream-chunk', 'chunk')
      return 'ok'
    })
    const handler = fake.handlers.get('test:ask')!
    // Two calls in flight at once, from two windows.
    const results = await Promise.all([
      handler({ sender: popOut.webContents }),
      handler({ sender: main.webContents })
    ])
    expect(results).toEqual([
      { ok: true, value: 'ok' },
      { ok: true, value: 'ok' }
    ])
    expect(seen).toEqual([popOut, main])
    expect(popOut.sent).toEqual([{ channel: 'ostler:on-ai-stream-chunk', payload: 'chunk' }])
    expect(main.sent).toEqual([{ channel: 'ostler:on-ai-stream-chunk', payload: 'chunk' }])
    // Outside an IPC call, nobody asked: callers fall back to the main window.
    expect(askingWindow()).toBeNull()
    main.close()
    popOut.close()
  })

  it('tells the other windows, once, about tasks one window changed', async () => {
    const main = fakeWindow('main')
    const popOut = fakeWindow('pop-out')
    registerOstlerWindow(main as never)
    registerOstlerWindow(popOut as never)
    const told: string[] = []
    const notify = createOtherWindowsNotifier((projectId, except) => {
      broadcastToWindows('ostler:on-project-state-change', { projectId }, except)
      told.push(projectId)
    })
    handleIpc('test:write', () => {
      // One move writes the task several times.
      notify('p1')
      notify('p1')
      notify('p2')
    })
    await fake.handlers.get('test:write')!({ sender: popOut.webContents })
    await new Promise((resolve) => setImmediate(resolve))
    expect(told).toEqual(['p1', 'p2'])
    // The window that made the change reloads itself; only the other one is told.
    expect(popOut.sent).toEqual([])
    expect(main.sent).toHaveLength(2)
    // A change from the APIs or an agent is pushed by its own path, not here.
    notify('p1')
    await new Promise((resolve) => setImmediate(resolve))
    expect(told).toEqual(['p1', 'p2'])
    main.close()
    popOut.close()
  })
})
