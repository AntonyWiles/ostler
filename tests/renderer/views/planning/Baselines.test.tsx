// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import type { Baseline, BaselineWithEntries } from '@shared/planning/baselines'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TimelineView } from '@renderer/views/planning/timeline/TimelineView'
import { GoalsMilestonesPanel } from '@renderer/views/planning/GoalsMilestonesPanel'
import {
  BaselinesDialog,
  SaveBaselineDialog
} from '@renderer/views/planning/baselines/BaselineDialogs'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads, renderPlanningWorkspace } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'
import { withElementSize } from '../../fixtures/layout'

const milestone: PlanningMilestone = {
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Launch',
  outcome: '',
  targetDate: '2026-10-20',
  successCriteria: [],
  status: 'planned',
  createdAt: 1,
  updatedAt: 1
}

/** Agreed on 3 October: Paint was due 3 days sooner, Tile was not planned, Launch was 16 October. */
const AGREED: BaselineWithEntries = {
  id: 'b1',
  projectId: 'p1',
  name: 'Plan agreed 3 October',
  savedAt: Date.UTC(2026, 9, 3),
  taskCount: 2,
  milestoneCount: 1,
  entries: [
    { kind: 'task', itemId: 'paint', start: '2026-10-09', due: '2026-10-12' },
    { kind: 'task', itemId: 'plaster', start: '2026-10-07', due: '2026-10-11' },
    { kind: 'milestone', itemId: 'm1', start: null, due: '2026-10-16' }
  ]
}

const summary = ({ entries: _entries, ...rest }: BaselineWithEntries): Baseline => rest

/** An in-memory baseline store behind the fake API. */
function fakeBaselines(initial: BaselineWithEntries[]) {
  let list = [...initial]
  let next = 1
  const api: Partial<OstlerAPI> = {
    listBaselines: async () => ({ ok: true, value: list.map(summary) }),
    getBaseline: async (_projectId, id) => {
      const found = list.find((entry) => entry.id === id)
      return found ? { ok: true, value: found } : { ok: false, error: 'Baseline not found' }
    },
    createBaseline: vi.fn(async (_projectId, input) => {
      if (input.replaceId) list = list.filter((entry) => entry.id !== input.replaceId)
      const made: BaselineWithEntries = {
        id: `new-${next++}`,
        projectId: 'p1',
        name: input.name,
        savedAt: Date.now(),
        taskCount: 0,
        milestoneCount: 0,
        entries: []
      }
      list = [made, ...list]
      return { ok: true as const, value: summary(made) }
    }),
    renameBaseline: async (_projectId, id, name) => {
      const before = list.find((entry) => entry.id === id)!
      list = list.map((entry) => (entry.id === id ? { ...entry, name } : entry))
      return { ok: true, value: { before: summary(before), after: summary({ ...before, name }) } }
    },
    deleteBaseline: async (_projectId, id) => {
      const found = list.find((entry) => entry.id === id)!
      list = list.filter((entry) => entry.id !== id)
      return { ok: true, value: found }
    },
    restoreBaseline: async (_projectId, baseline) => {
      list = [...list, baseline]
      return { ok: true, value: summary(baseline) }
    }
  }
  return { api, names: () => list.map((entry) => entry.name) }
}

const plan = (): PlanningWorkItem[] => [
  makeWorkItem('paint', {
    title: 'Paint',
    milestoneId: 'm1',
    startDate: '2026-10-12',
    targetDate: '2026-10-15',
    status: 'ready'
  }),
  makeWorkItem('plaster', {
    title: 'Plaster',
    milestoneId: 'm1',
    startDate: '2026-10-06',
    targetDate: '2026-10-10',
    status: 'active'
  }),
  makeWorkItem('tile', { title: 'Tile', milestoneId: 'm1', targetDate: '2026-10-18' })
]

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <TimelineView ws={ws} />
}

function renderTimeline(store = fakeBaselines([AGREED])) {
  const saved = fakeSavedViews()
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    ...store.api,
    getPlanningWorkItems: async () => ({ ok: true, value: plan() }),
    getPlanningMilestones: async () => ({ ok: true, value: [milestone] })
  })
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
  return { saved, store }
}

const bar = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title},`) })

describe('Compare with on the Timeline (N7.4)', () => {
  withElementSize(1280, 600)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('draws the baseline under the bars, says how far each moved, and remembers the choice', async () => {
    const { saved } = renderTimeline()
    await screen.findByRole('button', { name: /^Paint,/ })
    const picker = await screen.findByLabelText('Compare with')
    expect(document.querySelector('.timeline-baseline')).toBeNull()

    act(() => {
      fireEvent.change(picker, { target: { value: 'b1' } })
    })

    await waitFor(() =>
      expect(bar('Paint').getAttribute('aria-label')).toContain(
        "3 days later than 'Plan agreed 3 October'"
      )
    )
    expect(bar('Plaster').getAttribute('aria-label')).toContain(
      "1 day earlier than 'Plan agreed 3 October'"
    )
    expect(bar('Tile').getAttribute('aria-label')).toContain("New since 'Plan agreed 3 October'")
    expect(bar('Paint').querySelector('title')?.textContent).toContain('3 days later')
    // A thin hollow bar per task with baseline dates, and a hollow diamond for the milestone.
    expect(document.querySelector('[data-baseline="paint"]')?.tagName).toBe('rect')
    expect(document.querySelector('[data-baseline="tile"]')).toBeNull()
    expect(document.querySelector('[data-baseline="m1"]')?.tagName).toBe('polygon')
    expect(
      document.querySelector('[data-baseline="paint"]')?.closest('[aria-hidden="true"]')
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /^Milestone: Launch/ }).getAttribute('aria-label')
    ).toContain("4 days late against 'Plan agreed 3 October'")
    expect(screen.getByRole('status')).toHaveTextContent(
      "Against 'Plan agreed 3 October': 1 task later, 1 earlier, 1 new"
    )
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'timeline')?.config.options).toMatchObject({
        compareWith: 'b1'
      })
    )

    act(() => {
      fireEvent.change(picker, { target: { value: '' } })
    })
    await waitFor(() => expect(document.querySelector('.timeline-baseline')).toBeNull())
  })

  it('saves a baseline from the toolbar with a name suggested from today, and compares with it', async () => {
    const { store } = renderTimeline(fakeBaselines([]))
    await screen.findByRole('button', { name: /^Paint,/ })
    expect(screen.queryByLabelText('Compare with')).toBeNull()

    act(() => screen.getByRole('button', { name: 'Save a baseline' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Save a baseline' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Plan agreed 8 October')
    act(() => within(dialog).getByRole('button', { name: 'Save baseline' }).click())

    await waitFor(() =>
      expect(store.api.createBaseline).toHaveBeenCalledWith('p1', { name: 'Plan agreed 8 October' })
    )
    await waitFor(() => expect(screen.getByLabelText('Compare with')).toHaveValue('new-1'))
  })
})

describe('Save a baseline and Baselines (N7.4)', () => {
  afterEach(() => __resetDismissableStackForTests())

  const many = Array.from({ length: 10 }, (_, i) => ({
    ...AGREED,
    id: `b${i + 1}`,
    name: `Plan ${i + 1}`
  }))

  it('asks which to delete when ten are saved', async () => {
    const store = fakeBaselines(many)
    installOstlerApi(store.api)
    render(
      <ToastProvider>
        <SaveBaselineDialog projectId="p1" onClose={() => {}} />
      </ToastProvider>
    )
    const replace = await screen.findByLabelText('Delete to make room')
    act(() => screen.getByRole('button', { name: 'Save baseline' }).click())
    expect(await screen.findByText('Choose the baseline to delete.')).toBeInTheDocument()
    expect(store.api.createBaseline).not.toHaveBeenCalled()

    fireEvent.change(replace, { target: { value: 'b3' } })
    act(() => screen.getByRole('button', { name: 'Save baseline' }).click())
    await waitFor(() =>
      expect(store.api.createBaseline).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ replaceId: 'b3' })
      )
    )
    expect(store.names()).not.toContain('Plan 3')
  })

  it('says the save failed, and why, when it is refused', async () => {
    const store = fakeBaselines([])
    store.api.createBaseline = vi.fn(async () => ({
      ok: false as const,
      error: 'The disk is full.'
    }))
    installOstlerApi(store.api)
    const onClose = vi.fn()
    render(
      <ToastProvider>
        <SaveBaselineDialog projectId="p1" onClose={onClose} />
      </ToastProvider>
    )
    act(() => screen.getByRole('button', { name: 'Save baseline' }).click())
    expect(await screen.findByText("Couldn't save the baseline")).toBeInTheDocument()
    expect(screen.getByText('The disk is full.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Typing again clears it; a name that is not valid is not a failed save.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } })
    act(() => screen.getByRole('button', { name: 'Save baseline' }).click())
    expect(await screen.findByText('Give it a name of up to 80 characters.')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't save the baseline")).toBeNull()
  })

  it('lists baselines, renames one, and deletes one with undo', async () => {
    const store = fakeBaselines([AGREED, { ...AGREED, id: 'b2', name: 'First draft' }])
    installOstlerApi(store.api)
    render(
      <ToastProvider>
        <BaselinesDialog projectId="p1" onClose={() => {}} />
      </ToastProvider>
    )
    const list = await screen.findByRole('list', { name: 'Baselines' })
    await within(list).findByText('Plan agreed 3 October')
    expect(within(list).getAllByText(/2 tasks and 1 milestone/)).toHaveLength(2)

    act(() => screen.getByRole('button', { name: 'Rename First draft' }).click())
    const field = screen.getByLabelText('New name for First draft')
    fireEvent.change(field, { target: { value: 'Signed off' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await within(list).findByText('Signed off')

    act(() => screen.getByRole('button', { name: 'Delete Signed off' }).click())
    await waitFor(() => expect(store.names()).toEqual(['Plan agreed 3 October']))
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    await waitFor(() => expect(store.names()).toContain('Signed off'))
  })
})

describe('milestone cards against a baseline (N7.4)', () => {
  it('say how far each milestone moved against the newest baseline', async () => {
    const store = fakeBaselines([
      AGREED,
      {
        ...AGREED,
        id: 'old',
        name: 'Older',
        entries: [{ kind: 'milestone', itemId: 'm2', start: null, due: '2026-10-25' }]
      }
    ])
    const ws = await renderPlanningWorkspace({
      projectId: 'p1',
      api: {
        ...store.api,
        getPlanningMilestones: async () => ({
          ok: true,
          value: [milestone, { ...milestone, id: 'm2', name: 'Handover', targetDate: '2026-10-25' }]
        }),
        getPlanningWorkItems: async () => ({ ok: true, value: [] }),
        getAIMilestoneAdvisory: async () => ({ ok: true, value: null }),
        getAITaskSplitJob: async () => ({ ok: true, value: null }),
        getDefaultSavedView: async () => ({ ok: true, value: null })
      }
    })
    render(<GoalsMilestonesPanel ws={ws} />)

    expect(
      await screen.findByText("4 days late against 'Plan agreed 3 October'")
    ).toBeInTheDocument()
    // Handover was not in the newest baseline.
    expect(screen.getByText("New since 'Plan agreed 3 October'")).toBeInTheDocument()
  })
})
