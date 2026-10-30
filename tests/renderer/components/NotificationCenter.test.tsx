// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from '@renderer/components/NotificationCenter'
import {
  AnnouncerProvider,
  TOAST_DURATION_MS,
  ToastProvider,
  useToast,
  type ToastApi
} from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

async function setup(
  tips?: { enabled: boolean; dismissed: string[] },
  updateConfig: () => Promise<{ ok: true; value: typeof RENDERER_DEFAULT_CONFIG }> = async () => ({
    ok: true,
    value: RENDERER_DEFAULT_CONFIG
  })
) {
  installOstlerApi({
    getConfig: async () => ({
      ok: true,
      value: tips
        ? { ...RENDERER_DEFAULT_CONFIG, ui: { ...RENDERER_DEFAULT_CONFIG.ui, tips } }
        : RENDERER_DEFAULT_CONFIG
    }),
    updateConfig,
    onProjectStateChange: () => () => {}
  })
  let api!: ToastApi
  function Grab() {
    api = useToast()
    return null
  }
  render(
    <AnnouncerProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/home']}>
          <Grab />
          <NotificationCenter />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </AnnouncerProvider>
  )
  // The toasts' time on screen is read from the config.
  await act(async () => {})
  return () => api
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('NotificationCenter', () => {
  it('counts a toast that went by unseen, and keeps its Undo in the list', async () => {
    const api = await setup()
    const undo = vi.fn()
    act(() => {
      api().toastUndo('Unpinned Fix the gate', undo)
    })
    // The toast says where it will be kept.
    expect(
      screen.getByRole('button', { name: 'Missed one? They are all kept under the bell' })
    ).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    expect(screen.queryByRole('region', { name: 'Notifications' })?.textContent).not.toContain(
      'Unpinned'
    )

    const bell = screen.getByRole('button', { name: 'In-app notifications, 1 unseen' })
    fireEvent.click(bell)
    const center = screen.getByRole('dialog', { name: 'In-app notifications' })
    expect(within(center).getByText('Unpinned Fix the gate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In-app notifications' })).toBeInTheDocument()

    fireEvent.click(within(center).getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(within(center).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(within(center).getByText('Undone')).toBeInTheDocument()
  })

  it('links to Settings › Notifications, and clears', async () => {
    const api = await setup()
    act(() => {
      api().toast({ title: 'Saved' })
    })
    fireEvent.click(screen.getByRole('button', { name: /^In-app notifications/ }))
    const center = screen.getByRole('dialog', { name: 'In-app notifications' })
    fireEvent.click(within(center).getByRole('button', { name: 'Clear all' }))
    expect(within(center).queryByText('Saved')).toBeNull()

    fireEvent.click(within(center).getByRole('button', { name: 'Notification settings' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/notifications')
    expect(screen.queryByRole('dialog', { name: 'In-app notifications' })).toBeNull()
  })
})

describe('the kept-under-the-bell hint', () => {
  const HINT = 'Missed one? They are all kept under the bell'
  const HINT_ID = 'hint:notification-center'

  it('shows with the first toast, and saves that it has been shown', async () => {
    const updateConfig = vi.fn(async () => ({ ok: true as const, value: RENDERER_DEFAULT_CONFIG }))
    const api = await setup({ enabled: true, dismissed: [] }, updateConfig)
    act(() => {
      api().toast({ title: 'First' })
    })
    expect(screen.getByRole('button', { name: HINT })).toBeInTheDocument()
    await act(async () => {})
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: [HINT_ID] } }
    })
  })

  it('never shows again once it is in the dismissed list', async () => {
    const updateConfig = vi.fn(async () => ({ ok: true as const, value: RENDERER_DEFAULT_CONFIG }))
    const api = await setup({ enabled: true, dismissed: [HINT_ID] }, updateConfig)
    act(() => {
      api().toast({ title: 'Seen before' })
    })
    expect(screen.queryByRole('button', { name: HINT })).toBeNull()
    await act(async () => {})
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('does not show when tips are turned off', async () => {
    const updateConfig = vi.fn(async () => ({ ok: true as const, value: RENDERER_DEFAULT_CONFIG }))
    const api = await setup({ enabled: false, dismissed: [] }, updateConfig)
    act(() => {
      api().toast({ title: 'Tips off' })
    })
    expect(screen.queryByRole('button', { name: HINT })).toBeNull()
    await act(async () => {})
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('does not come back with a later toast once the first ones are gone', async () => {
    const api = await setup({ enabled: true, dismissed: [] })
    act(() => {
      api().toast({ title: 'First' })
    })
    expect(screen.getByRole('button', { name: HINT })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    act(() => {
      api().toast({ title: 'Later' })
    })
    expect(screen.getByText('Later')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: HINT })).toBeNull()
  })
})
