// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Section } from '@renderer/ui'

describe('Section', () => {
  it('is a region named by its heading', () => {
    render(
      <Section title="Members" description="Who can see this" headingLevel={3}>
        <p>Body</p>
      </Section>
    )
    const region = screen.getByRole('region', { name: 'Members' })
    expect(region).toHaveTextContent('Body')
    expect(screen.getByRole('heading', { level: 3, name: 'Members' })).toBeInTheDocument()
  })

  it('defaults to an h2', () => {
    render(<Section title="General" />)
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
  })
})
