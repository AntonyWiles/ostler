// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRequirements, RendererConfig } from '@shared/ostler-api'
import { AgentSetupDialog } from '@renderer/views/settings/AgentSetupDialog'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

let config: RendererConfig
let saveConfig: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>
let onSetUpAi: ReturnType<typeof vi.fn>

const ALL_GOOD: AgentRequirements = {
  gitVersion: 'git version 2.47.0.windows.1',
  aiConfigured: true,
  runtimePresent: true
}

function renderDialog(requirements: AgentRequirements) {
  installOstlerApi({
    checkAgentRequirements: vi.fn(async () => ({ ok: true as const, value: requirements }))
  })
  return render(
    <ToastProvider>
      <AgentSetupDialog
        config={config}
        onClose={onClose}
        saveConfig={saveConfig}
        onSetUpAi={onSetUpAi}
      />
    </ToastProvider>
  )
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))

async function checks() {
  next()
  return within(await screen.findByRole('list', { name: 'Requirements' }))
}

describe('AgentSetupDialog', () => {
  beforeEach(() => {
    config = structuredClone(RENDERER_DEFAULT_CONFIG)
    config.ai = { ...config.ai, provider: 'openai', model: 'gpt-4o', hasApiKey: true }
    saveConfig = vi.fn(async () => undefined)
    onClose = vi.fn()
    onSetUpAi = vi.fn()
  })

  it('explains what agents do and how they are kept safe', () => {
    renderDialog(ALL_GOOD)
    expect(screen.getByText(/works on its own copy of the project/)).toBeInTheDocument()
    expect(
      screen.getByText(/your folder stays as it is until you apply the work/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Stop all AI in the status bar/)).toBeInTheDocument()
  })

  it('says how to install Git when it is missing', async () => {
    renderDialog({ ...ALL_GOOD, gitVersion: null })
    const list = await checks()
    expect(list.getByText(/Install Git for Windows from git-scm.com/)).toBeInTheDocument()
    expect(screen.getByText(/fix this later/)).toBeInTheDocument()
  })

  it("links to Ostler AI's setup when AI is not set up", async () => {
    renderDialog({ ...ALL_GOOD, aiConfigured: false })
    const list = await checks()
    fireEvent.click(list.getByRole('button', { name: 'Set up AI…' }))
    expect(onSetUpAi).toHaveBeenCalled()
  })

  it('passes every check, then turns agents on with the choices in one save', async () => {
    renderDialog(ALL_GOOD)
    const list = await checks()
    expect(list.getAllByText('Ready')).toHaveLength(3)
    expect(screen.queryByText(/later/)).not.toBeInTheDocument()
    next()
    expect(screen.getByRole('radio', { name: /Same as/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Another model' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), {
      target: { value: 'gpt-5.5' }
    })
    next()
    expect(screen.getByRole('spinbutton', { name: 'Agents at once' })).toHaveValue(1)
    expect(screen.getByRole('switch', { name: 'Run queued tasks automatically' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on agents' }))
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith({
        harness: {
          enabled: true,
          agentProvider: 'openai',
          agentModel: 'gpt-5.5',
          maxConcurrentAgents: 1,
          autoRunQueued: false
        }
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('leaves agents off when closed', () => {
    renderDialog(ALL_GOOD)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
  })
})
