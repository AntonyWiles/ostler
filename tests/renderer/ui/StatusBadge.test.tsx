// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge, STATUS_ICONS } from '@renderer/ui'
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@shared/task-labels'

describe('StatusBadge', () => {
  it('shows the glossary word for a status', () => {
    const { rerender } = render(<StatusBadge status="active" />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    rerender(<StatusBadge status="review" />)
    expect(screen.getByText('In review')).toBeInTheDocument()
  })

  it('is an image named by the word when icon-only', () => {
    render(<StatusBadge status="active" iconOnly />)
    expect(screen.getByRole('img', { name: 'In progress' })).toHaveAttribute('title', 'In progress')
    expect(screen.queryByText('In progress')).not.toBeInTheDocument()
  })

  it('has an icon and a label for every status', () => {
    for (const status of TASK_STATUSES) {
      expect(STATUS_ICONS[status]).toBeDefined()
      const { unmount } = render(<StatusBadge status={status} iconOnly />)
      expect(screen.getByRole('img', { name: TASK_STATUS_LABELS[status] })).toBeInTheDocument()
      unmount()
    }
  })
})
