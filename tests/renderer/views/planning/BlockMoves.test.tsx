// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BlockMovePlan,
  FillDayPlan,
  MyDayTask,
  RendererProject,
  TimeBlock,
  TimeBlocksQuery
} from '@shared/ostler-api'
import { BlockCard } from '@renderer/components/time-blocks/BlockCard'
import { useBlockMoveActions } from '@renderer/components/time-blocks/BlockMoves'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { MyDaySection } from '@renderer/views/home/MyDaySection'
import { WeekHours } from '@renderer/views/planning/calendar/WeekHours'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

// Friday 16 October 2026, 11:00: a 09:00 block today has passed.
const TODAY = '2026-10-16'
const project = { id: 'web', name: 'Website', enabled: true } as RendererProject

const block = (id: string, extra: Partial<TimeBlock> = {}): TimeBlock => ({
  id,
  projectId: 'web',
  workItemId: 'a',
  date: TODAY,
  startMinute: 540,
  lengthMinutes: 60,
  createdAt: 1,
  title: 'Write the proposal',
  status: 'ready',
  ...extra
})

const task = (id: string, title: string, extra: Partial<MyDayTask> = {}): MyDayTask => ({
  id,
  projectId: 'web',
  projectName: 'Website',
  projectColor: '#3b82f6',
  title,
  status: 'ready',
  priority: 'medium',
  targetDate: null,
  assigneeId: null,
  linked: false,
  estimate: null,
  estimateUnit: 'hours',
  ...extra
})

const movePlan: BlockMovePlan = {
  now: { date: TODAY, minute: 660 },
  moves: [
    {
      blockId: 'b1',
      projectId: 'web',
      workItemId: 'a',
      title: 'Write the proposal',
      from: { date: TODAY, startMinute: 540, lengthMinutes: 60 },
      to: { date: TODAY, startMinute: 780, lengthMinutes: 60 }
    }
  ]
}

function undoIn(text: string) {
  const toast = screen.getByText(text)
  return within(toast.closest('[role="status"], [role="alert"], li, div')!.parentElement!)
    .getAllByRole('button')
    .find((candidate) => /undo/i.test(candidate.textContent ?? ''))!
}

function moveApi() {
  const previewBlockMoves = vi.fn(async () => ({ ok: true as const, value: movePlan }))
  const applyBlockMoves = vi.fn(async () => ({
    ok: true as const,
    value: {
      applied: true,
      blocks: [block('b1', { startMinute: 780 })],
      previous: [{ blockId: 'b1', date: TODAY, startMinute: 540, lengthMinutes: 60 }],
      plan: null
    }
  }))
  const updateTimeBlock = vi.fn(async () => ({ ok: true as const, value: block('b1') }))
  return { previewBlockMoves, applyBlockMoves, updateTimeBlock }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 11) })
})
afterEach(() => vi.useRealTimers())

function CardHost({ value }: { value: TimeBlock }) {
  const actions = useBlockMoveActions()
  return (
    <BlockCard
      block={value}
      anchor={document.body}
      onClose={() => {}}
      onOpenTask={() => {}}
      onRemove={() => {}}
      onMoveToFree={(target) => void actions.moveOne(target)}
    />
  )
}

describe('a passed block (N3.4b)', () => {
  it('says it passed and moves to the next free time in one click, with undo', async () => {
    const api = moveApi()
    installOstlerApi({ getProjects: async () => ({ ok: true, value: [project] }), ...api })
    render(
      <MemoryRouter>
        <OstlerProvider>
          <ToastProvider>
            <TimerProvider>
              <CardHost value={block('b1')} />
            </TimerProvider>
          </ToastProvider>
        </OstlerProvider>
      </MemoryRouter>
    )
    const card = await screen.findByRole('dialog', { name: 'Write the proposal' })
    expect(within(card).getByText('Passed with its task unfinished')).toBeInTheDocument()
    act(() => within(card).getByRole('button', { name: 'Move to the next free time' }).click())
    await waitFor(() => expect(api.applyBlockMoves).toHaveBeenCalledWith(movePlan))
    expect(api.previewBlockMoves).toHaveBeenCalledWith(['b1'])
    await screen.findByText(/^Moved Write the proposal to/)
    act(() => undoIn(screen.getByText(/^Moved Write the proposal to/).textContent!).click())
    await waitFor(() =>
      expect(api.updateTimeBlock).toHaveBeenCalledWith('b1', {
        date: TODAY,
        startMinute: 540,
        lengthMinutes: 60
      })
    )
  })

  it('offers no move while the block is still to come or its task is done', async () => {
    installOstlerApi({ getProjects: async () => ({ ok: true, value: [project] }) })
    render(
      <MemoryRouter>
        <OstlerProvider>
          <ToastProvider>
            <TimerProvider>
              <CardHost value={block('b2', { startMinute: 900 })} />
            </TimerProvider>
          </ToastProvider>
        </OstlerProvider>
      </MemoryRouter>
    )
    const card = await screen.findByRole('dialog', { name: 'Write the proposal' })
    expect(
      within(card).queryByRole('button', { name: 'Move to the next free time' })
    ).not.toBeInTheDocument()
  })
})

function renderMyDay(tasks: MyDayTask[]) {
  render(
    <ToastProvider>
      <MemoryRouter>
        <MyDaySection tasks={tasks} today={TODAY} onChanged={() => {}} />
      </MemoryRouter>
    </ToastProvider>
  )
}

describe("Home's passed blocks (N3.4b)", () => {
  it('counts them, shows where each would go, and moves them only on Move them', async () => {
    const api = moveApi()
    installOstlerApi({
      getTimeBlocks: async (query: TimeBlocksQuery) => ({
        ok: true,
        value:
          query.from === TODAY ? [block('b1')] : [block('b1'), block('old', { date: '2026-10-14' })]
      }),
      ...api
    })
    renderMyDay([task('a', 'Write the proposal', { status: 'done' })])
    expect(
      await screen.findByText('2 blocks passed with their tasks unfinished')
    ).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Move them' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Move passed blocks' })
    const list = await within(dialog).findByRole('list', { name: 'Where each task would go' })
    expect(
      within(list).getByText(/^Write the proposal: .* to .*13:00 to 14:00/)
    ).toBeInTheDocument()
    expect(api.previewBlockMoves).toHaveBeenCalledWith(['b1', 'old'])
    expect(api.applyBlockMoves).not.toHaveBeenCalled()
    act(() => within(dialog).getByRole('button', { name: 'Move them' }).click())
    await waitFor(() => expect(api.applyBlockMoves).toHaveBeenCalledWith(movePlan))
  })
})

const fillPlan: FillDayPlan = {
  date: TODAY,
  now: { date: TODAY, minute: 660 },
  closed: null,
  pieces: [
    {
      projectId: 'web',
      workItemId: 'a',
      title: 'First',
      date: TODAY,
      startMinute: 660,
      lengthMinutes: 60,
      part: 1,
      parts: 1
    },
    {
      projectId: 'web',
      workItemId: 'b',
      title: 'Second',
      date: TODAY,
      startMinute: 720,
      lengthMinutes: 30,
      part: 1,
      parts: 2
    },
    {
      projectId: 'web',
      workItemId: 'b',
      title: 'Second',
      date: TODAY,
      startMinute: 840,
      lengthMinutes: 30,
      part: 2,
      parts: 2
    }
  ],
  notPlaced: [{ projectId: 'web', workItemId: 'c', title: 'Huge', minutes: 600 }],
  alreadyBlocked: []
}

describe('Fill my day (N3.4b)', () => {
  const tasks = [task('a', 'First'), task('b', 'Second'), task('c', 'Huge')]

  it('previews the day, places them in one call, and one undo removes them all', async () => {
    const previewFillDay = vi.fn(async () => ({ ok: true as const, value: fillPlan }))
    const made = [block('n1'), block('n2'), block('n3')]
    const applyFillDay = vi.fn(async () => ({
      ok: true as const,
      value: { applied: true, blocks: made, previous: [], plan: null }
    }))
    const removeTimeBlocks = vi.fn(async () => ({ ok: true as const, value: made }))
    installOstlerApi({ previewFillDay, applyFillDay, removeTimeBlocks })
    renderMyDay(tasks)
    act(() => screen.getByRole('button', { name: 'Fill my day' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Fill my day' })
    const list = await within(dialog).findByRole('list', { name: 'Where each task would go' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'First: 11:00 to 12:00',
      'Second: 12:00 to 12:30, split in two',
      'Second: 14:00 to 14:30, split in two',
      'Huge: did not fit'
    ])
    expect(previewFillDay).toHaveBeenCalledWith(TODAY)
    expect(applyFillDay).not.toHaveBeenCalled()

    act(() => within(dialog).getByRole('button', { name: 'Place them' }).click())
    await waitFor(() => expect(applyFillDay).toHaveBeenCalledWith(fillPlan))
    await screen.findByText('Placed 3 blocks')
    act(() => undoIn('Placed 3 blocks').click())
    await waitFor(() => expect(removeTimeBlocks).toHaveBeenCalledWith(['n1', 'n2', 'n3']))
    expect(removeTimeBlocks).toHaveBeenCalledTimes(1)
  })

  it('says so on a day off and places nothing', async () => {
    const previewFillDay = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...fillPlan,
        closed: { kind: 'dayOff' as const, name: 'Bank holiday' },
        pieces: [],
        notPlaced: []
      }
    }))
    installOstlerApi({ previewFillDay })
    renderMyDay(tasks)
    act(() => screen.getByRole('button', { name: 'Fill my day' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Fill my day' })
    expect(
      await within(dialog).findByText('Today is a day off (Bank holiday), so nothing is placed.')
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Place them' })).toBeDisabled()
  })

  it('shows the plan worked out again when time moved on', async () => {
    const later = { ...fillPlan, now: { date: TODAY, minute: 700 }, pieces: [fillPlan.pieces[0]] }
    installOstlerApi({
      previewFillDay: async () => ({ ok: true, value: fillPlan }),
      applyFillDay: async () => ({
        ok: true,
        value: { applied: false, blocks: [], previous: [], plan: later }
      })
    })
    renderMyDay(tasks)
    act(() => screen.getByRole('button', { name: 'Fill my day' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Fill my day' })
    await within(dialog).findByText('Second: 12:00 to 12:30, split in two')
    act(() => within(dialog).getByRole('button', { name: 'Place them' }).click())
    expect(await within(dialog).findByText(/Time moved on/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/^Second/)).not.toBeInTheDocument()
  })

  it("draws the preview's blocks faintly on the Week's hours", () => {
    installOstlerApi({})
    render(
      <TimerProvider>
        <WeekHours
          days={[TODAY]}
          today={TODAY}
          workingHours={{ start: 540, end: 1020 }}
          blocks={[block('b1')]}
          events={[]}
          renderEvent={() => null}
          onDropTask={() => {}}
          onMoveBlock={() => {}}
          onResizeBlock={() => {}}
          onOpenBlock={() => {}}
          ghosts={fillPlan.pieces}
        />
      </TimerProvider>
    )
    const ghosts = document.querySelectorAll('.week-hours__ghost')
    expect(ghosts).toHaveLength(3)
    expect(ghosts[0].getAttribute('aria-hidden')).toBe('true')
    expect(ghosts[0].textContent).toBe('11:00 to 12:00First')
    // The passed block is quieter and says so.
    expect(
      screen.getByRole('button', { name: 'Write the proposal, 09:00 to 10:00, passed' })
    ).toBeInTheDocument()
  })
})
