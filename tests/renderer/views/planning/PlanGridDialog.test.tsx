// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningWorkItemBatchRow, RendererProject } from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { PlanGridDialog } from '@renderer/views/planning/PlanGridDialog'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

const PROJECT = { id: 'p1', name: 'Demo', estimateUnit: 'points' } as unknown as RendererProject

const titleCell = (row: number) => screen.getByRole('textbox', { name: `Row ${row}, Title` })
const labelsCell = (row: number) => screen.getByRole('textbox', { name: `Row ${row}, Labels` })
const rowElement = (row: number) => titleCell(row).closest('tr') as HTMLElement

/** Renders the grid over a real workspace whose batch calls are the given fakes. */
async function renderGrid(
  api: {
    check?: () => Promise<unknown>
    create?: (projectId: string, rows: PlanningWorkItemBatchRow[]) => Promise<unknown>
  } = {}
) {
  const checkMock = vi.fn(api.check ?? (async () => ({ ok: true, value: [] })))
  const createMock = vi.fn(
    api.create ??
      (async (_projectId: string, rows: PlanningWorkItemBatchRow[]) => ({
        ok: true,
        value: rows.map((row, index) => makeWorkItem(`new-${index}`, { title: row.title }))
      }))
  )
  const base = await renderPlanningWorkspace({
    api: {
      checkPlanningWorkItemBatch: checkMock as never,
      createPlanningWorkItemBatch: createMock as never
    }
  })
  const ws: PlanningWorkspace = withWorkspace(base, {
    setPlanGridOpen: vi.fn() as never
  })
  render(
    <StaticPeopleProvider people={[]}>
      <PlanGridDialog ws={ws} project={PROJECT} />
    </StaticPeopleProvider>
  )
  return { checkMock, createMock, ws }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('PlanGridDialog', () => {
  it('creates the plan in one batch call, after checking it', async () => {
    const { checkMock, createMock } = await renderGrid()

    fireEvent.change(titleCell(1), { target: { value: 'Draft the brief' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 task' }))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(checkMock).toHaveBeenCalled()
    expect(checkMock.mock.invocationCallOrder[0]).toBeLessThan(
      createMock.mock.invocationCallOrder[0]
    )
    const [projectId, rows] = createMock.mock.calls[0] as unknown as [
      string,
      PlanningWorkItemBatchRow[]
    ]
    expect(projectId).toBe('p1')
    expect(rows).toEqual([
      expect.objectContaining({
        ref: 'r0',
        title: 'Draft the brief',
        assigneeId: null,
        startDate: null,
        targetDate: null,
        estimate: null,
        labels: []
      })
    ])
  })

  it('adds a row with Enter in the last cell and moves the focus to its title', async () => {
    await renderGrid()

    fireEvent.change(titleCell(1), { target: { value: 'First' } })
    fireEvent.keyDown(labelsCell(1), { key: 'Enter' })

    expect(titleCell(2)).toBeTruthy()
    expect(document.activeElement).toBe(titleCell(2))
  })

  it('indents a row with Alt+Shift+Right, and its summary counts it as a subtask', async () => {
    await renderGrid()

    fireEvent.change(titleCell(1), { target: { value: 'Plan' } })
    fireEvent.keyDown(labelsCell(1), { key: 'Enter' })
    fireEvent.change(titleCell(2), { target: { value: 'Step' } })
    expect(screen.getByText('2 tasks, 0 subtasks, 0 Waits on links')).toBeTruthy()

    fireEvent.keyDown(titleCell(2), { key: 'ArrowRight', altKey: true, shiftKey: true })

    expect(
      rowElement(2)
        .querySelector<HTMLElement>('.plan-grid__title')
        ?.style.getPropertyValue('--plan-depth')
    ).toBe('1')
    expect(screen.getByText(/1 task, 1 subtask/)).toBeTruthy()
  })

  it('turns pasted lines into rows, with two leading spaces making a subtask', async () => {
    await renderGrid()

    fireEvent.paste(titleCell(1), {
      clipboardData: { getData: () => 'Plan\n  Step one\nShip' }
    })

    expect(titleCell(1)).toHaveValue('Plan')
    expect(titleCell(2)).toHaveValue('Step one')
    expect(titleCell(3)).toHaveValue('Ship')
    expect(screen.getByText(/2 tasks, 1 subtask/)).toBeTruthy()
  })

  it('shows a refused row on its own cell, and creates nothing', async () => {
    const message = 'The due date is before the start date.'
    const { createMock } = await renderGrid({
      check: async () => ({ ok: true, value: [{ index: 0, field: 'dueDate', message }] })
    })

    fireEvent.change(titleCell(1), { target: { value: 'Late task' } })

    const dueCell = within(rowElement(1))
    await waitFor(() => expect(dueCell.getByText(message)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Create 1 task' }))
    await waitFor(() => expect(dueCell.getByText(message)).toBeTruthy())
    expect(createMock).not.toHaveBeenCalled()
  })

  it('shows the message for a refused plan when Create is pressed', async () => {
    const { createMock } = await renderGrid({
      check: async () => ({ ok: false, error: 'Unknown milestone' })
    })

    fireEvent.change(titleCell(1), { target: { value: 'Task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create 1 task' }))

    // The message shows once from the live check and once from Create: both say the same.
    await waitFor(() => expect(screen.getAllByText('Unknown milestone').length).toBeGreaterThan(0))
    expect(createMock).not.toHaveBeenCalled()
  })

  it('removes a row and keeps at least one row to type in', async () => {
    await renderGrid()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }))
    })

    expect(titleCell(1)).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Row 2, Title' })).toBeNull()
  })
})
