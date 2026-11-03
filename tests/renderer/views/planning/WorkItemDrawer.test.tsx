// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { TaskChecklistEditor } from '@renderer/views/planning/TaskChecklistEditor'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TYPING_PAUSE_MS } from '@renderer/hooks/planning/drawer-saves'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider } from '@renderer/ui'
import type { PlanningWorkItem, UpdatePlanningWorkItemInput } from '@shared/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'
import {
  emptyPlanningReads,
  renderPlanningWorkspace,
  withWorkspace
} from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { flushPendingEdits } from '@renderer/shell/flush-on-quit'

let base: PlanningWorkspace

beforeEach(async () => {
  base = await renderPlanningWorkspace()
})

const shell = (ui: ReactElement, agents = false) => (
  <MemoryRouter>
    <ConfirmProvider>
      <StaticFeaturesProvider value={{ agents, ai: false }}>{ui}</StaticFeaturesProvider>
    </ConfirmProvider>
  </MemoryRouter>
)

function drawerWorkspace(
  item: PlanningWorkItem,
  workItems: PlanningWorkItem[],
  overrides: Partial<PlanningWorkspace> = {}
): PlanningWorkspace {
  return withWorkspace(base, {
    selectedWorkItem: item,
    selectedWorkItemId: item.id,
    workItems,
    workItemsById: new Map(workItems.map((candidate) => [candidate.id, candidate])),
    editTitle: item.title,
    editStatus: item.status,
    editDependencyIds: item.dependencyIds,
    ...overrides
  })
}

/** "Add to this task": a part's own button, or its entry under More. */
async function addPart(name: string) {
  const bar = screen.getByRole('group', { name: 'Add to this task' })
  const chip = within(bar).queryByRole('button', { name })
  if (chip) {
    fireEvent.click(chip)
    return
  }
  fireEvent.click(within(bar).getByRole('button', { name: /more$/ }))
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

describe('Checklist row editor', () => {
  function Harness({
    initial,
    onChange
  }: {
    initial: string[]
    onChange?: (items: string[]) => void
  }) {
    const [items, setItems] = useState(initial)
    return (
      <TaskChecklistEditor
        items={items}
        onChange={(next) => {
          setItems(next)
          onChange?.(next)
        }}
      />
    )
  }
  const rows = () =>
    screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)

  it('adds a row with the button and after a row with Enter', () => {
    render(<Harness initial={['First']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(rows()).toEqual(['First', ''])
    expect(document.activeElement).toBe(screen.getByLabelText('Checklist item 2'))

    fireEvent.change(screen.getByLabelText('Checklist item 2'), { target: { value: 'Third' } })
    fireEvent.keyDown(screen.getByLabelText('Checklist item 1'), { key: 'Enter' })
    expect(rows()).toEqual(['First', '', 'Third'])
  })

  it('reorders rows', () => {
    render(<Harness initial={['One', 'Two', 'Three']} />)
    expect(screen.getByRole('button', { name: 'Move item 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move item 3 down' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Move item 3 up' }))
    expect(rows()).toEqual(['One', 'Three', 'Two'])
    fireEvent.click(screen.getByRole('button', { name: 'Move item 1 down' }))
    expect(rows()).toEqual(['Three', 'One', 'Two'])
  })

  it('deletes a row', () => {
    const onChange = vi.fn()
    render(<Harness initial={['One', 'Two']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete item 1' }))
    expect(rows()).toEqual(['Two'])
    expect(onChange).toHaveBeenLastCalledWith(['Two'])
  })
})

describe('Task drawer', () => {
  it('offers dependencies other than the task itself and its subtasks', async () => {
    const parent = makeWorkItem('parent', { title: 'Parent task' })
    const items = [
      parent,
      makeWorkItem('child', {
        title: 'Its subtask',
        parentWorkItemId: 'parent',
        subtaskPhaseNumber: 1
      }),
      makeWorkItem('other', { title: 'Another task' })
    ]
    render(shell(<WorkItemDrawer ws={drawerWorkspace(parent, items)} />))

    // Waits on stays out of the way until a task waits on something, or it is added.
    expect(screen.queryByRole('combobox', { name: 'Add a task it waits on' })).toBeNull()
    await addPart('Waits on')
    const picker = await screen.findByRole('combobox', { name: 'Add a task it waits on' })
    expect(document.activeElement).toBe(picker)
    fireEvent.click(picker)
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options.some((text) => text?.includes('Another task'))).toBe(true)
    expect(options.some((text) => text?.includes('Parent task'))).toBe(false)
    expect(options.some((text) => text?.includes('Its subtask'))).toBe(false)
  })

  it('lists chosen dependencies with their status and lets them be removed', () => {
    const item = makeWorkItem('a', { title: 'Task A', dependencyIds: ['b'] })
    const items = [item, makeWorkItem('b', { title: 'Task B', status: 'done' })]
    const setEditDependencyIds = vi.fn()
    render(
      shell(
        <WorkItemDrawer
          ws={drawerWorkspace(item, items, {
            projectedStatus: (i) => i.status,
            setEditDependencyIds
          })}
        />
      )
    )
    const list = within(screen.getByRole('list', { name: 'Waits on' }))
    expect(list.getByRole('img', { name: 'Done' })).toBeTruthy()
    fireEvent.click(list.getByRole('button', { name: 'Stop waiting on Task B' }))
    expect(setEditDependencyIds).toHaveBeenCalled()
  })

  it('shows no agent section or control while agents are off', () => {
    const item = makeWorkItem('a', { title: 'Task A' })
    const { unmount } = render(shell(<WorkItemDrawer ws={drawerWorkspace(item, [item])} />))
    for (const name of ['Agent run', 'Verification', 'For the agent']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(screen.queryByLabelText('Auto-continue')).toBeNull()
    unmount()

    render(shell(<WorkItemDrawer ws={drawerWorkspace(item, [item])} />, true))
    expect(screen.getByRole('heading', { name: 'Agent run' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Verification' })).toBeTruthy()
  })
})

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

type SaveAnswer = (
  id: string,
  patch: UpdatePlanningWorkItemInput
) => Promise<{ ok: true; value: PlanningWorkItem } | { ok: false; error: string }>

/**
 * The real hook and drawer together, over an in-memory store that answers
 * saves the way the main process would: the patch lands in the record and the
 * saved record comes back.
 */
async function renderLiveDrawer(
  task: PlanningWorkItem,
  options: { updatePlanningWorkItem?: SaveAnswer } = {}
) {
  let store = [task]
  const storeAnswer: SaveAnswer = async (id, patch) => {
    const saved = {
      ...store.find((candidate) => candidate.id === id)!,
      ...patch
    } as PlanningWorkItem
    store = store.map((candidate) => (candidate.id === id ? saved : candidate))
    return { ok: true, value: saved }
  }
  const update = vi.fn(options.updatePlanningWorkItem ?? storeAnswer)
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: store }),
    // The drawer's activity feed, with nothing in it yet.
    getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } }),
    updatePlanningWorkItem: update
  })

  let live!: PlanningWorkspace
  function Live() {
    live = usePlanningWorkspace('p1', () => {})
    return shell(<WorkItemDrawer ws={live} />)
  }
  render(<Live />)
  await waitFor(() => expect(live.loading).toBe(false))
  act(() => live.openWorkItem(task))
  // The drawer's activity feed reads once it opens; let that read land inside act.
  await wait(0)
  return {
    update,
    replaceStore: (next: PlanningWorkItem[]) => {
      store = next
    },
    get ws() {
      return live
    }
  }
}

/** The description's editor, turning Edit on first when it is off. */
const description = () => {
  if (!screen.queryByRole('textbox', { name: 'Description' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  return screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement
}
const priority = () => screen.getByRole('combobox', { name: 'Priority' }) as HTMLSelectElement

describe('Task drawer saves as you go', () => {
  it('a picker change saves once, at once', async () => {
    const task = makeWorkItem('a', { title: 'Task A', priority: 'medium' })
    const { update } = await renderLiveDrawer(task)

    fireEvent.change(priority(), { target: { value: 'high' } })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('a', { priority: 'high' })
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  it('typed description saves once after the pause, and once more when left early', async () => {
    const task = makeWorkItem('a', { title: 'Task A' })
    const { update } = await renderLiveDrawer(task)

    fireEvent.focus(description())
    fireEvent.change(description(), { target: { value: 'Scope' } })
    expect(update).not.toHaveBeenCalled()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    expect(update).toHaveBeenLastCalledWith('a', { description: 'Scope' })

    fireEvent.change(description(), { target: { value: 'Scope, more' } })
    fireEvent.blur(description())
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenLastCalledWith('a', { description: 'Scope, more' })

    // Nothing is left to send: the pause passes without another save.
    await wait(TYPING_PAUSE_MS + 50)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('quitting saves typing still waiting for its pause, and waits for it (R1.5)', async () => {
    const task = makeWorkItem('a', { title: 'Task A' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const harness = await renderLiveDrawer(task, {
      updatePlanningWorkItem: async (_id, patch) => {
        await gate
        return { ok: true, value: { ...task, ...patch } as PlanningWorkItem }
      }
    })

    fireEvent.focus(description())
    fireEvent.change(description(), { target: { value: 'Typed just before quitting' } })
    expect(harness.update).not.toHaveBeenCalled()
    let flushed = false
    const flushing = act(() => flushPendingEdits().then(() => (flushed = true)))
    await waitFor(() =>
      expect(harness.update).toHaveBeenCalledWith('a', {
        description: 'Typed just before quitting'
      })
    )
    await wait(20)
    expect(flushed).toBe(false)
    release()
    await flushing
    expect(flushed).toBe(true)
    expect(harness.update).toHaveBeenCalledTimes(1)
  })

  it('closing waits for a save that is in flight', async () => {
    const task = makeWorkItem('a', { title: 'Task A', priority: 'medium' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const harness = await renderLiveDrawer(task, {
      updatePlanningWorkItem: async (_id, patch) => {
        await gate
        return { ok: true, value: { ...task, ...patch } as PlanningWorkItem }
      }
    })

    fireEvent.change(priority(), { target: { value: 'high' } })
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await wait(50)
    expect(harness.ws.selectedWorkItemId).toBe('a')

    await act(async () => release())
    await waitFor(() => expect(harness.ws.selectedWorkItemId).toBeNull())
  })

  it('closes at once when nothing was changed', async () => {
    const task = makeWorkItem('a', { title: 'Task A' })
    const harness = await renderLiveDrawer(task)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(harness.ws.selectedWorkItemId).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('a failed save keeps the typed text and offers Retry', async () => {
    const task = makeWorkItem('a', { title: 'Task A' })
    let failing = true
    const harness = await renderLiveDrawer(task, {
      updatePlanningWorkItem: async (_id, patch) =>
        failing
          ? { ok: false, error: 'The server refused it' }
          : { ok: true, value: { ...task, ...patch } as PlanningWorkItem }
    })

    fireEvent.focus(description())
    fireEvent.change(description(), { target: { value: 'Kept text' } })
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    expect(await screen.findByText('Not saved')).toBeTruthy()
    expect(screen.getByText("Couldn't save Description: The server refused it")).toBeTruthy()
    expect(description().value).toBe('Kept text')

    failing = false
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.queryByText(/Couldn't save/)).toBeNull()
    expect(harness.update).toHaveBeenLastCalledWith('a', { description: 'Kept text' })
  })

  it('closing after a failed save asks in the app: Keep editing stays, Discard closes', async () => {
    const task = makeWorkItem('a', { title: 'Task A' })
    const harness = await renderLiveDrawer(task, {
      updatePlanningWorkItem: async () => ({ ok: false, error: 'The server refused it' })
    })

    fireEvent.focus(description())
    fireEvent.change(description(), { target: { value: 'Lost text' } })
    expect(
      await screen.findByText('Not saved', {}, { timeout: TYPING_PAUSE_MS + 1000 })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const ask = await screen.findByRole('alertdialog', { name: "A change didn't save" })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(harness.ws.selectedWorkItemId).toBe('a')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const again = await screen.findByRole('alertdialog', { name: "A change didn't save" })
    fireEvent.click(within(again).getByRole('button', { name: 'Discard change' }))
    await waitFor(() => expect(harness.ws.selectedWorkItemId).toBeNull())
  })

  it('Ctrl+Z restores the previous saved value', async () => {
    const task = makeWorkItem('a', { title: 'Task A', priority: 'medium' })
    const harness = await renderLiveDrawer(task)

    fireEvent.change(priority(), { target: { value: 'high' } })
    expect(await screen.findByText('Saved')).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'z', ctrlKey: true })
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(2))
    expect(harness.update).toHaveBeenLastCalledWith('a', { priority: 'medium' })
    await waitFor(() => expect(priority().value).toBe('medium'))
  })

  it('a change from elsewhere refreshes an unfocused field and leaves a focused one alone', async () => {
    const task = makeWorkItem('a', {
      title: 'Task A',
      priority: 'medium',
      description: 'Saved text'
    })
    const harness = await renderLiveDrawer(task)

    fireEvent.focus(description())
    fireEvent.change(description(), { target: { value: 'My edit' } })
    harness.replaceStore([{ ...task, priority: 'low', description: 'From elsewhere' }])
    await act(async () => {
      await harness.ws.loadPlanning()
    })

    await waitFor(() => expect(priority().value).toBe('low'))
    expect(description().value).toBe('My edit')

    fireEvent.blur(description())
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(harness.update).toHaveBeenLastCalledWith('a', { description: 'My edit' })
  })
})

describe('Task drawer for a person who may not edit it', () => {
  const shareState = (myRole: 'viewer' | 'contributor') => ({
    ok: true as const,
    value: { projectId: 'p1', myRole } as never
  })

  it('locks the fields of a task a Viewer or a Contributor does not own', async () => {
    installOstlerApi({
      ...emptyPlanningReads(),
      getShareState: async () => shareState('contributor'),
      getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } })
    })
    const item = makeWorkItem('a', { title: 'Not mine', assigneeId: 'someone-else' })
    render(shell(<WorkItemDrawer ws={drawerWorkspace(item, [item])} />))
    expect(await screen.findByText(/This one is read-only/)).toBeTruthy()
    const lock = document.querySelector('fieldset.task-drawer__lock') as HTMLFieldSetElement
    expect(lock.disabled).toBe(true)
  })

  it('leaves the fields editable for an Owner', async () => {
    installOstlerApi({
      ...emptyPlanningReads(),
      getShareState: async () => ({ ok: true, value: null }),
      getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } })
    })
    const item = makeWorkItem('a', { title: 'Mine' })
    render(shell(<WorkItemDrawer ws={drawerWorkspace(item, [item])} />))
    await waitFor(() => expect(document.querySelector('fieldset.task-drawer__lock')).toBeTruthy())
    expect(
      (document.querySelector('fieldset.task-drawer__lock') as HTMLFieldSetElement).disabled
    ).toBe(false)
    expect(screen.queryByText(/This one is read-only/)).toBeNull()
  })
})
