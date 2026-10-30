// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type {
  CreateTimeBlockInput,
  RendererProject,
  TimeBlock,
  TimeBlocksQuery,
  UpdateTimeBlockInput
} from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { CalendarView } from '@renderer/views/planning/calendar/CalendarView'
import { BlockTimeDialog } from '@renderer/components/time-blocks/BlockTimeDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { CalendarsProvider } from '@renderer/context/CalendarsContext'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { layoutHourItems, minutesOnDay } from '@renderer/ui/hour-layout'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'

// jsdom has no PointerEvent; a MouseEvent carries the clientY a resize reads.
if (typeof window.PointerEvent === 'undefined')
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends (
    MouseEvent
  ) {}

const project = { id: 'p1', name: 'Launch', enabled: true } as RendererProject

function block(id: string, overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id,
    projectId: 'p1',
    workItemId: 'a',
    date: '2026-10-08',
    startMinute: 540,
    lengthMinutes: 90,
    createdAt: 1,
    title: 'Write the proposal',
    status: 'ready',
    ...overrides
  }
}

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <CalendarView ws={ws} />
}

function setup(blocks: TimeBlock[] = []) {
  const saved = fakeSavedViews()
  let stored = [...blocks]
  const getTimeBlocks = vi.fn(async (query: TimeBlocksQuery) => ({
    ok: true as const,
    value: stored.filter((entry) => entry.date >= query.from && entry.date <= query.to)
  }))
  const createTimeBlock = vi.fn(async (input: CreateTimeBlockInput) => {
    const made = block('new', {
      date: input.date,
      startMinute: input.startMinute,
      lengthMinutes: input.lengthMinutes ?? 60
    })
    stored = [...stored, made]
    return { ok: true as const, value: made }
  })
  const updateTimeBlock = vi.fn(async (id: string, updates: UpdateTimeBlockInput) => {
    const current = stored.find((entry) => entry.id === id)!
    const next = { ...current, ...updates }
    stored = stored.map((entry) => (entry.id === id ? next : entry))
    return { ok: true as const, value: next }
  })
  const removeTimeBlock = vi.fn(async (id: string) => {
    const current = stored.find((entry) => entry.id === id)!
    stored = stored.filter((entry) => entry.id !== id)
    return { ok: true as const, value: current }
  })
  const restoreTimeBlock = vi.fn(async (value: TimeBlock) => {
    stored = [...stored, value]
    return { ok: true as const, value }
  })
  const startTimer = vi.fn(async () => ({
    ok: true as const,
    value: {
      started: { id: 'e1', workItemId: 'a', workItemTitle: 'Write the proposal' },
      stopped: null
    } as never
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    getPlanningWorkItems: async () => ({
      ok: true,
      value: [
        makeWorkItem('a', { title: 'Write the proposal', targetDate: '2026-10-09' }),
        makeWorkItem('b', { title: 'Book venue' })
      ]
    }),
    getProjects: async () => ({ ok: true, value: [project] }),
    getTimeBlocks,
    createTimeBlock,
    updateTimeBlock,
    removeTimeBlock,
    restoreTimeBlock,
    startTimer
  })
  render(
    <MemoryRouter initialEntries={['/projects/p1/calendar']}>
      <OstlerProvider>
        <ToastProvider>
          <ConfirmProvider>
            <TimerProvider>
              <StaticFeaturesProvider value={{ agents: false, ai: false }}>
                <StaticPeopleProvider people={[]}>
                  <CalendarsProvider>
                    <Routes>
                      <Route path="*" element={<Live />} />
                    </Routes>
                  </CalendarsProvider>
                </StaticPeopleProvider>
              </StaticFeaturesProvider>
            </TimerProvider>
          </ConfirmProvider>
        </ToastProvider>
      </OstlerProvider>
    </MemoryRouter>
  )
  return {
    getTimeBlocks,
    createTimeBlock,
    updateTimeBlock,
    removeTimeBlock,
    restoreTimeBlock,
    startTimer
  }
}

const hourCell = (date: string, hour: number) =>
  document.querySelector<HTMLElement>(`[data-hours-date="${date}"] [data-hour="${hour}"]`)!

// Wait for the moved block to be re-rendered in its day's column and focused again, so the next
// key goes to the live button rather than the one about to unmount from the old column.
const focusedBlockIn = (date: string, name: RegExp) =>
  waitFor(() => {
    const column = document.querySelector<HTMLElement>(`[data-hours-date="${date}"]`)!
    const button = within(column).getByRole('button', { name })
    expect(button).toHaveFocus()
    return button
  })

function transfer(data: Record<string, string>) {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
    setData: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'all'
  }
}

async function openWeek() {
  await screen.findAllByRole('button', { name: /^Write the proposal,/ })
  act(() => screen.getByRole('radio', { name: 'Week' }).click())
  await waitFor(() => expect(hourCell('2026-10-08', 9)).toBeTruthy())
}

describe('time blocks in the Calendar (N3.4a)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('drops a task on an hour to block time there, saying so while dragging', async () => {
    const { createTimeBlock } = setup()
    await openWeek()
    const data = transfer({ 'text/plain': 'b' })
    fireEvent.dragOver(hourCell('2026-10-08', 10), { dataTransfer: data })
    expect(screen.getByText('Block time at 10:00')).toBeInTheDocument()
    fireEvent.drop(hourCell('2026-10-08', 10), { dataTransfer: data })
    await waitFor(() =>
      expect(createTimeBlock).toHaveBeenCalledWith({
        workItemId: 'b',
        date: '2026-10-08',
        startMinute: 600
      })
    )
    expect(await screen.findByText(/Blocked 10:00 to 11:00 for/)).toBeInTheDocument()
  })

  it('shows blocks at their times, named with their time, and moves one by dragging', async () => {
    const { updateTimeBlock } = setup([block('b1')])
    await openWeek()
    const button = await screen.findByRole('button', {
      name: 'Write the proposal, 09:00 to 10:30, passed'
    })
    const item = button.closest<HTMLElement>('[data-block-id]')!
    expect(item.closest('[data-hours-date]')).toHaveAttribute('data-hours-date', '2026-10-08')
    const data = transfer({ 'application/x-ostler-time-block': 'b1' })
    fireEvent.dragStart(item, { dataTransfer: data })
    fireEvent.dragOver(hourCell('2026-10-09', 13), { dataTransfer: data })
    expect(screen.getByText('Move to 13:00')).toBeInTheDocument()
    fireEvent.drop(hourCell('2026-10-09', 13), { dataTransfer: data })
    await waitFor(() =>
      expect(updateTimeBlock).toHaveBeenCalledWith('b1', { date: '2026-10-09', startMinute: 780 })
    )
  })

  it('resizes a block from its bottom edge', async () => {
    const { updateTimeBlock } = setup([block('b1')])
    await openWeek()
    const button = await screen.findByRole('button', { name: /^Write the proposal, 09:00/ })
    const handle = button.parentElement!.querySelector<HTMLElement>('.time-block__resize')!
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientY: 130, pointerId: 1 })
    await waitFor(() => expect(updateTimeBlock).toHaveBeenCalledWith('b1', { lengthMinutes: 120 }))
  })

  it('moves a focused block a quarter hour with the arrows and a day with Shift', async () => {
    const { updateTimeBlock } = setup([block('b1')])
    await openWeek()
    const button = await screen.findByRole('button', { name: /^Write the proposal, 09:00/ })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    await waitFor(() =>
      expect(updateTimeBlock).toHaveBeenCalledWith('b1', { date: '2026-10-08', startMinute: 555 })
    )
    const moved = await focusedBlockIn('2026-10-08', /^Write the proposal, 09:15/)
    fireEvent.keyDown(moved, { key: 'ArrowRight', shiftKey: true })
    await waitFor(() =>
      expect(updateTimeBlock).toHaveBeenCalledWith('b1', { date: '2026-10-09', startMinute: 555 })
    )
    const later = await focusedBlockIn('2026-10-09', /^Write the proposal, 09:15/)
    fireEvent.keyDown(later, { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(updateTimeBlock).toHaveBeenCalledWith('b1', { lengthMinutes: 105 }))
  })

  it("the card starts the task's timer and removes the block with undo", async () => {
    const { startTimer, removeTimeBlock, restoreTimeBlock } = setup([block('b1')])
    await openWeek()
    act(() => screen.getByRole('button', { name: /^Write the proposal, 09:00/ }).click())
    const card = await screen.findByRole('dialog', { name: 'Write the proposal' })
    expect(within(card).getByText('Launch')).toBeInTheDocument()
    expect(within(card).getByText(/09:00 to 10:30/)).toBeInTheDocument()
    act(() => within(card).getByRole('button', { name: 'Start' }).click())
    await waitFor(() => expect(startTimer).toHaveBeenCalledWith('p1', 'a'))

    act(() => screen.getByRole('button', { name: /^Write the proposal, 09:00/ }).click())
    const again = await screen.findByRole('dialog', { name: 'Write the proposal' })
    act(() => within(again).getByRole('button', { name: 'Remove' }).click())
    await waitFor(() => expect(removeTimeBlock).toHaveBeenCalledWith('b1'))
    const toast = await screen.findByText('Removed the time block for Write the proposal')
    const undo = within(toast.closest('[role="status"], [role="alert"], li, div')!.parentElement!)
      .getAllByRole('button')
      .find((candidate) => /undo/i.test(candidate.textContent ?? ''))!
    act(() => undo.click())
    await waitFor(() => expect(restoreTimeBlock).toHaveBeenCalledWith(block('b1')))
  })

  it("shows a task's blocks as times beside it in Month and Agenda", async () => {
    setup([block('b1')])
    const chip = await screen.findByRole('button', {
      name: 'Write the proposal, 09:00 to 10:30, passed'
    })
    expect(chip.textContent).toBe('09:00Write the proposal')
    act(() => screen.getByRole('radio', { name: 'Agenda' }).click())
    expect(
      await screen.findByRole('button', { name: 'Write the proposal, 09:00 to 10:30, passed' })
    ).toBeInTheDocument()
  })
})

describe('Block time… (N3.4a)', () => {
  afterEach(() => __resetDismissableStackForTests())

  it('blocks time by keyboard: a date, a start and the estimate as the length', async () => {
    installOstlerApi({ getDaysOff: async () => ({ ok: true, value: [] }) })
    const onCreate = vi.fn(async () => true)
    const onClose = vi.fn()
    render(
      <BlockTimeDialog
        item={makeWorkItem('a', { title: 'Write the proposal', estimate: 1.5 })}
        estimateUnit="hours"
        initial={{ date: '2026-10-08' }}
        onClose={onClose}
        onCreate={onCreate}
      />
    )
    const start = screen.getByLabelText('Start')
    fireEvent.change(start, { target: { value: '14:30' } })
    expect(screen.getByRole('combobox', { name: 'Length' })).toHaveValue('90')
    fireEvent.submit(start.closest('form')!)
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        date: '2026-10-08',
        startMinute: 870,
        lengthMinutes: 90
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('refuses a start off the quarter hour', () => {
    installOstlerApi({ getDaysOff: async () => ({ ok: true, value: [] }) })
    render(
      <BlockTimeDialog
        item={makeWorkItem('a', { title: 'Write the proposal' })}
        estimateUnit="points"
        onClose={() => {}}
        onCreate={async () => true}
      />
    )
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '09:10' } })
    expect(screen.getByText('Blocks start on the quarter hour.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Length' })).toHaveValue('60')
    expect(screen.getByRole('button', { name: 'Block time' })).toBeDisabled()
  })
})

describe('the hour layout (N3.4a)', () => {
  it('puts overlapping items side by side and leaves the rest full width', () => {
    const places = layoutHourItems([
      { id: 'a', start: 540, end: 630 },
      { id: 'b', start: 600, end: 660 },
      { id: 'c', start: 615, end: 630 },
      { id: 'd', start: 720, end: 780 }
    ])
    const byId = Object.fromEntries(places.map((place) => [place.item.id, place]))
    expect([byId.a.column, byId.b.column, byId.c.column]).toEqual([0, 1, 2])
    expect(byId.a.columns).toBe(3)
    expect(byId.d).toMatchObject({ column: 0, columns: 1 })
  })

  it('reuses a column once it is free, events and blocks alike', () => {
    const places = layoutHourItems([
      { id: 'event', start: 540, end: 600 },
      { id: 'block', start: 540, end: 660 },
      { id: 'later', start: 600, end: 630 }
    ])
    const byId = Object.fromEntries(places.map((place) => [place.item.id, place]))
    expect(byId.block.column).toBe(0)
    expect(byId.event.column).toBe(1)
    expect(byId.later.column).toBe(1)
    expect(byId.later.columns).toBe(2)
  })

  it('cuts a timed event at midnight on each day it covers', () => {
    const late = {
      startDate: '2026-10-08',
      endDate: '2026-10-09',
      startTime: '23:00',
      endTime: '01:00'
    }
    expect(minutesOnDay('2026-10-08', late)).toEqual({ start: 1380, end: 1440 })
    expect(minutesOnDay('2026-10-09', late)).toEqual({ start: 0, end: 60 })
    expect(minutesOnDay('2026-10-10', late)).toBeNull()
    expect(minutesOnDay('2026-10-08', { ...late, startTime: null })).toBeNull()
  })
})
