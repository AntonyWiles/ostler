// @vitest-environment jsdom
import { Suspense, useState, type ComponentType, type ReactElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { lazyLayer, lazyNamed } from '@renderer/lib/lazy-named'

/**
 * A dialog opened from a drawer's menu loads on its own (lazyLayer): while
 * its code loads, the drawer around the menu stays shown and keeps the focus,
 * so focus can go back to the menu when the dialog closes.
 */

type PickerModule = { Picker: (props: { title: string }) => ReactElement }

function slowPicker() {
  let finish!: () => void
  const load = () =>
    new Promise<PickerModule>((resolve) => {
      finish = () => resolve({ Picker: ({ title }) => <div role="dialog" aria-label={title} /> })
    })
  return { load, finish: () => finish() }
}

function renderDrawer(Layer: ComponentType<{ title: string }>) {
  function Drawer() {
    const [open, setOpen] = useState(false)
    return (
      <Suspense fallback={null}>
        <button type="button" onClick={() => setOpen(true)}>
          Task actions
        </button>
        {open && <Layer title="Block time" />}
      </Suspense>
    )
  }
  render(<Drawer />)
  const menu = screen.getByRole('button', { name: 'Task actions' })
  menu.focus()
  fireEvent.click(menu)
  return menu
}

describe('lazyLayer', () => {
  it('loads without hiding what shares its Suspense boundary, so focus stays put', async () => {
    const picker = slowPicker()
    const menu = renderDrawer(lazyLayer(picker.load, 'Picker'))
    // Still loading: the drawer's menu is not hidden, and has the focus.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(menu).toBeVisible()
    expect(menu).toHaveFocus()
    await act(async () => picker.finish())
    expect(await screen.findByRole('dialog', { name: 'Block time' })).toBeInTheDocument()
    expect(menu).toBeVisible()
  })

  it('is needed: a plain lazy dialog hides the drawer it was opened from while it loads', async () => {
    const picker = slowPicker()
    const menu = renderDrawer(lazyNamed(picker.load, 'Picker'))
    expect(menu).not.toBeVisible()
    await act(async () => picker.finish())
    expect(await screen.findByRole('dialog', { name: 'Block time' })).toBeInTheDocument()
  })
})
