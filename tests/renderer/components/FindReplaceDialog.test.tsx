// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findMatches,
  type FindReplaceChange,
  type FindReplaceChoice,
  type FindReplaceRequest,
  type FindReplaceResult,
  type FindReplaceTask
} from '@shared/planning/find-replace'
import { FindReplaceDialog } from '@renderer/components/find-replace/FindReplaceDialog'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../fixtures/ostler-api'

const TASKS: FindReplaceTask[] = [
  {
    id: 'a',
    title: 'Call Acme',
    description: 'Ask Acme about the invoice.',
    acceptanceCriteria: ['Pay Apex', 'Pay Acme']
  },
  { id: 'b', title: 'Acme visit', description: '', acceptanceCriteria: [] }
]

function setup() {
  const previewFindReplace = vi.fn(async (_projectId: string, request: FindReplaceRequest) => {
    const matches = findMatches(TASKS, request.find, request.replace, request)
    return {
      ok: true as const,
      value: {
        matches,
        taskCount: new Set(matches.map((m) => m.taskId)).size,
        truncated: false
      }
    }
  })
  const change: FindReplaceChange = {
    id: 'b',
    from: { title: 'Acme visit', description: '', acceptanceCriteria: [] },
    to: { title: 'Apex visit', description: '', acceptanceCriteria: [] },
    renamed: []
  }
  const applyFindReplace = vi.fn(
    async (_projectId: string, _replace: string, _matches: FindReplaceChoice[]) => ({
      ok: true as const,
      value: { changed: [change], skipped: [] } satisfies FindReplaceResult
    })
  )
  const revertFindReplace = vi.fn(async (_projectId: string, changes: FindReplaceChange[]) => ({
    ok: true as const,
    value: { changed: changes, skipped: [] } satisfies FindReplaceResult
  }))
  installOstlerApi({ previewFindReplace, applyFindReplace, revertFindReplace })
  const onClose = vi.fn()
  const onChanged = vi.fn()
  render(
    <ToastProvider>
      <FindReplaceDialog open projectId="p1" onClose={onClose} onChanged={onChanged} />
    </ToastProvider>
  )
  return { previewFindReplace, applyFindReplace, revertFindReplace, onClose, onChanged, change }
}

describe('FindReplaceDialog (N2.5)', () => {
  afterEach(() => __resetDismissableStackForTests())

  it('previews every match grouped by task, with the options sent to main', async () => {
    const { previewFindReplace } = setup()
    expect(screen.getByText('Type the text to find.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'Apex' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Whole words' }))
    await screen.findByText('4 matches in 2 tasks, 3 chosen')
    expect(previewFindReplace).toHaveBeenLastCalledWith('p1', {
      find: 'acme',
      replace: 'Apex',
      matchCase: false,
      wholeWords: true,
      includeArchived: false
    })
    // The checklist match that would merge two items cannot be ticked, and says why.
    const merge = screen.getByRole('checkbox', {
      name: 'Include the match in Checklist item 2 of Call Acme'
    }) as HTMLInputElement
    expect(merge.disabled).toBe(true)
    expect(screen.getByText(/the two would merge/)).toBeTruthy()
    expect(screen.getAllByText('Apex', { selector: 'ins' }).length).toBe(4)
  })

  it('ticks per task and per match, then replaces and the toast undoes', async () => {
    const { applyFindReplace, revertFindReplace, onClose, onChanged, change } = setup()
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'Apex' } })
    await screen.findByText('4 matches in 2 tasks, 3 chosen')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include every match in Call Acme' }))
    await screen.findByText('4 matches in 2 tasks, 1 chosen')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Include the match in Title of Call Acme' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Replace 2 matches' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const sent = applyFindReplace.mock.calls[0]!
    expect(sent[0]).toBe('p1')
    expect(sent[1]).toBe('Apex')
    expect(sent[2].map((m) => [m.taskId, m.field, m.start])).toEqual([
      ['a', 'title', 5],
      ['b', 'title', 0]
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)

    await screen.findByText('Replaced text in 1 task')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(revertFindReplace).toHaveBeenCalledWith('p1', [
        { id: 'b', from: change.to, to: change.from, renamed: [] }
      ])
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
  })

  it('says when nothing matches', async () => {
    setup()
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'zebra' } })
    await screen.findByText('No matches.')
    expect(
      (screen.getByRole('button', { name: 'Replace 0 matches' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
