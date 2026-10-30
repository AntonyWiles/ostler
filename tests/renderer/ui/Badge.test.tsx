// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '@renderer/ui'
import { Info } from '@renderer/ui/icons'

describe('Badge', () => {
  it('shows its text with the tone as a class, passing other attributes through', () => {
    render(
      <Badge tone="danger" icon={Info} title="3 failing">
        3
      </Badge>
    )
    const badge = screen.getByText('3')
    expect(badge).toHaveClass('ui-badge', 'ui-badge--danger')
    expect(badge).toHaveAttribute('title', '3 failing')
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('defaults to the neutral tone', () => {
    render(<Badge>New</Badge>)
    expect(screen.getByText('New')).toHaveClass('ui-badge--neutral')
  })
})
