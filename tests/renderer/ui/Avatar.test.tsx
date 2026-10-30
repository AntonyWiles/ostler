// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar, initials } from '@renderer/ui'
import { avatarInk } from '@renderer/ui/Avatar'
import { contrastRatio } from '@renderer/ui/theme/accent'
import { PROJECT_COLORS } from '@shared/project-colors'

describe('Avatar', () => {
  it('is an image named by the person, showing their initials', () => {
    render(<Avatar name="Ada Lovelace" />)
    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' })
    expect(avatar).toHaveTextContent('AL')
    expect(avatar).toHaveAttribute('title', 'Ada Lovelace')
  })

  it('uses a given colour', () => {
    render(<Avatar name="ostler" color="rgb(1, 2, 3)" />)
    expect(screen.getByRole('img', { name: 'ostler' })).toHaveStyle({
      background: 'rgb(1, 2, 3)'
    })
  })

  it('picks black or white initials so every palette colour reads at 4.5:1 or better', () => {
    // White on indigo was 4.46:1, flagged by axe during the GUI monkey's run;
    // white on amber, lime or cyan was nearer 2:1.
    for (const color of PROJECT_COLORS) {
      const ink = avatarInk(color)
      const text = ink === 'dark' ? '#000000' : '#FFFFFF'
      expect(contrastRatio(text, color), `${color} with ${ink} ink`).toBeGreaterThanOrEqual(4.5)
    }
    render(<Avatar name="Robin Monkey" color="#f59e0b" />)
    expect(screen.getByRole('img', { name: 'Robin Monkey' })).toHaveClass('ui-avatar--ink-dark')
  })

  it('leaves a colour token to bring its own ink', () => {
    expect(avatarInk('var(--chart-2)')).toBeNull()
    expect(avatarInk(undefined)).toBeNull()
  })

  it('takes up to two initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('Ada King Lovelace')).toBe('AL')
    expect(initials('ostler')).toBe('O')
    expect(initials('   ')).toBe('?')
  })
})
