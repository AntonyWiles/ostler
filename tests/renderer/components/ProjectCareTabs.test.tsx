// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  ProjectBackupEntry,
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  RendererProject
} from '@shared/ostler-api'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const ostler = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }))
vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false, refreshProjects: ostler.refreshProjects })
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
  aiProfile: 'auto'
}

const inventory = (overrides: Partial<ProjectRemovalInventory> = {}): ProjectRemovalInventory => ({
  projectId: 'p1',
  projectName: 'Garden',
  projectPath: 'C:/work/garden',
  rowCounts: [{ table: 'planning_work_items', rows: 12 }],
  totalRows: 12,
  harnessDir: null,
  aiDirectories: [],
  libraryDir: null,
  libraryItemCount: 0,
  libraryFileCount: 0,
  libraryBytes: 0,
  sessionBranches: [],
  openSessions: [],
  runningSessions: 0,
  staleSessions: 0,
  reviewSessions: 0,
  archiveRoot: 'C:/work/garden/.ostler-archive',
  databasePath: 'C:/data/ostler.db',
  toDelete: [
    { kind: 'library', path: 'C:/data/library/p1', fileCount: 3, bytes: 4096 },
    { kind: 'aiDrafts', path: 'C:/data/ai/drafts/p1', fileCount: 1, bytes: 1024 }
  ],
  archives: [],
  ...overrides
})

const backup: ProjectBackupEntry = {
  id: 'Garden 20261023-093000-000.ostler-project',
  filePath: 'C:/data/project-backups/p1/Garden 20261023-093000-000.ostler-project',
  createdAt: Date.UTC(2026, 9, 23, 9, 30),
  sizeBytes: 2048,
  hasChecksum: true
}

const purge: ProjectRemovalPurge = {
  deletedRows: [{ table: 'planning_work_items', rows: 12 }],
  removedPaths: ['C:/data/ai/drafts/p1'],
  failedPaths: [],
  retainedBranches: [],
  libraryDirRemoved: false
}

function renderRemove(options: {
  found?: ProjectRemovalInventory
  backups?: ProjectBackupEntry[]
  project?: RendererProject
}) {
  const calls: string[] = []
  const onClose = vi.fn()
  installOstlerApi({
    getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
    getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not needed' }),
    getProjectAISettings: async () => ({ ok: false, error: 'not needed' }),
    getPlanningLabels: async () => ({ ok: true, value: [] }),
    getProjectRemovalInventory: async () => ({ ok: true, value: options.found ?? inventory() }),
    listProjectBackups: async () => ({ ok: true, value: options.backups ?? [] }),
    listBackups: async () => ({ ok: true, value: [] }),
    getBackupCopyStatus: async () => ({
      ok: true,
      value: { folder: null, target: null, syncedBy: null, lastCopiedAt: null, copyFailedAt: null }
    }),
    createProjectBackup: async () => {
      calls.push('backup')
      return { ok: true, value: backup }
    },
    purgeProjectData: async () => {
      calls.push('purge')
      return { ok: true, value: purge }
    },
    getDemoProjects: async () => ({
      ok: true,
      value: {
        projects: [
          { id: 'd1', name: 'Welcome to Ostler (Demo Project)', kind: 'simple', enabled: true },
          { id: 'd2', name: 'Harbour Café refit (Advanced Demo)', kind: 'advanced', enabled: true }
        ],
        addedTasks: 2,
        addedComments: 0,
        untouched: false
      }
    }),
    removeDemoProjects: async () => {
      calls.push('removeDemos')
      return { ok: true, value: 2 }
    }
  })
  render(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <ProjectSettingsDialog
              project={options.project ?? project}
              section="remove"
              onClose={onClose}
              onChanged={() => undefined}
            />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  return { calls, onClose }
}

describe('Project settings › Remove', () => {
  it('opens on Remove with the backups found, what goes, what stays, and every choice', async () => {
    renderRemove({ backups: [backup] })
    expect(await screen.findByRole('tab', { name: 'Remove', selected: true })).toBeInTheDocument()
    const found = await screen.findByRole('region', { name: 'Backups Ostler found' })
    expect(within(found).getByText(/1 backup, made/)).toBeInTheDocument()
    expect(within(found).getByText(/Full backups of everything/)).toBeInTheDocument()
    const deleted = screen.getByRole('region', { name: 'Deleted from this computer' })
    expect(within(deleted).getByText('C:/data/library/p1')).toBeInTheDocument()
    expect(within(deleted).getByText('C:/data/ostler.db')).toBeInTheDocument()
    const kept = screen.getByRole('region', { name: 'Never deleted' })
    expect(within(kept).getByText('C:/work/garden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Walk me through it' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back up and remove…' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove permanently…' })).toBeDisabled()
  })

  it('asks again before removing permanently, and removes nothing when cancelled', async () => {
    const { calls, onClose } = renderRemove({ backups: [backup] })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Type Garden to confirm' }), {
      target: { value: 'Garden' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove permanently…' }))
    let confirm = await screen.findByRole('alertdialog', { name: 'Remove Garden permanently?' })
    expect(within(confirm).getByText(/anything since then is lost/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Remove permanently…' }))
    confirm = await screen.findByRole('alertdialog', { name: 'Remove Garden permanently?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove permanently' }))
    const done = await screen.findByRole('dialog', { name: 'Garden removed' })
    expect(calls).toEqual(['purge'])
    fireEvent.click(within(done).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    expect(ostler.refreshProjects).toHaveBeenCalled()
  })

  it('backs up before it removes, and says where the backup is', async () => {
    const { calls } = renderRemove({})
    fireEvent.click(await screen.findByRole('button', { name: 'Back up and remove…' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Back up and remove Garden?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Back up and remove' }))
    await screen.findByRole('dialog', { name: 'Garden removed' })
    expect(calls).toEqual(['backup', 'purge'])
    expect(screen.getByText(backup.filePath)).toBeInTheDocument()
  })

  it('holds removal back while an agent is running', async () => {
    renderRemove({
      found: inventory({
        openSessions: [{ id: 's1', title: 'Fix the gate', lastSeenAt: null, running: true }],
        runningSessions: 1
      })
    })
    expect(await screen.findByRole('button', { name: 'Stop agent' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Back up and remove…' })).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeEnabled()
  })
})

describe('Project settings › Remove for a demo project', () => {
  const demo: RendererProject = {
    ...project,
    id: 'd1',
    name: 'Welcome to Ostler (Demo Project)',
    path: null,
    demo: 'simple'
  }

  it('removes both demos after one confirmation that names what you added', async () => {
    const { calls, onClose } = renderRemove({ project: demo })
    expect(screen.queryByRole('button', { name: 'Remove permanently…' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the demos…' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove both demo projects?' })
    expect(within(confirm).getByText(/You added 2 tasks to them/)).toBeInTheDocument()
    expect(within(confirm).getByText(/Harbour Café refit/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove the demos' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls).toEqual(['removeDemos'])
    expect(ostler.refreshProjects).toHaveBeenCalled()
  })

  it('keeps the other ways to remove one demo a click away', async () => {
    renderRemove({ project: demo })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Back it up, archive it or remove only this one' })
    )
    expect(await screen.findByRole('button', { name: 'Remove permanently…' })).toBeInTheDocument()
  })
})

describe('Project settings › Backup', () => {
  it('lists this project’s backups and checks one against its checksum', async () => {
    renderRemove({ backups: [backup] })
    installOstlerApi({
      ...window.ostlerAPI,
      listProjectBackups: async () => ({ ok: true, value: [backup] }),
      listBackups: async () => ({ ok: true, value: [] }),
      verifyProjectBackup: async () => ({ ok: true, value: 'differs' })
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Backup' }))
    const list = await screen.findByRole('list', { name: "This project's backups" })
    fireEvent.click(within(list).getByRole('button', { name: /^Check the backup from/ }))
    expect(await within(list).findByText('Damaged: checksum differs')).toBeInTheDocument()
  })
})
