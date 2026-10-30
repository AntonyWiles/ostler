// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineGrid, type TimelineBarSpec, type TimelineZoom } from '@renderer/ui'
import { withElementSize } from '../fixtures/layout'

interface Row {
  id: string
  title: string
  bar: TimelineBarSpec
}

const rows: Row[] = [
  {
    id: 'a',
    title: 'Alpha',
    bar: { id: 'a', start: '2026-10-05', end: '2026-10-09', editable: true }
  },
  { id: 'b', title: 'Beta', bar: { id: 'b', start: '2026-10-12', end: '2026-10-12' } }
]

function renderGrid(zoom: TimelineZoom, onZoomChange = vi.fn(), onBarActivate = vi.fn()) {
  render(
    <TimelineGrid<Row, TimelineBarSpec>
      label="Plan"
      rows={rows}
      getRowId={(row) => row.id}
      renderLabel={(row) => row.title}
      barsFor={(row) => [row.bar]}
      renderBar={(_bar, box) => <rect width={box.width} height={10} />}
      barLabel={(bar) => `Bar ${bar.id}`}
      arrows={[{ id: 'a->b', from: 'a', to: 'b' }]}
      range={{ start: '2026-10-01', end: '2026-10-31' }}
      today="2026-10-08"
      zoom={zoom}
      onZoomChange={onZoomChange}
      onBarActivate={onBarActivate}
    />
  )
  return { onZoomChange, onBarActivate }
}

describe('TimelineGrid', () => {
  withElementSize(1280, 600)

  it('shades weekends at Week zoom only, and draws today and the arrows', () => {
    renderGrid('week')
    // October 2026 has nine weekend days.
    expect(document.querySelectorAll('.ui-timeline__weekend')).toHaveLength(9)
    expect(document.querySelector('.ui-timeline__today')).not.toBeNull()
    expect(document.querySelector('[data-arrow-id="a->b"]')).not.toBeNull()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('has no weekend shading at Month zoom', () => {
    renderGrid('month')
    expect(document.querySelectorAll('.ui-timeline__weekend')).toHaveLength(0)
  })

  it('zooms with Ctrl and the wheel, and leaves a plain wheel alone', () => {
    const { onZoomChange } = renderGrid('month')
    const scroll = document.querySelector('.ui-timeline__scroll')!
    fireEvent.wheel(scroll, { deltaY: 100 })
    expect(onZoomChange).not.toHaveBeenCalled()
    fireEvent.wheel(scroll, { deltaY: -100, ctrlKey: true })
    expect(onZoomChange).toHaveBeenLastCalledWith('week')
    fireEvent.wheel(scroll, { deltaY: 100, ctrlKey: true })
    expect(onZoomChange).toHaveBeenLastCalledWith('quarter')
  })

  it('activates a bar with Enter', () => {
    const { onBarActivate } = renderGrid('month')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bar b' }), { key: 'Enter' })
    expect(onBarActivate).toHaveBeenCalledWith(rows[1].bar)
  })
})

describe('TimelineGrid with a baseline bar (N7.4) and link drawing (N7.2b)', () => {
  withElementSize(1280, 600)

  interface MarkRow {
    id: string
    title: string
    bars: TimelineBarSpec[]
  }

  it('gives a baseline bar no link handles, no focus or name, and never an arrow to it', () => {
    const baseline: TimelineBarSpec = {
      id: 'baseline:a',
      start: '2026-10-02',
      end: '2026-10-06',
      decorative: true
    }
    const markRows: MarkRow[] = [
      {
        id: 'a',
        title: 'Alpha',
        bars: [baseline, { id: 'a', start: '2026-10-05', end: '2026-10-09', editable: true }]
      },
      { id: 'b', title: 'Beta', bars: [{ id: 'b', start: '2026-10-12', end: '2026-10-14' }] }
    ]
    render(
      <TimelineGrid<MarkRow, TimelineBarSpec>
        label="Plan"
        rows={markRows}
        getRowId={(row) => row.id}
        renderLabel={(row) => row.title}
        barsFor={(row) => row.bars}
        renderBar={(_bar, box) => <rect width={box.width} height={10} />}
        barLabel={(bar) => `Bar ${bar.id}`}
        arrows={[
          { id: 'a->b', from: 'a', to: 'b' },
          { id: 'baseline:a->b', from: 'baseline:a', to: 'b' },
          { id: 'b->baseline:a', from: 'b', to: 'baseline:a' }
        ]}
        onArrowActivate={vi.fn()}
        canLink={() => true}
        onLinkDraw={vi.fn()}
        barMenu={() => [{ label: 'Link to…', onSelect: vi.fn() }]}
        range={{ start: '2026-10-01', end: '2026-10-31' }}
        today="2026-10-08"
        zoom="week"
      />
    )
    // Today's bars can be linked from either end.
    for (const id of ['a', 'b'])
      expect(
        document.querySelector(`[data-bar-id="${id}"]`)!.querySelectorAll('[data-link-end]')
      ).toHaveLength(2)

    // The baseline's mark is drawn, but has no handles, no focus, no name and no bar id.
    const marks = document.querySelectorAll('.ui-timeline__bars .ui-timeline__mark')
    expect(marks).toHaveLength(1)
    const mark = marks[0]
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    expect(mark.hasAttribute('tabindex')).toBe(false)
    expect(mark.hasAttribute('role')).toBe(false)
    expect(mark.querySelectorAll('[data-link-end], .ui-timeline__link-handle')).toHaveLength(0)
    expect(document.querySelector('[data-bar-id="baseline:a"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bar baseline:a' })).toBeNull()
    expect(document.querySelectorAll('.ui-timeline__link-handle')).toHaveLength(4)

    // Arrows join today's bars only: never from or to the baseline.
    expect(document.querySelector('[data-arrow-id="a->b"]')).not.toBeNull()
    expect(document.querySelector('[data-arrow-id="baseline:a->b"]')).toBeNull()
    expect(document.querySelector('[data-arrow-id="b->baseline:a"]')).toBeNull()
    expect(document.querySelectorAll('.ui-timeline__link')).toHaveLength(1)
  })
})
