// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineAlert } from '@renderer/ui'

describe('InlineAlert', () => {
  it('announces warnings and errors at once', () => {
    const { rerender } = render(<InlineAlert tone="danger" title="Save failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
    rerender(<InlineAlert tone="warning" title="Disk almost full" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Disk almost full')
  })

  it('announces info and success politely', () => {
    const { rerender } = render(<InlineAlert title="Synced">All up to date</InlineAlert>)
    expect(screen.getByRole('status')).toHaveTextContent('SyncedAll up to date')
    rerender(<InlineAlert tone="success" title="Saved" />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a dismiss button and an action only when asked', () => {
    const onDismiss = vi.fn()
    const onRetry = vi.fn()
    const { rerender } = render(<InlineAlert title="Plain" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <InlineAlert
        tone="danger"
        title="Save failed"
        onDismiss={onDismiss}
        action={{ label: 'Retry', onClick: onRetry }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
