// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Kbd, shortcutKeys } from '@renderer/ui'

describe('Kbd', () => {
  it('draws one keycap per key and names the whole shortcut', () => {
    const { container } = render(<Kbd shortcut="Ctrl+Shift+P" />)
    const outer = container.firstElementChild!
    expect(outer.tagName).toBe('KBD')
    expect(outer).not.toHaveAttribute('aria-label')
    expect(outer.querySelector('.ui-visually-hidden')?.textContent).toBe('Ctrl plus Shift plus P')
    const keys = outer.querySelectorAll('.ui-kbd__key')
    expect(Array.from(keys, (key) => key.textContent)).toEqual(['Ctrl', 'Shift', 'P'])
    for (const key of keys) expect(key).toHaveAttribute('aria-hidden', 'true')
  })

  it('splits shortcuts, keeping a literal plus key', () => {
    expect(shortcutKeys('Ctrl+K')).toEqual(['Ctrl', 'K'])
    expect(shortcutKeys('+')).toEqual(['+'])
    expect(shortcutKeys('Ctrl++')).toEqual(['Ctrl', '+'])
    expect(shortcutKeys('/')).toEqual(['/'])
  })
})
