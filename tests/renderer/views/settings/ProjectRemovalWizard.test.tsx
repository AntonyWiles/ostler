// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  RendererProject
} from '@shared/ostler-api'
import { ProjectRemovalWizard } from '@renderer/views/settings/ProjectRemovalWizard'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'p1',
  name: 'Garden plan',
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

const inventory = {
  totalRows: 3,
  rowCounts: [{ table: 'planning_work_items', rows: 3 }],
  unexportedCommits: 0,
  sessionBranches: [],
  controlPath: null,
  libraryItemCount: 0,
  libraryBytes: 0,
  libraryFileCount: 0,
  libraryDir: null,
  aiDirectories: [],
  openSessions: [],
  runningSessions: 0,
  staleSessions: 0,
  reviewSessions: 0,
  archiveRoot: null
} as unknown as ProjectRemovalInventory

function renderWizard() {
  const purgeProjectData = vi.fn(async (_id: string) => ({
    ok: true as const,
    value: { deletedRows: [], removedPaths: [], failedPaths: [] } as unknown as ProjectRemovalPurge
  }))
  installOstlerApi({
    getProjectRemovalInventory: async () => ({ ok: true, value: inventory }),
    purgeProjectData
  })
  render(<ProjectRemovalWizard project={project} onClose={vi.fn()} onRemoved={vi.fn()} />)
  return { purgeProjectData }
}

describe('ProjectRemovalWizard', () => {
  it('is a stepped dialog that marks the current step', async () => {
    renderWizard()
    const dialog = screen.getByRole('dialog', { name: 'Remove Garden plan' })
    const steps = within(dialog).getByRole('list', { name: 'Steps' })
    // No folder: no agent-commit step.
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((step) => step.textContent)
    ).toEqual(['1What Ostler holds', '2Records', '3Remove'])
    expect(within(steps).getByText('What Ostler holds').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
    await waitFor(() => expect(within(dialog).getByText('Database records')).toBeTruthy())
  })

  it('removes only after the project name is typed', async () => {
    const { purgeProjectData } = renderWizard()
    const next = await screen.findByRole('button', { name: 'Next' })
    await waitFor(() => expect(next).not.toBeDisabled())
    fireEvent.click(next)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const remove = screen.getByRole('button', { name: 'Remove permanently' })
    expect(remove).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type the project name to confirm'), {
      target: { value: 'Garden plan' }
    })
    expect(remove).not.toBeDisabled()
    fireEvent.click(remove)
    await waitFor(() => expect(purgeProjectData).toHaveBeenCalledWith('p1'))
  })
})
