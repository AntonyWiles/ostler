// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningTaskType, PlanningTaskTypeDeletion } from '@shared/ostler-api'
import { ProjectTaskTypesManager } from '@renderer/task-types/ProjectTaskTypesManager'
import { TaskTypeIcon } from '@renderer/task-types/TaskTypeIcon'
import { TaskTypeField } from '@renderer/task-types/TaskTypeField'
import { QuickAddForm } from '@renderer/components/quick-add/QuickAddForm'
import { ToastProvider } from '@renderer/ui'
import { MemoryRouter } from 'react-router-dom'
import { installOstlerApi } from '../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({
    projects: [{ id: 'p1', name: 'Website', enabled: true, path: null }],
    loading: false,
    refreshProjects: async () => {}
  })
}))

function taskType(overrides: Partial<PlanningTaskType>): PlanningTaskType {
  return {
    id: 'y1',
    projectId: 'p1',
    name: 'Bug',
    icon: 'bug',
    color: '#ef4444',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  } as PlanningTaskType
}

/** A fake main process holding the project's task types. */
function setup(initial: PlanningTaskType[]) {
  let types = [...initial]
  const createPlanningTaskType = vi.fn(async (_projectId: string, input: { name: string }) => {
    const created = taskType({
      id: `y${types.length + 1}`,
      name: input.name,
      position: types.length
    })
    types = [...types, created]
    return { ok: true as const, value: created }
  })
  const deletion: PlanningTaskTypeDeletion = { taskType: initial[0], taskIds: ['w1'] }
  const deletePlanningTaskType = vi.fn(async (typeId: string) => {
    types = types.filter((candidate) => candidate.id !== typeId)
    return { ok: true as const, value: deletion }
  })
  const restorePlanningTaskType = vi.fn(async () => {
    types = [initial[0], ...types]
    return { ok: true as const, value: initial[0] }
  })
  const reorderPlanningTaskTypes = vi.fn(async (_projectId: string, order: string[]) => {
    types = order.map((id, position) => ({
      ...types.find((type) => type.id === id)!,
      position
    }))
    return { ok: true as const, value: types }
  })
  installOstlerApi({
    getPlanningTaskTypes: async () => ({ ok: true, value: types }),
    createPlanningTaskType,
    deletePlanningTaskType,
    restorePlanningTaskType,
    reorderPlanningTaskTypes
  } as never)
  const onSaved = vi.fn()
  render(
    <ToastProvider>
      <ProjectTaskTypesManager projectId="p1" onError={() => {}} onSaved={onSaved} />
    </ToastProvider>
  )
  return {
    createPlanningTaskType,
    deletePlanningTaskType,
    restorePlanningTaskType,
    reorderPlanningTaskTypes,
    onSaved
  }
}

describe('ProjectTaskTypesManager (N2.7a)', () => {
  it('says when the project has no types yet', async () => {
    setup([])
    expect(await screen.findByText(/no task types yet/i)).toBeTruthy()
  })

  it('adds a type by name', async () => {
    const { createPlanningTaskType, onSaved } = setup([])
    fireEvent.change(await screen.findByLabelText('New task type'), { target: { value: 'Errand' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add type' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createPlanningTaskType).toHaveBeenCalledWith('p1', { name: 'Errand' })
    expect(await screen.findByText('Errand')).toBeTruthy()
  })

  it('moves a type down the order', async () => {
    const { reorderPlanningTaskTypes } = setup([
      taskType({}),
      taskType({ id: 'y2', name: 'Chore', position: 1 })
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Move Bug down' }))
    await waitFor(() => expect(reorderPlanningTaskTypes).toHaveBeenCalledWith('p1', ['y2', 'y1']))
  })

  it('deletes a type at once, and Undo puts it back on its tasks', async () => {
    const { deletePlanningTaskType, restorePlanningTaskType } = setup([taskType({})])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Bug' }))
    await waitFor(() => expect(deletePlanningTaskType).toHaveBeenCalledWith('y1'))
    await waitFor(() => expect(screen.queryByText('Bug')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(restorePlanningTaskType).toHaveBeenCalledWith({
        taskType: taskType({}),
        taskIds: ['w1']
      })
    )
    expect(await screen.findByText('Bug')).toBeTruthy()
  })
})

describe('TaskTypeIcon (N2.7a)', () => {
  it('names the type for screen readers and on hover', () => {
    render(<TaskTypeIcon type={taskType({})} />)
    const icon = screen.getByLabelText('Type: Bug')
    expect(icon.closest('.task-type-icon')?.getAttribute('title')).toBe('Type: Bug')
  })
})

describe('TaskTypeField (N2.7a)', () => {
  it('is absent until the project has a type, then offers no type and each type', () => {
    const { container, rerender } = render(
      <TaskTypeField types={[]} value="" onChange={() => {}} />
    )
    expect(container.textContent).toBe('')
    const onChange = vi.fn()
    rerender(<TaskTypeField types={[taskType({})]} value="gone" onChange={onChange} />)
    const select = screen.getByLabelText(/^Type/) as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map((option) => option.text)).toEqual(['No type', 'Bug'])
    fireEvent.change(select, { target: { value: 'y1' } })
    expect(onChange).toHaveBeenCalledWith('y1')
  })
})

describe('Quick add with task types (N2.7a)', () => {
  it('makes the task with the type picked under the line', async () => {
    const created = vi.fn(async (_projectId: string, input: { title: string }) => ({
      ok: true as const,
      value: { id: 'w1', projectId: 'p1', title: input.title } as never
    }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getTaskTemplates: async () => ({ ok: true, value: [] }),
      getPlanningTaskTypes: async () => ({ ok: true, value: [taskType({})] }),
      createPlanningWorkItem: created
    } as never)
    render(
      <MemoryRouter>
        <ToastProvider>
          <QuickAddForm defaultProjectId="p1" />
        </ToastProvider>
      </MemoryRouter>
    )
    fireEvent.change(await screen.findByLabelText(/^Type/), { target: { value: 'y1' } })
    const field = screen.getByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(field, { target: { value: 'Crash on save' } })
    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(created).toHaveBeenCalled())
    expect(created.mock.calls[0][1]).toMatchObject({ title: 'Crash on save', typeId: 'y1' })
  })
})
