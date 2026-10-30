// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OstlerAPI } from '@shared/ostler-api'
import type { TryRun } from '@shared/try-it'
import { TryItPanel, type TryItPanelProps } from '@renderer/views/planning/TryItPanel'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

function tryRun(overrides: Partial<TryRun> = {}): TryRun {
  return {
    projectId: 'p1',
    sessionId: 's1',
    command: 'npm run dev',
    state: 'running',
    exitCode: null,
    lines: [],
    startedAt: new Date().toISOString(),
    leftFiles: [],
    ...overrides
  }
}

function renderPanel(
  props: Partial<TryItPanelProps> = {},
  api: Partial<OstlerAPI> = {},
  initial: TryRun | null = null
) {
  let listener: ((run: TryRun) => void) | null = null
  const calls = {
    startTryRun: vi.fn(async (_p: string, _s: string, _ack: boolean) => ({
      ok: true as const,
      value: tryRun({ state: 'setting-up' })
    })),
    stopTryRun: vi.fn(async () => ({ ok: true as const, value: tryRun({ state: 'stopped' }) })),
    undoTryLeftFiles: vi.fn(async () => ({
      ok: true as const,
      value: tryRun({ state: 'stopped', leftFiles: [] })
    })),
    keepTryLeftFiles: vi.fn(async () => ({
      ok: true as const,
      value: tryRun({ state: 'stopped', leftFiles: [] })
    })),
    openTryAddress: vi.fn(async () => ({ ok: true as const, value: undefined }))
  }
  installOstlerApi({
    getTryRun: async () => ({ ok: true, value: initial }),
    onTryRunChanged: (callback) => {
      listener = callback
      return () => {
        listener = null
      }
    },
    ...calls,
    ...api
  })
  const onUseCommand = vi.fn()
  render(
    <ToastProvider>
      <ConfirmProvider>
        <TryItPanel
          projectId="p1"
          sessionId="s1"
          tryCommand="npm run dev"
          tryItWarningSeen
          onUseCommand={onUseCommand}
          {...props}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  const push = (run: TryRun) => act(() => listener?.(run))
  return { calls, onUseCommand, push }
}

describe('TryItPanel (N9.4)', () => {
  it('is disabled with a reason while no try command is set', async () => {
    renderPanel({ tryCommand: '' })
    const button = await screen.findByRole('button', { name: 'Try it' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/Set a try command in Project settings › Agents/)
  })

  it('warns before the first run in a project, and runs only once accepted', async () => {
    const { calls } = renderPanel({ tryItWarningSeen: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Try it' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      "Try it runs npm run dev on the agent's code, with your rights, as running it yourself would. Only try work you are willing to run."
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.startTryRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    const again = await screen.findByRole('alertdialog')
    fireEvent.click(within(again).getByRole('button', { name: 'Try it' }))
    await waitFor(() => expect(calls.startTryRun).toHaveBeenCalledWith('p1', 's1', true))
  })

  it('runs at once when the warning was seen', async () => {
    const { calls } = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Try it' }))
    await waitFor(() => expect(calls.startTryRun).toHaveBeenCalledWith('p1', 's1', false))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows the output live, links local addresses only, and opens them', async () => {
    const { calls, push } = renderPanel({}, {}, tryRun())
    await screen.findByText('Running')
    push(
      tryRun({
        lines: ['$ npm run dev', 'Local: http://localhost:5173/', 'Docs: https://example.com/']
      })
    )
    const output = await screen.findByRole('region', { name: 'Try it' })
    const link = within(output).getByRole('link', { name: 'http://localhost:5173/' })
    expect(within(output).queryByRole('link', { name: 'https://example.com/' })).toBeNull()
    expect(within(output).getByText(/Docs: https:\/\/example\.com\//)).toBeInTheDocument()
    fireEvent.click(link)
    expect(calls.openTryAddress).toHaveBeenCalledWith('http://localhost:5173/')
    push(tryRun({ state: 'exited', exitCode: 1, lines: ['$ npm run dev', 'boom'] }))
    expect(await screen.findByText('Exited with code 1')).toBeInTheDocument()
  })

  it('Stop stops the run', async () => {
    const { calls } = renderPanel({}, {}, tryRun())
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(calls.stopTryRun).toHaveBeenCalledWith('p1', 's1'))
    expect(await screen.findByText('Stopped')).toBeInTheDocument()
  })

  it('lists the files the run left, with Undo those changes and Keep them', async () => {
    const { calls } = renderPanel(
      {},
      {},
      tryRun({ state: 'stopped', leftFiles: ['package-lock.json', 'dist/app.js', 'notes.txt'] })
    )
    expect(await screen.findByText('Try it left 3 changed files.')).toBeInTheDocument()
    expect(screen.getByText('dist/app.js')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo those changes' }))
    await waitFor(() => expect(calls.undoTryLeftFiles).toHaveBeenCalledWith('p1', 's1'))
    await waitFor(() => expect(screen.queryByText('Try it left 3 changed files.')).toBeNull())
    expect(calls.keepTryLeftFiles).not.toHaveBeenCalled()
  })

  it("shows the agent's suggestion with Use this command, and never runs it", async () => {
    const { calls, onUseCommand } = renderPanel({ tryCommand: '', suggestion: 'npm run preview' })
    expect(await screen.findByText('The agent suggests:')).toBeInTheDocument()
    expect(screen.getByText('npm run preview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this command' }))
    expect(onUseCommand).toHaveBeenCalledWith('npm run preview')
    expect(calls.startTryRun).not.toHaveBeenCalled()
  })
})
