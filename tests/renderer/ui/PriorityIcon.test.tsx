// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PriorityIcon, PRIORITY_ICONS } from '@renderer/ui'
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@shared/task-labels'

describe('PriorityIcon', () => {
  it('is an image named "<word> priority" by default', () => {
    render(<PriorityIcon priority="high" />)
    expect(screen.getByRole('img', { name: 'High priority' })).toHaveAttribute(
      'title',
      'High priority'
    )
  })

  it('shows the word instead of being an image with showLabel', () => {
    render(<PriorityIcon priority="critical" showLabel />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /priority/ })).not.toBeInTheDocument()
  })

  it('has an icon and a name for every priority', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(PRIORITY_ICONS[priority]).toBeDefined()
      const { unmount } = render(<PriorityIcon priority={priority} />)
      expect(
        screen.getByRole('img', { name: `${TASK_PRIORITY_LABELS[priority]} priority` })
      ).toBeInTheDocument()
      unmount()
    }
  })
})
