// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RendererConfig,
  RendererConfigUpdate,
  RendererProject,
  Result
} from '@shared/ostler-api'
import { SettingsView } from '@renderer/views/SettingsView'
import { FeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { getModelOptions } from '@shared/model-options'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const ostler = vi.hoisted(() => ({ projects: [] as RendererProject[] }))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({
    projects: ostler.projects,
    refreshProjects: async () => {},
    watcherStatus: null
  })
}))

const garden: RendererProject = {
  id: 'p1',
  name: 'Garden',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false,
  aiProfile: 'auto'
}

let config: RendererConfig
let updateConfig: ReturnType<typeof vi.fn>

/** Merges an update the way main does, one level deep. */
function merge(base: RendererConfig, update: RendererConfigUpdate): RendererConfig {
  const next = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(update)) {
    next[key] = { ...(base as unknown as Record<string, object>)[key], ...value }
  }
  return next as unknown as RendererConfig
}

function install(overrides: Parameters<typeof installOstlerApi>[0] = {}) {
  updateConfig = vi.fn(async (update: RendererConfigUpdate): Promise<Result<RendererConfig>> => {
    config = merge(config, update)
    return { ok: true, value: config }
  })
  installOstlerApi({
    getConfig: async () => ({ ok: true, value: config }),
    updateConfig,
    getDatabaseStats: async () => ({
      ok: true,
      value: {
        sizeBytes: 4096,
        watchEventCount: 3,
        gitEventCount: 2,
        harnessEventCount: 0,
        conversationCount: 1,
        oldestEvent: null,
        syncedBy: null
      }
    }),
    listBackups: async () => ({ ok: true, value: [] }),
    checkAgentRequirements: async () => ({
      ok: true,
      value: { gitVersion: 'git version 2.47.0', aiConfigured: false, runtimePresent: true }
    }),
    ...overrides
  })
}

function renderSettings(section: string) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <FeaturesProvider>
          <MemoryRouter initialEntries={[`/settings/${section}`]}>
            <Routes>
              <Route path="/settings/:section" element={<SettingsView />} />
            </Routes>
          </MemoryRouter>
        </FeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

const heading = (name: string) => screen.findByRole('heading', { level: 2, name })

describe('SettingsView', () => {
  beforeEach(() => {
    config = structuredClone(RENDERER_DEFAULT_CONFIG)
    ostler.projects = []
    install()
  })

  it('lists the sections in order, People after Projects', async () => {
    renderSettings('general')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual([
      'General',
      'Projects',
      'People',
      'Notifications',
      'AI',
      'Agents',
      'Connections',
      'Devices',
      'Data',
      'Advanced',
      'About'
    ])
  })

  it('opens General for a section that does not exist', async () => {
    renderSettings('harness')
    expect(await heading('General')).toBeInTheDocument()
  })

  it('General shows each group as a line with what it is set to, and opens it in place', async () => {
    localStorage.removeItem('ostler.settingsGroupsOpen')
    renderSettings('general')
    await heading('General')
    const startUp = screen.getByRole('button', { name: 'Start-up' })
    expect(startUp).toHaveAttribute('aria-expanded', 'false')
    expect(startUp).toHaveAccessibleDescription('Home')
    expect(screen.queryByRole('radio', { name: 'Home' })).toBeNull()
    fireEvent.click(startUp)
    expect(startUp).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked()
  })

  it('General saves the start page and shows Saved', async () => {
    localStorage.setItem('ostler.settingsGroupsOpen', JSON.stringify(['start-up']))
    renderSettings('general')
    await heading('General')
    fireEvent.click(screen.getByRole('radio', { name: 'The project you had open last' }))
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({ ui: { startPage: 'lastProject' } })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('Projects shows an empty state with a way to start', async () => {
    renderSettings('projects')
    await heading('Projects')
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New project…' }).length).toBeGreaterThan(0)
  })

  it('Notifications saves a switch, and hides the agent one while agents are off', async () => {
    renderSettings('notifications')
    await heading('Notifications')
    expect(screen.queryByRole('switch', { name: /agent/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'When a build fails' }))
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({ notifications: { onBuildFailure: false } })
    )
  })

  it('AI shows one Set up AI action until a provider is set up', async () => {
    renderSettings('ai')
    await heading('AI')
    expect(screen.getByText("Ostler AI isn't set up")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up AI' }))
    expect(await screen.findByRole('dialog', { name: 'Set up Ostler AI' })).toBeInTheDocument()
  })

  it('AI shows the provider, model and Change… once it is set up', async () => {
    config = merge(config, { ai: {} })
    config.ai = { ...config.ai, hasApiKey: true, apiKeyHint: '1234', model: 'gpt-4o' }
    renderSettings('ai')
    expect(await screen.findByText('Ostler AI is set up')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('Saved, ending 1234')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What Ostler AI sends' })).toBeNull()
  })

  it('Agents shows only the switch and its explanation while agents are off', async () => {
    renderSettings('agents')
    await heading('Agents')
    const toggle = screen.getByRole('switch', { name: 'Use AI agents for software projects' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/nothing reaches\s+your folder until you review/)).toBeInTheDocument()
    expect(screen.queryByText('Automation API')).not.toBeInTheDocument()

    // Turning agents on walks through the guided setup; nothing is saved until its last step.
    fireEvent.click(toggle)
    const dialog = await screen.findByRole('dialog', { name: 'Turn on AI agents' })
    expect(updateConfig).not.toHaveBeenCalled()
    for (let step = 0; step < 3; step++) {
      const nextButton = within(dialog).getByRole('button', { name: 'Next' })
      await waitFor(() => expect(nextButton).toBeEnabled())
      fireEvent.click(nextButton)
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on agents' }))
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({
        harness: {
          enabled: true,
          agentProvider: '',
          agentModel: '',
          maxConcurrentAgents: 1,
          autoRunQueued: false
        }
      })
    )
    expect(await screen.findByRole('heading', { name: 'Built-in agent' })).toBeInTheDocument()
    // The automation API has its own section now (D38).
    expect(screen.queryByRole('heading', { name: 'Automation API' })).not.toBeInTheDocument()
  })

  it('Agents lists a project without a folder and says agents need one', async () => {
    config = merge(config, { harness: { enabled: true }, automationApi: { enabled: true } })
    ostler.projects = [garden]
    const getHarnessState = vi.fn()
    install({ getHarnessState })
    renderSettings('agents')
    await heading('Agents')
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveDisplayValue('Garden')
    expect(screen.getByText(/Link a folder to a project/)).toBeInTheDocument()
    // The automation API and its tokens are in Settings › Connections (D38).
    expect(screen.queryByRole('button', { name: 'Create automation token' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Turn on the automation API' })).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Connect an agent yourself' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Health/ })).not.toBeInTheDocument()
    expect(getHarnessState).not.toHaveBeenCalled()
  })

  it("Agents shows the agent API's port beside agents' switch, and Advanced does not", async () => {
    config = merge(config, { harness: { enabled: true } })
    renderSettings('agents')
    await heading('Agents')
    const group = (await screen.findByRole('heading', { name: 'Agent API' })).closest('section')!
    const port = within(group as HTMLElement).getByRole('spinbutton', { name: 'Port' })
    expect(port).toHaveValue(config.harness.port)
    fireEvent.change(port, { target: { value: '9100' } })
    fireEvent.blur(port)
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith({ harness: { port: 9100 } }))
  })

  it('Advanced has no port: each API keeps its port beside its own switch', async () => {
    config = merge(config, { harness: { enabled: true } })
    renderSettings('advanced')
    await heading('Advanced')
    expect(screen.queryByRole('spinbutton', { name: /port/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Ports' })).toBeNull()
  })

  it('Connections turns the automation API on with agents off, and shows its port', async () => {
    ostler.projects = [garden]
    renderSettings('connections')
    await heading('Connections')
    expect(screen.getByText(/nothing listens/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Turn on the automation API' }))
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({ automationApi: { enabled: true } })
    )
    expect(config.harness.enabled).toBe(false)
    expect(await screen.findByRole('spinbutton', { name: 'Port' })).toHaveValue(
      config.automationApi.port
    )
    expect(screen.getByRole('button', { name: 'Create automation token' })).toBeInTheDocument()
    expect(
      screen.getByText(/Create an automation token to connect an assistant/)
    ).toBeInTheDocument()
  })

  it('Connections shows no warning about token encryption', async () => {
    config = merge(config, { automationApi: { enabled: true } })
    ostler.projects = [garden]
    renderSettings('connections')
    await heading('Connections')
    expect(screen.queryByText(/cannot encrypt/i)).not.toBeInTheDocument()
  })

  it('Connections shows how to connect an AI assistant, masked, and copies through main', async () => {
    config = merge(config, { automationApi: { enabled: true } })
    ostler.projects = [{ ...garden, hasAutomationToken: true }]
    const copyMcpClientConfig = vi.fn(async () => ({ ok: true as const, value: 'masked' }))
    install({
      describeMcpConnection: async () => ({
        ok: true,
        value: {
          url: 'http://127.0.0.1:8935/automation/p1/mcp',
          command: 'C:\\Ostler\\Ostler.exe --mcp-stdio --project p1',
          httpConfig: '{ "Authorization": "Bearer ••••abcd" }',
          stdioConfig: '{ "command": "C:\\\\Ostler\\\\Ostler.exe" }'
        }
      }),
      copyMcpClientConfig
    })
    renderSettings('connections')
    await heading('Connections')
    expect(await screen.findByText('http://127.0.0.1:8935/automation/p1/mcp')).toBeInTheDocument()
    expect(screen.getByText(/--mcp-stdio --project p1/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Client settings for HTTP' })).toHaveValue(
      '{ "Authorization": "Bearer ••••abcd" }'
    )
    expect(screen.getByText(/may send what it reads/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy HTTP settings' }))
    await waitFor(() => expect(copyMcpClientConfig).toHaveBeenCalledWith('p1', 'http'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy stdio settings' }))
    await waitFor(() => expect(copyMcpClientConfig).toHaveBeenCalledWith('p1', 'stdio'))
  })

  it('Agents shows the refusal and stays on while agent work is in flight', async () => {
    config = merge(config, { harness: { enabled: true } })
    install({
      updateConfig: vi.fn(async () => ({
        ok: false as const,
        error: "Agents can't be turned off while they have work. Site: 1 agent run queued."
      }))
    })
    renderSettings('agents')
    await heading('Agents')
    fireEvent.click(screen.getByRole('switch', { name: 'Use AI agents for software projects' }))
    expect(await screen.findByText(/Site: 1 agent run queued/)).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Use AI agents for software projects' })
    ).toBeChecked()
  })

  it('Data shows the database size and backups', async () => {
    renderSettings('data')
    await heading('Data')
    expect(await screen.findByText('4 kB')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Backups' })).toBeInTheDocument()
  })

  it('Data warns when the data folder is in a synced folder, and keeps the database size', async () => {
    install({
      getDatabaseStats: async () => ({
        ok: true,
        value: {
          sizeBytes: 4096,
          watchEventCount: 0,
          gitEventCount: 0,
          harnessEventCount: 0,
          conversationCount: 0,
          oldestEvent: null,
          syncedBy: 'Dropbox'
        }
      })
    })
    renderSettings('data')
    await heading('Data')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dropbox')
    expect(screen.getByText('Database size')).toBeInTheDocument()
  })

  it('Data shows no synced-folder warning when the data folder is not synced', async () => {
    renderSettings('data')
    await heading('Data')
    await screen.findByText('4 kB')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows Git in the menu only while Advanced or Git is on show', async () => {
    renderSettings('general')
    await heading('General')
    expect(screen.queryByRole('link', { name: 'Git' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Advanced' }))
    await heading('Advanced')
    expect(screen.getByRole('link', { name: 'Git' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Commits to read at a time' })).toBeNull()
  })

  it('Git saves a number when the field loses focus', async () => {
    renderSettings('git')
    await heading('Git')
    expect(screen.getByRole('link', { name: 'Git' })).toHaveAttribute('aria-current', 'page')
    const field = screen.getByRole('spinbutton', { name: 'Commits to read at a time' })
    fireEvent.change(field, { target: { value: '80' } })
    fireEvent.blur(field)
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({ git: { maxCommitsToFetch: 80 } })
    )
  })

  it('About shows the version and Copy diagnostics', async () => {
    install({ getAppVersion: async () => ({ ok: true, value: '0.1.0' }) })
    renderSettings('about')
    await heading('About')
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeInTheDocument()
  })

  it('About shows the open source licences in a dialog', async () => {
    const getThirdPartyNotices = vi.fn(async () => ({
      ok: true as const,
      value: '# Third-party notices\n\n## react 19.1.0\n\nLicence: MIT'
    }))
    install({ getThirdPartyNotices })
    renderSettings('about')
    fireEvent.click(await screen.findByRole('button', { name: 'Open source licences' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open source licences' })
    expect(await within(dialog).findByText(/## react 19.1.0/)).toBeInTheDocument()
    expect(getThirdPartyNotices).toHaveBeenCalledTimes(1)
  })

  it('About says updates are off in development, without the update switches', async () => {
    install({
      getUpdateState: async () => ({ ok: true, value: { status: 'off', reason: 'development' } })
    })
    renderSettings('about')
    expect(await screen.findByText('Updates are off in development builds.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    expect(screen.queryByRole('switch', { name: /Check for updates automatically/ })).toBeNull()
  })

  it('About checks for updates and saves the update switches', async () => {
    const checkForUpdates = vi.fn(async () => ({
      ok: true as const,
      value: { status: 'up-to-date' as const, checkedAt: Date.UTC(2026, 9, 9, 9) }
    }))
    install({
      getUpdateState: async () => ({ ok: true, value: { status: 'idle' } }),
      checkForUpdates
    })
    renderSettings('about')
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText(/is up to date/)).toBeInTheDocument()
    expect(checkForUpdates).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch', { name: /Receive beta updates/ }))
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith({ updates: { receiveBeta: true } })
    )
  })

  it('About offers Restart when agents finish while agents work, and shows the notes', async () => {
    const restartToUpdate = vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'ready' as const,
        version: '1.1.0',
        notes: 'Faster boards',
        agentsRunning: 1,
        restartWhenAgentsFinish: true
      }
    }))
    install({
      getUpdateState: async () => ({
        ok: true,
        value: {
          status: 'ready',
          version: '1.1.0',
          notes: 'Faster boards',
          agentsRunning: 1,
          restartWhenAgentsFinish: false
        }
      }),
      restartToUpdate
    })
    renderSettings('about')
    fireEvent.click(await screen.findByRole('button', { name: 'Restart when agents finish' }))
    expect(restartToUpdate).toHaveBeenCalledWith('when-agents-finish')
    expect(await screen.findByText(/installs when the agents finish/)).toBeInTheDocument()
    expect(screen.getByText('Faster boards')).toBeInTheDocument()
  })
})

describe('settings model options', () => {
  it('matches preset URLs with endpoint suffixes', () => {
    const baseUrl = 'https://opencode.ai/zen/go/v1/chat/completions/'
    expect(getModelOptions('custom', baseUrl).some(({ value }) => value === 'gpt-5.6-luna')).toBe(
      true
    )
  })
})
