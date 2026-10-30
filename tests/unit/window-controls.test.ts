import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/shared/ostler-api'

/**
 * The custom title bar's own Minimise, Maximise or Restore, and Close:
 * each acts on the window that pressed it, Close is the window's own close
 * (so background mode's 'close' handler still hides the main window), and an
 * off-screen window is never maximised onto a display.
 */

const offScreen = vi.hoisted(() => ({ value: false }))
vi.mock('../../electron/app/off-screen', () => ({
  get offScreen() {
    return offScreen.value
  }
}))

const { controlWindow, watchWindowState, windowState } =
  await import('../../electron/app/desktop/window-controls')

function fakeWindow(state: { maximized?: boolean; fullScreen?: boolean } = {}) {
  const listeners = new Map<string, () => void>()
  const calls: string[] = []
  const sent: unknown[][] = []
  const win = {
    isDestroyed: () => false,
    isMaximized: () => state.maximized === true,
    isFullScreen: () => state.fullScreen === true,
    minimize: () => calls.push('minimize'),
    maximize: () => calls.push('maximize'),
    unmaximize: () => calls.push('unmaximize'),
    setFullScreen: (on: boolean) => calls.push(`setFullScreen:${on}`),
    close: () => calls.push('close'),
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    webContents: { send: (...args: unknown[]) => sent.push(args) }
  }
  return { win: win as unknown as BrowserWindow, calls, sent, listeners, state }
}

beforeEach(() => {
  offScreen.value = false
})

describe('controlWindow', () => {
  it('minimises and closes the window that pressed the button', () => {
    const { win, calls } = fakeWindow()
    controlWindow(win, 'minimize')
    controlWindow(win, 'close')
    expect(calls).toEqual(['minimize', 'close'])
  })

  it('maximises a normal window, restores a maximised one and leaves full screen first', () => {
    const normal = fakeWindow()
    controlWindow(normal.win, 'toggle-maximize')
    const maximised = fakeWindow({ maximized: true })
    controlWindow(maximised.win, 'toggle-maximize')
    const full = fakeWindow({ maximized: true, fullScreen: true })
    controlWindow(full.win, 'toggle-maximize')
    expect([normal.calls, maximised.calls, full.calls]).toEqual([
      ['maximize'],
      ['unmaximize'],
      ['setFullScreen:false']
    ])
  })

  it('never maximises an off-screen window onto a display', () => {
    offScreen.value = true
    const { win, calls } = fakeWindow()
    controlWindow(win, 'toggle-maximize')
    expect(calls).toEqual([])
  })
})

describe('watchWindowState', () => {
  it('tells the page each time the window is maximised, restored or full screen', () => {
    const { win, sent, listeners, state } = fakeWindow()
    watchWindowState(win)
    expect([...listeners.keys()].sort()).toEqual(
      ['enter-full-screen', 'leave-full-screen', 'maximize', 'restore', 'unmaximize'].sort()
    )
    state.maximized = true
    listeners.get('maximize')!()
    expect(sent).toEqual([[IPC_CHANNELS.ON_WINDOW_STATE, { maximized: true, fullScreen: false }]])
    expect(windowState(win)).toEqual({ maximized: true, fullScreen: false })
  })
})
