// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnipPreview } from '@shared/snip'
import { QuickAddProvider, useQuickAdd } from '@renderer/components/quick-add/QuickAddProvider'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

/**
 * Snip to task (N4.2a): quick add opens with the snip as a thumbnail and an
 * empty title. Add creates the task and then stores the picture with it;
 * Cancel drops the picture and stores nothing.
 */

const project = { id: 'p1', name: 'Website', enabled: true, path: null }

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false, refreshProjects: async () => {} })
}))

const SNIP: SnipPreview = {
  snipId: 'snip-1',
  thumbnail: 'data:image/png;base64,iVBORw0KGgo=',
  width: 640,
  height: 360
}

function Opener() {
  const quickAdd = useQuickAdd()
  return (
    <button type="button" onClick={() => quickAdd.open({ snip: SNIP })}>
      Open with snip
    </button>
  )
}

function renderWithSnip() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <QuickAddProvider>
            <Opener />
          </QuickAddProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open with snip' }))
}

beforeEach(() => localStorage.clear())

describe('quick add with a snip', () => {
  it('shows the picture as a thumbnail, with an empty title', async () => {
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderWithSnip()
    const picture = await screen.findByRole('img', { name: 'The snip, 640 × 360' })
    expect(picture.getAttribute('src')).toBe(SNIP.thumbnail)
    expect(screen.getByRole('dialog', { name: 'Snip to task' })).toBeTruthy()
    expect(
      (screen.getByRole('textbox', { name: 'Quick add a task' }) as HTMLInputElement).value
    ).toBe('')
  })

  it('Add creates the task, then stores the snip with it', async () => {
    const order: string[] = []
    const createPlanningWorkItem = vi.fn(async (projectId: string, input: { title: string }) => {
      order.push('task')
      return {
        ok: true as const,
        value: makeWorkItem('w1', { projectId, title: input.title })
      }
    })
    const saveSnipToTask = vi.fn(async () => {
      order.push('snip')
      return { ok: true as const, value: {} as never }
    })
    const discardSnip = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      createPlanningWorkItem: createPlanningWorkItem as never,
      saveSnipToTask,
      discardSnip
    })
    renderWithSnip()
    const field = await screen.findByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(field, { target: { value: 'The chart is upside down' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(saveSnipToTask).toHaveBeenCalledWith('p1', 'w1', 'snip-1'))
    expect(order).toEqual(['task', 'snip'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(discardSnip).not.toHaveBeenCalled()
  })

  it('Cancel drops the snip and creates nothing', async () => {
    const createPlanningWorkItem = vi.fn()
    const saveSnipToTask = vi.fn()
    const discardSnip = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      createPlanningWorkItem,
      saveSnipToTask,
      discardSnip
    })
    renderWithSnip()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(discardSnip).toHaveBeenCalledWith('snip-1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createPlanningWorkItem).not.toHaveBeenCalled()
    expect(saveSnipToTask).not.toHaveBeenCalled()
  })
})
