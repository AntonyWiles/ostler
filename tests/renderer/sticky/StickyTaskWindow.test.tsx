// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningWorkItem,
  PlanningWorkItemScope,
  ProjectStateUpdate,
  RendererProject,
  TimeEntry
} from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { StickyTaskWindow } from '@renderer/sticky/StickyTaskWindow'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

/**
 * Sticky task on the desktop (N5.8b): what the sticky window shows and does.
 * Ticking the checklist, Start and Stop on the one timer, Done with undo in
 * its toast, live changes, and the window that says its task is gone.
 */

let projects: RendererProject[] = []
vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects, areas: [], loading: false, refreshProjects: async () => {} })
}))

const REF = { projectId: 'p1', taskId: 't1' }
const ok = <T,>(value: T) => ({ ok: true as const, value })

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Write the report',
    startedAt: Date.now() - 65_000,
    ...overrides
  } as TimeEntry
}

function setup(lists: Partial<Record<PlanningWorkItemScope, PlanningWorkItem[]>>) {
  const current = { ...lists }
  // Every window-level subscriber (the toasts too) hears the change.
  const planningListeners: Array<(state: ProjectStateUpdate) => void> = []
  const api = {
    getPlanningWorkItems: vi.fn(async (_projectId: string, scope?: PlanningWorkItemScope) =>
      ok(current[scope ?? 'live'] ?? [])
    ),
    onProjectStateChange: vi.fn((callback: (state: ProjectStateUpdate) => void) => {
      planningListeners.push(callback)
      return () => {}
    }),
    setPlanningChecklistItemChecked: vi.fn(async (id: string, text: string, checked: boolean) => {
      const task = (current.live ?? []).find((item) => item.id === id)!
      return ok({
        ...task,
        checkedCriteria: checked
          ? [...task.checkedCriteria, text]
          : task.checkedCriteria.filter((entry) => entry !== text)
      })
    }),
    updatePlanningWorkItem: vi.fn(async (id: string, update: { status?: string }) => {
      const task = (current.live ?? []).find((item) => item.id === id)!
      return ok({ ...task, ...update } as PlanningWorkItem)
    }),
    getTimer: vi.fn(async () => ok({ running: null, interrupted: null })),
    startTimer: vi.fn(async () => ok({ started: entry(), stopped: null })),
    stopTimer: vi.fn(async () => ok(null)),
    getFocus: vi.fn(async () => ok(null)),
    unpinStickyTask: vi.fn(async () => ok(undefined)),
    releaseStickyFocus: vi.fn(async () => ok(undefined)),
    openInMainWindow: vi.fn(async () => ok(undefined))
  }
  installOstlerApi(api as never)
  render(
    <ToastProvider>
      <StickyTaskWindow taskRef={REF} />
    </ToastProvider>
  )
  return {
    api,
    current,
    push: () =>
      act(() => {
        for (const listener of planningListeners) {
          listener({ projectId: 'p1', field: 'planning', data: null })
        }
      })
  }
}

const task = (overrides: Partial<PlanningWorkItem> = {}) =>
  makeWorkItem('t1', {
    title: 'Write the report',
    status: 'active',
    acceptanceCriteria: ['Outline', 'Draft'],
    checkedCriteria: ['Outline'],
    ...overrides
  })

beforeEach(() => {
  projects = [{ id: 'p1', name: 'Shop', color: '#336699', icon: null } as RendererProject]
})

describe('a sticky task window (N5.8b)', () => {
  it('shows the title, the checklist and its progress, and names the window', async () => {
    setup({ live: [task()] })
    expect(
      await screen.findByRole('button', { name: /Open Write the report in/ })
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Outline' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Draft' })).not.toBeChecked()
    expect(document.title).toBe('Write the report')
  })

  it('ticks a checklist item through the same path as the drawer', async () => {
    const { api } = setup({ live: [task()] })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Draft' }))
    await waitFor(() =>
      expect(api.setPlanningChecklistItemChecked).toHaveBeenCalledWith('t1', 'Draft', true)
    )
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Draft' })).toBeChecked())
  })

  it('starts and stops the timer', async () => {
    const { api } = setup({ live: [task()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Start timer' }))
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledWith('p1', 't1'))
    const stop = await screen.findByRole('button', { name: /Stop timer/ })
    expect(stop).toHaveTextContent(/1:0\d/)
    fireEvent.click(stop)
    await waitFor(() => expect(api.stopTimer).toHaveBeenCalled())
  })

  it('Done goes through the status change, says so, and Undo puts the status back', async () => {
    const { api } = setup({ live: [task()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(api.updatePlanningWorkItem).toHaveBeenCalledWith('t1', { status: 'done' })
    )
    expect(await screen.findByText('This task is done.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() =>
      expect(api.updatePlanningWorkItem).toHaveBeenCalledWith('t1', { status: 'active' })
    )
  })

  it('follows a change made in another window', async () => {
    const { current, push } = setup({ live: [task()] })
    await screen.findByRole('checkbox', { name: 'Draft' })
    current.live = [task({ checkedCriteria: ['Outline', 'Draft'] })]
    push()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Draft' })).toBeChecked())
  })

  it('says an archived task is gone and offers Unpin', async () => {
    const { api } = setup({ live: [], triage: [], archived: [task()] })
    expect(await screen.findByText('This task was archived.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    const unpins = screen.getAllByRole('button', { name: 'Unpin' })
    fireEvent.click(unpins[unpins.length - 1])
    expect(api.unpinStickyTask).toHaveBeenCalled()
  })

  it('says when the project was removed', async () => {
    projects = []
    setup({ live: [task()] })
    expect(
      await screen.findByText("This task's project was removed from Ostler.")
    ).toBeInTheDocument()
  })

  it('Esc hands the focus back without closing', async () => {
    const { api } = setup({ live: [task()] })
    await screen.findByRole('checkbox', { name: 'Draft' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.releaseStickyFocus).toHaveBeenCalled()
    expect(api.unpinStickyTask).not.toHaveBeenCalled()
  })

  it('the title opens the task in the main window', async () => {
    const { api } = setup({ live: [task()] })
    fireEvent.click(await screen.findByRole('button', { name: /Open Write the report in/ }))
    expect(api.openInMainWindow).toHaveBeenCalledWith('/projects/p1/tasks/t1')
  })
})
