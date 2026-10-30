// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { TaskFilter } from '@shared/task-filter'
import { FilterBuilder, type FilterChoices } from '@renderer/ui'

const choices: FilterChoices = {
  people: [{ value: 'p2', label: 'Sam' }],
  milestones: [{ value: 'm1', label: 'Beta' }],
  goals: [],
  labels: [{ value: 'web', label: 'web' }]
}

function Harness({ initial, onValue }: { initial: TaskFilter; onValue: (f: TaskFilter) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <FilterBuilder
      value={value}
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
      choices={choices}
      names={{ person: (id) => (id === 'p2' ? 'Sam' : undefined) }}
    />
  )
}

function setup(initial: TaskFilter = { match: 'all', conditions: [] }) {
  let latest = initial
  render(<Harness initial={initial} onValue={(next) => (latest = next)} />)
  return () => latest
}

describe('FilterBuilder', () => {
  it('adds a condition from "Add filter" and shows it as an editable chip', () => {
    const value = setup()
    const group = screen.getByRole('group', { name: 'Filters' })
    expect(within(group).queryByRole('button', { name: 'Clear' })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Add filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Due' }))
    // The new chip's editor opens at once, on a valid first value.
    const editor = screen.getByRole('dialog', { name: 'Edit filter: Due' })
    expect(value().conditions).toEqual([{ field: 'due', op: 'is', value: 'today' }])
    fireEvent.change(within(editor).getByLabelText('When'), { target: { value: 'thisWeek' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Edit filter: Due is this week' })).toBeTruthy()
    expect(value().conditions).toEqual([{ field: 'due', op: 'is', value: 'thisWeek' }])
  })

  it('edits a list condition with checkboxes, including me and nobody', () => {
    const value = setup({
      match: 'all',
      conditions: [{ field: 'assignee', op: 'is', value: ['me'] }]
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit filter: Assignee is me' }))
    const editor = screen.getByRole('dialog', { name: 'Edit filter: Assignee' })
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Sam' }))
    fireEvent.change(within(editor).getByLabelText('Assignee'), { target: { value: 'isNot' } })
    expect(value().conditions).toEqual([{ field: 'assignee', op: 'isNot', value: ['me', 'p2'] }])
    expect(
      screen.getByRole('button', { name: 'Edit filter: Assignee is not me or Sam' })
    ).toBeTruthy()
  })

  it('switches between all and any once there are two conditions, removes one and clears', () => {
    const value = setup({
      match: 'all',
      conditions: [
        { field: 'priority', op: 'is', value: ['high'] },
        { field: 'due', op: 'is', value: 'overdue' }
      ]
    })
    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'any' } })
    expect(value().match).toBe('any')
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Due is overdue' }))
    expect(value().conditions).toEqual([{ field: 'priority', op: 'is', value: ['high'] }])
    expect(screen.queryByLabelText('Match')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(value()).toEqual({ match: 'all', conditions: [] })
  })

  it('takes a date for "before" and a number for an estimate', () => {
    const value = setup({
      match: 'all',
      conditions: [{ field: 'estimate', op: 'is', value: 'set' }]
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit filter: Estimate is set' }))
    const editor = screen.getByRole('dialog', { name: 'Edit filter: Estimate' })
    fireEvent.change(within(editor).getAllByLabelText('Estimate')[0], {
      target: { value: 'greaterThan' }
    })
    expect(value().conditions[0]).toEqual({ field: 'estimate', op: 'greaterThan', value: 1 })
  })
})
