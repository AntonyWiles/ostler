// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectAiSettings, RendererProject } from '@shared/ostler-api'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

// The projects already in Ostler, for the name's duplicate warning.
const ostler = vi.hoisted(() => ({ projects: [] as { id: string; name: string }[] }))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: ostler.projects, loading: false, refreshProjects: async () => {} })
}))

const project: RendererProject = {
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

function renderDialog(ai: boolean, myRole: 'owner' | 'editor' | 'viewer' | null = null) {
  let settings: ProjectAiSettings = {
    projectId: 'p1',
    profileSetting: 'auto',
    profile: 'general'
  }
  const updateProjectAISettings = vi.fn(
    async (_id: string, updates: { profileSetting?: 'auto' | 'software' | 'general' }) => {
      settings = { ...settings, ...updates }
      return { ok: true as const, value: settings }
    }
  )
  installOstlerApi({
    getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
    getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not needed' }),
    getProjectAISettings: async () => ({ ok: true, value: settings }),
    getPlanningLabels: async () => ({ ok: true, value: [] }),
    getShareState: async () => ({
      ok: true,
      value: myRole
        ? {
            projectId: 'p1',
            status: 'up-to-date' as const,
            folder: 'C:/Users/ann/OneDrive/Garden',
            members: [],
            lastSyncedAt: null,
            waitingToSend: 0,
            waitingToApply: 0,
            problems: [],
            removed: false,
            myRole,
            inPersonalSpace: false,
            sharedCapabilities: []
          }
        : null
    }),
    updateProjectAISettings
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai }}>
          <ProjectSettingsDialog
            project={project}
            onClose={() => undefined}
            onChanged={() => undefined}
          />
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  return updateProjectAISettings
}

describe('ProjectSettingsDialog › sections', () => {
  it('shows one section at a time, with every section down the side', async () => {
    renderDialog(false)
    const sections = await screen.findByRole('tablist', { name: 'Settings sections' })
    expect(sections).toHaveAttribute('aria-orientation', 'vertical')
    expect(
      within(sections)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual([
      'General',
      'Tasks',
      'People',
      'Board',
      'Budget',
      'Folder and GitHub',
      'Sharing',
      'Backup',
      'Check and repair',
      'Export and import',
      'Remove'
    ])
    expect(screen.getByRole('textbox', { name: 'Project name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Link a folder…' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Folder and GitHub' }))
    expect(screen.getByRole('button', { name: 'Link a folder…' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull()
  })
})

describe('ProjectSettingsDialog › a shared project', () => {
  it('lets a Viewer see the name and icon but not change them, and says who can', async () => {
    renderDialog(false, 'viewer')
    expect(await screen.findByText(/only an owner or editor can change them/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Project name' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'None' })).toBeDisabled()
  })

  it('lets an Owner or Editor change them', async () => {
    renderDialog(false, 'editor')
    expect(await screen.findByRole('textbox', { name: 'Project name' })).toBeEnabled()
    expect(screen.queryByText(/only an owner or editor can change them/)).toBeNull()
  })
})

describe('ProjectSettingsDialog › Ostler AI', () => {
  it('chooses the kind of project', async () => {
    const update = renderDialog(true)
    expect(await screen.findByRole('radio', { name: 'Auto (general)' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Software' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { profileSetting: 'software' }))
  })

  it('shows no AI settings while Ostler AI is not set up', async () => {
    renderDialog(false)
    expect(await screen.findByRole('dialog', { name: 'Garden settings' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Software' })).toBeNull()
  })
})

describe('ProjectSettingsDialog › Agents › Conventions', () => {
  it('saves the conventions when the field is left, only while agents are on', async () => {
    const withFolder: RendererProject = { ...project, path: 'C:/work/garden', agentConventions: '' }
    const updateProject = vi.fn(async (_id: string, updates: Partial<RendererProject>) => ({
      ok: true as const,
      value: { ...withFolder, ...updates }
    }))
    installOstlerApi({
      getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
      getProjectAutoDispatchConfig: async () => ({
        ok: true,
        value: {
          projectId: 'p1',
          enabled: false,
          maxConcurrentEmbeddedSessions: 0,
          aiOverrideEnabled: false,
          defaultProvider: '',
          defaultModel: '',
          defaultEffort: '',
          autoArchiveDoneAfterDays: 0
        }
      }),
      getProjectAISettings: async () => ({ ok: false, error: 'not needed' }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      updateProject
    })
    render(
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: true, ai: false }}>
            <ProjectSettingsDialog
              project={withFolder}
              onClose={() => undefined}
              onChanged={() => undefined}
            />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    const field = await screen.findByRole('textbox', { name: 'Conventions (Markdown)' })
    fireEvent.change(field, { target: { value: '# Rules\n\nUse tabs.' } })
    fireEvent.blur(field)
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('p1', { agentConventions: '# Rules\n\nUse tabs.' })
    )
  })
})
