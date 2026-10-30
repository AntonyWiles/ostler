// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessSession, HarnessSessionDiff, HarnessTask } from '@shared/ostler-api'
import { SessionReviewModal } from '@renderer/views/planning/SessionReviewModal'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '+two',
  '+three'
].join('\n')

const DIFF: HarnessSessionDiff = {
  branchName: 'ostler/s1',
  baseBranch: 'main',
  filesChanged: 1,
  insertions: 2,
  deletions: 0,
  files: [{ path: 'src/a.ts', insertions: 2, deletions: 0, binary: false }],
  patch: PATCH,
  patchTruncated: false,
  committedFilesChanged: 1,
  committedInsertions: 2,
  committedDeletions: 0,
  hasUncommittedChanges: false,
  uncommittedFiles: [],
  mergeReadiness: 'ready',
  mergeReadinessReason: '',
  taskVersion: 'main',
  folderVersion: 'main',
  versionChanged: false
} as HarnessSessionDiff

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
  provenance: 'external'
} as unknown as HarnessSession

function task(report: Partial<NonNullable<HarnessTask['report']>>): HarnessTask {
  return {
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
      ...report
    }
  }
}

function renderModal(reportTask: HarnessTask) {
  installOstlerApi({ getHarnessSessionDiff: async () => ({ ok: true, value: DIFF }) })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <SessionReviewModal
          id="p1"
          session={SESSION}
          task={reportTask}
          harnessBusy={false}
          openCodeWorkspace={vi.fn()}
          runHarnessAction={vi.fn(async () => true)}
          onClose={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
}

describe('pictures in Review changes', () => {
  it('shows thumbnails with captions, opens one full size and moves by arrow keys', async () => {
    renderModal(
      task({
        pictures: [
          { name: '1-home.png', path: 'home.png', caption: '<b>Home</b> screen', size: 10 },
          { name: '2-menu.png', path: 'menu.png', size: 10 }
        ],
        picturesLeftOut: [
          { path: 'a.txt', reason: 'not-image' },
          { path: 'b.txt', reason: 'not-image' }
        ]
      })
    )
    const strip = screen.getByRole('region', { name: 'Pictures' })
    // A caption is plain text, never HTML.
    expect(within(strip).getByText('<b>Home</b> screen')).toBeTruthy()
    expect(within(strip).getByText('2 pictures were left out: not an image.')).toBeTruthy()

    const first = within(strip).getByRole('button', { name: 'Open <b>Home</b> screen full size' })
    first.focus()
    fireEvent.click(first)
    const viewer = await screen.findByRole('dialog', { name: 'Picture 1 of 2' })
    const image = within(viewer).getByRole('img') as HTMLImageElement
    expect(image.alt).toBe('<b>Home</b> screen')
    expect(image.src).toBe('ostler-report-picture://p1/s1/1-home.png')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const second = await screen.findByRole('dialog', { name: 'Picture 2 of 2' })
    expect((within(second).getByRole('img') as HTMLImageElement).alt).toBe('Picture 2 of 2')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(await screen.findByRole('dialog', { name: 'Picture 1 of 2' })).toBeTruthy()
  })
})

describe('Walk through', () => {
  it('steps through the stops, highlighting each one and saying when one is not shown', async () => {
    renderModal(
      task({
        walkthrough: [
          { path: 'src/a.ts', startLine: 2, endLine: 3, note: 'The new lines.' },
          { path: 'src/other.ts', startLine: 1, endLine: 4, note: 'Not in this diff.' }
        ]
      })
    )
    const start = await screen.findByRole('button', { name: 'Walk through (2 stops)' })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(start)

    const bar = screen.getByRole('region', { name: 'Walkthrough' })
    expect(within(bar).getByText('Stop 1 of 2')).toBeTruthy()
    expect(within(bar).getByText('The new lines.')).toBeTruthy()
    const highlighted = () =>
      Array.from(document.querySelectorAll('.diff-patch__line--highlight .diff-patch__text')).map(
        (line) => line.textContent
      )
    expect(highlighted()).toEqual(['+two', '+three'])
    expect(document.activeElement).toBe(bar)

    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(within(bar).getByText('Stop 2 of 2')).toBeTruthy()
    expect(within(bar).getByText('Not in this diff.')).toBeTruthy()
    expect(within(bar).getByText(/These lines are not in the changes shown/)).toBeTruthy()
    expect(highlighted()).toEqual([])
    expect((within(bar).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
      true
    )

    fireEvent.click(within(bar).getByRole('button', { name: 'Previous' }))
    expect(within(bar).getByText('Stop 1 of 2')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Walkthrough' })).toBeNull()
  })
})
