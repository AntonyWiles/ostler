// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem, RendererProject } from '@shared/ostler-api'
import { TriageView } from '@renderer/views/planning/triage/TriageView'
import { TriageSetting } from '@renderer/views/planning/triage/TriageSetting'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { installOstlerApi } from '../../fixtures/ostler-api'

const ITEMS = () => [
  makeWorkItem('a', {
    title: 'Call the plumber',
    inTriage: true,
    capturedBy: 'quick-add',
    createdAt: Date.now() - 60_000
  }),
  makeWorkItem('b', { title: 'Snipped bug', inTriage: true, capturedBy: 'snip' })
]

const loadPlanning = vi.fn(async () => undefined)

function renderTriage(api: Partial<OstlerAPI> = {}, items = ITEMS()) {
  installOstlerApi({
    getTriage: async () => ({ ok: true, value: { items, pictures: {} } }),
    ...api
  })
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticPeopleProvider people={[]}>
          <TriageView ws={{ projectId: 'p1', workItems: [], milestones: [], loadPlanning }} />
        </StaticPeopleProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

const row = (title: string) =>
  screen.getByRole('listitem', { name: new RegExp(`^${title}, Captured`) })

describe('To triage (N4.3a)', () => {
  beforeEach(() => {
    __resetDismissableStackForTests()
    loadPlanning.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists each waiting task with when and how it was captured', async () => {
    renderTriage()
    expect(await screen.findByText('Call the plumber')).toBeTruthy()
    expect(screen.getByText('2 tasks to triage')).toBeTruthy()
    expect(within(row('Call the plumber')).getByText(/with quick add$/)).toBeTruthy()
    expect(within(row('Snipped bug')).getByText(/with Snip to task$/)).toBeTruthy()
  })

  it('says when nothing waits', async () => {
    renderTriage({}, [])
    expect(await screen.findByText('Nothing to triage')).toBeTruthy()
  })

  it('accepts with the fields set in the row first, and offers undo', async () => {
    const acceptTriagedWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('a', { inTriage: false })
    }))
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('a')
    }))
    renderTriage({ acceptTriagedWorkItem, updatePlanningWorkItem })
    await screen.findByText('Call the plumber')
    const first = row('Call the plumber')
    fireEvent.change(within(first).getByLabelText('Priority'), { target: { value: 'high' } })
    fireEvent.change(within(first).getByLabelText('Labels'), {
      target: { value: 'home, urgent' }
    })
    fireEvent.click(within(first).getByRole('button', { name: /^Accept/ }))
    await waitFor(() =>
      expect(acceptTriagedWorkItem).toHaveBeenCalledWith('p1', 'a', {
        status: 'backlog',
        priority: 'high',
        assigneeId: null,
        labels: ['home', 'urgent'],
        targetDate: null,
        milestoneId: null
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ inTriage: true, priority: 'medium' })
      )
    )
  })

  it('moves between rows with the arrow keys and decides with a key', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('b')
    }))
    const closePlanningWorkItemAsWontDo = vi.fn(async () => ({
      ok: true as const,
      value: { workItem: makeWorkItem('a'), closedIds: ['a'], cancelledTask: false }
    }))
    renderTriage({ updatePlanningWorkItem, closePlanningWorkItemAsWontDo })
    await screen.findByText('Call the plumber')
    const first = row('Call the plumber')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row('Snipped bug'))
    fireEvent.keyDown(row('Snipped bug'), { key: 's' })
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledWith('b', { someday: true }))

    fireEvent.keyDown(row('Call the plumber'), { key: 'w' })
    const dialog = await screen.findByRole('dialog', { name: /Close “Call the plumber”/ })
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: 'Fixed it myself' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close as won’t do' }))
    await waitFor(() =>
      expect(closePlanningWorkItemAsWontDo).toHaveBeenCalledWith('a', {
        reason: 'Fixed it myself'
      })
    )
  })

  it('keeps focus in the list after a decision: on the row that took the decided one’s place', async () => {
    const all = ITEMS()
    let waiting = all
    const acceptTriagedWorkItem = vi.fn(async () => {
      waiting = all.filter((item) => item.id !== 'a')
      return { ok: true as const, value: makeWorkItem('a', { inTriage: false }) }
    })
    renderTriage({
      getTriage: async () => ({ ok: true, value: { items: waiting, pictures: {} } }),
      acceptTriagedWorkItem
    })
    await screen.findByText('Call the plumber')
    const first = row('Call the plumber')
    first.focus()
    fireEvent.keyDown(first, { key: 'a' })
    await waitFor(() => expect(screen.queryByText('Call the plumber')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row('Snipped bug')))
    // The Board and the List read the project's tasks again, the accepted one among them.
    expect(loadPlanning).toHaveBeenCalled()
  })

  it('shows the task again once its decision is undone, though the planned tasks never changed', async () => {
    const all = ITEMS()
    let waiting = all
    const closePlanningWorkItemAsWontDo = vi.fn(async () => {
      waiting = all.filter((item) => item.id !== 'a')
      return {
        ok: true as const,
        value: { workItem: makeWorkItem('a'), closedIds: ['a'], cancelledTask: false }
      }
    })
    const unarchivePlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('a')
    }))
    const updatePlanningWorkItem = vi.fn(async () => {
      waiting = all
      return { ok: true as const, value: makeWorkItem('a', { inTriage: true }) }
    })
    renderTriage({
      getTriage: async () => ({ ok: true, value: { items: waiting, pictures: {} } }),
      closePlanningWorkItemAsWontDo,
      unarchivePlanningWorkItem,
      updatePlanningWorkItem
    })
    await screen.findByText('Call the plumber')
    fireEvent.keyDown(row('Call the plumber'), { key: 'w' })
    const dialog = await screen.findByRole('dialog', { name: /Close “Call the plumber”/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close as won’t do' }))
    await waitFor(() => expect(screen.queryByText('Call the plumber')).toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { inTriage: true })
    )
    expect(await screen.findByText('Call the plumber')).toBeTruthy()
    expect(screen.getByText('2 tasks to triage')).toBeTruthy()
  })

  it('does not decide while typing in a row’s field', async () => {
    const updatePlanningWorkItem = vi.fn()
    renderTriage({ updatePlanningWorkItem })
    await screen.findByText('Call the plumber')
    const labels = within(row('Call the plumber')).getByLabelText('Labels')
    fireEvent.keyDown(labels, { key: 's' })
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('shows each decision’s key on its button', async () => {
    renderTriage()
    await screen.findByText('Call the plumber')
    const buttons = within(row('Call the plumber'))
      .getAllByRole('button')
      .filter((button) =>
        /^(Accept|Someday|Won’t do|Duplicate of|Move to project)/.test(button.textContent ?? '')
      )
    expect(buttons.map((button) => button.getAttribute('aria-keyshortcuts'))).toEqual([
      'A',
      'S',
      'W',
      'D',
      'M'
    ])
  })
})

describe('Triage new captures in Project settings (N4.3a)', () => {
  const project = { id: 'p1', name: 'Website', triageCaptures: true } as RendererProject

  function renderSetting(api: Partial<OstlerAPI>, waiting: PlanningWorkItem[]) {
    const onSaved = vi.fn()
    installOstlerApi({
      getTriage: async () => ({ ok: true, value: { items: waiting, pictures: {} } }),
      ...api
    })
    render(
      <ToastProvider>
        <ConfirmProvider>
          <TriageSetting project={project} onSaved={onSaved} onError={() => {}} />
        </ConfirmProvider>
      </ToastProvider>
    )
    return onSaved
  }

  beforeEach(() => {
    __resetDismissableStackForTests()
  })

  it('asks before turning off with tasks waiting, and accepts them all', async () => {
    const acceptAllTriagedWorkItems = vi.fn(async () => ({ ok: true as const, value: 2 }))
    const updateProject = vi.fn(async () => ({
      ok: true as const,
      value: { ...project, triageCaptures: false }
    }))
    const onSaved = renderSetting({ acceptAllTriagedWorkItems, updateProject }, ITEMS())
    fireEvent.click(screen.getByRole('switch', { name: /Triage new captures/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/2 tasks wait in To triage/)).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Accept and turn off' }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('p1', { triageCaptures: false }))
    expect(acceptAllTriagedWorkItems).toHaveBeenCalledWith('p1')
    expect(onSaved).toHaveBeenCalled()
  })

  it('keeps it on when the person says so', async () => {
    const acceptAllTriagedWorkItems = vi.fn()
    const updateProject = vi.fn()
    renderSetting({ acceptAllTriagedWorkItems, updateProject }, ITEMS())
    fireEvent.click(screen.getByRole('switch', { name: /Triage new captures/ }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep triage on' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(acceptAllTriagedWorkItems).not.toHaveBeenCalled()
    expect(updateProject).not.toHaveBeenCalled()
  })

  it('turns off at once with nothing waiting', async () => {
    const updateProject = vi.fn(async () => ({
      ok: true as const,
      value: { ...project, triageCaptures: false }
    }))
    renderSetting({ updateProject }, [])
    fireEvent.click(screen.getByRole('switch', { name: /Triage new captures/ }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('p1', { triageCaptures: false }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
