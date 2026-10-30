// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND } from '@shared/brand'
import type { RendererConfig, RendererProject } from '@shared/ostler-api'
import type { TipsSettings } from '@shared/tips'
import { TipsProvider, TIP_COOLDOWN_MS, TIP_DELAY_MS } from '@renderer/tips/TipsProvider'
import { SAMPLE_TOUR } from '@renderer/tips/catalog'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

const project = (id: string, name: string) =>
  ({ id, name, enabled: true, path: null }) as unknown as RendererProject

const projects = [
  { ...project('sample', BRAND.sampleProjectName), demo: 'simple' } as RendererProject,
  project('mine', 'My project')
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, refreshProjects: async () => {} })
}))

/** Whether the page has a side panel open, with its resize grip. */
let drawerOpen = false
/** Whether the page has a whiteboard open, which tips wait for. */
let boardOpen = false

/** Everything the tour and the tips point at, on one page. */
function Page() {
  const location = useLocation()
  return (
    <div>
      <p data-testid="where">{location.pathname}</p>
      <header data-tour="project-header">
        <input aria-label="Name" />
        <button type="button" data-tour="new-task">
          New task
        </button>
      </header>
      <div className="ostler-workspace-tabs">
        <div role="tablist" aria-label="Views" />
      </div>
      <div className="board">
        <div className="board__columns">
          <section className="board-column">
            <div className="task-card">Pick the weekend</div>
          </section>
          <section className="board-column" />
        </div>
      </div>
      <button type="button" data-tour="search">
        Search
      </button>
      <button type="button" data-tour="help">
        Help
      </button>
      {drawerOpen && <span data-tour="drawer-resize" />}
      {boardOpen && <div data-tips-wait="" />}
    </div>
  )
}

async function setUp(path: string, tips: TipsSettings = { enabled: true, dismissed: [] }) {
  const updateConfig = vi.fn(async (update: { ui?: { tips?: TipsSettings } }) => ({
    ok: true as const,
    value: {
      ...RENDERER_DEFAULT_CONFIG,
      ui: { ...RENDERER_DEFAULT_CONFIG.ui, tips: update.ui?.tips ?? tips }
    } as RendererConfig
  }))
  installOstlerApi({
    getConfig: async () => ({
      ok: true,
      value: { ...RENDERER_DEFAULT_CONFIG, ui: { ...RENDERER_DEFAULT_CONFIG.ui, tips } }
    }),
    updateConfig: updateConfig as never
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <TipsProvider>
        <Page />
      </TipsProvider>
    </MemoryRouter>
  )
  // The settings load first; then the timers that offer tips run.
  await wait(0)
  return { updateConfig }
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('tips and the tour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom lays nothing out: every element counts as on screen.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    cleanup()
    drawerOpen = false
    boardOpen = false
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers the tour in the sample project after a moment, without taking focus', async () => {
    await setUp('/projects/sample/overview')
    const name = screen.getByLabelText('Name')
    name.focus()
    await wait(100)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    await wait(TIP_DELAY_MS + 700)
    const invite = screen.getByRole('region', { name: /take a quick tour/i })
    expect(invite).toBeTruthy()
    expect(document.activeElement).toBe(name)
  })

  it('shows nothing outside the sample project, or with tips off', async () => {
    await setUp('/projects/mine/overview')
    await wait(TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    cleanup()
    await setUp('/projects/sample/overview', { enabled: false, dismissed: [] })
    await wait(TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()
  })

  it('shows the panel resize tip in any project, until a panel has been resized', async () => {
    drawerOpen = true
    await setUp('/projects/mine/overview')
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByRole('region', { name: /make this panel wider/i })).toBeTruthy()
    cleanup()
    window.localStorage.setItem('ostler.drawer-width.task', '600')
    await setUp('/projects/mine/overview')
    await wait(TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()
  })

  it('walks through the views with Next, Back and the dots, opening each one', async () => {
    const { updateConfig } = await setUp('/projects/sample/board')
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByText(new RegExp(`in ${SAMPLE_TOUR.length} short steps`))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show me around' }))
    await wait(200)
    expect(screen.getByText(`1 of ${SAMPLE_TOUR.length}`)).toBeTruthy()
    // The person asked for the tour, so it takes focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()

    // The views step opens the Overview.
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await wait(200)
    expect(screen.getByTestId('where').textContent).toBe('/projects/sample/overview')
    expect(screen.getByText(`2 of ${SAMPLE_TOUR.length}`)).toBeTruthy()

    // The board's step opens the Board.
    const board = SAMPLE_TOUR.findIndex((step) => step.view === 'board') + 1
    fireEvent.click(screen.getByRole('button', { name: `Go to step ${board}` }))
    await wait(200)
    expect(screen.getByTestId('where').textContent).toBe('/projects/sample/board')
    expect(screen.getByText(`${board} of ${SAMPLE_TOUR.length}`)).toBeTruthy()

    // On to the card, which says what the Board's own tip would.
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await wait(200)
    expect(screen.getByText(`${board + 1} of ${SAMPLE_TOUR.length}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await wait(200)

    // Back to the Overview's own step: this page has nothing it points at, so
    // it is skipped the way the person was going, back to step 2.
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await wait(3600)
    await wait(300)
    expect(screen.getByText(`2 of ${SAMPLE_TOUR.length}`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `Go to step ${SAMPLE_TOUR.length}` }))
    await wait(200)
    expect(screen.getByText(`${SAMPLE_TOUR.length} of ${SAMPLE_TOUR.length}`)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: `Go to step ${SAMPLE_TOUR.length}` })
        .getAttribute('aria-current')
    ).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    await wait(50)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    // The tour, and the Board's tip, which the card step already said.
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: ['tour:sample', 'tip:board-drag'] } }
    })
  })

  it('closes the tour with Escape from inside it, and remembers it was seen', async () => {
    const { updateConfig } = await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    fireEvent.click(screen.getByRole('button', { name: 'Show me around' }))
    await wait(200)
    fireEvent.keyDown(screen.getByTestId('coachmark'), { key: 'ArrowRight' })
    await wait(200)
    expect(screen.getByText(`2 of ${SAMPLE_TOUR.length}`)).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('coachmark'), { key: 'Escape' })
    await wait(50)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: ['tour:sample'] } }
    })
  })

  it('"Not now" puts the invitation away without saving anything', async () => {
    const { updateConfig } = await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await wait(TIP_COOLDOWN_MS + TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('"Not now" holds through a reload of the window, until Ostler starts again', async () => {
    await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    // A reload: everything is mounted afresh, in the same window.
    cleanup()
    await setUp('/projects/sample/overview')
    await wait(TIP_COOLDOWN_MS + TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    // A new start of Ostler has a new session: the invitation comes back.
    cleanup()
    window.sessionStorage.clear()
    await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByRole('region', { name: /take a quick tour/i })).toBeTruthy()
  })

  it('offers nothing while a whiteboard is open, and puts away what was showing', async () => {
    boardOpen = true
    await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS * 3)
    expect(screen.queryByTestId('coachmark')).toBeNull()

    // The board closes: the invitation comes; a board opening again puts it away, unsaved.
    boardOpen = false
    cleanup()
    const { updateConfig } = await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByRole('region', { name: /take a quick tour/i })).toBeTruthy()
    const host = document.createElement('div')
    host.setAttribute('data-tips-wait', '')
    document.body.append(host)
    await wait(1000)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    expect(updateConfig).not.toHaveBeenCalled()
    host.remove()
  })

  it('"Don\'t show this again" turns the invitation down for good', async () => {
    const { updateConfig } = await setUp('/projects/sample/overview')
    await wait(TIP_DELAY_MS + 700)
    fireEvent.click(screen.getByRole('button', { name: "Don't show this again" }))
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: ['tour:sample'] } }
    })
  })

  it('shows a view\'s tip once the tour is answered; "Got it" closes it without saving it', async () => {
    const { updateConfig } = await setUp('/projects/sample/board', {
      enabled: true,
      dismissed: ['tour:sample']
    })
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByRole('region', { name: /drag to move a task on/i })).toBeTruthy()
    // The card's own edge is marked, the next column's too, and a faint copy glides between them.
    await wait(300)
    expect(screen.getByText('Drag to the next column')).toBeTruthy()
    expect(document.querySelector('[data-tip-mark="click"]')).not.toBeNull()
    expect(document.querySelector('[data-tip-mark="drop"]')).not.toBeNull()
    expect(document.querySelector('.ostler-tip-ghost')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await wait(50)
    // Closing the tip takes its marks off the page.
    expect(document.querySelector('[data-tip-mark]')).toBeNull()
    expect(screen.queryByRole('region', { name: /drag to move a task on/i })).toBeNull()
    expect(updateConfig).not.toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: ['tour:sample', 'tip:board-drag'] } }
    })
  })

  it('"Don\'t show this tip again" saves only that tip as dismissed, and closes it', async () => {
    const { updateConfig } = await setUp('/projects/sample/board', {
      enabled: true,
      dismissed: ['tour:sample']
    })
    await wait(TIP_DELAY_MS + 700)
    expect(screen.getByRole('region', { name: /drag to move a task on/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Don't show this tip again" }))
    await wait(50)
    expect(screen.queryByRole('region', { name: /drag to move a task on/i })).toBeNull()
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: true, dismissed: ['tour:sample', 'tip:board-drag'] } }
    })
  })

  it('"Turn off tips" turns every tip off', async () => {
    const { updateConfig } = await setUp('/projects/sample/board', {
      enabled: true,
      dismissed: ['tour:sample']
    })
    await wait(TIP_DELAY_MS + 700)
    fireEvent.click(screen.getByRole('button', { name: 'Turn off tips' }))
    await wait(50)
    expect(screen.queryByTestId('coachmark')).toBeNull()
    expect(updateConfig).toHaveBeenCalledWith({
      ui: { tips: { enabled: false, dismissed: ['tour:sample'] } }
    })
  })
})
