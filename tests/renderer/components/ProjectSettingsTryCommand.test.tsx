// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], areas: [], loading: false, refreshProjects: async () => {} })
}))

const project: RendererProject = {
  id: 'p1',
  name: 'Garden',
  path: 'C:/work/garden',
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false,
  tryCommand: ''
}

function renderDialog(suggestedTryCommand?: string) {
  const updateProject = vi.fn(async (_id: string, updates: Partial<RendererProject>) => ({
    ok: true as const,
    value: { ...project, ...updates }
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
    describeProjectSetup: async () => ({
      ok: true,
      value: { kind: 'none', reason: 'no-lockfile' }
    }),
    updateProject
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: true, ai: false }}>
          <ProjectSettingsDialog
            project={project}
            suggestedTryCommand={suggestedTryCommand}
            onClose={() => undefined}
            onChanged={() => undefined}
          />
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  return updateProject
}

describe('ProjectSettingsDialog › Agents › Try command (N9.4)', () => {
  it('saves the command the person types, with examples beside it', async () => {
    const updateProject = renderDialog()
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    const field = await screen.findByRole('textbox', { name: 'Try command' })
    expect(field).toHaveAccessibleDescription(/npm run dev, npm run preview or npm test/)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(field, { target: { value: 'npm run dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('p1', { tryCommand: 'npm run dev' })
    )
  })

  it("opens on an agent's suggestion for the person to save, and saves nothing by itself", async () => {
    const updateProject = renderDialog('npm run preview')
    expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true')
    const field = await screen.findByRole('textbox', { name: 'Try command' })
    expect(field).toHaveValue('npm run preview')
    expect(field).toHaveAccessibleDescription('Suggested by the agent. Save it to use it.')
    expect(updateProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('p1', { tryCommand: 'npm run preview' })
    )
  })
})
