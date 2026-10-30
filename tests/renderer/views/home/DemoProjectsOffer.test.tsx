// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { DemoProjectsOffer, DEMO_OFFER_DISMISSED_KEY } from '@renderer/views/home/DemoProjectsOffer'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const ostler = vi.hoisted(() => ({
  projects: [] as RendererProject[],
  refreshProjects: vi.fn(async () => {})
}))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: ostler.projects, refreshProjects: ostler.refreshProjects })
}))

const project = (id: string, name: string, demo?: 'simple' | 'advanced') =>
  ({ id, name, enabled: true, path: null, demo }) as unknown as RendererProject

function renderOffer() {
  const removed: string[] = []
  installOstlerApi({
    getDemoProjects: async () => ({
      ok: true,
      value: {
        projects: [{ id: 'd1', name: 'Demo', kind: 'simple', enabled: true }],
        addedTasks: 0,
        addedComments: 0,
        untouched: false
      }
    }),
    removeDemoProjects: async () => {
      removed.push('demos')
      return { ok: true, value: 1 }
    }
  })
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <DemoProjectsOffer />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  return removed
}

afterEach(() => localStorage.clear())

describe('Home › Done with the demos?', () => {
  it('waits until there is a project of your own beside the demos', () => {
    ostler.projects = [project('d1', 'Demo', 'simple')]
    renderOffer()
    expect(screen.queryByRole('region', { name: 'Done with the demos?' })).toBeNull()
  })

  it('removes the demos after one confirmation', async () => {
    ostler.projects = [project('d1', 'Demo', 'simple'), project('p1', 'Garden')]
    const removed = renderOffer()
    const offer = screen.getByRole('region', { name: 'Done with the demos?' })
    fireEvent.click(within(offer).getByRole('button', { name: 'Remove the demos…' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove the demo project?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove the demo' }))
    await waitFor(() => expect(removed).toEqual(['demos']))
  })

  it('stops offering once you keep them', () => {
    ostler.projects = [project('d1', 'Demo', 'simple'), project('p1', 'Garden')]
    renderOffer()
    fireEvent.click(screen.getByRole('button', { name: 'Keep the demos' }))
    expect(screen.queryByRole('region', { name: 'Done with the demos?' })).toBeNull()
    expect(localStorage.getItem(DEMO_OFFER_DISMISSED_KEY)).toBe('true')
  })
})
