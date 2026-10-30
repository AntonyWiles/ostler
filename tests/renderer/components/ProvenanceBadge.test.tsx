// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProvenanceBadge } from '@renderer/components/ProvenanceBadge'

describe('ProvenanceBadge', () => {
  it('renders external provenance badge with proper label and default tooltip', () => {
    const { container } = render(<ProvenanceBadge provenance="external" />)
    const badge = screen.getByText('Connected')
    expect(badge).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('ui-badge', 'ui-badge--neutral')
    expect(container.firstChild).toHaveAttribute(
      'title',
      'Connected agent, linked through the Agent API'
    )
    expect(container.firstChild).toHaveAttribute('data-provenance', 'external')
  })

  it('renders embedded provenance badge without runtime metadata', () => {
    const { container } = render(<ProvenanceBadge provenance="embedded" />)
    const badge = screen.getByText('Built-in')
    expect(badge).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('ui-badge', 'ui-badge--info')
    expect(container.firstChild).toHaveAttribute('title', 'Built-in agent')
    expect(container.firstChild).toHaveAttribute('data-provenance', 'embedded')
  })

  it('renders embedded provenance badge with detailed runtime metadata tooltip', () => {
    const { container } = render(
      <ProvenanceBadge
        provenance="embedded"
        embeddedRuntime={{
          kind: 'opencode',
          version: '1.18.23',
          processPort: 4096,
          openCodeSessionId: 'sess-123',
          toolCallCount: 12,
          maxToolCallsPerMinute: 50,
          toolCallsInLastMinute: 5,
          turnCount: 4,
          usage: { totalTokens: 15400 }
        }}
      />
    )
    const badge = screen.getByText('Built-in')
    expect(badge).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute(
      'title',
      'Built-in agent (version 1.18.23, port 4096) · Tool calls: 12 · Rate: 5/50 per minute · Turns: 4 · Tokens: 15,400'
    )
  })

  it('includes stopped for review in tooltip when stoppedForReview is true', () => {
    const { container } = render(
      <ProvenanceBadge
        provenance="embedded"
        embeddedRuntime={{
          kind: 'opencode',
          version: '1.18.23',
          processPort: 4096,
          openCodeSessionId: 'sess-123',
          toolCallCount: 50,
          maxToolCallsPerMinute: 50,
          stoppedForReview: true
        }}
      />
    )
    expect(container.firstChild).toHaveAttribute(
      'title',
      'Built-in agent (version 1.18.23, port 4096) · Tool calls: 50 · Rate: limit 50/minute · Stopped for review'
    )
  })
})
