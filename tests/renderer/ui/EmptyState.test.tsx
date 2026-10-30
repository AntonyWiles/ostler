// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '@renderer/ui'

describe('EmptyState', () => {
  it('titles itself with a heading, explains, and offers actions', () => {
    render(
      <EmptyState
        title="No tasks yet"
        description="Tasks track the work."
        action={<button type="button">New task</button>}
        secondaryAction={<button type="button">Import</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 2, name: 'No tasks yet' })).toBeInTheDocument()
    expect(screen.getByText('Tasks track the work.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })

  it('uses the heading level asked for', () => {
    render(<EmptyState title="Nothing here" headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument()
  })
})
