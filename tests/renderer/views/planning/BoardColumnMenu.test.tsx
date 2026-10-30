// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
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

const columnNames = () =>
  within(screen.getByLabelText('Planning board'))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent)

beforeEach(() => localStorage.clear())
afterEach(() => __resetDismissableStackForTests())

describe('Right-click on a Board column (MOP-36)', () => {
  it('offers the column’s actions in an empty column', async () => {
    renderBoard([makeWorkItem('a', { title: 'Write brief', status: 'ready' })])
    await screen.findByRole('heading', { name: 'Write brief' })
    const empty = screen.getByRole('region', { name: 'In progress' })
    fireEvent.contextMenu(within(empty).getByText('No tasks'))

    const menu = screen.getByRole('menu', { name: 'Actions for In progress' })
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(names).toEqual([
      'New task in In progress',
      'Hide column in this view',
      'Customise board…'
    ])
  })

  it('hides the column for this view, and offers Select all where there are tasks', async () => {
    renderBoard([makeWorkItem('a', { title: 'Write brief', status: 'ready' })])
    await screen.findByRole('heading', { name: 'Write brief' })
    fireEvent.contextMenu(screen.getByRole('region', { name: 'Ready' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Ready' })
    expect(within(menu).getByRole('menuitem', { name: 'Select all in Ready' })).toBeTruthy()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column in this view' }))
    expect(columnNames()).not.toContain('Ready')
  })

  it('leaves a card’s right-click to the card’s own menu', async () => {
    renderBoard([makeWorkItem('a', { title: 'Write brief', status: 'ready' })])
    const title = await screen.findByRole('heading', { name: 'Write brief' })
    fireEvent.contextMenu(title)
    expect(screen.queryByRole('menu', { name: 'Actions for Ready' })).toBeNull()
    expect(screen.getByRole('menu', { name: /Write brief/ })).toBeTruthy()
  })
})
