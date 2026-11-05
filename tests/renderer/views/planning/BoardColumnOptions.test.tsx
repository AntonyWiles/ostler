// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { columnCards, normalizeColumnOptions } from '@shared/planning/board'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { BOARD_VIEW_SPEC } from '@renderer/hooks/planning/useBoardInteraction'
import { BoardView } from '@renderer/views/planning/BoardView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <BoardView ws={ws} />
}

function renderBoard(items: PlanningWorkItem[]) {
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: items })
  })
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <Live />
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

const cardTitles = (column: string) =>
  within(screen.getByRole('region', { name: column }))
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent)

beforeEach(() => localStorage.clear())
afterEach(() => __resetDismissableStackForTests())

describe('Board column options (MOP-79)', () => {
  it('keeps only known options, and drops empty columns', () => {
    expect(
      normalizeColumnOptions({
        ready: { sortBy: 'title', sortDir: 'desc', maxCards: 5, maxHeight: 480, hideFields: true },
        done: { sortBy: 'manual', maxCards: -1, maxHeight: 'tall' },
        bad: 'x'
      })
    ).toEqual({
      ready: { sortBy: 'title', sortDir: 'desc', maxCards: 5, maxHeight: 480, hideFields: true }
    })
    expect(normalizeColumnOptions(null)).toEqual({})
    expect(BOARD_VIEW_SPEC.normalize({}).columnOptions).toEqual({})
  })

  it('sorts a column its own way and cuts it to its cards shown', () => {
    const items = ['c', 'a', 'b'].map((id) => makeWorkItem(id, { title: id }))
    const cut = columnCards(items, { sortBy: 'title', sortDir: 'asc', maxCards: 2 }, false)
    expect(cut.shown.map((item) => item.title)).toEqual(['a', 'b'])
    expect(cut.hidden).toBe(1)
    expect(columnCards(items, { maxCards: 2 }, true).shown).toHaveLength(3)
    expect(columnCards(items, undefined, false).shown).toBe(items)
  })

  it('sets a column’s sort and cards shown from its options button', async () => {
    renderBoard(
      ['Charlie', 'Alpha', 'Bravo'].map((title, index) =>
        makeWorkItem(String(index), { title, status: 'ready' })
      )
    )
    await screen.findByRole('heading', { name: 'Alpha' })
    fireEvent.click(screen.getByRole('button', { name: 'Column options for Ready' }))
    const dialog = screen.getByRole('dialog', { name: 'Ready options' })
    fireEvent.change(within(dialog).getByLabelText('Sort by'), { target: { value: 'title' } })
    expect(cardTitles('Ready')).toEqual(['Alpha', 'Bravo', 'Charlie'])

    fireEvent.change(within(dialog).getByLabelText('Cards shown'), { target: { value: '5' } })
    expect(cardTitles('Ready')).toHaveLength(3)
  })

  it('shows the first cards and a Show more for the rest', async () => {
    localStorage.clear()
    renderBoard(
      Array.from({ length: 7 }, (_, index) =>
        makeWorkItem(String(index), { title: `Task ${index}`, status: 'ready' })
      )
    )
    await screen.findByRole('heading', { name: 'Task 0' })
    fireEvent.click(screen.getByRole('button', { name: 'Column options for Ready' }))
    const dialog = screen.getByRole('dialog', { name: 'Ready options' })
    fireEvent.change(within(dialog).getByLabelText('Cards shown'), { target: { value: '5' } })
    expect(cardTitles('Ready')).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(cardTitles('Ready')).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(cardTitles('Ready')).toHaveLength(5)
  })
})
