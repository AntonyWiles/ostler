// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { frequentLabels } from '@shared/planning/frequent-labels'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { CreateRecordModal } from '@renderer/views/planning/CreateRecordModal'
import { TaskLabelsField } from '@renderer/views/planning/TaskLabelsField'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { makeWorkItem } from '../../fixtures/planning-records'

const project = { id: 'p1', name: 'Website', enabled: true, path: null }

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOstler: () => ({ projects: [project], loading: false, refreshProjects: async () => {} })
}))

const milestone = (id: string, name: string): PlanningMilestone =>
  ({
    id,
    projectId: 'p1',
    goalId: null,
    name,
    outcome: '',
    targetDate: null,
    status: 'planned',
    successCriteria: [],
    createdAt: 1,
    updatedAt: 1
  }) as unknown as PlanningMilestone

/** The live workspace with New task open, as the app shows it. */
let current: PlanningWorkspace
function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  current = ws
  return ws.createMode ? <CreateRecordModal ws={ws} selectedProject={undefined} /> : null
}

async function openNewTask(items: PlanningWorkItem[] = [], milestones: PlanningMilestone[] = []) {
  const created: PlanningMilestone[] = []
  const createPlanningMilestone = vi.fn(async (_projectId: string, input: { name: string }) => {
    const made = milestone('m-new', input.name)
    created.push(made)
    return { ok: true as const, value: made }
  })
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    getPlanningMilestones: async () => ({ ok: true, value: [...milestones, ...created] }),
    createPlanningMilestone: createPlanningMilestone as never
  })
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ ai: false, agents: false }}>
            <Live />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(current.loading).toBe(false))
  act(() => current.openWorkItemCreate())
  const dialog = await screen.findByRole('dialog', { name: 'New task' })
  return { dialog, createPlanningMilestone }
}

beforeEach(() => localStorage.clear())

describe('New task: a milestone from the form', () => {
  it('makes a new milestone in its own dialog and chooses it', async () => {
    const { dialog, createPlanningMilestone } = await openNewTask()
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Milestone' }), {
      target: { value: 'new-milestone' }
    })
    const small = await screen.findByRole('dialog', { name: 'New milestone' })
    const name = within(small).getByRole('textbox', { name: /Milestone name/ })
    fireEvent.change(name, { target: { value: 'Soft launch' } })
    fireEvent.change(within(small).getByRole('textbox', { name: 'Outcome' }), {
      target: { value: 'People can try it' }
    })
    // Enter in its own form makes the milestone, and does not create the task.
    fireEvent.submit(name.closest('form')!)
    await waitFor(() =>
      expect(createPlanningMilestone).toHaveBeenCalledWith('p1', {
        name: 'Soft launch',
        outcome: 'People can try it',
        goalId: null,
        targetDate: null
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New milestone' })).toBeNull())
    const select = within(dialog).getByRole('combobox', { name: 'Milestone' })
    expect(select).toHaveValue('m-new')
    expect(within(select).getByRole('option', { name: 'Soft launch' })).toBeTruthy()
    expect(current.itemMilestoneId).toBe('m-new')
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeTruthy()
  })

  it('goes back to the list on Cancel without making anything', async () => {
    const { dialog, createPlanningMilestone } = await openNewTask([], [milestone('m1', 'Beta')])
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Milestone' }), {
      target: { value: 'new-milestone' }
    })
    const small = await screen.findByRole('dialog', { name: 'New milestone' })
    fireEvent.click(within(small).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New milestone' })).toBeNull())
    expect(within(dialog).getByRole('combobox', { name: 'Milestone' })).toHaveValue('')
    expect(createPlanningMilestone).not.toHaveBeenCalled()
  })
})

describe('New task: minimise', () => {
  it('puts the task aside as a bar and brings it back as it was', async () => {
    const { dialog } = await openNewTask()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Book the venue' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Minimise' }))
    expect(screen.queryByRole('dialog', { name: 'New task' })).toBeNull()
    const bar = screen.getByRole('region', { name: 'New task, put aside' })
    expect(within(bar).getByText('New task: Book the venue')).toBeTruthy()

    // New task again, from a column or the header, brings back the one put aside.
    act(() => current.openWorkItemCreate('ready'))
    const again = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(again).getByRole('textbox', { name: 'Title' })).toHaveValue('Book the venue')

    fireEvent.click(within(again).getByRole('button', { name: 'Minimise' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('region', { name: 'New task, put aside' })).toBeNull()
    expect(current.itemTitle).toBe('')
  })
})

describe('labels a click each', () => {
  it('ranks a project’s labels by how many tasks have them', () => {
    const items = [
      makeWorkItem('a', { labels: ['docs', 'urgent'] }),
      makeWorkItem('b', { labels: ['urgent'] }),
      makeWorkItem('c', { labels: ['design', 'urgent'] }),
      makeWorkItem('d', { labels: ['docs'], deletedAt: 5 } as Partial<PlanningWorkItem>)
    ]
    expect(frequentLabels(items)).toEqual(['urgent', 'design', 'docs'])
    expect(frequentLabels(items, 1)).toEqual(['urgent'])
  })

  it('adds and takes off a usual label in one click, and keeps the others as chips', () => {
    const onChange = vi.fn()
    // Eight usual labels fill the one-click row, so 'rare' is a chip.
    const usual = ['urgent', 'docs', 'a', 'b', 'c', 'd', 'e', 'f']
    const { rerender } = render(
      <TaskLabelsField
        labels={['rare']}
        known={['rare', ...usual]}
        frequent={usual}
        onChange={onChange}
      />
    )
    const urgent = screen.getByRole('button', { name: 'urgent' })
    expect(urgent).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(urgent)
    expect(onChange).toHaveBeenLastCalledWith(['rare', 'urgent'])
    expect(screen.getByRole('button', { name: 'Remove label rare' })).toBeTruthy()

    rerender(
      <TaskLabelsField
        labels={['rare', 'urgent']}
        known={['rare', ...usual]}
        frequent={usual}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'urgent' }))
    expect(onChange).toHaveBeenLastCalledWith(['rare'])
  })

  it('tops the row up with labels no task uses yet, so none needs typing (MOP-44)', () => {
    const onChange = vi.fn()
    render(
      <TaskLabelsField labels={[]} known={['docs', 'urgent']} frequent={[]} onChange={onChange} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'urgent' }))
    expect(onChange).toHaveBeenLastCalledWith(['urgent'])
  })

  it('offers the usual labels in New task', async () => {
    const items = [
      makeWorkItem('a', { labels: ['urgent'] }),
      makeWorkItem('b', { labels: ['urgent'] })
    ]
    const { dialog } = await openNewTask(items)
    fireEvent.click(within(dialog).getByRole('button', { name: 'urgent' }))
    expect(current.itemLabels).toBe('urgent')
    expect(within(dialog).getByRole('button', { name: 'urgent' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

describe('New task: pasted pictures (MOP-31)', () => {
  it('shows a pasted picture as a thumbnail, not text, and attaches it on Create', async () => {
    const { dialog } = await openNewTask()
    const api = window.ostlerAPI as unknown as Record<string, unknown>
    const importLibraryFiles = vi.fn(async () => ({
      ok: true as const,
      value: [{ item: { id: 'lib-1', title: 'Screenshot' } }]
    }))
    const attachToWorkItem = vi.fn(async () => ({ ok: true as const, value: null }))
    const createPlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('w-new', { title: 'With a picture' })
    }))
    Object.assign(api, { importLibraryFiles, attachToWorkItem, createPlanningWorkItem })

    const description = within(dialog).getByLabelText('Description', { selector: 'textarea' })
    // jsdom's File has no arrayBuffer().
    const picture = Object.assign(new File([], 'shot.png', { type: 'image/png' }), {
      arrayBuffer: async () => new ArrayBuffer(3)
    })
    fireEvent.paste(description, { clipboardData: { files: [picture] } })

    const strip = await within(dialog).findByRole('list', { name: 'Pictures' })
    expect(within(strip).getByRole('img', { name: 'Preview Screenshot' })).toBeTruthy()
    expect(description).toHaveValue('')

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'With a picture' }
    })
    fireEvent.submit(description.closest('form')!)
    await waitFor(() =>
      expect(attachToWorkItem).toHaveBeenCalledWith('p1', 'w-new', 'lib-1', 'human')
    )
  })

  it('takes a picture off with its cross', async () => {
    const { dialog } = await openNewTask()
    act(() => current.setItemPictures([{ id: 'lib-1', title: 'Screenshot' }]))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Screenshot' }))
    expect(within(dialog).queryByRole('list', { name: 'Pictures' })).toBeNull()
  })
})
