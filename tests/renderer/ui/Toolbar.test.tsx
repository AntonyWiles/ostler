// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toolbar } from '@renderer/ui'

describe('Toolbar', () => {
  it('is a toolbar named by its label', () => {
    render(
      <Toolbar label="Board filters">
        <button type="button">Mine</button>
      </Toolbar>
    )
    expect(screen.getByRole('toolbar', { name: 'Board filters' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('moves focus between its controls with Left and Right, wrapping', () => {
    render(
      <Toolbar label="Board filters">
        <button type="button">Mine</button>
        <button type="button">Blocked</button>
        <button type="button">Due</button>
      </Toolbar>
    )
    const mine = screen.getByRole('button', { name: 'Mine' })
    mine.focus()
    fireEvent.keyDown(mine, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Blocked' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('button', { name: 'Due' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(mine).toHaveFocus()
    fireEvent.keyDown(mine, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'Due' })).toHaveFocus()
  })

  it('leaves arrow keys to a text field inside it', () => {
    render(
      <Toolbar label="Board filters">
        <input aria-label="Filter" />
        <button type="button">Mine</button>
      </Toolbar>
    )
    const input = screen.getByRole('textbox', { name: 'Filter' })
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(input).toHaveFocus()
  })

  it('collapses secondary actions into a "More actions" menu', () => {
    const onExport = vi.fn()
    render(
      <Toolbar label="Board filters" overflow={[{ label: 'Export', onSelect: onExport }]}>
        <button type="button">Mine</button>
      </Toolbar>
    )
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }))
    expect(onExport).toHaveBeenCalledOnce()
  })
})
