// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmProvider, useConfirm, type ConfirmFunction } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'

afterEach(() => __resetDismissableStackForTests())

function setup() {
  let confirm!: ConfirmFunction
  function Grab() {
    confirm = useConfirm()
    return null
  }
  render(
    <ConfirmProvider>
      <Grab />
    </ConfirmProvider>
  )
  return () => confirm
}

describe('useConfirm', () => {
  it('shows an alertdialog named by its title, with the body and a named action', async () => {
    const confirm = setup()
    let answer!: Promise<boolean>
    act(() => {
      answer = confirm()({
        title: 'Delete decision "Use SQLite"?',
        body: 'This removes the record permanently.',
        confirmLabel: 'Delete decision',
        tone: 'danger'
      })
    })
    const dialog = screen.getByRole('alertdialog', { name: 'Delete decision "Use SQLite"?' })
    expect(dialog).toHaveTextContent('This removes the record permanently.')
    fireEvent.click(screen.getByRole('button', { name: 'Delete decision' }))
    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('resolves false on Cancel and on Escape', async () => {
    const confirm = setup()
    let answer!: Promise<boolean>
    act(() => {
      answer = confirm()({ title: 'Revoke token?', confirmLabel: 'Revoke token' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answer).resolves.toBe(false)

    act(() => {
      answer = confirm()({ title: 'Revoke token?', confirmLabel: 'Revoke token' })
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    await expect(answer).resolves.toBe(false)
  })

  it('starts on Cancel for the danger tone, and on the action otherwise', () => {
    const confirm = setup()
    act(() => {
      void confirm()({ title: 'Purge?', confirmLabel: 'Purge', tone: 'danger' })
    })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    act(() => {
      void confirm()({ title: 'Apply?', confirmLabel: 'Apply reconciliation' })
    })
    expect(screen.getByRole('button', { name: 'Apply reconciliation' })).toHaveFocus()
  })

  it('asks queued questions one at a time', async () => {
    const confirm = setup()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = confirm()({ title: 'First?', confirmLabel: 'Do first' })
      second = confirm()({ title: 'Second?', confirmLabel: 'Do second' })
    })
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Do first' }))
    await expect(first).resolves.toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(second).resolves.toBe(false)
  })

  it('rejects outside a ConfirmProvider rather than acting unasked', async () => {
    let confirm!: ConfirmFunction
    function Grab() {
      confirm = useConfirm()
      return null
    }
    render(<Grab />)
    await expect(confirm({ title: 'Delete?', confirmLabel: 'Delete' })).rejects.toThrow(
      /ConfirmProvider/
    )
  })
})
