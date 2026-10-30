// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '@renderer/ui'

describe('PageHeader', () => {
  it('titles the page with its one h1, a subtitle and actions', () => {
    render(
      <PageHeader
        title="Board"
        subtitle="All projects"
        actions={<button type="button">New task</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByText('All projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })
})
