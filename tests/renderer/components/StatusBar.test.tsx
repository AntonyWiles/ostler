// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProjectStateUpdate, RendererConfig } from '@shared/ostler-api'
import { StatusBar } from '@renderer/components/StatusBar'
import { FeaturesProvider } from '@renderer/navigation/features'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

function setup(options: { agents: boolean; apiKey: boolean; activeRequests?: number }) {
  const listeners: Array<(update: ProjectStateUpdate) => void> = []
  const config: RendererConfig = {
    ...RENDERER_DEFAULT_CONFIG,
    harness: { ...RENDERER_DEFAULT_CONFIG.harness, enabled: options.agents },
    ai: { ...RENDERER_DEFAULT_CONFIG.ai, hasApiKey: options.apiKey }
  }
  installOstlerApi({
    getConfig: async () => ({ ok: true, value: config }),
    getAIHaltState: async () => ({
      ok: true,
      value: { halted: false, activeRequests: options.activeRequests ?? 0 }
    }),
    onProjectStateChange: (listener) => {
      listeners.push(listener)
      return () => {}
    }
  })
  render(
    <FeaturesProvider>
      <StatusBar />
    </FeaturesProvider>
  )
  return {
    push: (update: ProjectStateUpdate) =>
      act(() => listeners.forEach((listener) => listener(update)))
  }
}

describe('StatusBar', () => {
  it('shows only background activity: no watcher, database size or AI setup', async () => {
    setup({ agents: true, apiKey: true })
    await screen.findByRole('button', { name: 'Stop all AI' })
    expect(screen.queryByText(/watched|Watching|DB:|AI: /)).toBeNull()
  })

  it('offers Stop all AI while AI is on, even with agents off', async () => {
    setup({ agents: false, apiKey: true })
    expect(await screen.findByRole('button', { name: 'Stop all AI' })).toBeInTheDocument()
  })

  it('hides Stop all AI while neither AI nor agents are on', async () => {
    setup({ agents: false, apiKey: false })
    await waitFor(() => expect(window.ostlerAPI).toBeDefined())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Stop all AI' })).toBeNull()
  })

  it('says AI is busy while a model request is waiting, from the pushed count', async () => {
    const { push } = setup({ agents: false, apiKey: true, activeRequests: 1 })
    expect(await screen.findByText('AI busy')).toBeInTheDocument()
    push({ projectId: '', field: 'ai', data: { activeRequests: 0 } })
    expect(screen.queryByText('AI busy')).toBeNull()
    push({ projectId: '', field: 'ai', data: { activeRequests: 2 } })
    expect(screen.getByText('AI busy')).toBeInTheDocument()
  })
})
