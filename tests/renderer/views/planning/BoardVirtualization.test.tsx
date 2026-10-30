// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { BoardView } from '@renderer/views/planning/BoardView'
import {
  VIRTUALIZE_ABOVE,
  scrollParent,
  withPinned
} from '@renderer/views/planning/BoardColumnItems'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider } from '@renderer/ui'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import { makeWorkItem } from '../../fixtures/planning-records'

const readyItems = (count: number): PlanningWorkItem[] =>
  Array.from({ length: count }, (_, index) =>
    makeWorkItem(`r${index}`, { status: 'ready', title: `Ready ${index}` })
  )

async function renderBoard(items: PlanningWorkItem[], overrides = {}) {
  const base = await renderPlanningWorkspace({
    api: { getPlanningWorkItems: async () => ({ ok: true, value: items }) }
  })
  const ws = withWorkspace(base, overrides)
  // The board scrolls inside the page's content area, as in the app.
  return render(
    <ConfirmProvider>
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <div style={{ overflowY: 'auto', height: '600px' }}>
          <BoardView ws={ws} />
        </div>
      </StaticFeaturesProvider>
    </ConfirmProvider>
  )
}

const readyCards = () =>
  [...document.querySelectorAll('.ostler-planning-column--ready article.task-card')].map((card) =>
    card.getAttribute('aria-label')
  )

describe('Board column virtualisation (P9.1)', () => {
  // jsdom lays nothing out: give the page a 600 px viewport and every card
  // 100 px, so the virtualiser has something to measure.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 100,
      right: 300,
      width: 300,
      height: 100,
      toJSON: () => ({})
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders every card in a column of up to the threshold', async () => {
    await renderBoard(readyItems(VIRTUALIZE_ABOVE))
    expect(readyCards()).toHaveLength(VIRTUALIZE_ABOVE)
  })

  it('renders only the cards near the screen in a longer column', async () => {
    await renderBoard(readyItems(VIRTUALIZE_ABOVE + 50))
    const shown = readyCards()
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(VIRTUALIZE_ABOVE)
    expect(shown[0]).toBe('Ready 0')
    // The column still counts all of them.
    expect(
      document.querySelector('.ostler-planning-column--ready .board-column__count')
    ).toHaveTextContent(String(VIRTUALIZE_ABOVE + 50))
  })

  it('keeps keyboard navigation working onto cards that were off screen', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    await renderBoard(readyItems(VIRTUALIZE_ABOVE + 50))
    expect(readyCards()).not.toContain('Ready 40')
    for (let press = 0; press <= 40; press += 1) {
      act(() => {
        fireEvent.keyDown(window, { key: 'j' })
      })
    }
    const cursor = document.querySelector('.ostler-planning-column--ready .is-cursor')
    expect(cursor).toHaveAttribute('aria-label', 'Ready 40')
  })

  it('still takes a drop on a long column, for a card dragged from anywhere', async () => {
    const dropWorkItem = vi.fn()
    await renderBoard(readyItems(VIRTUALIZE_ABOVE + 50), { dropWorkItem })
    const dataTransfer = { getData: () => 'r149', setData: vi.fn(), dropEffect: '' }
    fireEvent.drop(document.querySelector('.ostler-planning-column--active')!, { dataTransfer })
    expect(dropWorkItem).toHaveBeenCalledWith('active', undefined, 'r149', expect.any(Array))
  })

  it('scrolls with the page, not with the columns that only scroll sideways', () => {
    // The page's content area scrolls; the Board's columns, `overflow-x: auto`
    // and so `overflow-y: auto` too, grow with their cards and never scroll down.
    const page = document.createElement('div')
    page.style.overflowY = 'auto'
    const columns = document.createElement('div')
    columns.style.overflowX = 'auto'
    columns.style.overflowY = 'auto'
    const list = document.createElement('div')
    columns.append(list)
    page.append(columns)
    document.body.append(page)
    const size = (element: HTMLElement, client: number, scroll: number) => {
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: client })
      Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scroll })
    }
    try {
      size(page, 600, 25_000)
      size(columns, 24_900, 24_900)
      expect(scrollParent(list)).toBe(page)
      // A short page where nothing scrolls yet: the nearest that could.
      size(page, 600, 600)
      size(columns, 400, 400)
      expect(scrollParent(list)).toBe(columns)
    } finally {
      page.remove()
    }
  })

  it('always renders the pinned cards (the dragged one, the cursor) with the visible range', () => {
    const range = { startIndex: 10, endIndex: 14, overscan: 2, count: 200 }
    expect(withPinned(range, [150, 3, 12])).toEqual([3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 150])
    expect(withPinned(range, [500, -1])).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16])
  })
})
