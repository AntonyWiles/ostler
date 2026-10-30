// @vitest-environment jsdom
import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DataTable,
  nextSort,
  sortRows,
  type DataTableColumn,
  type DataTableEntry,
  type SortKey
} from '@renderer/ui'
import { withElementSize } from '../fixtures/layout'

interface Fruit {
  id: string
  name: string
  count: number
}

const COLUMNS: DataTableColumn<Fruit>[] = [
  {
    id: 'name',
    header: 'Name',
    compare: (a, b) => a.name.localeCompare(b.name),
    cell: (row) => row.name
  },
  {
    id: 'count',
    header: 'Count',
    align: 'end',
    compare: (a, b) => a.count - b.count,
    cell: (row) => String(row.count)
  },
  { id: 'note', header: 'Note', cell: () => '—' }
]

const FRUIT: Fruit[] = [
  { id: 'a', name: 'Apple', count: 3 },
  { id: 'b', name: 'Banana', count: 1 },
  { id: 'c', name: 'Cherry', count: 2 },
  { id: 'd', name: 'Damson', count: 5 }
]

const rowEntries = (rows: Fruit[]): DataTableEntry<Fruit>[] =>
  rows.map((row) => ({ kind: 'row', id: row.id, row, label: row.name }))

const COMPARERS = Object.fromEntries(
  COLUMNS.map((column) => [column.id, column.compare && { compare: column.compare }])
)

function Harness({
  rows = FRUIT,
  grouped = false,
  onRowActivate
}: {
  rows?: Fruit[]
  grouped?: boolean
  onRowActivate?: (row: Fruit, id: string) => void
}) {
  const [sort, setSort] = useState<SortKey[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [order, setOrder] = useState(COLUMNS.map((column) => column.id))
  const [widths, setWidths] = useState<Record<string, number>>({})
  const sorted = sortRows(rows, sort, COMPARERS)
  const entries: DataTableEntry<Fruit>[] = grouped
    ? [
        { kind: 'group', id: 'g', label: 'All fruit', count: rows.length, collapsed },
        ...(collapsed ? [] : rowEntries(sorted))
      ]
    : rowEntries(sorted)
  return (
    <>
      <DataTable
        label="Fruit"
        columns={order.map((id) => COLUMNS.find((column) => column.id === id)!)}
        entries={entries}
        sort={sort}
        onSortChange={setSort}
        selectable
        selectedIds={new Set(selected)}
        onSelectionChange={setSelected}
        onToggleGroup={() => setCollapsed((value) => !value)}
        onRowActivate={onRowActivate}
        widths={widths}
        onColumnResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
        onColumnMove={(id, to) =>
          setOrder((current) => {
            const next = current.filter((candidate) => candidate !== id)
            next.splice(to, 0, id)
            return next
          })
        }
      />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  )
}

const grid = () => screen.getByRole('grid', { name: 'Fruit' })
const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`\\b${name}\\b`) })
const cellOf = (rowName: string, columnIndex: number) =>
  within(rowOf(rowName)).getAllByRole('gridcell')[columnIndex]
const key = (target: Element, keyName: string, init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    fireEvent.keyDown(target, { key: keyName, ...init })
  })
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })
const rowNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('gridcell')[1]?.textContent)

describe('DataTable', () => {
  withElementSize(800, 360)

  it('is a named grid with one tab stop that arrow keys move across cells', () => {
    render(<Harness />)
    expect(grid()).toHaveAttribute('aria-rowcount', '5')
    const first = cellOf('Apple', 0)
    expect(first).toHaveAttribute('tabindex', '0')
    expect(cellOf('Apple', 1)).toHaveAttribute('tabindex', '-1')

    first.focus()
    key(first, 'ArrowRight')
    expect(cellOf('Apple', 1)).toHaveFocus()
    key(document.activeElement!, 'ArrowDown')
    expect(cellOf('Banana', 1)).toHaveFocus()
    key(document.activeElement!, 'End')
    expect(cellOf('Banana', 3)).toHaveFocus()
    key(document.activeElement!, 'Home')
    expect(cellOf('Banana', 0)).toHaveFocus()
    key(document.activeElement!, 'End', { ctrlKey: true })
    expect(cellOf('Damson', 0)).toHaveFocus()
    key(document.activeElement!, 'PageUp')
    expect(cellOf('Apple', 0)).toHaveFocus()
    key(document.activeElement!, 'ArrowUp')
    expect(screen.getAllByRole('columnheader')[0]).toHaveFocus()
  })

  it('moves into a group header, which collapses and expands from the keyboard', () => {
    render(<Harness grouped />)
    const apple = cellOf('Apple', 1)
    apple.focus()
    key(apple, 'ArrowUp')
    const groupRow = () => screen.getByRole('row', { name: /All fruit/ })
    const group = within(groupRow()).getByRole('gridcell')
    expect(group).toHaveFocus()
    expect(groupRow()).toHaveAttribute('aria-expanded', 'true')
    expect(group).toHaveTextContent('4')

    key(group, 'ArrowLeft')
    expect(groupRow()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('row', { name: /Apple/ })).toBeNull()
    key(group, 'Enter')
    expect(rowOf('Apple')).toBeInTheDocument()

    // Back down, to the column it came from.
    key(group, 'ArrowDown')
    expect(cellOf('Apple', 1)).toHaveFocus()
  })

  it('sorts from the header and says so with aria-sort; Shift adds a second key', () => {
    render(<Harness />)
    expect(header('Count')).toHaveAttribute('aria-sort', 'none')
    expect(header('Note')).not.toHaveAttribute('aria-sort')

    fireEvent.click(header('Count'))
    expect(header('Count')).toHaveAttribute('aria-sort', 'ascending')
    expect(rowNames()).toEqual(['Banana', 'Cherry', 'Apple', 'Damson'])

    fireEvent.click(header('Count'))
    expect(header('Count')).toHaveAttribute('aria-sort', 'descending')
    expect(rowNames()).toEqual(['Damson', 'Apple', 'Cherry', 'Banana'])

    fireEvent.click(header('Count'))
    expect(header('Count')).toHaveAttribute('aria-sort', 'none')
    expect(rowNames()).toEqual(['Apple', 'Banana', 'Cherry', 'Damson'])

    fireEvent.click(header('Name'))
    fireEvent.click(header('Count'), { shiftKey: true })
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    // Only the primary key carries aria-sort; the second says so in words.
    expect(header('Count')).not.toHaveAttribute('aria-sort')
    expect(header('Count')).toHaveTextContent('sort 2, ascending')
  })

  it('sorts from the keyboard on a header cell', () => {
    render(<Harness />)
    const name = header('Name')
    name.focus()
    key(name, 'Enter')
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
    key(header('Name'), 'Enter')
    expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
  })

  it('selects a range with Shift+click and everything with Ctrl+A', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Apple' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cherry' }), { shiftKey: true })
    expect(screen.getByTestId('selected')).toHaveTextContent('a,b,c')
    expect(rowOf('Banana')).toHaveAttribute('aria-selected', 'true')
    expect(rowOf('Damson')).toHaveAttribute('aria-selected', 'false')

    const cell = cellOf('Damson', 1)
    cell.focus()
    key(cell, 'x')
    expect(screen.getByTestId('selected')).toHaveTextContent('a,b,c,d')
    key(cell, 'Escape')
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement()
    key(cell, 'a', { ctrlKey: true })
    expect(screen.getByTestId('selected')).toHaveTextContent('a,b,c,d')
    expect(screen.getByRole('checkbox', { name: 'Deselect all rows' })).toBeChecked()
  })

  it('opens a row with Enter, Ctrl+Enter or a double click', () => {
    const onRowActivate = vi.fn()
    render(<Harness onRowActivate={onRowActivate} />)
    const cell = cellOf('Banana', 1)
    cell.focus()
    key(cell, 'Enter')
    key(cell, 'Enter', { ctrlKey: true })
    fireEvent.doubleClick(cell)
    expect(onRowActivate).toHaveBeenCalledTimes(3)
    expect(onRowActivate).toHaveBeenCalledWith(FRUIT[1], 'b')
  })

  it('moves a column with Alt+Arrow and resizes it with Alt+Shift+Arrow', () => {
    render(<Harness />)
    const name = header('Name')
    name.focus()
    key(name, 'ArrowRight', { altKey: true })
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '',
      'Count',
      'Name',
      'Note'
    ])
    expect(header('Name')).toHaveFocus()
    expect(screen.getByText('Name moved to column 2 of 3')).toBeInTheDocument()

    const before = parseFloat(header('Name').style.width)
    key(header('Name'), 'ArrowRight', { altKey: true, shiftKey: true })
    expect(parseFloat(header('Name').style.width)).toBe(before + 16)
  })

  it('keeps only a window of 5,000 rows in the DOM', () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({
      id: `r${index}`,
      name: `Row${index}`,
      count: index
    }))
    render(<Harness rows={many} />)
    expect(grid()).toHaveAttribute('aria-rowcount', '5001')
    const rendered = screen.getAllByRole('row').length - 1
    expect(rendered).toBeGreaterThan(5)
    expect(rendered).toBeLessThan(60)
    expect(screen.queryByRole('row', { name: /Row4999\b/ })).toBeNull()

    // The end of the grid brings the last row in, and the first one leaves.
    const cell = cellOf('Row0', 1)
    cell.focus()
    key(cell, 'End', { ctrlKey: true })
    expect(rowOf('Row4999')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Row0\b/ })).toBeNull()
  })
})

describe('DataTable sort rules', () => {
  it('cycles a plain click through ascending, descending and unsorted', () => {
    expect(nextSort([], 'a', false)).toEqual([{ columnId: 'a', direction: 'asc' }])
    expect(nextSort([{ columnId: 'a', direction: 'asc' }], 'a', false)).toEqual([
      { columnId: 'a', direction: 'desc' }
    ])
    expect(nextSort([{ columnId: 'a', direction: 'desc' }], 'a', false)).toEqual([])
    expect(nextSort([{ columnId: 'a', direction: 'asc' }], 'b', false)).toEqual([
      { columnId: 'b', direction: 'asc' }
    ])
  })

  it('adds, flips and removes a key with Shift', () => {
    const one: SortKey[] = [{ columnId: 'a', direction: 'asc' }]
    const two = nextSort(one, 'b', true)
    expect(two).toEqual([...one, { columnId: 'b', direction: 'asc' }])
    expect(nextSort(two, 'b', true)[1]).toEqual({ columnId: 'b', direction: 'desc' })
    expect(nextSort(nextSort(two, 'b', true), 'b', true)).toEqual(one)
  })

  it('sorts stably, by every key, with empty values last either way', () => {
    interface Item {
      id: number
      due: string | null
      p: number
    }
    const rows: Item[] = [
      { id: 1, due: null, p: 1 },
      { id: 2, due: '2026-01-02', p: 2 },
      { id: 3, due: '2026-01-01', p: 2 },
      { id: 4, due: '2026-01-01', p: 1 }
    ]
    const comparers = {
      due: {
        compare: (a: Item, b: Item) => a.due!.localeCompare(b.due!),
        isEmpty: (row: Item) => !row.due
      },
      p: { compare: (a: Item, b: Item) => a.p - b.p }
    }
    const ids = (sort: SortKey[]) => sortRows(rows, sort, comparers).map((row) => row.id)
    expect(ids([{ columnId: 'due', direction: 'asc' }])).toEqual([3, 4, 2, 1])
    expect(ids([{ columnId: 'due', direction: 'desc' }])).toEqual([2, 3, 4, 1])
    expect(
      ids([
        { columnId: 'due', direction: 'asc' },
        { columnId: 'p', direction: 'asc' }
      ])
    ).toEqual([4, 3, 2, 1])
    expect(ids([])).toEqual([1, 2, 3, 4])
  })
})
