// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from '@renderer/ui'

describe('Switch', () => {
  it('is a switch named by its label and described by its hint', () => {
    render(<Switch label="Notifications" hint="Desktop alerts" />)
    const toggle = screen.getByRole('switch', { name: 'Notifications' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('Desktop alerts')
  })

  it('toggles on activation (Space on a native checkbox dispatches a click)', () => {
    const onChange = vi.fn()
    render(<Switch label="Notifications" onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Notifications' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('can be disabled', () => {
    render(<Switch label="Notifications" disabled onChange={() => {}} />)
    const toggle = screen.getByRole('switch', { name: 'Notifications' })
    expect(toggle).toBeDisabled()
    // jsdom still dispatches synthetic clicks to disabled inputs; browsers do not.
  })
})
