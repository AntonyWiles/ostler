// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnnouncerProvider,
  MAX_VISIBLE_TOASTS,
  TOAST_DURATION_MS,
  ToastProvider,
  useNotificationCenter,
  useToast,
  type NotificationCenterApi,
  type ToastApi
} from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

let center!: NotificationCenterApi

function setup() {
  installOstlerApi({
    getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
    onProjectStateChange: () => () => {}
  })
  let api!: ToastApi
  function Grab() {
    api = useToast()
    center = useNotificationCenter()!
    return <input aria-label="Notes" />
  }
  render(
    <AnnouncerProvider>
      <ToastProvider>
        <Grab />
      </ToastProvider>
    </AnnouncerProvider>
  )
  return () => api
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useToast', () => {
  it('shows toasts in a region named Notifications and says each one once, without taking focus', () => {
    const api = setup()
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    notes.focus()
    act(() => {
      api().toast({ title: 'Pruned 12 events', body: 'Older activity is gone.', tone: 'success' })
    })
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(within(region).getByText('Pruned 12 events')).toBeInTheDocument()
    // The stack itself is not live, so a toast is not read a second time.
    expect(region.querySelector('[aria-live]')).toBeNull()
    const live = document.querySelector('[data-announcer]')!
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent?.trim()).toBe('Pruned 12 events. Older activity is gone.')
    expect(notes).toHaveFocus()
  })

  it('names both of its actions aloud when it has two, in the order they show', () => {
    const api = setup()
    act(() => {
      api().toast({
        title: 'Eight windows are open',
        body: 'Close the oldest, Board, and open this one?',
        action: { label: 'Close it and open', onClick: () => {} },
        secondaryAction: { label: 'Leave them', onClick: () => {} }
      })
    })
    const live = document.querySelector('[data-announcer]')!
    expect(live.textContent?.trim()).toBe(
      'Eight windows are open. Close the oldest, Board, and open this one? ' +
        'Leave them and Close it and open are available.'
    )
    const buttons = within(screen.getByRole('region', { name: 'Notifications' }))
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons.slice(0, 2)).toEqual(['Leave them', 'Close it and open'])
  })

  it('dismisses itself after 10 s, and from its dismiss button', () => {
    const api = setup()
    act(() => {
      api().toast({ title: 'Saved' })
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1))
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()

    act(() => {
      api().toast({ title: 'Again' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Again')).not.toBeInTheDocument()
  })

  it('pauses the timer while hovered or focused', () => {
    const api = setup()
    act(() => {
      api().toast({ title: 'Hover me' })
    })
    const toast = screen.getByText('Hover me').closest('li')!
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 2000))
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2))
    expect(screen.getByText('Hover me')).toBeInTheDocument()
    fireEvent.mouseLeave(toast)
    // 2 s were left when the pointer arrived.
    act(() => vi.advanceTimersByTime(1999))
    expect(screen.getByText('Hover me')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Hover me')).not.toBeInTheDocument()

    act(() => {
      api().toast({ title: 'Focus me' })
    })
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification' }))
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2))
    expect(screen.getByText('Focus me')).toBeInTheDocument()
  })
})

describe('toastUndo', () => {
  it('runs the undo from its Undo button', () => {
    const api = setup()
    const undo = vi.fn()
    act(() => {
      api().toastUndo('Moved "Draft" to the recycle bin', undo)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Moved "Draft" to the recycle bin')).not.toBeInTheDocument()
  })

  it('runs the newest visible undo on Ctrl+Z', () => {
    const api = setup()
    const older = vi.fn()
    const newer = vi.fn()
    act(() => {
      api().toastUndo('Archived A', older)
      api().toast({ title: 'Plain toast' })
      api().toastUndo('Archived B', newer)
    })
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(older).toHaveBeenCalledTimes(1)
  })

  it('leaves Ctrl+Z to a text field that has focus', () => {
    const api = setup()
    const undo = vi.fn()
    act(() => {
      api().toastUndo('Archived A', undo)
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
  })

  it('does nothing on Ctrl+Z once the toast has gone', () => {
    const api = setup()
    const undo = vi.fn()
    act(() => {
      api().toastUndo('Archived A', undo)
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undo).not.toHaveBeenCalled()
  })
})

describe('notification centre', () => {
  it('shows at most three at once and keeps the rest, newest first', () => {
    const api = setup()
    act(() => {
      for (const title of ['One', 'Two', 'Three', 'Four']) api().toast({ title })
    })
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(within(region).getAllByRole('listitem')).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(within(region).queryByText('One')).not.toBeInTheDocument()
    expect(center.records.map((record) => record.title)).toEqual(['Four', 'Three', 'Two', 'One'])
    expect(center.unread).toBe(4)
  })

  it('keeps an Undo after its toast has gone, and runs it once', () => {
    const api = setup()
    const undo = vi.fn()
    act(() => {
      api().toastUndo('Archived A', undo)
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
    expect(screen.queryByText('Archived A')).not.toBeInTheDocument()
    expect(center.unread).toBe(1)

    act(() => center.setOpen(true))
    expect(center.unread).toBe(0)
    act(() => center.runAction(center.records[0].id, 'action'))
    act(() => center.runAction(center.records[0].id, 'action'))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(center.records[0].used).toBe(true)
  })

  it('counts a toast the person closed or acted on as seen', () => {
    const api = setup()
    act(() => {
      api().toast({ title: 'Closed' })
      api().toastUndo('Undone', () => {})
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(center.unread).toBe(0)
  })

  it('keeps a toast until it is closed when set to', () => {
    const api = setup()
    act(() => center.setDuration('untilClosed'))
    act(() => {
      api().toast({ title: 'Stays' })
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 10))
    expect(screen.getByText('Stays')).toBeInTheDocument()
  })
})
