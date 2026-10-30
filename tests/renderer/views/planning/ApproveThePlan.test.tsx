// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessPlan,
  HarnessSession,
  HarnessSessionDiff,
  PlanningWorkItem,
  ProjectAutoDispatchConfig,
  RendererProject,
  SessionPlanView,
  TaskPlanRecord
} from '@shared/ostler-api'
import { PlanDialog } from '@renderer/views/planning/PlanDialog'
import { TaskPlanFirst } from '@renderer/views/planning/TaskPlanFirst'
import { SessionReviewModal } from '@renderer/views/planning/SessionReviewModal'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false, refreshProjects: async () => {} })
}))

const PLAN: HarnessPlan = {
  version: 2,
  steps: ['Read <b>src/app.ts</b>', 'Change the greeting'],
  files: ['src/app.ts', 'docs/greeting.md'],
  risks: 'A [link](https://example.com) in the risks stays text.',
  status: 'pending',
  submittedAt: new Date().toISOString(),
  decidedAt: null,
  changesNote: null
}

const EARLIER: TaskPlanRecord = {
  id: 'r1',
  projectId: 'p1',
  workItemId: 'w1',
  sessionId: 's1',
  taskId: 't1',
  version: 1,
  steps: ['Rewrite everything'],
  files: [],
  risks: '',
  status: 'changes-requested',
  changesNote: 'Smaller, please',
  submittedAt: new Date().toISOString(),
  decidedAt: new Date().toISOString(),
  changedBeforeApproval: []
}

const DIFF = {
  branchName: 'ostler/s1',
  baseBranch: 'main',
  filesChanged: 2,
  insertions: 2,
  deletions: 0,
  files: [
    { path: 'src/app.ts', insertions: 1, deletions: 0, binary: false },
    { path: 'src/extra.ts', insertions: 1, deletions: 0, binary: false }
  ],
  patch: '',
  patchTruncated: false,
  committedFilesChanged: 2,
  committedInsertions: 2,
  committedDeletions: 0,
  hasUncommittedChanges: false,
  uncommittedFiles: [],
  mergeReadiness: 'ready',
  mergeReadinessReason: '',
  taskVersion: 'main',
  folderVersion: 'main',
  versionChanged: false
} as unknown as HarnessSessionDiff

function wrap(element: ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{element}</ConfirmProvider>
    </ToastProvider>
  )
}

function planView(plan: HarnessPlan | null, history: TaskPlanRecord[] = []): SessionPlanView {
  return { sessionId: 's1', title: 'Change the greeting', plan, history }
}

describe('the Plan dialog (N9.3b)', () => {
  function renderDialog(view: SessionPlanView, diff: HarnessSessionDiff = DIFF) {
    const api = {
      getHarnessSessionPlan: vi.fn(async () => ({ ok: true as const, value: view })),
      getHarnessSessionDiff: vi.fn(async () => ({ ok: true as const, value: diff })),
      approveHarnessPlan: vi.fn(async () => ({
        ok: true as const,
        value: { ...view.plan!, status: 'approved' as const }
      })),
      requestHarnessPlanChanges: vi.fn(async (_p: string, _s: string, note: string) => ({
        ok: true as const,
        value: { ...view.plan!, status: 'changes-requested' as const, changesNote: note }
      })),
      stopHarnessSession: vi.fn(async () => ({
        ok: true as const,
        value: {} as HarnessSession
      }))
    }
    installOstlerApi(api)
    const onClose = vi.fn()
    const onDecided = vi.fn()
    wrap(<PlanDialog projectId="p1" sessionId="s1" onClose={onClose} onDecided={onDecided} />)
    return { api, onClose, onDecided }
  }

  it('shows the plan as plain text, the version after the note, and the earlier note', async () => {
    renderDialog(planView(PLAN, [EARLIER]))
    const dialog = await screen.findByRole('dialog', { name: 'Plan' })
    expect(
      await within(dialog).findByText('Version 2: changed after your note', { exact: false })
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Smaller, please')).toBeInTheDocument()
    expect(within(dialog).getByText('Read <b>src/app.ts</b>')).toBeInTheDocument()
    expect(dialog.querySelector('b')).toBeNull()
    expect(within(dialog).queryByRole('link')).toBeNull()
    expect(within(dialog).getByText('docs/greeting.md')).toBeInTheDocument()
  })

  it('warns when the copy changed files before approval', async () => {
    renderDialog(planView({ ...PLAN, version: 1 }))
    expect(
      await screen.findByText('The agent has already changed 2 files before you approved its plan.')
    ).toBeInTheDocument()
  })

  it('approves', async () => {
    const { api, onClose, onDecided } = renderDialog(planView({ ...PLAN, version: 1 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.approveHarnessPlan).toHaveBeenCalledWith('p1', 's1'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDecided).toHaveBeenCalled()
  })

  it('asks for changes only with a note', async () => {
    const { api, onClose } = renderDialog(planView({ ...PLAN, version: 1 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for changes' }))
    const send = screen.getByRole('button', { name: 'Send note' })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: 'What should change?' }), {
      target: { value: 'Leave the docs alone' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }))
    await waitFor(() =>
      expect(api.requestHarnessPlanChanges).toHaveBeenCalledWith('p1', 's1', 'Leave the docs alone')
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('cancels the run after confirming', async () => {
    const { api, onClose } = renderDialog(planView({ ...PLAN, version: 1 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel run' }))
    await waitFor(() => expect(api.stopHarnessSession).toHaveBeenCalledWith('p1', 's1'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows a decided plan with what was changed before approval, and only Close', async () => {
    renderDialog(
      planView({
        ...PLAN,
        version: 1,
        status: 'approved',
        decidedAt: new Date().toISOString(),
        changedBeforeApproval: { files: ['src/early.ts'] }
      })
    )
    expect(
      await screen.findByText('1 file changed before the plan was approved:')
    ).toBeInTheDocument()
    expect(screen.getByText('src/early.ts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })
})

describe('Plan first in the drawer (N9.3b)', () => {
  const item = (planFirst: PlanningWorkItem['planFirst'], linked: string | null = null) =>
    ({
      id: 'w1',
      projectId: 'p1',
      title: 'Change the greeting',
      planFirst,
      linkedHarnessTaskId: linked,
      updatedAt: 1
    }) as PlanningWorkItem

  function renderSection(work: PlanningWorkItem, kept: TaskPlanRecord[] = []) {
    const updatePlanningWorkItem = vi.fn(async () => ({ ok: true as const, value: work }))
    installOstlerApi({
      getProjectAutoDispatchConfig: async () => ({
        ok: true,
        value: { agentsPlanFirst: true } as ProjectAutoDispatchConfig
      }),
      listWorkItemPlans: async () => ({ ok: true, value: kept }),
      updatePlanningWorkItem
    })
    const onChanged = vi.fn()
    wrap(<TaskPlanFirst projectId="p1" item={work} onChanged={onChanged} onError={vi.fn()} />)
    return { updatePlanningWorkItem, onChanged }
  }

  it("offers Project default (showing the project's choice), Yes and No, and saves the choice", async () => {
    const { updatePlanningWorkItem, onChanged } = renderSection(item('default'))
    const select = screen.getByRole('combobox', { name: 'Plan first' })
    expect(await screen.findByRole('option', { name: 'Project default (on)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'no' } })
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('w1', { planFirst: 'no' })
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('is locked once the task is queued, and shows the approved plan and its history', async () => {
    renderSection(item('yes', 't1'), [
      EARLIER,
      { ...EARLIER, id: 'r2', version: 2, status: 'approved', changesNote: null, steps: ['Do it'] }
    ])
    expect(screen.getByRole('combobox', { name: 'Plan first' })).toBeDisabled()
    expect(await screen.findByText('Approved plan')).toBeInTheDocument()
    expect(screen.getByText('Do it')).toBeInTheDocument()
    expect(screen.getByText('Version 1 · Changes asked for')).toBeInTheDocument()
    expect(screen.getByText('Version 2 · Approved')).toBeInTheDocument()
  })
})

describe('Agents plan first in project settings (N9.3b)', () => {
  it('turns it on through the auto-dispatch settings', async () => {
    const config: ProjectAutoDispatchConfig = {
      projectId: 'p1',
      enabled: false,
      maxConcurrentEmbeddedSessions: 0,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0,
      agentsPlanFirst: false
    }
    const updateProjectAutoDispatchConfig = vi.fn(
      async (_id: string, updates: Partial<ProjectAutoDispatchConfig>) => ({
        ok: true as const,
        value: { ...config, ...updates }
      })
    )
    installOstlerApi({
      getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
      getProjectAutoDispatchConfig: async () => ({ ok: true, value: config }),
      getProjectAISettings: async () => ({ ok: false, error: 'not needed' }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      updateProjectAutoDispatchConfig
    })
    const project = {
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
    } as RendererProject
    wrap(
      <StaticFeaturesProvider value={{ agents: true, ai: false }}>
        <ProjectSettingsDialog project={project} onClose={vi.fn()} onChanged={vi.fn()} />
      </StaticFeaturesProvider>
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    const toggle = await screen.findByRole('switch', { name: 'Agents plan first' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateProjectAutoDispatchConfig).toHaveBeenCalledWith('p1', { agentsPlanFirst: true })
    )
  })
})

describe('the approved plan beside the change in Review changes (N9.3b)', () => {
  it('lists the steps and compares the files', async () => {
    installOstlerApi({ getHarnessSessionDiff: async () => ({ ok: true, value: DIFF }) })
    const session = {
      id: 's1',
      title: 'Change the greeting',
      startedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      statusNote: '',
      status: 'done',
      blocked: false,
      workspace: {
        branchName: 'ostler/s1',
        worktreePath: 'C:/data/worktrees/p1/s1',
        baseBranch: 'main',
        baseCommit: 'abc'
      },
      token: '',
      lastSeenAt: null,
      taskId: 't1',
      provenance: 'external',
      plan: { ...PLAN, version: 1, status: 'approved', decidedAt: new Date().toISOString() }
    } as unknown as HarnessSession
    wrap(
      <SessionReviewModal
        id="p1"
        session={session}
        task={null}
        harnessBusy={false}
        openCodeWorkspace={vi.fn()}
        runHarnessAction={vi.fn(async () => true)}
        onClose={vi.fn()}
      />
    )
    const plan = await screen.findByRole('region', { name: 'The approved plan' })
    expect(within(plan).getByText('Change the greeting')).toBeInTheDocument()
    const notPlanned = await within(plan).findByLabelText('Changed but not in the plan')
    expect(within(notPlanned).getByText('src/extra.ts')).toBeInTheDocument()
    const notChanged = within(plan).getByLabelText('In the plan but not changed')
    expect(within(notChanged).getByText('docs/greeting.md')).toBeInTheDocument()
  })
})
