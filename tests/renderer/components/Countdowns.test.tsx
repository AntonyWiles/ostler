// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreatePinInput,
  OstlerAPI,
  Person,
  PinView,
  RendererProject,
  SetPinCountdownInput
} from '@shared/ostler-api'
import { PinsProvider } from '@renderer/pins/PinsProvider'
import { PinnedSection } from '@renderer/pins/PinnedSection'
import { HomeCountdowns } from '@renderer/views/home/HomeCountdowns'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const P1 = 'p1'
/** A fixed today, a Monday: no test reads the real date. */
const TODAY = '2026-03-02'

const projects: RendererProject[] = [
  {
    id: P1,
    name: 'Shop',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    areaId: null,
    icon: null
  } as RendererProject
]

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects, areas: [], refreshProjects: async () => {} })
}))

function pinView(overrides: Partial<PinView>): PinView {
  return {
    id: 'pin-1',
    place: 'sidebar',
    projectId: P1,
    kind: 'milestone',
    targetId: 'm1',
    orderKey: 'V',
    createdAt: new Date(2026, 1, 20, 9).getTime(),
    countdown: false,
    exists: true,
    title: 'Launch',
    archived: false,
    date: '2026-03-14',
    done: false,
    countdownText: null,
    ...overrides
  }
}

/** A fake pin store behind the API, as main keeps it, with its countdowns. */
function countdownApi(initial: PinView[]) {
  let pins = [...initial]
  const api = {
    listPins: vi.fn(async (query: { place: string }) => ({
      ok: true as const,
      value: pins.filter((pin) => pin.place === query.place)
    })),
    listCountdowns: vi.fn(async () => ({
      ok: true as const,
      value: pins.filter((pin) => pin.countdown)
    })),
    createPin: vi.fn(async (input: CreatePinInput) => {
      const made = pinView({ id: 'made', place: input.place, targetId: input.targetId })
      pins = [...pins, made]
      return { ok: true as const, value: made }
    }),
    setPinCountdown: vi.fn(async (pinId: string, input: SetPinCountdownInput) => {
      pins = pins.map((pin) =>
        pin.id === pinId
          ? { ...pin, countdown: input.countdown }
          : pin.id === input.replacePinId
            ? { ...pin, countdown: false }
            : pin
      )
      return { ok: true as const, value: pins.find((pin) => pin.id === pinId)! }
    })
  }
  return api
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

describe('Show as countdown (N5.2b)', () => {
  beforeEach(() => window.localStorage.clear())
  Element.prototype.scrollIntoView = vi.fn()

  it('turns a pinned milestone into a countdown from its pin menu, and back', async () => {
    const api = countdownApi([pinView({})])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    const region = await screen.findByRole('region', { name: 'Pinned' })
    fireEvent.contextMenu(within(region).getByRole('button', { name: 'Launch, Shop' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show as countdown' }))
    await waitFor(() =>
      expect(api.setPinCountdown).toHaveBeenCalledWith('pin-1', { countdown: true })
    )
    await waitFor(() => expect(api.listCountdowns).toHaveBeenCalledTimes(2))

    fireEvent.contextMenu(within(region).getByRole('button', { name: 'Launch, Shop' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop the countdown' }))
    await waitFor(() =>
      expect(api.setPinCountdown).toHaveBeenLastCalledWith('pin-1', { countdown: false })
    )
  })

  it('offers no countdown for an undated pin', async () => {
    const api = countdownApi([pinView({ date: null })])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    const region = await screen.findByRole('region', { name: 'Pinned' })
    fireEvent.contextMenu(within(region).getByRole('button', { name: 'Launch, Shop' }))
    await screen.findByRole('menuitem', { name: 'Unpin' })
    expect(screen.queryByRole('menuitem', { name: 'Show as countdown' })).toBeNull()
  })

  it('asks which countdown to turn off before a fourth', async () => {
    const api = countdownApi([
      pinView({ id: 'a', targetId: 'ma', title: 'Move', countdown: true }),
      pinView({ id: 'b', targetId: 'mb', title: 'Exam', countdown: true }),
      pinView({ id: 'c', targetId: 'mc', title: 'Wedding', countdown: true }),
      pinView({ id: 'd', targetId: 'md', title: 'Launch' })
    ])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<PinnedSection projects={projects} collapsed={false} />)
    const region = await screen.findByRole('region', { name: 'Pinned' })
    await waitFor(() => expect(api.listCountdowns).toHaveBeenCalled())
    fireEvent.contextMenu(within(region).getByRole('button', { name: 'Launch, Shop' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show as countdown' }))

    const dialog = await screen.findByRole('dialog', { name: 'Turn off a countdown?' })
    expect(api.setPinCountdown).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn off Exam' }))
    await waitFor(() =>
      expect(api.setPinCountdown).toHaveBeenCalledWith('d', { countdown: true, replacePinId: 'b' })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe("Home's countdown cards (N5.2b)", () => {
  it('shows each countdown in words with its date and bar, and opens its item', async () => {
    const api = countdownApi([
      pinView({ countdown: true }),
      pinView({
        id: 'task',
        kind: 'task',
        targetId: 't1',
        title: 'Exam',
        date: '2026-03-03',
        countdown: true
      })
    ])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<HomeCountdowns today={TODAY} />)
    const region = await screen.findByRole('region', { name: 'Countdowns' })
    const cards = within(region).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('12 days to Launch (9 working days)')).toBeTruthy()
    expect(within(cards[1]).getByText('Exam is tomorrow')).toBeTruthy()
    const bar = within(cards[0]).getByRole('progressbar', {
      name: 'Time passed since it was pinned'
    })
    // Pinned 20 February, due 14 March: 10 of 22 days have passed.
    expect(bar.getAttribute('aria-valuenow')).toBe('45')

    fireEvent.click(
      within(cards[0]).getByRole('button', { name: /^Open Launch, 12 days to Launch/ })
    )
    expect(screen.getByTestId('where').textContent).toContain('m1')
  })

  it("counts Me's own working days, as the tray and the automation API do", async () => {
    const api = countdownApi([pinView({ countdown: true })])
    installOstlerApi(api as Partial<OstlerAPI>)
    const me: Person = {
      id: 'me',
      name: 'Ana',
      initials: 'A',
      color: '#3b82f6',
      isMe: true,
      archivedAt: null,
      weeklyCapacityHours: null,
      // A four-day week: Fridays are not working days.
      workingDays: [1, 2, 3, 4],
      projectId: null,
      createdAt: 0,
      updatedAt: 0
    }
    renderWithPins(
      <StaticPeopleProvider people={[me]}>
        <HomeCountdowns today={TODAY} />
      </StaticPeopleProvider>
    )
    const region = await screen.findByRole('region', { name: 'Countdowns' })
    expect(within(region).getByText('12 days to Launch (7 working days)')).toBeTruthy()
  })

  it('says done and offers to turn off the countdown of a done item', async () => {
    const api = countdownApi([pinView({ countdown: true, done: true })])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<HomeCountdowns today={TODAY} />)
    const region = await screen.findByRole('region', { name: 'Countdowns' })
    expect(within(region).getByText('Launch: done')).toBeTruthy()
    fireEvent.click(
      within(region).getByRole('button', { name: 'Turn off the countdown for Launch' })
    )
    await waitFor(() =>
      expect(api.setPinCountdown).toHaveBeenCalledWith('pin-1', { countdown: false })
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Countdowns' })).toBeNull())
  })

  it('shows nothing without countdowns', async () => {
    const api = countdownApi([pinView({})])
    installOstlerApi(api as Partial<OstlerAPI>)
    renderWithPins(<HomeCountdowns today={TODAY} />)
    await waitFor(() => expect(api.listCountdowns).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Countdowns' })).toBeNull()
  })
})
