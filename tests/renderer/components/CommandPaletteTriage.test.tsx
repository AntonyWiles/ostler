// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { installOstlerApi } from '../fixtures/ostler-api'

function project(id: string, name: string, triageCaptures: boolean): RendererProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    triageCaptures
  } as RendererProject
}

// Off and empty, triaging, and off with a task still waiting.
const projects = [
  project('alpha', 'Alpha', false),
  project('beta', 'Beta', true),
  project('gamma', 'Gamma', false)
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

describe('the command palette and To triage', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('lists To triage only for projects where it can hold something', async () => {
    installOstlerApi({
      search: async () => ({ ok: true, value: [] }),
      listSavedViews: async () => ({ ok: true, value: [] })
    })
    render(
      <MemoryRouter initialEntries={['/home']}>
        <StaticFeaturesProvider
          value={{ agents: false, ai: false, triageWaiting: new Set(['gamma']) }}
        >
          <CommandPalette open onOpenChange={vi.fn()} onNewProject={vi.fn()} />
        </StaticFeaturesProvider>
      </MemoryRouter>
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Command palette search' }), {
      target: { value: 'To triage' }
    })
    const names = () => screen.getAllByRole('option').map((option) => option.textContent ?? '')
    await waitFor(() => expect(names().some((name) => name.includes('Beta: To triage'))).toBe(true))
    expect(names().some((name) => name.includes('Gamma: To triage'))).toBe(true)
    expect(names().some((name) => name.includes('Alpha: To triage'))).toBe(false)
  })
})
