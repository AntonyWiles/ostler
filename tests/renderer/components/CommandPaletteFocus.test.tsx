// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject, SearchResult } from '@shared/ostler-api'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { FocusProvider } from '@renderer/time/FocusProvider'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

const projects = [
  {
    id: 'alpha',
    name: 'Alpha launch',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false
  } as RendererProject
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

const TASK: SearchResult = {
  type: 'task',
  id: 't1',
  projectId: 'alpha',
  title: 'Write the proposal',
  snippet: [{ text: 'Write the proposal', match: true }],
  workItemId: 't1',
  score: -1
}

describe('Focus on… in the command palette (N3.5)', () => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()

  it('picks a task, closes the palette and asks for the length', async () => {
    const onOpenChange = vi.fn()
    const search = vi.fn(async (_query: string, options?: { types?: string[] }) => ({
      ok: true as const,
      value: options?.types?.includes('task') ? [TASK] : []
    }))
    installOstlerApi({
      search,
      listSavedViews: async () => ({ ok: true, value: [] }),
      getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }),
      getTimer: async () => ({ ok: true, value: { running: null, interrupted: null } }),
      getFocus: async () => ({ ok: true, value: null })
    })
    render(
      <ToastProvider>
        <MemoryRouter>
          <TimerProvider>
            <FocusProvider>
              <CommandPalette open onOpenChange={onOpenChange} onNewProject={vi.fn()} />
            </FocusProvider>
          </TimerProvider>
        </MemoryRouter>
      </ToastProvider>
    )

    const input = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(input, { target: { value: 'focus on' } })
    fireEvent.click((await screen.findAllByRole('option', { name: /^Focus on/ }))[0])
    expect((input as HTMLInputElement).placeholder).toBe('Find a task to focus on')

    fireEvent.change(input, { target: { value: 'write' } })
    await waitFor(() =>
      expect(search).toHaveBeenCalledWith('write', expect.objectContaining({ types: ['task'] }))
    )
    fireEvent.click(await screen.findByRole('option', { name: /Write the proposal/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    const dialog = await screen.findByRole('dialog', { name: 'Focus on Write the proposal' })
    expect(
      (within(dialog).getByRole('radio', { name: '25 minutes' }) as HTMLInputElement).checked
    ).toBe(true)
  })
})
