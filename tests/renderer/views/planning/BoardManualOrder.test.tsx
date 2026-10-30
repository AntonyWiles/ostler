// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningWorkItem, PlanningWorkItemPlacement } from '@shared/ostler-api'
import { BoardView } from '@renderer/views/planning/BoardView'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { AnnouncerProvider, ConfirmProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { makeWorkItem } from '../../fixtures/planning-records'

/** Manual order on the Board (D31): drops between cards, Alt and the arrows. */

const ITEMS: PlanningWorkItem[] = [
  makeWorkItem('a', { status: 'ready', title: 'Pay invoice', orderKey: 'a' }),
  makeWorkItem('b', { status: 'ready', title: 'Book venue', orderKey: 'b' }),
  makeWorkItem('c', { status: 'backlog', title: 'Write brief', orderKey: 'c' })
]

/** jsdom lays nothing out: every card is 100 px tall, stacked in its column. */
function layOutCards() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id = this.getAttribute('data-work-item-id')
    const column = this.closest('.board-column')
    const cards = column ? [...column.querySelectorAll('[data-work-item-id]')] : []
    const top = id ? cards.indexOf(this) * 100 : 0
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      bottom: top + 100,
      right: 300,
      width: 300,
      height: 100,
      toJSON: () => ({})
    }
  })
}

let move: ReturnType<typeof vi.fn>
let workspace: PlanningWorkspace

function LiveBoard() {
  workspace = usePlanningWorkspace('p1', () => {})
  return <BoardView ws={workspace} />
}

async function renderBoard() {
  move = vi.fn(async (id: string, placement: PlanningWorkItemPlacement) => ({
    ok: true as const,
    value: { ...ITEMS.find((item) => item.id === id)!, status: placement.status ?? 'ready' }
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: ITEMS }),
    movePlanningWorkItem: move
  })
  render(
    <AnnouncerProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <LiveBoard />
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </AnnouncerProvider>
  )
  await waitFor(() => expect(document.querySelectorAll('article.task-card')).toHaveLength(3))
}

const column = (status: string) =>
  document.querySelector(`.ostler-planning-column--${status}`) as HTMLElement
const card = (id: string) => document.querySelector(`[data-work-item-id="${id}"]`) as HTMLElement
const dataTransfer = (id: string) => ({
  getData: () => id,
  setData: vi.fn(),
  dropEffect: '',
  effectAllowed: ''
})
/** A dragover at a height: jsdom's fireEvent drops `clientY` from drag events. */
function dragOverAt(target: HTMLElement, id: string, clientY: number) {
  const event = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer(id) })
  fireEvent(target, event)
}
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim()

describe('Board manual order (D31)', () => {
  beforeEach(() => {
    layOutCards()
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.restoreAllMocks())

  it('drops a card from another column between two cards, where the line shows', async () => {
    await renderBoard()
    fireEvent.dragStart(card('c'), { dataTransfer: dataTransfer('c') })
    // Below the middle of the first card, above the middle of the second.
    dragOverAt(column('ready'), 'c', 120)
    const line = column('ready').querySelector('.board-column__drop-line')!
    expect(line.nextElementSibling).toHaveAttribute('aria-label', 'Book venue')
    fireEvent.drop(column('ready'), { dataTransfer: dataTransfer('c') })
    await waitFor(() => expect(move).toHaveBeenCalledWith('c', { beforeId: 'b', status: 'ready' }))
  })

  it('moves a card within its own column', async () => {
    await renderBoard()
    fireEvent.dragStart(card('a'), { dataTransfer: dataTransfer('a') })
    dragOverAt(column('ready'), 'a', 180)
    fireEvent.drop(column('ready'), { dataTransfer: dataTransfer('a') })
    await waitFor(() => expect(move).toHaveBeenCalledWith('a', { afterId: 'b', status: 'ready' }))
  })

  it('does not offer a drag within a column under another sort, and says how to get it back', async () => {
    await renderBoard()
    act(() => workspace.setBoardSortBy('targetDate'))
    fireEvent.dragStart(card('a'), { dataTransfer: dataTransfer('a') })
    dragOverAt(column('ready'), 'a', 180)
    expect(column('ready').querySelector('.board-column__drop-line')).toBeNull()
    expect(document.querySelector('.board__sort-hint')).toHaveTextContent(
      'Sorted by due date. Choose Manual order to arrange cards by hand.'
    )
    fireEvent.drop(column('ready'), { dataTransfer: dataTransfer('a') })
    expect(move).not.toHaveBeenCalled()
  })

  it('moves the focused card with Alt and the arrow keys, and says where it went', async () => {
    await renderBoard()
    // The cursor lands on the first card there is (Backlog's), then moves right to Ready.
    act(() => {
      fireEvent.keyDown(window, { key: 'j' })
    })
    act(() => {
      fireEvent.keyDown(window, { key: 'l' })
    })
    expect(document.querySelector('.is-cursor')).toHaveAttribute('aria-label', 'Pay invoice')

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })
    })
    await waitFor(() => expect(move).toHaveBeenCalledWith('a', { afterId: 'b' }))
    expect(announced()).toBe('Moved below Book venue, 2 of 2')

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    })
    await waitFor(() =>
      expect(move).toHaveBeenLastCalledWith('a', { beforeId: 'c', status: 'backlog' })
    )
    expect(announced()).toMatch(/^Moved to Backlog, 1 of 2/)
  })

  it('says so when a card cannot move further', async () => {
    await renderBoard()
    act(() => {
      fireEvent.keyDown(window, { key: 'j' })
    })
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true })
    })
    expect(move).not.toHaveBeenCalled()
    expect(announced()).toBe("Can't move further")
  })
})
