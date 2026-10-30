// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MoreDetails } from '@renderer/views/planning/MoreDetails'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('MoreDetails', () => {
  it('starts closed and opens its fields on request', () => {
    render(
      <MoreDetails>
        <span>Due date field</span>
      </MoreDetails>
    )

    const toggle = screen.getByRole('button', { name: 'More details' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Due date field')).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Due date field')).toBeTruthy()
  })

  it('remembers an open section for the next form', () => {
    const { unmount } = render(
      <MoreDetails>
        <span>Estimate field</span>
      </MoreDetails>
    )
    fireEvent.click(screen.getByRole('button', { name: 'More details' }))
    expect(localStorage.getItem('ostler.taskMoreDetailsOpen')).toBe('true')
    unmount()

    render(
      <MoreDetails>
        <span>Estimate field</span>
      </MoreDetails>
    )

    expect(screen.getByRole('button', { name: 'More details' }).getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(screen.getByText('Estimate field')).toBeTruthy()
  })
})
