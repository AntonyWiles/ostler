// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FocusChange,
  FocusState,
  OstlerAPI,
  PlanningWorkItem,
  RendererConfig,
  TimeEntry
} from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { FocusProvider } from '@renderer/time/FocusProvider'
import { TaskTimeSection } from '@renderer/time/TaskTimeSection'
import { StatusBarFocus } from '@renderer/time/StatusBarFocus'
import { StatusBarTimer } from '@renderer/time/StatusBarTimer'
import { NotificationsSection } from '@renderer/views/settings/sections/NotificationsSection'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const TASK = {
  id: 't1',
  projectId: 'p1',
  title: 'Write the proposal',
  estimate: null,
  archivedAt: null,
  deletedAt: null
} as unknown as PlanningWorkItem

const ok = <T,>(value: T) => ({ ok: true as const, value })

function entry(partial: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'run',
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Write the proposal',
    personId: null,
    startedAt: Date.now(),
    durationSeconds: null,
    note: '',
    source: 'timer',
    billable: false,
    billingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

function focusState(partial: Partial<FocusState> = {}): FocusState {
  return {
    id: 'f1',
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Write the proposal',
    entryId: 'run',
    minutes: 25,
    startedAt: Date.now(),
    endsAt: Date.now() + 25 * 60_000,
    phase: 'focus',
    breakEndsAt: null,
    ...partial
  }
}

function config(focus: Partial<RendererConfig['notifications']['focus']> = {}): RendererConfig {
  return {
    ...RENDERER_DEFAULT_CONFIG,
    notifications: {
      ...RENDERER_DEFAULT_CONFIG.notifications,
      focus: { ...RENDERER_DEFAULT_CONFIG.notifications.focus, ...focus }
    }
  }
}

let focusListener: ((change: FocusChange) => void) | null

function install(overrides: Partial<OstlerAPI> = {}) {
  focusListener = null
  return installOstlerApi({
    getConfig: async () => ok(config()),
    getTimer: async () => ok({ running: null, interrupted: null }),
    getFocus: async () => ok(null),
    getTaskTimeEntries: async () => ok([]),
    onFocusChange: (callback) => {
      focusListener = callback
      return () => {}
    },
    ...overrides
  })
}

function renderInApp(ui: React.ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <TimerProvider>
          <FocusProvider>{ui}</FocusProvider>
        </TimerProvider>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('starting focus (N3.5)', () => {
  it('starts from the drawer with the length picked, the last one used chosen first', async () => {
    const startFocus = vi.fn(async (_projectId: string, _workItemId: string, minutes: number) =>
      ok({
        focus: focusState({ minutes }),
        timer: { started: entry(), stopped: null }
      })
    )
    install({ getConfig: async () => ok(config({ lastMinutes: 50 })), startFocus })
    renderInApp(<TaskTimeSection item={TASK} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Focus…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Focus on Write the proposal' })
    const fifty = within(dialog).getByRole('radio', { name: '50 minutes' }) as HTMLInputElement
    expect(fifty.checked).toBe(true)
    expect(within(dialog).getByRole('radio', { name: '25 minutes' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('radio', { name: '25 minutes' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start focus' }))
    await waitFor(() => expect(startFocus).toHaveBeenCalledWith('p1', 't1', 25))
    expect(await screen.findByText('Focusing on Write the proposal for 25 minutes')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('takes another length from 5 to 180 minutes', async () => {
    const startFocus = vi.fn(async () =>
      ok({ focus: focusState({ minutes: 40 }), timer: { started: entry(), stopped: null } })
    )
    install({ startFocus })
    renderInApp(<TaskTimeSection item={TASK} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Focus…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Another length' }))
    const start = within(dialog).getByRole('button', { name: 'Start focus' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Minutes/ }), {
      target: { value: '200' }
    })
    expect(start.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Minutes/ }), {
      target: { value: '40' }
    })
    fireEvent.click(start)
    await waitFor(() => expect(startFocus).toHaveBeenCalledWith('p1', 't1', 40))
  })
})

describe('the status bar during focus (N3.5)', () => {
  it('shows the task and the time left, and Stop focus stops it', async () => {
    const stopFocus = vi.fn(async () => ok(null))
    install({
      getTimer: async () => ok({ running: entry(), interrupted: null }),
      getFocus: async () => ok(focusState({ endsAt: Date.now() + 12 * 60_000 - 1000 })),
      stopFocus
    })
    renderInApp(
      <>
        <StatusBarFocus />
        <StatusBarTimer />
      </>
    )
    const item = await screen.findByRole('button', {
      name: 'Focus: 12 min left on Write the proposal'
    })
    expect(item.textContent).toMatch(/11:5\d/)
    // The timer's own item steps aside while focus counts down on it.
    expect(screen.queryByRole('button', { name: 'Stop timer' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Stop focus' }))
    await waitFor(() => expect(stopFocus).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop timer' })).toBeTruthy())
  })

  it('counts a break down', async () => {
    install({
      getFocus: async () =>
        ok(focusState({ phase: 'break', breakEndsAt: Date.now() + 4 * 60_000 - 1000 }))
    })
    renderInApp(<StatusBarFocus />)
    expect(await screen.findByRole('button', { name: 'Break: 4 min left' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'End break' })).toBeTruthy()
  })
})

describe('the end of a focus (N3.5)', () => {
  beforeEach(() => {
    install()
  })

  it.each([
    ['Take a 5-minute break', 'break'],
    ['Keep going', 'keep'],
    ['Stop', 'stop']
  ] as const)('offers %s', async (label, choice) => {
    const chooseFocusEnd = vi.fn(async () => ok(null))
    install({ getFocus: async () => ok(focusState({ phase: 'ended' })), chooseFocusEnd })
    renderInApp(null)
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Focus finished: Write the proposal'
    })
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Take a 5-minute break' })).toBeTruthy()
    )
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(chooseFocusEnd).toHaveBeenCalledWith(choice))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('keeps the timer running when the person closes the question', async () => {
    const chooseFocusEnd = vi.fn(async () => ok(null))
    install({ getFocus: async () => ok(focusState({ phase: 'ended' })), chooseFocusEnd })
    renderInApp(null)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(chooseFocusEnd).toHaveBeenCalledWith('keep'))
  })

  it('chimes once when focus ends, and not when the chime is off', async () => {
    const made: unknown[] = []
    class FakeAudioContext {
      currentTime = 0
      destination = {}
      constructor() {
        made.push(this)
      }
      createOscillator() {
        return { frequency: {}, connect: () => {}, start: () => {}, stop: () => {} }
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => {}
        }
      }
      close() {
        return Promise.resolve()
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    try {
      renderInApp(null)
      await waitFor(() => expect(focusListener).not.toBeNull())
      const ended = focusState({ id: 'chime-1', phase: 'ended' })
      act(() => {
        focusListener?.({ focus: ended, event: 'finished', focusId: 'chime-1' })
        focusListener?.({ focus: ended, event: 'finished', focusId: 'chime-1' })
      })
      await waitFor(() => expect(made).toHaveLength(1))
      await screen.findByRole('alertdialog')

      install({ getConfig: async () => ok(config({ chime: false })) })
      renderInApp(null)
      await waitFor(() => expect(focusListener).not.toBeNull())
      act(() => {
        focusListener?.({ focus: null, event: 'break-over', focusId: 'chime-2' })
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(made).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Settings › Notifications › Focus (N3.5)', () => {
  it('saves the lengths offered, the break and the chime', async () => {
    install()
    const saveConfig = vi.fn(async () => {})
    render(
      <ToastProvider>
        <SettingsProvider
          value={{
            config: RENDERER_DEFAULT_CONFIG,
            saveConfig,
            setConfig: () => {},
            reloadConfig: () => {},
            markSaved: () => {},
            setError: () => {}
          }}
        >
          <NotificationsSection />
        </SettingsProvider>
      </ToastProvider>
    )
    const group = screen.getByRole('heading', { name: 'Focus' }).closest('section') as HTMLElement
    const first = within(group).getByRole('spinbutton', { name: /First length offered/ })
    expect((first as HTMLInputElement).value).toBe('25')
    expect(
      (within(group).getByRole('spinbutton', { name: /Second length offered/ }) as HTMLInputElement)
        .value
    ).toBe('50')
    fireEvent.change(first, { target: { value: '30' } })
    fireEvent.blur(first)
    expect(saveConfig).toHaveBeenLastCalledWith({
      notifications: {
        focus: { lengths: [30, 50], breakMinutes: 5, chime: true, lastMinutes: 25 }
      }
    })

    const breakField = within(group).getByRole('spinbutton', { name: /Break/ })
    fireEvent.change(breakField, { target: { value: '10' } })
    fireEvent.blur(breakField)
    expect(saveConfig).toHaveBeenLastCalledWith({
      notifications: { focus: expect.objectContaining({ breakMinutes: 10 }) }
    })

    fireEvent.click(within(group).getByRole('switch', { name: /Chime when a focus/ }))
    expect(saveConfig).toHaveBeenLastCalledWith({
      notifications: { focus: expect.objectContaining({ chime: false }) }
    })
  })
})
