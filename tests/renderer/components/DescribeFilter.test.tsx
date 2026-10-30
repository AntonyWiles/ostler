// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FilterFromWordsResult } from '@shared/filter-from-words'
import { EMPTY_TASK_FILTER, type TaskFilter } from '@shared/task-filter'
import type { TaskFilterFieldsValue } from '@renderer/views/planning/TaskFilterFields'
import { TaskFilterFields } from '@renderer/views/planning/TaskFilterFields'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

const before: TaskFilter = {
  match: 'all',
  conditions: [{ field: 'priority', op: 'is', value: ['low'] }]
}

function filtersStub(filter: TaskFilter, setFilter: (next: TaskFilter) => void) {
  return {
    filter,
    setFilter,
    query: '',
    setQuery: () => {},
    hideDone: false,
    setHideDone: () => {},
    isFiltered: filter.conditions.length > 0,
    clear: () => {},
    options: {},
    setOptions: () => {},
    views: [],
    activeView: null,
    isChanged: false,
    loaded: true,
    selectView: () => {},
    saveAs: async () => {},
    updateActive: async () => {},
    rename: async () => {},
    remove: async () => {},
    setAsDefault: async () => {},
    revert: () => {},
    defaultSource: 'standard' as const,
    hasAllProjectsDefault: false,
    resetDefault: async () => {},
    setAsAllProjectsDefault: async () => {},
    resetAllProjectsDefault: async () => {}
  } satisfies TaskFilterFieldsValue
}

function Bar() {
  const [filter, setFilter] = useState<TaskFilter>(before)
  return (
    <>
      <TaskFilterFields
        filters={filtersStub(filter, setFilter)}
        ws={{
          projectId: 'p1',
          milestones: [{ id: 'm-launch', name: 'Launch' }] as never,
          goals: []
        }}
        workItems={[]}
      />
      <output data-testid="filter">{JSON.stringify(filter)}</output>
    </>
  )
}

function renderBar(ai: boolean) {
  return render(
    <MemoryRouter>
      <StaticFeaturesProvider value={{ ai, agents: false }}>
        <StaticPeopleProvider people={[]}>
          <ToastProvider>
            <Bar />
          </ToastProvider>
        </StaticPeopleProvider>
      </StaticFeaturesProvider>
    </MemoryRouter>
  )
}

function shownFilter(): TaskFilter {
  return JSON.parse(screen.getByTestId('filter').textContent ?? '{}') as TaskFilter
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => __resetDismissableStackForTests())

async function describeIt(words: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Describe it' }))
  fireEvent.change(await screen.findByLabelText('Describe the tasks you want to see'), {
    target: { value: words }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Make filter' }))
}

describe('Describe it', () => {
  it('is hidden while Ostler AI is not set up', () => {
    installOstlerApi()
    renderBar(false)
    expect(screen.queryByRole('button', { name: 'Describe it' })).toBeNull()
  })

  it('replaces the filter with the answer, keeps the words, and undoes', async () => {
    const result: FilterFromWordsResult = {
      model: 'test-model',
      filter: {
        match: 'all',
        conditions: [
          { field: 'milestone', op: 'is', value: ['m-launch'] },
          { field: 'due', op: 'is', value: 'overdue' }
        ]
      },
      notes: [{ kind: 'unknownName', field: 'labels', name: 'urgent' }]
    }
    const api = installOstlerApi({
      filterFromWords: vi.fn(async () => ({ ok: true as const, value: result }))
    })
    renderBar(true)
    await describeIt('overdue launch tasks tagged urgent')

    await waitFor(() => expect(shownFilter()).toEqual(result.filter))
    expect(api.filterFromWords).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ text: 'overdue launch tasks tagged urgent' })
    )
    // The bar shows the conditions as if built by hand.
    expect(screen.getByText(/Milestone is Launch/)).toBeTruthy()
    expect(screen.getByText("Could not find a label called 'urgent'")).toBeTruthy()
    expect(
      (screen.getByLabelText('Describe the tasks you want to see') as HTMLInputElement).value
    ).toBe('overdue launch tasks tagged urgent')

    expect(screen.getByText('Filter replaced')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(shownFilter()).toEqual(before))
  })

  it('changes nothing and says so when no filter comes back', async () => {
    installOstlerApi({
      filterFromWords: vi.fn(async () => ({
        ok: true as const,
        value: { model: 'test-model', filter: EMPTY_TASK_FILTER, notes: [] }
      }))
    })
    renderBar(true)
    await describeIt('hello')
    expect(await screen.findByText(/found no filter in those words/)).toBeTruthy()
    expect(shownFilter()).toEqual(before)
  })
})
