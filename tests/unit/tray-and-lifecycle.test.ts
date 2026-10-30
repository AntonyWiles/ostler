import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenu } from '../../electron/app/desktop/tray-menu'
import { createQuitController } from '../../electron/app/desktop/lifecycle'

const time = (at: number) => new Date(at).toISOString().slice(11, 16)
const labels = (items: ReturnType<typeof buildTrayMenu>) =>
  items.map((item) => ('label' in item ? item.label : '—'))

describe('buildTrayMenu', () => {
  it('offers Stop timer, naming the task, first while a timer runs (R2.3)', () => {
    const items = buildTrayMenu({
      unread: 0,
      aiOn: false,
      remindersPausedUntil: null,
      time,
      timerTask: 'Write the brief'
    })
    expect(items[0]).toEqual({ label: 'Stop timer: Write the brief', action: 'stop-timer' })
    expect(labels(items)[1]).toBe('—')
  })

  it('doubles "&" in the task title, so Windows shows it rather than an access key', () => {
    const items = buildTrayMenu({
      unread: 0,
      aiOn: false,
      remindersPausedUntil: null,
      time,
      timerTask: 'Q&A with R&D'
    })
    expect(labels(items)[0]).toBe('Stop timer: Q&&A with R&&D')
  })

  it('holds Open, Quick add, Snip to task, Inbox with its count, Pause reminders, Stop all AI and Quit', () => {
    expect(
      labels(buildTrayMenu({ unread: 3, aiOn: true, remindersPausedUntil: null, time }))
    ).toEqual([
      'Open Ostler',
      'Quick add',
      'Snip to task',
      'Inbox (3)',
      '—',
      'Pause reminders for 1 hour',
      'Stop all AI',
      '—',
      'Quit Ostler'
    ])
  })

  it('hides Stop all AI while AI and agents are off, and offers to resume paused reminders', () => {
    const shown = labels(
      buildTrayMenu({
        unread: 0,
        aiOn: false,
        remindersPausedUntil: Date.UTC(2026, 9, 9, 14, 5),
        time
      })
    )
    expect(shown).not.toContain('Stop all AI')
    expect(shown).toContain('Inbox')
    expect(shown).toContain('Resume reminders (paused until 14:05)')
  })
})

/** The existing order, from stopServices in services.ts. */
const STOP_ORDER = ['timers', 'reminders', 'backups', 'agents', 'watchers', 'servers', 'database']

/** A stand-in for Electron's app and its one window, wired the way main.ts wires them. */
function fakeApp(backgroundMode: boolean) {
  const events = new EventEmitter()
  const order: string[] = []
  let exited = false
  let windowOpen = true
  const app = {
    quit: () => {
      let prevented = false
      events.emit('before-quit', { preventDefault: () => (prevented = true) })
      if (prevented) return
      windowOpen = false
      exited = true
    }
  }
  /** Whether the window was still open each time main asked it to save its edits. */
  const flushes: boolean[] = []
  const controller = createQuitController({
    backgroundMode: () => backgroundMode,
    flushEdits: async () => {
      flushes.push(windowOpen)
      order.push('edits saved')
    },
    stopServices: async () => {
      for (const step of STOP_ORDER) order.push(step)
    },
    quit: () => app.quit()
  })
  events.on('before-quit', (event) => controller.onBeforeQuit(event))
  const closeWindow = () => {
    let prevented = false
    const hidden = controller.onWindowClose({ preventDefault: () => (prevented = true) }, () =>
      order.push('hidden')
    )
    if (!prevented) {
      windowOpen = false
      controller.onWindowAllClosed()
    }
    return hidden
  }
  return {
    app,
    order,
    flushes,
    closeWindow,
    get exited() {
      return exited
    },
    get windowOpen() {
      return windowOpen
    }
  }
}

describe('background mode', () => {
  it('hides the window on close when it is on, and keeps every service running', async () => {
    const fake = fakeApp(true)
    expect(fake.closeWindow()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fake.order).toEqual(['hidden'])
    expect(fake.windowOpen).toBe(true)
    expect(fake.exited).toBe(false)
  })

  it('quits on close when it is off, stopping the services first', async () => {
    const fake = fakeApp(false)
    expect(fake.closeWindow()).toBe(false)
    await vi.waitFor(() => expect(fake.exited).toBe(true))
    expect(fake.order).toEqual(['edits saved', ...STOP_ORDER])
    // The window was still open to save the last second of typing (R1.5).
    expect(fake.flushes).toEqual([true])
  })

  it('stops the services once, in the existing order, on Quit from the tray', async () => {
    const fake = fakeApp(true)
    fake.closeWindow()
    fake.app.quit() // the tray's Quit
    fake.app.quit() // a second click while stopping changes nothing
    await vi.waitFor(() => expect(fake.exited).toBe(true))
    expect(fake.order).toEqual(['hidden', 'edits saved', ...STOP_ORDER])
  })

  it('lets the window close during a real quit even with background mode on', () => {
    const controller = createQuitController({
      backgroundMode: () => true,
      flushEdits: async () => {},
      stopServices: () => new Promise(() => {}),
      quit: () => {}
    })
    controller.onBeforeQuit({ preventDefault: () => {} })
    const hide = vi.fn()
    expect(controller.onWindowClose({ preventDefault: () => {} }, hide)).toBe(false)
    expect(hide).not.toHaveBeenCalled()
    expect(controller.quitting).toBe(true)
  })

  it('stops the services even when saving the edits fails', async () => {
    const stopped = vi.fn(async () => {})
    const controller = createQuitController({
      backgroundMode: () => false,
      flushEdits: async () => {
        throw new Error('window gone')
      },
      stopServices: stopped,
      quit: () => {}
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    controller.onBeforeQuit({ preventDefault: () => {} })
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce())
  })

  it('lets restart-to-update close the window with background mode on', () => {
    const controller = createQuitController({
      backgroundMode: () => true,
      flushEdits: async () => {},
      stopServices: async () => {},
      quit: () => {}
    })
    controller.beginQuit()
    const hide = vi.fn()
    expect(controller.onWindowClose({ preventDefault: () => {} }, hide)).toBe(false)
    expect(hide).not.toHaveBeenCalled()
  })
})
