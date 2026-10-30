// @vitest-environment jsdom
import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarGrid, type CalendarDrop } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'

interface Event {
  id: string
  start: string
  end: string
}

function Harness({
  items = [],
  initial = '2026-10-15',
  mode = 'month',
  onDrop,
  onDayActivate
}: {
  items?: Event[]
  initial?: string
  mode?: 'month' | 'week'
  onDrop?: (date: string, drop: CalendarDrop) => void
  onDayActivate?: (date: string) => void
}) {
  const [focused, setFocused] = useState(initial)
  return (
    <CalendarGrid<Event>
      label="Test calendar"
      mode={mode}
      weekStart={1}
      focusedDate={focused}
      onFocusedDateChange={setFocused}
      today="2026-10-08"
      items={items}
      canDrag={() => true}
      onDrop={onDrop}
      onDayActivate={onDayActivate}
      renderItem={(item, place) => (
        <button type="button" tabIndex={place.tabbable ? 0 : -1}>
          {item.id}
        </button>
      )}
    />
  )
}

const day = (date: string) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)!
const press = (target: Element, key: string) =>
  act(() => {
    fireEvent.keyDown(target, { key })
  })

describe('CalendarGrid', () => {
  afterEach(() => __resetDismissableStackForTests())

  it('is a grid of weeks with weekday headers, marking today, weekends and other months', () => {
    render(<Harness />)
    const grid = screen.getByRole('grid', { name: 'Test calendar' })
    const rows = within(grid).getAllByRole('row')
    expect(rows).toHaveLength(6) // header + 5 weeks
    expect(within(rows[0]).getAllByRole('columnheader')).toHaveLength(7)
    expect(day('2026-10-08')).toHaveAttribute('aria-current', 'date')
    expect(day('2026-10-10')).toHaveClass('is-weekend')
    expect(day('2026-09-28')).toHaveClass('is-outside')
    expect(day('2026-10-15')).toHaveAttribute('tabindex', '0')
    expect(day('2026-10-16')).toHaveAttribute('tabindex', '-1')
  })

  it('moves the focused day with arrows, Home, End and Page Up and Down', () => {
    render(<Harness />)
    day('2026-10-15').focus()
    press(day('2026-10-15'), 'ArrowRight')
    expect(day('2026-10-16')).toHaveFocus()
    press(day('2026-10-16'), 'ArrowDown')
    expect(day('2026-10-23')).toHaveFocus()
    press(day('2026-10-23'), 'Home')
    expect(day('2026-10-19')).toHaveFocus()
    press(day('2026-10-19'), 'End')
    expect(day('2026-10-25')).toHaveFocus()
    press(day('2026-10-25'), 'ArrowUp')
    press(day('2026-10-18'), 'ArrowLeft')
    expect(day('2026-10-17')).toHaveFocus()
    press(day('2026-10-17'), 'PageDown')
    expect(day('2026-11-17')).toHaveFocus()
    press(day('2026-11-17'), 'PageUp')
    press(day('2026-10-17'), 'PageUp')
    expect(day('2026-09-17')).toHaveFocus()
  })

  it('pages a week at a time in week mode', () => {
    render(<Harness mode="week" />)
    expect(screen.getAllByRole('gridcell')).toHaveLength(7)
    day('2026-10-15').focus()
    press(day('2026-10-15'), 'PageDown')
    expect(day('2026-10-22')).toHaveFocus()
  })

  it('activates a day with Enter', () => {
    const onDayActivate = vi.fn()
    render(<Harness onDayActivate={onDayActivate} />)
    press(day('2026-10-15'), 'Enter')
    expect(onDayActivate).toHaveBeenCalledWith('2026-10-15')
  })

  it('shows "+N more" at the right count, and its list is keyboard reachable', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      start: '2026-10-15',
      end: '2026-10-15'
    }))
    render(<Harness items={items} />)
    const cell = day('2026-10-15')
    expect(within(cell).getAllByRole('button', { name: /^[a-e]$/ })).toHaveLength(2)
    const more = within(cell).getByRole('button', { name: /3 more on/ })
    expect(more).toHaveTextContent('+3 more')
    // In the focused day, so Tab reaches it.
    expect(more).toHaveAttribute('tabindex', '0')
    act(() => more.click())
    const list = screen.getByRole('dialog', { name: /15 October 2026/ })
    const listed = within(list).getAllByRole('button')
    expect(listed.map((button) => button.textContent)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(listed[0]).toHaveFocus()
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports a drop with the item and the day it was held by', () => {
    const onDrop = vi.fn()
    render(
      <Harness items={[{ id: 'a', start: '2026-10-15', end: '2026-10-15' }]} onDrop={onDrop} />
    )
    const item = day('2026-10-15').querySelector('[data-item-id="a"]')!
    const data = new Map<string, string>()
    const dataTransfer = {
      types: ['text/plain'],
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'all',
      dropEffect: 'none'
    }
    fireEvent.dragStart(item, { dataTransfer })
    fireEvent.dragOver(day('2026-10-16'), { dataTransfer })
    expect(day('2026-10-16')).toHaveClass('is-drop-target')
    fireEvent.drop(day('2026-10-16'), { dataTransfer })
    expect(onDrop).toHaveBeenCalledWith('2026-10-16', {
      itemId: 'a',
      grabbedDate: '2026-10-15'
    })
  })
})
