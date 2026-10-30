// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressBar } from '@renderer/ui'

describe('ProgressBar', () => {
  it('is a progressbar with its name and values', () => {
    render(<ProgressBar label="Checklist" value={3} max={5} valueText="3 of 5" />)
    const bar = screen.getByRole('progressbar', { name: 'Checklist' })
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 5')
  })

  it('defaults the value text to a percentage and clamps the value', () => {
    render(<ProgressBar label="Upload" value={150} />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '100%')
  })

  it('has no value when indeterminate', () => {
    render(<ProgressBar label="Loading" />)
    const bar = screen.getByRole('progressbar', { name: 'Loading' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).not.toHaveAttribute('aria-valuetext')
    expect(bar).toHaveClass('is-indeterminate')
  })

  it('is labelled by its visible label with showLabel', () => {
    render(<ProgressBar label="Checklist" value={1} max={4} showLabel />)
    expect(screen.getByRole('progressbar', { name: 'Checklist' })).toHaveAttribute(
      'aria-valuetext',
      '25%'
    )
    expect(screen.getByText('25%')).toBeInTheDocument()
  })
})
