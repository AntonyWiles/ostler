// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { installOstlerApi } from '../fixtures/ostler-api'

const projects = ['alpha', 'beta'].map(
  (id) =>
    ({
      id,
      name: id,
      path: null,
      color: '#3b82f6',
      enabled: true,
      customIgnorePatterns: [],
      notes: '',
      tags: [],
      addedAt: 0,
      lastActivity: null,
      hasAutomationToken: false
    }) as unknown as RendererProject
)

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

// Every project's views: the bulk of what the palette lists.
const allProjectViews = vi.hoisted(() => vi.fn())
vi.mock('@renderer/navigation/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@renderer/navigation/registry')>()
  allProjectViews.mockImplementation(registry.allProjectViews)
  return { ...registry, allProjectViews }
})

describe('the command palette while closed', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('builds its list only once it opens, not on every project and view switch', () => {
    installOstlerApi({
      search: async () => ({ ok: true, value: [] }),
      listSavedViews: async () => ({ ok: true, value: [] })
    })
    const palette = (open: boolean) => (
      <MemoryRouter initialEntries={['/projects/alpha/board']}>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <CommandPalette open={open} onOpenChange={vi.fn()} onNewProject={vi.fn()} />
        </StaticFeaturesProvider>
      </MemoryRouter>
    )
    const { rerender } = render(palette(false))
    expect(allProjectViews).not.toHaveBeenCalled()
    rerender(palette(true))
    expect(allProjectViews).toHaveBeenCalled()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })
})
