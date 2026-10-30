// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type {
  CalendarEventsQuery,
  CalendarOccurrence,
  OutsideCalendar,
  RendererProject
} from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { CalendarView } from '@renderer/views/planning/calendar/CalendarView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { CalendarsProvider } from '@renderer/context/CalendarsContext'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { takePendingEventTask, taskFromEvent } from '@renderer/hooks/event-task'
import { TodayEvents, todaySummary } from '@renderer/components/calendar-events/TodayEvents'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'

const work: OutsideCalendar = {
  id: 'work',
  name: 'Work',
  color: '#8b5cf6',
  kind: 'file',
  path: 'C:\\cal\\work.ics',
  hidden: false,
  loadedAt: 0,
  readCount: 2,
  skippedCount: 0,
  shownOnceCount: 0,
  createdAt: 0,
  updatedAt: 0
}

function occurrence(
  id: string,
  date: string,
  overrides: Partial<CalendarOccurrence> = {}
): CalendarOccurrence {
  return {
    id,
    eventId: id,
    calendarId: 'work',
    title: 'Stand-up',
    location: '',
    description: '',
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: '09:30',
    endTime: '09:45',
    start: Date.parse(`${date}T09:30:00Z`),
    end: Date.parse(`${date}T09:45:00Z`),
    ...overrides
  }
}

const EVENTS = [
  occurrence('s1', '2026-10-08'),
  occurrence('r1', '2026-10-09', {
    title: 'Design review',
    startTime: '14:00',
    endTime: '15:00',
    location: 'Room 4',
    description: '<b>Bring</b> the plan\nand notes'
  })
]

const project = { id: 'p1', name: 'Launch', enabled: true } as RendererProject

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <CalendarView ws={ws} />
}

function setup(events = EVENTS) {
  const saved = fakeSavedViews()
  const getCalendarEvents = vi.fn(async (query: CalendarEventsQuery) => ({
    ok: true as const,
    value: events.filter((event) => event.endDate >= query.from && event.startDate <= query.to)
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    getPlanningWorkItems: async () => ({
      ok: true,
      value: [makeWorkItem('a', { title: 'Book venue', targetDate: '2026-10-08' })]
    }),
    getProjects: async () => ({ ok: true, value: [project] }),
    getOutsideCalendars: async () => ({ ok: true, value: [work] }),
    getCalendarEvents
  })
  render(
    <MemoryRouter initialEntries={['/projects/p1/calendar']}>
      <OstlerProvider>
        <ToastProvider>
          <ConfirmProvider>
            <StaticFeaturesProvider value={{ agents: false, ai: false }}>
              <StaticPeopleProvider people={[]}>
                <CalendarsProvider>
                  <Routes>
                    <Route path="*" element={<Live />} />
                  </Routes>
                  <Where />
                </CalendarsProvider>
              </StaticPeopleProvider>
            </StaticFeaturesProvider>
          </ConfirmProvider>
        </ToastProvider>
      </OstlerProvider>
    </MemoryRouter>
  )
  return { saved, getCalendarEvents }
}

const day = (date: string) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)!
const eventButton = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title}, event,`) })

describe('outside calendar events in the Calendar (N3.3a)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('shows events in Month, quieter than tasks, time first, and never draggable', async () => {
    const { getCalendarEvents } = setup()
    await screen.findByRole('button', { name: /^Stand-up, event,/ })
    const standup = eventButton('Stand-up')
    expect(day('2026-10-08')).toContainElement(standup)
    expect(standup).toHaveClass('calendar-event')
    expect(standup.textContent).toBe('09:30Stand-up')
    expect(standup.closest('[data-item-id]')).toHaveAttribute('draggable', 'false')
    expect(
      screen.getByRole('button', { name: /^Book venue,/ }).closest('[data-item-id]')
    ).toHaveAttribute('draggable', 'true')
    // Only the range on screen is asked for: the month's weeks.
    const query = getCalendarEvents.mock.calls.at(-1)![0]
    expect(query.from <= '2026-10-01' && query.to >= '2026-10-31').toBe(true)
  })

  it('the switch hides them and is saved with the view; Week and Agenda show them, Year does not', async () => {
    const { saved } = setup()
    await screen.findByRole('button', { name: /^Stand-up, event,/ })
    act(() => screen.getByRole('switch', { name: 'Show my calendars' }).click())
    expect(screen.queryByRole('button', { name: /, event,/ })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'calendar')?.config.options).toMatchObject({
        showCalendars: false
      })
    )
    act(() => screen.getByRole('switch', { name: 'Show my calendars' }).click())

    act(() => screen.getByRole('radio', { name: 'Week' }).click())
    await waitFor(() => expect(eventButton('Stand-up')).toBeInTheDocument())

    act(() => screen.getByRole('radio', { name: 'Agenda' }).click())
    await waitFor(() => expect(eventButton('Design review')).toBeInTheDocument())

    act(() => screen.getByRole('radio', { name: 'Year' }).click())
    expect(screen.queryByRole('button', { name: /, event,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Show my calendars' })).not.toBeInTheDocument()
  })

  it('opens a read-only card and makes a task from the event in a project the person picks', async () => {
    setup()
    await screen.findByRole('button', { name: /^Design review, event,/ })
    act(() => eventButton('Design review').click())
    const card = await screen.findByRole('dialog', { name: 'Design review' })
    expect(within(card).getByText(/14:00 – 15:00/)).toBeInTheDocument()
    expect(within(card).getByText('Where: Room 4')).toBeInTheDocument()
    // The description is text, never HTML.
    expect(within(card).getByText(/<b>Bring<\/b> the plan/)).toBeInTheDocument()
    expect(card.querySelector('b')).toBeNull()
    expect(within(card).getByText('From Work')).toBeInTheDocument()

    act(() => within(card).getByRole('button', { name: 'Make a task' }).click())
    await waitFor(() =>
      expect(within(card).getByRole('combobox', { name: 'Project' })).toHaveValue('p1')
    )
    act(() => within(card).getByRole('button', { name: 'Continue' }).click())
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?newTask=1')
    expect(takePendingEventTask()).toEqual({
      title: 'Design review',
      targetDate: '2026-10-09',
      description: 'From a calendar event, 14:00 – 15:00.\nWhere: Room 4'
    })
    expect(takePendingEventTask()).toBeNull()
  })

  it('offers Join for an online meeting, and opens only its link', async () => {
    setup([
      occurrence('m1', '2026-10-09', {
        title: 'Weekly sync',
        description: 'Agenda first.\nhttps://teams.microsoft.com/l/meetup-join/abc123'
      }),
      occurrence('n1', '2026-10-10', { title: 'Lunch', description: 'https://example.com/menu' })
    ])
    const openExternalLink = vi.fn(async () => ({ ok: true as const, value: undefined }))
    window.ostlerAPI.openExternalLink = openExternalLink
    await screen.findByRole('button', { name: /^Weekly sync, event,/ })
    act(() => eventButton('Weekly sync').click())
    const card = await screen.findByRole('dialog', { name: 'Weekly sync' })
    act(() => within(card).getByRole('button', { name: 'Join Weekly sync online' }).click())
    expect(openExternalLink).toHaveBeenCalledWith(
      'https://teams.microsoft.com/l/meetup-join/abc123'
    )
    act(() => eventButton('Lunch').click())
    const lunch = await screen.findByRole('dialog', { name: 'Lunch' })
    expect(within(lunch).queryByRole('button', { name: /^Join/ })).toBeNull()
  })
})

describe('Home’s strip of today’s events (N3.3a)', () => {
  it('summarises today: the count and what is next', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    const morning = occurrence('m', '2026-10-08')
    const afternoon = occurrence('a', '2026-10-08', {
      title: 'Design review',
      startTime: '14:00',
      start: Date.parse('2026-10-08T14:00:00Z'),
      end: Date.parse('2026-10-08T15:00:00Z')
    })
    expect(todaySummary([], now)).toBe('No events today')
    expect(todaySummary([morning, afternoon], now)).toBe(
      '2 events today; next: 14:00 Design review'
    )
    expect(todaySummary([morning], now)).toBe('1 event today; all over for today')
    expect(
      todaySummary([occurrence('d', '2026-10-08', { allDay: true, startTime: null })], now)
    ).toBe('1 event today')
  })

  it('lists today’s events in a quiet strip, and nothing before a calendar is added', async () => {
    installOstlerApi({
      getOutsideCalendars: async () => ({ ok: true, value: [work] }),
      getCalendarEvents: async () => ({ ok: true, value: [EVENTS[0]] })
    })
    render(
      <MemoryRouter>
        <CalendarsProvider>
          <TodayEvents today="2026-10-08" />
        </CalendarsProvider>
      </MemoryRouter>
    )
    const strip = await screen.findByRole('group', { name: "Today's events" })
    await waitFor(() => expect(within(strip).getByText(/^1 event today/)).toBeInTheDocument())
    expect(within(strip).getByRole('button', { name: /^Stand-up, event,/ })).toBeInTheDocument()
  })

  it('shows nothing without calendars', async () => {
    installOstlerApi({ getOutsideCalendars: async () => ({ ok: true, value: [] }) })
    const { container } = render(
      <MemoryRouter>
        <CalendarsProvider>
          <TodayEvents today="2026-10-08" />
        </CalendarsProvider>
      </MemoryRouter>
    )
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('an all-day event makes a task with no time', () => {
    expect(
      taskFromEvent(occurrence('d', '2026-10-12', { allDay: true, startTime: null, title: 'Away' }))
    ).toEqual({
      title: 'Away',
      targetDate: '2026-10-12',
      description: 'From a calendar event, all day.'
    })
  })
})
