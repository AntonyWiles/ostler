// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip, TOOLTIP_DELAY_MS } from '@renderer/ui'

function setup(describes = true) {
  render(
    <Tooltip content="Archive the task" describe={describes}>
      <button type="button">Archive</button>
    </Tooltip>
  )
  return screen.getByRole('button', { name: 'Archive' })
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('describes its trigger and stays hidden until needed', () => {
    const trigger = setup()
    const tip = screen.getByRole('tooltip', { hidden: true })
    expect(tip).not.toBeVisible()
    expect(trigger).toHaveAttribute('aria-describedby', tip.id)
    expect(trigger).toHaveAccessibleDescription('Archive the task')
  })

  it('does not describe the trigger when describe is off', () => {
    expect(setup(false)).not.toHaveAttribute('aria-describedby')
  })

  it('opens on hover after the delay and closes on leave', () => {
    const trigger = setup()
    expect(TOOLTIP_DELAY_MS).toBe(400)
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Archive the task')
    fireEvent.mouseLeave(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('does not open if the pointer leaves before the delay', () => {
    const trigger = setup()
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseLeave(trigger)
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens at once on keyboard focus, closes on Escape and on blur', () => {
    const trigger = setup()
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(trigger)
    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens nothing for focus the page gives itself, or after a click', () => {
    const trigger = setup()
    // As a window opens, or comes back and puts focus where it was.
    fireEvent.blur(window)
    fireEvent.focus(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.blur(trigger)
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.pointerDown(trigger)
    fireEvent.focus(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes when the window loses focus', () => {
    const trigger = setup()
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(window)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders the trigger alone when there is no content', () => {
    render(
      <Tooltip content="">
        <button type="button">Plain</button>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
  })
})
