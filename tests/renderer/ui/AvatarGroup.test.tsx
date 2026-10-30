// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvatarGroup } from '@renderer/ui'

const PEOPLE = [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Alan' }, { name: 'Edsger' }]

describe('AvatarGroup', () => {
  it('is a group naming how many people it holds', () => {
    render(<AvatarGroup people={PEOPLE} max={2} />)
    expect(screen.getByRole('group', { name: '4 people' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ada' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Grace' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Alan' })).not.toBeInTheDocument()
  })

  it('collapses the rest into "+N", named after them', () => {
    render(<AvatarGroup people={PEOPLE} max={2} />)
    const more = screen.getByRole('img', { name: '2 more: Alan, Edsger' })
    expect(more).toHaveTextContent('+2')
  })

  it('has no "+N" when everyone fits', () => {
    render(<AvatarGroup people={PEOPLE.slice(0, 3)} />)
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })
})
