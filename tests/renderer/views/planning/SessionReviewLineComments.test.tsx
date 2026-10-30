// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  HarnessReviewComment,
  HarnessSession,
  HarnessSessionDiff,
  HarnessTask
} from '@shared/ostler-api'
import { SessionReviewModal } from '@renderer/views/planning/SessionReviewModal'
import { RejectWorkForm } from '@renderer/views/planning/RejectWorkForm'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

/** Comments on lines of an agent's change in Review changes (N9.2a). */

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

function session(drafts?: HarnessReviewComment[]): HarnessSession {
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
    ...(drafts ? { reviewDrafts: drafts } : {})
  } as unknown as HarnessSession
}

const TASK: HarnessTask = {
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

function renderModal(
  options: { drafts?: HarnessReviewComment[]; task?: HarnessTask } = {},
  api: Record<string, unknown> = {}
) {
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
  installOstlerApi({
    getHarnessSessionDiff: async () => ({ ok: true, value: DIFF }),
    saveHarnessReviewDrafts,
    applyHarnessTaskWork,
    ...api
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <SessionReviewModal
          id="p1"
          session={session(options.drafts)}
          task={options.task ?? TASK}
          harnessBusy={false}
          openCodeWorkspace={vi.fn()}
          runHarnessAction={async (action) => (await action()).ok}
          onClose={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  return { saveHarnessReviewDrafts, applyHarnessTaskWork }
}

async function openChanges() {
  const view = await screen.findByRole('button', { name: 'View changes' })
  await waitFor(() => expect((view as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(view)
}

const selectedLines = () =>
  Array.from(document.querySelectorAll('.diff-patch__line--selected')).map(
    (line) => line.querySelector('.diff-patch__text')?.textContent
  )

describe('line comments in Review changes', () => {
  it('selects a range by mouse, writes a comment and keeps it with the session', async () => {
    const { saveHarnessReviewDrafts } = renderModal()
    await openChanges()

    fireEvent.click(screen.getByRole('button', { name: 'Comment on line 2 of src/a.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Comment on line 3 of src/a.ts' }), {
      shiftKey: true
    })
    expect(selectedLines()).toEqual(['+two', '+three'])

    const box = screen.getByRole('textbox', { name: 'Comment on lines 2 to 3' })
    fireEvent.change(box, { target: { value: 'This check is backwards' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))

    await waitFor(() => expect(saveHarnessReviewDrafts).toHaveBeenCalled())
    expect(saveHarnessReviewDrafts.mock.calls[0][2]).toEqual([
      expect.objectContaining({
        file: 'src/a.ts',
        side: 'new',
        firstLine: 2,
        lastLine: 3,
        comment: 'This check is backwards'
      })
    ])
    // Under its lines, and in the Comments list.
    const list = screen.getByRole('region', { name: 'Comments' })
    expect(within(list).getByText('src/a.ts, lines 2 to 3')).toBeTruthy()
    expect(screen.getAllByText('This check is backwards')).toHaveLength(2)
  })

  it('comments on a removed line on the old side, by keyboard', async () => {
    const { saveHarnessReviewDrafts } = renderModal()
    await openChanges()

    const first = screen.getByRole('button', { name: 'Comment on line 1 of src/a.ts' })
    // One line number is the tab stop; the arrows move between them.
    expect(first.tabIndex).toBe(0)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const removed = screen.getByRole('button', { name: 'Comment on removed line 2 of src/a.ts' })
    expect(document.activeElement).toBe(removed)
    fireEvent.click(removed)
    expect(selectedLines()).toEqual(['-old two'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment on removed line 2' }), {
      target: { value: 'Keep this' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() =>
      expect(saveHarnessReviewDrafts.mock.calls.at(-1)?.[2]).toEqual([
        expect.objectContaining({ side: 'old', firstLine: 2, lastLine: 2 })
      ])
    )

    // Shift with the arrows takes in more lines.
    const two = screen.getByRole('button', { name: 'Comment on line 2 of src/a.ts' })
    fireEvent.click(two)
    fireEvent.keyDown(two, { key: 'ArrowDown', shiftKey: true })
    expect(selectedLines()).toEqual(['+two', '+three'])
  })

  it('edits and deletes a comment from the list, with undo', async () => {
    const draft: HarnessReviewComment = {
      id: 'd1',
      file: 'src/a.ts',
      side: 'new',
      firstLine: 3,
      lastLine: 3,
      comment: 'Rename this'
    }
    const { saveHarnessReviewDrafts } = renderModal({ drafts: [draft] })
    await openChanges()
    const list = screen.getByRole('region', { name: 'Comments' })

    fireEvent.click(
      within(list).getByRole('button', { name: 'Edit the comment on src/a.ts, line 3' })
    )
    const box = within(list).getByRole('textbox', { name: 'Comment on line 3' })
    fireEvent.change(box, { target: { value: 'Do not rename this' } })
    fireEvent.click(within(list).getByRole('button', { name: 'Save comment' }))
    await waitFor(() =>
      expect(saveHarnessReviewDrafts.mock.calls.at(-1)?.[2]).toEqual([
        { ...draft, comment: 'Do not rename this' }
      ])
    )

    fireEvent.click(
      within(list).getByRole('button', { name: 'Delete the comment on src/a.ts, line 3' })
    )
    await waitFor(() => expect(saveHarnessReviewDrafts.mock.calls.at(-1)?.[2]).toEqual([]))
    expect(within(list).getByText(/No comments yet/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(saveHarnessReviewDrafts.mock.calls.at(-1)?.[2]).toEqual([
        { ...draft, comment: 'Do not rename this' }
      ])
    )
  })

  it('jumps to a comment from the list', async () => {
    renderModal({
      drafts: [
        { id: 'd1', file: 'src/a.ts', side: 'new', firstLine: 4, lastLine: 4, comment: 'Here' }
      ]
    })
    await openChanges()
    fireEvent.click(screen.getByRole('button', { name: 'Show src/a.ts, line 4 in the changes' }))
    const marked = Array.from(document.querySelectorAll('.diff-patch__line--highlight')).map(
      (line) => line.querySelector('.diff-patch__text')?.textContent
    )
    expect(marked).toEqual([' four'])
  })

  it('asks before Apply leaves draft comments unsent', async () => {
    const { applyHarnessTaskWork } = renderModal({
      drafts: [
        { id: 'd1', file: 'src/a.ts', side: 'new', firstLine: 2, lastLine: 2, comment: 'a' },
        { id: 'd2', file: 'src/a.ts', side: 'new', firstLine: 3, lastLine: 3, comment: 'b' }
      ]
    })
    const apply = await screen.findByRole('button', { name: 'Apply' })
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(apply)
    const ask = await screen.findByRole('alertdialog')
    expect(within(ask).getByText('2 comments will not be sent. Apply anyway?')).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep reviewing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(applyHarnessTaskWork).not.toHaveBeenCalled()

    fireEvent.click(apply)
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply anyway' })
    )
    await waitFor(() => expect(applyHarnessTaskWork).toHaveBeenCalled())
  })

  it('shows the comments from the last review with their excerpts', async () => {
    renderModal({
      task: {
        ...TASK,
        rejections: [
          {
            reason: 'See the line comments',
            rejectedAt: '',
            disposition: 'retry',
            sessionId: 's1',
            comments: [
              {
                id: 'c1',
                file: 'src/a.ts',
                side: 'new',
                firstLine: 2,
                lastLine: 2,
                comment: 'Handle the empty case',
                excerpt: ' one\n+two'
              }
            ]
          }
        ]
      }
    })
    const section = await screen.findByRole('region', { name: 'Comments from the last review' })
    expect(within(section).getByText('src/a.ts, line 2')).toBeTruthy()
    expect(within(section).getByText('Handle the empty case')).toBeTruthy()
    expect(section.querySelector('pre')?.textContent).toBe(' one\n+two')
    expect(within(section).getByText('No answer')).toBeTruthy()
  })
})

describe('answers to the last review in Review changes (N9.2b)', () => {
  const lastReview = (id: string, firstLine: number, comment: string) => ({
    id,
    file: 'src/a.ts',
    side: 'new' as const,
    firstLine,
    lastLine: firstLine,
    comment,
    excerpt: '+two'
  })
  const answeredTask = (outcome: 'reported' | 'unreported' = 'reported'): HarnessTask => ({
    ...TASK,
    rejections: [
      {
        reason: 'See the line comments',
        rejectedAt: '',
        disposition: 'retry',
        sessionId: 's1',
        comments: [
          lastReview('c1', 2, 'Handle the empty case'),
          lastReview('c2', 3, 'Name it better'),
          lastReview('c3', 4, 'Drop this'),
          lastReview('c4', 9, 'Gone line')
        ]
      }
    ],
    report: {
      filesChanged: ['src/a.ts'],
      summary: 'Reworked',
      submittedAt: '',
      outcome,
      commentAnswers: [
        { id: 'c1', status: 'done', note: '', path: 'src/a.ts', startLine: 3, endLine: 3 },
        { id: 'c2', status: 'done', note: 'Renamed to <b>count</b>' },
        { id: 'c3', status: 'not-done', note: 'It is still used by the importer' }
      ]
    }
  })

  it('shows each comment with its answer, the counts and No answer beside the diff', async () => {
    renderModal({ task: answeredTask() })
    await openChanges()
    const section = screen.getByRole('region', { name: 'Comments from the last review' })
    expect(within(section).getByText('2 done, 1 not done, 1 no answer')).toBeTruthy()
    expect(within(section).getAllByText('Done')).toHaveLength(2)
    expect(within(section).getByText('Not done')).toBeTruthy()
    expect(within(section).getByText('No answer')).toBeTruthy()
    expect(within(section).getByText('It is still used by the importer')).toBeTruthy()
    // A note is plain text, never markup.
    expect(within(section).getByText('Renamed to <b>count</b>')).toBeTruthy()
    expect(section.querySelector('b')).toBeNull()
    // Beside the new diff, and flagged next to Apply.
    expect(section.closest('.line-comments__layout')).not.toBeNull()
    expect(screen.getByText('3 of 4 comments answered')).toBeTruthy()
  })

  it('shows where the change now is, or the file when no lines were given', async () => {
    renderModal({ task: answeredTask() })
    await openChanges()
    const marked = () =>
      Array.from(document.querySelectorAll('.diff-patch__line--highlight')).map(
        (line) => line.querySelector('.diff-patch__text')?.textContent
      )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show where the agent dealt with src/a.ts, line 2' })
    )
    expect(marked()).toEqual(['+three'])
    fireEvent.click(
      screen.getByRole('button', { name: 'Show where the agent dealt with src/a.ts, line 3' })
    )
    expect(marked()).toEqual([' one', '+two', '+three', ' four'])
  })

  it('carries a comment into a new draft with Comment again', async () => {
    const { saveHarnessReviewDrafts } = renderModal({ task: answeredTask() })
    await openChanges()
    // Answered with lines in the new diff: the draft goes there.
    fireEvent.click(screen.getByRole('button', { name: 'Comment again on src/a.ts, line 2' }))
    await waitFor(() =>
      expect(saveHarnessReviewDrafts.mock.calls.at(-1)?.[2]).toEqual([
        expect.objectContaining({
          file: 'src/a.ts',
          side: 'new',
          firstLine: 3,
          lastLine: 3,
          comment: 'Handle the empty case'
        })
      ])
    )
    // Lines the new diff does not show cannot be commented on again.
    const gone = screen.getByRole('button', {
      name: 'Comment again on src/a.ts, line 9'
    }) as HTMLButtonElement
    expect(gone.disabled).toBe(true)
  })

  it('shows every comment as No answer when the attempt did not report', async () => {
    renderModal({ task: answeredTask('unreported') })
    const section = await screen.findByRole('region', { name: 'Comments from the last review' })
    expect(within(section).getAllByText('No answer')).toHaveLength(4)
    expect(screen.getByText('0 of 4 comments answered')).toBeTruthy()
  })
})

describe('Send back with line comments', () => {
  it('says how many comments go, and allows an empty reason with them', () => {
    installOstlerApi({})
    const onReject = vi.fn()
    render(
      <ToastProvider>
        <RejectWorkForm projectId="p1" busy={false} commentCount={4} onReject={onReject} />
      </ToastProvider>
    )
    expect(screen.getByText('4 line comments will be sent.')).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(onReject).toHaveBeenCalledWith('', 'retry', undefined)
  })

  it('still needs a reason without comments', () => {
    installOstlerApi({})
    render(
      <ToastProvider>
        <RejectWorkForm projectId="p1" busy={false} onReject={vi.fn()} />
      </ToastProvider>
    )
    const send = screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement
    expect(send.disabled || send.getAttribute('aria-disabled') === 'true').toBe(true)
  })
})
