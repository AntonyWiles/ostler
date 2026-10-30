// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeeklyReview, WeeklyReviewTask } from '@shared/ostler-api'
import { WeeklyReviewView } from '@renderer/views/weekly-review/WeeklyReviewView'
import { REVIEW_PROGRESS_KEY } from '@renderer/views/weekly-review/review-progress'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({
    projects: [{ id: 'p1', name: 'Website', color: '#3b82f6', enabled: true }],
    loading: false
  })
}))

const task = (id: string, title: string, extra: Partial<WeeklyReviewTask> = {}) =>
  ({
    id,
    projectId: 'p1',
    projectName: 'Website',
    projectColor: '#3b82f6',
    title,
    status: 'ready',
    priority: 'medium',
    targetDate: null,
    assigneeId: null,
    linked: false,
    since: Date.now() - 20 * 86_400_000,
    ...extra
  }) satisfies WeeklyReviewTask

function review(extra: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    today: '2026-10-16',
    inboxCount: 2,
    overdue: [task('a', 'Pay invoice', { targetDate: '2026-10-10' })],
    blocked: [],
    stale: [task('b', 'Old idea')],
    someday: [task('c', 'Learn the banjo')],
    upcoming: [],
    milestones: [],
    ...extra
  }
}

function setup() {
  let current = review()
  const api = {
    getWeeklyReview: vi.fn(async () => ({ ok: true as const, value: current })),
    updatePlanningWorkItem: vi.fn(async (id: string, input: { someday?: boolean }) => {
      // Moving "Old idea" to Someday takes it off the stale step; undo brings it back.
      if (id === 'b') current = review(input.someday ? { stale: [] } : {})
      return { ok: true as const, value: {} as never }
    }),
    finishWeeklyReview: vi.fn(async (steps: unknown) => ({
      ok: true as const,
      value: { id: 'r1', finishedAt: Date.now(), steps: steps as never }
    }))
  }
  installOstlerApi(api)
  const view = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <WeeklyReviewView />
        </ToastProvider>
      </MemoryRouter>
    )
  return { api, view }
}

const heading = (name: RegExp) => screen.findByRole('heading', { level: 2, name })
const click = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }))

describe('WeeklyReviewView (N1.5)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetDismissableStackForTests()
  })
  afterEach(() => cleanup())

  it('walks through the steps with Next, Skip and Back, and finishes with the counts', async () => {
    const { api, view } = setup()
    view()
    expect(await heading(/^Inbox \(2\)$/)).toBeTruthy()
    expect(screen.getByText('2 items wait in the Inbox.')).toBeTruthy()

    click(/^Next$/)
    expect(await heading(/^Overdue \(1\)$/)).toBeTruthy()
    expect(screen.getByText('Pay invoice')).toBeTruthy()
    click(/^Skip$/)
    expect(await heading(/^Blocked for more than three days \(0\)$/)).toBeTruthy()
    expect(screen.getByText('Nothing here')).toBeTruthy()
    click(/^Back$/)
    expect(await heading(/^Overdue/)).toBeTruthy()
    click(/^Skip$/)
    click(/^Next$/)

    expect(await heading(/^Nothing changed in 14 days \(1\)$/)).toBeTruthy()
    click(/^Someday$/)
    await waitFor(() =>
      expect(api.updatePlanningWorkItem).toHaveBeenCalledWith('b', { someday: true })
    )
    expect(await heading(/^Nothing changed in 14 days \(0\)$/)).toBeTruthy()

    click(/^Next$/)
    expect(await heading(/^Someday \(1\)$/)).toBeTruthy()
    click(/^Keep$/)
    expect(await heading(/^Someday \(0\)$/)).toBeTruthy()

    click(/^Next$/)
    click(/^Next$/)
    expect(await heading(/^Milestones at risk \(0\)$/)).toBeTruthy()
    click(/^Finish review$/)
    await waitFor(() => expect(api.finishWeeklyReview).toHaveBeenCalledTimes(1))
    expect(api.finishWeeklyReview).toHaveBeenCalledWith({
      inbox: { shown: 2, changed: 0 },
      blocked: { shown: 0, changed: 0 },
      stale: { shown: 1, changed: 1 },
      someday: { shown: 1, changed: 0 },
      upcoming: { shown: 0, changed: 0 },
      milestones: { shown: 0, changed: 0 }
    })
    // Finishing forgets where the person was.
    expect(window.localStorage.getItem(REVIEW_PROGRESS_KEY)).toBeNull()
  })

  it('counts a task changed in one step and kept in a later one as changed where it changed', async () => {
    const { api, view } = setup()
    // Moved to Someday, "Old idea" leaves the stale step and shows in Someday, as it does in main.
    api.updatePlanningWorkItem.mockImplementation(async () => ({
      ok: true as const,
      value: {} as never
    }))
    api.getWeeklyReview.mockImplementation(async () => ({
      ok: true as const,
      value:
        api.updatePlanningWorkItem.mock.calls.length > 0
          ? review({ stale: [], someday: [task('c', 'Learn the banjo'), task('b', 'Old idea')] })
          : review()
    }))
    window.localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify({ step: 3, skipped: [] }))
    view()
    expect(await heading(/^Nothing changed in 14 days \(1\)$/)).toBeTruthy()
    click(/^Someday$/)
    expect(await heading(/^Nothing changed in 14 days \(0\)$/)).toBeTruthy()

    click(/^Next$/)
    expect(await heading(/^Someday \(2\)$/)).toBeTruthy()
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actions for Old idea' })).getByRole('button', {
        name: 'Keep'
      })
    )
    expect(await heading(/^Someday \(1\)$/)).toBeTruthy()

    click(/^Next$/)
    click(/^Next$/)
    click(/^Finish review$/)
    await waitFor(() => expect(api.finishWeeklyReview).toHaveBeenCalledTimes(1))
    expect(api.finishWeeklyReview).toHaveBeenCalledWith({
      stale: { shown: 1, changed: 1 },
      someday: { shown: 2, changed: 0 },
      upcoming: { shown: 0, changed: 0 },
      milestones: { shown: 0, changed: 0 }
    })
  })

  it('reads a review left half-way with its kept tasks stored before they were kept by step', async () => {
    const { view } = setup()
    window.localStorage.setItem(
      REVIEW_PROGRESS_KEY,
      JSON.stringify({ step: 4, skipped: [], dismissed: ['c'] })
    )
    view()
    expect(await heading(/^Someday \(0\)$/)).toBeTruthy()
  })

  it('undoes an action from its toast', async () => {
    const { api, view } = setup()
    window.localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify({ step: 3 }))
    view()
    expect(await heading(/^Nothing changed in 14 days \(1\)$/)).toBeTruthy()
    click(/^Someday$/)
    expect(await heading(/^Nothing changed in 14 days \(0\)$/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /undo/i }))
    await waitFor(() =>
      expect(api.updatePlanningWorkItem).toHaveBeenLastCalledWith('b', { someday: false })
    )
    expect(await heading(/^Nothing changed in 14 days \(1\)$/)).toBeTruthy()
  })

  it('comes back to the same step after leaving', async () => {
    const { view } = setup()
    const first = view()
    expect(await heading(/^Inbox/)).toBeTruthy()
    click(/^Next$/)
    expect(await heading(/^Overdue/)).toBeTruthy()
    first.unmount()

    view()
    expect(await heading(/^Overdue/)).toBeTruthy()
    expect(screen.getByText('Step 2 of 7')).toBeTruthy()
  })
})
