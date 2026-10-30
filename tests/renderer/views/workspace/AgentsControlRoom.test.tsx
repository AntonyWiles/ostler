// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessSession, HarnessSessionDiff, HarnessTask } from '@shared/ostler-api'
import { NeedsYouSection } from '@renderer/views/workspace/agents/NeedsYouSection'
import { RunningNowSection } from '@renderer/views/workspace/agents/RunningNowSection'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const HOUR = 60 * 60 * 1000

function session(
  id: string,
  title: string,
  overrides: Partial<HarnessSession> = {}
): HarnessSession {
  return {
    id,
    title,
    startedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    lastUpdate: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    statusNote: '',
    status: 'active',
    blocked: false,
    workspace: {
      branchName: `ostler/${id}`,
      worktreePath: `C:/data/worktrees/p1/${id}`,
      baseBranch: 'main',
      baseCommit: 'abc'
    },
    token: '',
    lastSeenAt: null,
    taskId: `task-${id}`,
    provenance: 'embedded',
    ...overrides
  } as HarnessSession
}

const DIFF: HarnessSessionDiff = {
  branchName: 'ostler/r1',
  baseBranch: 'main',
  filesChanged: 3,
  insertions: 40,
  deletions: 12,
  files: [],
  patch: '',
  patchTruncated: false,
  committedFilesChanged: 3,
  committedInsertions: 40,
  committedDeletions: 12,
  hasUncommittedChanges: false,
  uncommittedFiles: [],
  mergeReadiness: 'ready',
  mergeReadinessReason: '',
  taskVersion: 'main',
  folderVersion: 'main',
  versionChanged: false
}

function renderReview(diff: HarnessSessionDiff) {
  const runHarnessAction = vi.fn(async (action: () => Promise<{ ok: boolean }>) => {
    await action()
    return true
  })
  const applyHarnessTaskWork = vi.fn(async () => ({
    ok: true as const,
    value: { outcome: 'applied' as const }
  }))
  const sendBackHarnessTaskWork = vi.fn(async () => ({ ok: true as const, value: null }))
  installOstlerApi({
    getHarnessSessionDiff: async () => ({ ok: true, value: diff }),
    applyHarnessTaskWork: applyHarnessTaskWork as never,
    sendBackHarnessTaskWork: sendBackHarnessTaskWork as never
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <NeedsYouSection
          projectId="p1"
          questions={<p>Which colour should the button be?</p>}
          reviewSessions={[session('r1', 'Fix the header', { status: 'done' })]}
          busy={false}
          runHarnessAction={runHarnessAction}
          openSessionReview={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  return { applyHarnessTaskWork, sendBackHarnessTaskWork }
}

describe('The Agents view as a control room', () => {
  it('Needs you shows questions first, then each task in review with its changes and verdicts', async () => {
    const { applyHarnessTaskWork, sendBackHarnessTaskWork } = renderReview(DIFF)
    const section = screen.getByRole('region', { name: 'Ready for you to review' })
    expect(within(section).getByText('Which colour should the button be?')).toBeInTheDocument()
    const row = within(section).getByRole('list', { name: 'Tasks ready for you to review' })
    expect(await within(row).findByText(/3 files changed/)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyHarnessTaskWork).toHaveBeenCalledWith('p1', 'r1', false))

    fireEvent.click(within(row).getByRole('button', { name: 'Send back…' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Why are you sending it back/ }), {
      target: { value: 'Wrong file' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await waitFor(() =>
      // No next-run model: the agent settings were not read (getConfig is not mocked).
      expect(sendBackHarnessTaskWork).toHaveBeenCalledWith(
        'p1',
        'r1',
        'Wrong file',
        'retry',
        undefined
      )
    )
  })

  it('asks before applying a task that started on another version', async () => {
    const { applyHarnessTaskWork } = renderReview({
      ...DIFF,
      taskVersion: 'main',
      folderVersion: 'feature',
      versionChanged: true
    })
    const row = screen.getByRole('list', { name: 'Tasks ready for you to review' })
    await within(row).findByText(/3 files changed/)
    fireEvent.click(within(row).getByRole('button', { name: 'Apply' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Your project folder is on a different version'
    })
    expect(applyHarnessTaskWork).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to the current version' }))
    await waitFor(() => expect(applyHarnessTaskWork).toHaveBeenCalledWith('p1', 'r1', true))
  })

  it('offers "Nothing changed: Close" instead of Apply when the agent changed nothing', async () => {
    renderReview({ ...DIFF, filesChanged: 0, mergeReadiness: 'no_changes' })
    const row = screen.getByRole('list', { name: 'Tasks ready for you to review' })
    expect(
      await within(row).findByRole('button', { name: 'Nothing changed: Close' })
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Discard' })).toBeNull()
  })

  it('Needs you says so when nothing is waiting', () => {
    installOstlerApi()
    render(
      <ConfirmProvider>
        <NeedsYouSection
          projectId="p1"
          questions={null}
          reviewSessions={[]}
          busy={false}
          runHarnessAction={vi.fn()}
          openSessionReview={vi.fn()}
        />
      </ConfirmProvider>
    )
    expect(screen.getByText(/Nothing to review right now/)).toBeInTheDocument()
  })

  it('Working now shows the task, run time, last activity, Watch and Stop', async () => {
    const stopHarnessSession = vi.fn(async () => ({ ok: true as const, value: null }))
    installOstlerApi({ stopHarnessSession: stopHarnessSession as never })
    const openTranscript = vi.fn()
    const task = { id: 'task-s1', title: 'Add the pricing page', claimedBy: 's1' } as HarnessTask
    render(
      <ConfirmProvider>
        <RunningNowSection
          projectId="p1"
          sessions={[session('s1', 'Built-in agent run', { statusNote: 'Editing src/app.ts' })]}
          tasks={[task]}
          folderVersion="feature"
          busy={false}
          runHarnessAction={async (action) => (await action()).ok}
          openTranscript={openTranscript}
          openSessionReview={vi.fn()}
        />
      </ConfirmProvider>
    )
    const section = screen.getByRole('region', { name: 'Working now' })
    expect(within(section).getByText('Add the pricing page')).toBeInTheDocument()
    expect(within(section).getByText(/Running for 2 hours/)).toBeInTheDocument()
    expect(
      within(section).getByText(/Last activity 5 minutes ago: Editing src\/app.ts/)
    ).toBeInTheDocument()
    expect(within(section).getByText(/switched to a different version/)).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Watch Add the pricing page' }))
    expect(openTranscript).toHaveBeenCalledWith('s1')

    fireEvent.click(within(section).getByRole('button', { name: 'Stop' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop "Add the pricing page"?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(stopHarnessSession).toHaveBeenCalledWith('p1', 's1'))
  })
})
