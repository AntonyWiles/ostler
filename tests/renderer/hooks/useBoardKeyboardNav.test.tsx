// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useBoardKeyboardNav, type BoardColumn } from '@renderer/hooks/useBoardKeyboardNav'
import type { PlanningWorkItem, PlanningWorkItemStatus } from '@shared/ostler-api'

function item(id: string, status: PlanningWorkItemStatus): PlanningWorkItem {
  return { id, status, title: `Item ${id}` } as unknown as PlanningWorkItem
}

/** backlog: a1 a2 a3 | ready: b1 | active: (empty) | blocked: c1 c2 */
function columns(): BoardColumn[] {
  return [
    {
      status: 'backlog',
      columnId: null,
      label: 'backlog',
      items: [item('a1', 'backlog'), item('a2', 'backlog'), item('a3', 'backlog')]
    },
    { status: 'ready', columnId: null, label: 'ready', items: [item('b1', 'ready')] },
    { status: 'active', columnId: null, label: 'active', items: [] },
    {
      status: 'blocked',
      columnId: null,
      label: 'blocked',
      items: [item('c1', 'blocked'), item('c2', 'blocked')]
    }
  ]
}

function Harness({
  onOpen = vi.fn(),
  onMove = vi.fn(),
  enabled = true
}: {
  onOpen?: (i: PlanningWorkItem) => void
  onMove?: (i: PlanningWorkItem, s: PlanningWorkItemStatus) => void
  enabled?: boolean
}) {
  const focused = useBoardKeyboardNav({ columns: columns(), enabled, onOpen, onMove })
  return <div data-testid="focused">{focused ?? 'none'}</div>
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ...init })

describe('useBoardKeyboardNav', () => {
  it('starts on the first card in the first non-empty column', () => {
    const { getByTestId } = render(<Harness />)
    press('j')
    expect(getByTestId('focused').textContent).toBe('a1')
  })

  it('moves down and up within a column, stopping at the ends', () => {
    const { getByTestId } = render(<Harness />)
    press('j')
    press('j')
    expect(getByTestId('focused').textContent).toBe('a2')
    press('ArrowDown')
    press('ArrowDown')
    expect(getByTestId('focused').textContent).toBe('a3')

    press('k')
    expect(getByTestId('focused').textContent).toBe('a2')
  })

  it('skips empty columns when moving sideways', () => {
    const { getByTestId } = render(<Harness />)
    press('j')
    press('l')
    expect(getByTestId('focused').textContent).toBe('b1')
    // 'active' is empty, so right lands on 'blocked'.
    press('l')
    expect(getByTestId('focused').textContent).toBe('c1')
  })

  it('lands on the nearest row when the target column is shorter', () => {
    const { getByTestId } = render(<Harness />)
    press('j')
    press('j')
    press('j')
    expect(getByTestId('focused').textContent).toBe('a3')
    // 'ready' holds one item, so row 2 clamps to row 0.
    press('ArrowRight')
    expect(getByTestId('focused').textContent).toBe('b1')
  })

  it('opens the focused item on Enter', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    press('j')
    press('Enter')
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it('moves the focused item to the adjacent column on Shift+arrow', () => {
    const onMove = vi.fn()
    render(<Harness onMove={onMove} />)
    press('j')
    press('ArrowRight', { shiftKey: true })
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'ready', null)
  })

  it('does not move an item off either end of the board', () => {
    const onMove = vi.fn()
    render(<Harness onMove={onMove} />)
    press('j')
    press('ArrowLeft', { shiftKey: true })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('clears the cursor on Escape', () => {
    const { getByTestId } = render(<Harness />)
    press('j')
    expect(getByTestId('focused').textContent).toBe('a1')
    press('Escape')
    expect(getByTestId('focused').textContent).toBe('none')
  })

  it('ignores keys typed into a field', () => {
    const { getByTestId } = render(
      <>
        <Harness />
        <input data-testid="field" />
      </>
    )
    fireEvent.keyDown(getByTestId('field'), { key: 'j' })
    expect(getByTestId('focused').textContent).toBe('none')
  })

  it('ignores keys while an overlay is open', () => {
    const { getByTestId } = render(
      <>
        <Harness />
        <div role="dialog">a modal</div>
      </>
    )
    press('j')
    expect(getByTestId('focused').textContent).toBe('none')
  })

  it('leaves Enter and the arrows to a focused control, and every key to an open menu', () => {
    const onOpen = vi.fn()
    const { getByTestId, getByRole, rerender } = render(
      <>
        <Harness onOpen={onOpen} />
        <button>More actions</button>
      </>
    )
    press('j')
    const button = getByRole('button', { name: 'More actions' })
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(getByTestId('focused').textContent).toBe('a1')
    // j still moves the cursor from a button.
    fireEvent.keyDown(button, { key: 'j' })
    expect(getByTestId('focused').textContent).toBe('a2')

    rerender(
      <>
        <Harness onOpen={onOpen} />
        <div role="menu">a menu</div>
      </>
    )
    press('j')
    press('Enter')
    expect(getByTestId('focused').textContent).toBe('a2')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('stays inert when disabled, as it is for the grouped board', () => {
    const { getByTestId } = render(<Harness enabled={false} />)
    press('j')
    expect(getByTestId('focused').textContent).toBe('none')
  })
})
