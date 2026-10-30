// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ListView } from '@renderer/views/planning/list/ListView'
import { IdeaGrid, type IdeaGridWorkspace } from '@renderer/views/planning/ideas/IdeaGrid'
import { TurnedDown, type TurnedDownWorkspace } from '@renderer/views/planning/ideas/TurnedDown'
import { WontDoDialog } from '@renderer/views/planning/WontDoDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { AnnouncerProvider, ConfirmProvider, ToastProvider } from '@renderer/ui'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

const IDEAS = () => [
  makeWorkItem('a', { title: 'Dark mode', someday: true, impact: 4, effort: 2 }),
  makeWorkItem('b', { title: 'Rewrite it', someday: true, impact: 1, effort: 5 }),
  makeWorkItem('c', { title: 'Offline sync', someday: true, impact: null, effort: null }),
  makeWorkItem('d', { title: 'Half scored', someday: true, impact: 5, effort: null })
]

function gridWorkspace(overrides: Partial<IdeaGridWorkspace> = {}): IdeaGridWorkspace {
  return {
    busy: false,
    updateWorkItemInline: vi.fn(async () => true),
    setSomeday: vi.fn(async () => {}),
    openWontDo: vi.fn(),
    wontDoBlocker: () => null,
    openWorkItem: vi.fn(),
    ...overrides
  }
}

function renderGrid(ideas: PlanningWorkItem[], ws = gridWorkspace()) {
  installOstlerApi()
  render(
    <AnnouncerProvider>
      <ToastProvider>
        <IdeaGrid ws={ws} ideas={ideas} />
      </ToastProvider>
    </AnnouncerProvider>
  )
  return ws
}

const cell = (impact: number, effort: number) =>
  screen.getByRole('group', { name: new RegExp(`^Impact ${impact}, effort ${effort}:`) })

/** A drag's data, as the browser hands it from dragstart to drop. */
function dataTransfer() {
  const data = new Map<string, string>()
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    dropEffect: 'none',
    effectAllowed: 'all'
  }
}

describe('the ideas grid (N1.1b)', () => {
  it('places each idea in the cell of its scores, and the unscored ones in the tray', () => {
    renderGrid(IDEAS())
    expect(within(cell(4, 2)).getByText('Dark mode')).toBeTruthy()
    expect(within(cell(1, 5)).getByText('Rewrite it')).toBeTruthy()
    expect(cell(3, 3).textContent).toBe('')
    const tray = screen.getByRole('region', { name: 'Not scored yet: 2 ideas' })
    expect(within(tray).getByText('Offline sync')).toBeTruthy()
    expect(within(tray).getByText('Half scored')).toBeTruthy()
    // The corners are labelled.
    expect(within(cell(5, 1)).getByText('Quick wins')).toBeTruthy()
    expect(within(cell(1, 5)).getByText('Probably not')).toBeTruthy()
    expect(cell(4, 2).className).toContain('idea-grid__cell--quick-win')
  })

  it('sets both scores when a card is dropped on a cell, and undo puts them back', async () => {
    const ws = renderGrid(IDEAS())
    const transfer = dataTransfer()
    const card = screen.getByText('Offline sync').closest('li')!
    fireEvent.dragStart(card, { dataTransfer: transfer })
    fireEvent.dragOver(cell(5, 1), { dataTransfer: transfer })
    fireEvent.drop(cell(5, 1), { dataTransfer: transfer })

    await waitFor(() =>
      expect(ws.updateWorkItemInline).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), {
        impact: 5,
        effort: 1
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(ws.updateWorkItemInline).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'c', impact: 5, effort: 1 }),
        { impact: null, effort: null }
      )
    )
  })

  it('moves a focused card with the arrow keys, and opens it on click', async () => {
    const ws = renderGrid(IDEAS())
    const card = screen.getByRole('button', { name: 'Dark mode: impact 4, effort 2' })
    fireEvent.keyDown(card, { key: 'ArrowUp' })
    await waitFor(() =>
      expect(ws.updateWorkItemInline).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
        impact: 5,
        effort: 2
      })
    )
    fireEvent.keyDown(card, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(ws.updateWorkItemInline).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'a' }),
        { impact: 4, effort: 3 }
      )
    )
    // An unscored card leaves the tray for the middle, keeping the score it has.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Half scored: not scored yet' }), {
      key: 'ArrowLeft'
    })
    await waitFor(() =>
      expect(ws.updateWorkItemInline).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'd' }),
        { impact: 5, effort: 3 }
      )
    )
    fireEvent.click(card)
    expect(ws.openWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('does not move a card past the edge', () => {
    const ws = renderGrid([
      makeWorkItem('e', { title: 'Edge', someday: true, impact: 5, effort: 1 })
    ])
    fireEvent.keyDown(screen.getByRole('button', { name: 'Edge: impact 5, effort 1' }), {
      key: 'ArrowUp'
    })
    expect(ws.updateWorkItemInline).not.toHaveBeenCalled()
  })

  it('collapses a crowded cell to a count that opens a list', () => {
    const crowd = Array.from({ length: 5 }, (_, index) =>
      makeWorkItem(`x${index}`, { title: `Idea ${index}`, someday: true, impact: 3, effort: 3 })
    )
    const ws = renderGrid(crowd)
    expect(screen.queryByText('Idea 0')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: '5 ideas with impact 3, effort 3: show them' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Idea 2' }))
    expect(ws.openWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'x2' }))
  })

  it('brings an idea back, or turns it down through Won’t do, which asks for a reason', () => {
    const ws = renderGrid(IDEAS())
    fireEvent.click(screen.getByRole('button', { name: 'Bring back “Dark mode”' }))
    expect(ws.setSomeday).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })], false)
    fireEvent.click(screen.getByRole('button', { name: 'Not now: close “Rewrite it” as won’t do' }))
    expect(ws.openWontDo).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })])

    render(
      <WontDoDialog
        ws={{
          workItems: IDEAS(),
          harnessTaskFor: () => null,
          wontDoBlocker: () => null,
          closeAsWontDo: vi.fn(async () => null),
          setWontDoTargets: vi.fn()
        }}
        targets={[IDEAS()[1]]}
      />
    )
    expect(screen.getByRole('textbox', { name: /Reason/ })).toBeTruthy()
  })
})

describe('the Someday list’s scores (N1.1b)', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())

  function Live() {
    const ws = usePlanningWorkspace('p1', () => {})
    return <ListView ws={ws} someday />
  }

  it('shows Impact and Effort, best first, and edits a score in place', async () => {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: { ...IDEAS().find((item) => item.id === id)!, ...patch } as PlanningWorkItem
    }))
    installOstlerApi({
      ...emptyPlanningReads(),
      getPlanningWorkItems: async () => ({ ok: true, value: IDEAS() }),
      updatePlanningWorkItem
    } as Partial<OstlerAPI>)
    render(
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <Live />
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    )
    const grid = await screen.findByRole('grid', { name: 'Tasks' })
    expect(within(grid).getByRole('columnheader', { name: /Impact/ })).toBeTruthy()
    expect(within(grid).getByRole('columnheader', { name: /Effort/ })).toBeTruthy()
    const titles = within(grid)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '')
    const order = ['Half scored', 'Dark mode', 'Rewrite it', 'Offline sync'].map((title) =>
      titles.findIndex((text) => text.includes(title))
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((index) => index >= 0)).toBe(true)

    const row = within(grid)
      .getAllByRole('row')
      .find((candidate) => candidate.textContent?.includes('Offline sync'))!
    const cells = within(row).getAllByRole('gridcell')
    const impactIndex = within(grid)
      .getAllByRole('columnheader')
      .findIndex((header) => /Impact/.test(header.textContent ?? ''))
    fireEvent.keyDown(cells[impactIndex], { key: 'Enter' })
    // The scores are radios (menuitemradio), the one chosen ticked.
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '3' }))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledWith('c', { impact: 3 }))
  })
})

describe('Turned down (N1.1b)', () => {
  const archived = [
    makeWorkItem('t1', {
      title: 'Blockchain',
      someday: true,
      resolution: 'wont-do',
      resolutionReason: 'Nobody asked for it',
      archivedAt: 1
    }),
    makeWorkItem('t2', { title: 'Closed task', resolution: 'wont-do', archivedAt: 1 }),
    makeWorkItem('t3', { title: 'Finished idea', someday: true, archivedAt: 1 })
  ]

  function renderTurnedDown(ws: Partial<TurnedDownWorkspace> = {}) {
    const getPlanningWorkItems = vi.fn(async () => ({ ok: true as const, value: archived }))
    installOstlerApi({ getPlanningWorkItems } as Partial<OstlerAPI>)
    const full: TurnedDownWorkspace = {
      projectId: 'p1',
      workItems: [],
      reopenWorkItem: vi.fn(async () => {}),
      ...ws
    }
    render(<TurnedDown ws={full} />)
    return { ws: full, getPlanningWorkItems }
  }

  it('lists ideas closed from Someday, collapsed, with their reasons, and reopens one', async () => {
    const { ws, getPlanningWorkItems } = renderTurnedDown()
    const toggle = await screen.findByRole('button', { name: 'Turned down (1)' })
    expect(getPlanningWorkItems).toHaveBeenCalledWith('p1', 'archived')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Blockchain')).toBeNull()

    fireEvent.click(toggle)
    const list = screen.getByRole('list', { name: 'Turned-down ideas' })
    expect(within(list).getByText('Blockchain')).toBeTruthy()
    expect(within(list).getByText('Nobody asked for it')).toBeTruthy()
    expect(within(list).queryByText('Closed task')).toBeNull()
    expect(within(list).queryByText('Finished idea')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Bring back “Blockchain”' }))
    await waitFor(() =>
      expect(ws.reopenWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    )
  })
})
