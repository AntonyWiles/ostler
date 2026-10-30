// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessSession,
  HarnessSessionDiff,
  HarnessTask,
  RendererProject
} from '@shared/ostler-api'
import type { TryRun } from '@shared/try-it'
import { SessionReviewModal } from '@renderer/views/planning/SessionReviewModal'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const DIFF = {
  branchName: 'ostler/s1',
  baseBranch: 'main',
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  files: [{ path: 'src/a.ts', insertions: 1, deletions: 0, binary: false }],
  patch: '',
  patchTruncated: false,
  hasUncommittedChanges: false,
  uncommittedFiles: [],
  mergeReadiness: 'ready',
  mergeReadinessReason: ''
} as unknown as HarnessSessionDiff

const SESSION = {
  id: 's1',
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
  provenance: 'embedded'
} as unknown as HarnessSession

const TASK = {
  id: 't1',
  title: 'Tidy the parser',
  status: 'complete',
  claimedBy: 's1',
  details: '',
  priority: 'medium',
  planningWorkItemId: null,
  autoContinue: false,
  report: {
    summary: 'Tidied it.',
    filesChanged: ['src/a.ts'],
    submittedAt: new Date().toISOString(),
    tryCommand: 'npm run preview'
  }
} as HarnessTask

function renderModal(run: TryRun | null) {
  const stopTryRun = vi.fn(async () => ({ ok: true as const, value: null }))
  const onClose = vi.fn()
  installOstlerApi({
    getHarnessSessionDiff: async () => ({ ok: true, value: DIFF }),
    getProjects: async () => ({
      ok: true,
      value: [
        {
          id: 'p1',
          name: 'P',
          tryCommand: 'npm run dev',
          tryItWarningSeen: true
        } as RendererProject
      ]
    }),
    getTryRun: async () => ({ ok: true, value: run }),
    stopTryRun
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <SessionReviewModal
          id="p1"
          session={SESSION}
          task={TASK}
          harnessBusy={false}
          openCodeWorkspace={vi.fn()}
          runHarnessAction={vi.fn(async () => true)}
          onClose={onClose}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  return { stopTryRun, onClose }
}

const running: TryRun = {
  projectId: 'p1',
  sessionId: 's1',
  command: 'npm run dev',
  state: 'running',
  exitCode: null,
  lines: ['$ npm run dev'],
  startedAt: new Date().toISOString(),
  leftFiles: []
}

describe('Try it in Review changes (N9.4)', () => {
  it("shows Try it for a finished task with the project's command and the agent's suggestion", async () => {
    renderModal(null)
    const panel = await screen.findByRole('region', { name: 'Try it' })
    expect(await within(panel).findByRole('button', { name: 'Try it' })).toBeEnabled()
    expect(within(panel).getByText('npm run preview')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Use this command' })).toBeInTheDocument()
  })

  it('asks before closing while Try it runs, then stops it', async () => {
    const { stopTryRun, onClose } = renderModal(running)
    await screen.findByText('Running')
    const dialog = screen.getByRole('dialog', { name: 'Tidy the parser' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    const ask = await screen.findByRole('alertdialog')
    expect(ask).toHaveTextContent('Closing Review changes stops it.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Stop and close' }))
    await waitFor(() => expect(stopTryRun).toHaveBeenCalledWith('p1', 's1'))
    expect(onClose).toHaveBeenCalled()
  })

  it('asks on Escape and on the close button in the title too', async () => {
    const { stopTryRun, onClose } = renderModal(running)
    await screen.findByText('Running')
    const dialog = screen.getByRole('dialog', { name: 'Tidy the parser' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    const ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(stopTryRun).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0])
    const again = await screen.findByRole('alertdialog')
    fireEvent.click(within(again).getByRole('button', { name: 'Stop and close' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('closes at once when nothing is running', async () => {
    const { stopTryRun, onClose } = renderModal(null)
    await screen.findByRole('region', { name: 'Try it' })
    const dialog = screen.getByRole('dialog', { name: 'Tidy the parser' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(stopTryRun).not.toHaveBeenCalled()
  })
})
