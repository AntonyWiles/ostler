// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererConfig } from '@shared/ostler-api'
import { AiSetupDialog } from '@renderer/views/settings/AiSetupDialog'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

let config: RendererConfig
let saveConfig: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

function renderDialog() {
  return render(
    <ToastProvider>
      <AiSetupDialog
        config={config}
        onClose={onClose}
        saveConfig={saveConfig}
        onKeyCleared={() => undefined}
      />
    </ToastProvider>
  )
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))

describe('AiSetupDialog', () => {
  beforeEach(() => {
    config = structuredClone(RENDERER_DEFAULT_CONFIG)
    config.ai.model = ''
    saveConfig = vi.fn(async () => undefined)
    onClose = vi.fn()
  })

  it('sets up Ollama without typing an address or a key', async () => {
    const testAIConnection = vi.fn(async () => ({
      ok: true as const,
      value: { model: 'llama3.2', responseMs: 120 }
    }))
    const findLocalAI = vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'found' as const,
        baseUrl: 'http://localhost:11434/v1',
        models: [
          { id: 'qwen3', label: 'qwen3' },
          { id: 'llama3.2', label: 'llama3.2' }
        ]
      }
    }))
    installOstlerApi({ findLocalAI, testAIConnection })
    renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }))
    next()
    expect(findLocalAI).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Find it' }))
    expect(await screen.findByText('Found Ollama')).toBeInTheDocument()
    expect(findLocalAI).toHaveBeenCalledWith('ollama')
    next()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('llama3.2')
    next()
    expect(await screen.findByText('It works')).toBeInTheDocument()
    expect(testAIConnection).toHaveBeenCalledWith({
      presetId: 'ollama',
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith({
        ai: { provider: 'custom', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' }
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('says how to start a local provider that is not running', async () => {
    const openAIProviderPage = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      openAIProviderPage,
      findLocalAI: async () => ({
        ok: true,
        value: {
          status: 'not-found',
          baseUrl: 'http://localhost:11434/v1',
          message: 'Nothing is answering at http://localhost:11434/v1. Is Ollama running?',
          downloadUrl: 'https://ollama.com/download'
        }
      })
    })
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Find it' }))
    expect(await screen.findByText(/Is Ollama running\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Download Ollama' }))
    expect(openAIProviderPage).toHaveBeenCalledWith('ollama')
  })

  it('sets up a cloud provider in four steps, sending the key to main only', async () => {
    const listAIModels = vi.fn(async () => ({
      ok: true as const,
      value: [
        { id: 'gpt-4.1', label: 'gpt-4.1' },
        { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }
      ]
    }))
    installOstlerApi({
      listAIModels,
      testAIConnection: async () => ({
        ok: true,
        value: { model: 'gpt-4.1-mini', responseMs: 300 }
      })
    })
    renderDialog()

    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI' }))
    next()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    const key = screen.getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    fireEvent.change(key, { target: { value: 'sk-test' } })
    next()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-4.1-mini')
    )
    expect(listAIModels).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: 'openai', apiKey: 'sk-test' })
    )
    next()
    expect(await screen.findByText('It works')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith({
        ai: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          apiKey: 'sk-test'
        }
      })
    )
  })

  it('shows a failed test as advice, with the raw error behind Details', async () => {
    installOstlerApi({
      listAIModels: async () => ({
        ok: true,
        value: [{ id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' }]
      }),
      testAIConnection: async () => ({
        ok: false,
        error:
          'The key was refused. Check it in Settings › AI.\n\nDetails: OpenAI API error: 401 Unauthorized'
      })
    })
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: 'OpenAI' }))
    next()
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-bad' } })
    next()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-4.1-mini')
    )
    next()
    expect(await screen.findByText(/The key was refused\./)).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('OpenAI API error: 401 Unauthorized')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
  })
})
