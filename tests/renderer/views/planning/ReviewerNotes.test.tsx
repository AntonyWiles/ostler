// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessReviewComment,
  HarnessReviewerReport,
  HarnessSession,
  HarnessSessionDiff,
  HarnessTask,
  ProjectAutoDispatchConfig,
  RendererProject
} from '@shared/ostler-api'
import { SessionReviewModal } from '@renderer/views/planning/SessionReviewModal'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false, refreshProjects: async () => {} })
}))

/** Reviewer notes in Review changes (N9.5b). */

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' one',
  '-old two',
  '+two',
  '+three',
  ' four'
].join('\n')

const DIFF = {
  branchName: 'ostler/s1',
  baseBranch: 'main',
  filesChanged: 1,
  insertions: 2,
  deletions: 1,
  files: [{ path: 'src/a.ts', insertions: 2, deletions: 1, binary: false }],
  patch: PATCH,
  patchTruncated: false,
  committedFilesChanged: 1,
  committedInsertions: 2,
  committedDeletions: 1,
  hasUncommittedChanges: false,
  uncommittedFiles: [],
  mergeReadiness: 'ready',
  mergeReadinessReason: '',
  taskVersion: 'main',
  folderVersion: 'main',
  versionChanged: false
} as unknown as HarnessSessionDiff

const REPORT: HarnessReviewerReport = {
  reviewerSessionId: 'r1',
  reviewTaskId: 'rt1',
  provenance: 'embedded',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  outcome: 'reported',
  summary: 'Mostly fine.',
  findings: [
    {
      id: 'f1',
      file: 'src/a.ts',
      side: 'new',
      firstLine: 2,
      lastLine: 3,
      comment: 'This drops the old check',
      severity: 'must-fix',
      excerpt: ''
    },
    {
      id: 'f2',
      file: 'src/a.ts',
      side: 'new',
      firstLine: 3,
      lastLine: 3,
      comment: 'Name it better',
      severity: 'nit',
      excerpt: ''
    },
    {
      id: 'f3',
      file: 'src/b.ts',
      side: 'new',
      firstLine: 9,
      lastLine: 9,
      comment: 'No test for this',
      severity: 'should-fix',
      excerpt: '',
      general: true
    }
  ]
}

function session(extra: Partial<HarnessSession> = {}): HarnessSession {
  return {
    id: 's2',
    title: 'Tidy the parser',
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
    ...extra
  } as unknown as HarnessSession
}

const TASK = {
  id: 't1',
  title: 'Tidy the parser',
  status: 'complete',
  claimedBy: 's2',
  details: '',
  priority: 'medium',
  planningWorkItemId: null,
  autoContinue: false,
  hold: false
} as HarnessTask

function renderModal(extra: Partial<HarnessSession> = {}) {
  const saveHarnessReviewDrafts = vi.fn(
    async (_p: string, _s: string, drafts: HarnessReviewComment[]) => ({
      ok: true as const,
      value: { ...session(), reviewDrafts: drafts }
    })
  )
  const applyHarnessTaskWork = vi.fn(async () => ({
    ok: true as const,
    value: { session: session(), outcome: 'applied' as const, entries: 1 }
  }))
  const dismissHarnessReviewFinding = vi.fn(
    async (_p: string, _s: string, findingId: string, dismissed: boolean) => ({
      ok: true as const,
      value: session({ dismissedFindingIds: dismissed ? [findingId] : [] })
    })
  )
  const startHarnessReview = vi.fn(async () => ({ ok: true as const, value: TASK }))
  const sendBackHarnessTaskWork = vi.fn(async () => ({ ok: true as const, value: session() }))
  installOstlerApi({
    sendBackHarnessTaskWork,
    getHarnessSessionDiff: async () => ({ ok: true, value: DIFF }),
    saveHarnessReviewDrafts,
    applyHarnessTaskWork,
    dismissHarnessReviewFinding,
    startHarnessReview
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <SessionReviewModal
          id="p1"
          session={session(extra)}
          task={TASK}
          harnessBusy={false}
          openCodeWorkspace={vi.fn()}
          runHarnessAction={async (action) => (await action()).ok}
          onClose={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  return {
    saveHarnessReviewDrafts,
    applyHarnessTaskWork,
    dismissHarnessReviewFinding,
    startHarnessReview,
    sendBackHarnessTaskWork
  }
}

const reviewed = {
  reviewerReports: [REPORT],
  review: { status: 'reported' as const, requestedAt: null }
}

async function openChanges() {
  const view = await screen.findByRole('button', { name: 'View changes' })
  await waitFor(() => expect((view as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(view)
}

describe('reviewer findings in Review changes', () => {
  it('offers Ask a reviewer for work never reviewed, and starts one', async () => {
    const { startHarnessReview } = renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask a reviewer' }))
    await waitFor(() => expect(startHarnessReview).toHaveBeenCalledWith('p1', 's2'))
  })

  it('says the work is being reviewed, and offers no second review meanwhile', async () => {
    renderModal({ review: { status: 'running', requestedAt: new Date().toISOString() } })
    expect(await screen.findByText(/Being reviewed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask a reviewer' })).toBeNull()
  })

  it('shows the summary, general findings and line findings with severities in words, and filters them', async () => {
    renderModal(reviewed)
    expect(await screen.findByText('Reviewer: 1 must-fix, 1 should-fix, 1 nit')).toBeInTheDocument()
    const general = screen.getByRole('region', { name: 'General findings' })
    expect(within(general).getByText('No test for this')).toBeInTheDocument()
    expect(within(general).getByText('Should fix')).toBeInTheDocument()

    await openChanges()
    const list = screen.getByRole('region', { name: "Reviewer's findings" })
    expect(within(list).getByText('Must fix')).toBeInTheDocument()
    expect(within(list).getByText('Nit')).toBeInTheDocument()
    expect(within(list).getAllByText("Reviewer's finding")).toHaveLength(2)
    // Under its lines in the diff too.
    expect(screen.getAllByText('This drops the old check')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Show findings'), { target: { value: 'must-fix' } })
    expect(screen.queryByText('Name it better')).toBeNull()
    expect(screen.queryByText('No test for this')).toBeNull()
    expect(screen.getAllByText('This drops the old check').length).toBeGreaterThan(0)
  })

  it('Send back as mine makes an editable draft comment of the person’s', async () => {
    const { saveHarnessReviewDrafts } = renderModal(reviewed)
    await openChanges()
    const list = screen.getByRole('region', { name: "Reviewer's findings" })
    fireEvent.click(
      within(list).getByRole('button', {
        name: 'Send back the finding on src/a.ts, lines 2 to 3 as my comment'
      })
    )
    await waitFor(() => expect(saveHarnessReviewDrafts).toHaveBeenCalled())
    const drafts = saveHarnessReviewDrafts.mock.calls.at(-1)![2]
    expect(drafts).toEqual([
      expect.objectContaining({
        file: 'src/a.ts',
        side: 'new',
        firstLine: 2,
        lastLine: 3,
        comment: 'This drops the old check'
      })
    ])
    const comments = screen.getByRole('region', { name: 'Comments' })
    expect(
      within(comments).getByRole('button', { name: /Edit the comment on src\/a\.ts, lines 2 to 3/ })
    ).toBeInTheDocument()
  })

  it('Send back as mine on a general finding adds its words to the Send back reason, editable before sending', async () => {
    const { saveHarnessReviewDrafts, sendBackHarnessTaskWork } = renderModal(reviewed)
    const general = await screen.findByRole('region', { name: 'General findings' })
    // What the person already wrote stays first; the finding is a paragraph of its own.
    fireEvent.click(screen.getByRole('button', { name: 'Send back…' }))
    const reason = screen.getByLabelText('Why are you sending it back?') as HTMLTextAreaElement
    fireEvent.change(reason, { target: { value: 'The parser is wrong.  ' } })
    const add = within(general).getByRole('button', {
      name: 'Add the finding on src/b.ts to my Send back reason'
    })
    fireEvent.click(add)
    expect(reason.value).toBe('The parser is wrong.\n\nNo test for this')
    // Once is enough: it says where the words went, and is not offered again.
    expect(add).toHaveTextContent('In your reason')
    expect((add as HTMLButtonElement).disabled).toBe(true)
    // Not a line comment: there are no lines to put it on.
    expect(saveHarnessReviewDrafts).not.toHaveBeenCalled()

    const edited = 'The parser is wrong.\n\nNo test for this: add one for the empty case.'
    fireEvent.change(reason, { target: { value: edited } })
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(sendBackHarnessTaskWork).toHaveBeenCalled())
    expect(sendBackHarnessTaskWork.mock.calls[0]).toEqual(['p1', 's2', edited, 'retry', undefined])
  })

  it('Send back as mine on a general finding opens Send back with its words when it was closed', async () => {
    renderModal(reviewed)
    const general = await screen.findByRole('region', { name: 'General findings' })
    expect(screen.queryByLabelText('Why are you sending it back?')).toBeNull()
    fireEvent.click(
      within(general).getByRole('button', {
        name: 'Add the finding on src/b.ts to my Send back reason'
      })
    )
    const reason = screen.getByLabelText('Why are you sending it back?') as HTMLTextAreaElement
    expect(reason.value).toBe('No test for this')
    // Cancel drops the reason, as closing Send back always has, and offers the finding again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Why are you sending it back?')).toBeNull()
    expect(
      within(general).getByRole('button', {
        name: 'Add the finding on src/b.ts to my Send back reason'
      })
    ).toHaveTextContent('Send back as mine')
  })

  it('Dismiss marks a finding dismissed, and Apply asks first only while must-fix findings are open', async () => {
    const { dismissHarnessReviewFinding, applyHarnessTaskWork } = renderModal(reviewed)
    await openChanges()
    const apply = screen.getByRole('button', { name: 'Apply' })
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(apply)
    expect(await screen.findByText('1 must-fix finding is open. Apply anyway?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
    expect(applyHarnessTaskWork).not.toHaveBeenCalled()

    const list = screen.getByRole('region', { name: "Reviewer's findings" })
    fireEvent.click(
      within(list).getByRole('button', { name: 'Dismiss the finding on src/a.ts, lines 2 to 3' })
    )
    await waitFor(() =>
      expect(dismissHarnessReviewFinding).toHaveBeenCalledWith('p1', 's2', 'f1', true)
    )
    expect(await within(list).findByText('Dismissed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyHarnessTaskWork).toHaveBeenCalled())
  })
})

describe('Review agent work before me in project settings (N9.5b)', () => {
  it('turns it on through the auto-dispatch settings, saying what it costs', async () => {
    const config: ProjectAutoDispatchConfig = {
      projectId: 'p1',
      enabled: false,
      maxConcurrentEmbeddedSessions: 0,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0,
      agentsPlanFirst: false,
      reviewBeforeMe: false
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
    render(
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: true, ai: false }}>
            <ProjectSettingsDialog project={project} onClose={vi.fn()} onChanged={vi.fn()} />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    const toggle = await screen.findByRole('switch', { name: 'Review agent work before me' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/counts towards usage limits/)).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateProjectAutoDispatchConfig).toHaveBeenCalledWith('p1', { reviewBeforeMe: true })
    )
  })
})
