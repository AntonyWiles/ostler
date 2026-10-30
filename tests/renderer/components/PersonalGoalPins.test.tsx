// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePinInput, OstlerAPI, PinView, RendererProject } from '@shared/ostler-api'
import { PinsProvider, usePins } from '@renderer/pins/PinsProvider'
import { PinnedSection } from '@renderer/pins/PinnedSection'
import { HomeCountdowns } from '@renderer/views/home/HomeCountdowns'
import { ConfirmProvider, Menu, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

/** A fixed today: no test reads the real date. */
const TODAY = '2026-10-12'

const projects: RendererProject[] = []

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects, areas: [], refreshProjects: async () => {} })
}))

function goalPin(overrides: Partial<PinView> = {}): PinView {
  return {
    id: 'pin-goal',
    place: 'sidebar',
    projectId: '',
    kind: 'personal-goal',
    targetId: 'pg1',
    orderKey: 'V',
    createdAt: new Date(2026, 9, 1, 9).getTime(),
    countdown: false,
    exists: true,
    title: 'Save £5,000',
    archived: false,
    date: '2026-11-21',
    done: false,
    countdownText: null,
    ...overrides
  }
}

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

function renderWithPins(ui: ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route
              path="*"
              element={
                <PinsProvider>
                  {ui}
                  <Where />
                </PinsProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** A goal's menu as the Goals view builds it: the pin entries for its target. */
function GoalMenu() {
  const pins = usePins()
  return (
    <Menu
      label="Goal actions"
      items={pins.menuItems({
        kind: 'personal-goal',
        targetId: 'pg1',
        projectId: '',
        title: 'Save £5,000'
      })}
    />
  )
}

describe('pins and countdowns of goals of one’s own (N5.6b)', () => {
  beforeEach(() => window.localStorage.clear())
  Element.prototype.scrollIntoView = vi.fn()

  it('pins a goal to the sidebar only, shows it with no project, and opens it in Goals', async () => {
    let pins: PinView[] = []
    const createPin = vi.fn(async (input: CreatePinInput) => {
      pins = [goalPin({ targetId: input.targetId })]
      return { ok: true as const, value: pins[0] }
    })
    installOstlerApi({
      listPins: async () => ({ ok: true, value: pins }),
      listCountdowns: async () => ({ ok: true, value: [] }),
      createPin
    } as Partial<OstlerAPI>)
    renderWithPins(
      <>
        <GoalMenu />
        <PinnedSection projects={projects} collapsed={false} />
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Goal actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Pin to sidebar' })).toBeTruthy()
    // A goal of one's own is in no project: it has no Overview.
    expect(screen.queryByRole('menuitem', { name: 'Pin to Overview' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() =>
      expect(createPin).toHaveBeenCalledWith({
        place: 'sidebar',
        kind: 'personal-goal',
        targetId: 'pg1',
        projectId: ''
      })
    )
    const region = await screen.findByRole('region', { name: 'Pinned' })
    fireEvent.click(within(region).getByRole('button', { name: 'Save £5,000' }))
    expect(screen.getByTestId('where').textContent).toBe('/goals?goal=pg1')
  })

  it('shows a pinned goal’s countdown on Home in N5.2b’s words', async () => {
    const pin = goalPin({ countdown: true })
    installOstlerApi({
      listPins: async () => ({ ok: true, value: [pin] }),
      listCountdowns: async () => ({ ok: true, value: [pin] }),
      listDaysOff: async () => ({ ok: true, value: [] })
    } as Partial<OstlerAPI>)
    renderWithPins(<HomeCountdowns today={TODAY} />)
    const region = await screen.findByRole('region', { name: 'Countdowns' })
    expect(within(region).getByText('40 days to Save £5,000 (29 working days)')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: /Save £5,000/ }))
    expect(screen.getByTestId('where').textContent).toBe('/goals?goal=pg1')
  })
})
