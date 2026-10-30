// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { BOARD_VIEW_SPEC } from '@renderer/hooks/planning/useBoardInteraction'
import { BoardView } from '@renderer/views/planning/BoardView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

/** The real workspace hook against a fake API, live, so a change shows as it would in the app. */
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

describe('Columns under View options', () => {
  it('hides and shows columns for this view in a click, even one with tasks in it', async () => {
    renderBoard([makeWorkItem('a', { title: 'Write brief', status: 'ready' })])
    await screen.findByRole('heading', { name: 'Write brief' })
    const before = columnNames()
    expect(before).toContain('Ready')

    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    const picker = screen.getByRole('group', { name: 'Columns on this board' })
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Ready' }))

    expect(columnNames()).not.toContain('Ready')
    expect(columnNames()).toHaveLength(before.length - 1)
    expect(screen.queryByRole('heading', { name: 'Write brief' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View options · 1 column hidden' })).toBeTruthy()

    const options = screen.getByRole('dialog', { name: 'View options' })
    fireEvent.click(within(options).getByRole('button', { name: 'Show all' }))
    expect(columnNames()).toEqual(before)
  })

  it('keeps the last column shown', async () => {
    renderBoard([])
    fireEvent.click(await screen.findByRole('button', { name: 'View options' }))
    const picker = screen.getByRole('group', { name: 'Columns on this board' })
    const boxes = within(picker).getAllByRole('checkbox')
    for (const box of boxes.slice(1)) fireEvent.click(box)
    expect(boxes[0]).toBeDisabled()
    expect(columnNames()).toHaveLength(1)
  })
})

describe('Board view options', () => {
  it('reads hidden columns and the selection boxes from a saved view, ignoring junk', () => {
    expect(BOARD_VIEW_SPEC.normalize({})).toMatchObject({ showBoxes: false, hiddenColumns: [] })
    expect(
      BOARD_VIEW_SPEC.normalize({
        showBoxes: true,
        hiddenColumns: ['ready', 'ready', 'nonsense', 3, 'done']
      })
    ).toMatchObject({ showBoxes: true, hiddenColumns: ['ready', 'done'] })
  })
})
