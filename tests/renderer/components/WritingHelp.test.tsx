// @vitest-environment jsdom
import { useRef, useState, type ReactElement } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItem, OstlerAPI, PlanningComment, PlanningWorkItem } from '@shared/ostler-api'
import type { ImproveWritingRequest } from '@shared/writing-help'
import { useWritingHelp, WritingHelpLayout } from '@renderer/components/WritingHelp'
import { LibraryEditor } from '@renderer/views/project-detail/library/LibraryEditor'
import { DecisionFields, type DecisionDraftFields } from '@renderer/views/planning/DecisionFields'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { CommentSummaryPanel } from '@renderer/views/planning/CommentSummaryPanel'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

const shell = (ui: ReactElement, ai = true) => (
  <MemoryRouter>
    <ConfirmProvider>
      <ToastProvider>
        <StaticFeaturesProvider value={{ agents: false, ai }}>{ui}</StaticFeaturesProvider>
      </ToastProvider>
    </ConfirmProvider>
  </MemoryRouter>
)

const improveButtons = () => screen.queryAllByRole('button', { name: /^Improve writing/ })

describe('Improve writing in the three editors', () => {
  const note = {
    id: '10000000-0000-4000-8000-000000000001',
    projectId: 'p1',
    kind: 'note',
    title: 'Sync',
    summary: '',
    body: 'Some notes',
    tags: [],
    aiAccess: 'when-selected',
    isPrimaryBrief: false,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-03-14T10:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z'
  } as unknown as LibraryItem

  const editor = (item: LibraryItem) => (
    <LibraryEditor projectId="p1" item={item} kind="note" onClose={() => {}} onSaved={() => {}} />
  )

  beforeEach(() => {
    installOstlerApi()
  })

  it('shows on a Library note, and never on one set to Human only or without AI', () => {
    const { unmount } = render(shell(editor(note)))
    expect(improveButtons()).toHaveLength(1)
    unmount()
    const second = render(shell(editor({ ...note, aiAccess: 'human-only' } as LibraryItem)))
    expect(improveButtons()).toHaveLength(0)
    second.unmount()
    render(shell(editor(note), false))
    expect(improveButtons()).toHaveLength(0)
  })

  it("shows on each of a decision's text fields, and not without AI", () => {
    const value: DecisionDraftFields = {
      title: 'Use SQLite',
      date: '2026-03-14',
      context: 'Why',
      decision: 'We use it',
      alternativesConsidered: 'Postgres',
      consequences: 'Simple',
      linkedWorkItemIds: []
    }
    const fields = (
      <DecisionFields
        value={value}
        onChange={() => {}}
        workItems={[]}
        writingHelp={{ projectId: 'p1', decisionId: 'd1' }}
      />
    )
    const { unmount } = render(shell(fields))
    expect(improveButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Improve writing: Context',
      'Improve writing: Decision',
      'Improve writing: Alternatives',
      'Improve writing: Consequences'
    ])
    unmount()
    render(shell(fields, false))
    expect(improveButtons()).toHaveLength(0)
  })

  it("shows on a task's description, and not without AI", async () => {
    const base: PlanningWorkspace = await renderPlanningWorkspace()
    const item = makeWorkItem('a', { title: 'Task A', description: 'Do it' })
    const ws = withWorkspace(base, {
      selectedWorkItem: item,
      selectedWorkItemId: item.id,
      workItems: [item],
      workItemsById: new Map([[item.id, item]]),
      editTitle: item.title,
      editDescription: item.description,
      editStatus: item.status,
      editDependencyIds: item.dependencyIds
    })
    const { unmount } = render(shell(<WorkItemDrawer ws={ws} />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(improveButtons()).toHaveLength(1)
    unmount()
    render(shell(<WorkItemDrawer ws={ws} />, false))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(improveButtons()).toHaveLength(0)
  })
})

describe('the suggestion', () => {
  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial)
    const ref = useRef<HTMLTextAreaElement>(null)
    const help = useWritingHelp({
      projectId: 'p1',
      target: { kind: 'task', workItemId: 'w1' },
      value,
      onChange: setValue,
      textRef: ref
    })
    return (
      <>
        {help.button}
        <WritingHelpLayout suggestion={help.suggestion}>
          <textarea
            ref={ref}
            aria-label="Text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </WritingHelpLayout>
      </>
    )
  }

  let improve: ReturnType<typeof vi.fn>
  beforeEach(() => {
    let call = 0
    improve = vi.fn(async (_projectId: string, request: ImproveWritingRequest) => {
      call += 1
      return {
        ok: true as const,
        value: {
          style: request.style,
          original: request.text,
          suggestion: call === 1 ? 'the slow fox' : 'the quick red fox',
          missingLinks: call === 1 ? ['[[Plan]]'] : []
        }
      }
    })
    installOstlerApi({ improveWriting: improve as unknown as OstlerAPI['improveWriting'] })
  })

  const choose = async (style: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: style }))
  }
  const text = () => screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement

  it('offers the five styles', async () => {
    render(shell(<Harness initial="the quick fox" />))
    fireEvent.click(screen.getByRole('button', { name: 'Improve writing' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Clearer',
      'Shorter',
      'Friendlier',
      'Fix spelling and grammar',
      'As a list'
    ])
  })

  it('shows the changes beside the text, changes nothing until Accept, and warns of a lost link', async () => {
    render(shell(<Harness initial="the quick fox" />))
    await choose('Shorter')
    const panel = await screen.findByRole('region', { name: 'Suggestion: Shorter' })
    expect(improve).toHaveBeenCalledWith('p1', {
      target: { kind: 'task', workItemId: 'w1' },
      style: 'shorter',
      text: 'the quick fox'
    })
    expect(within(panel).getByText(/quick/, { selector: 'del' })).toHaveTextContent('removed:')
    expect(within(panel).getByText(/slow/, { selector: 'ins' })).toHaveTextContent('added:')
    expect(within(panel).getByText(/dropped a link: \[\[Plan\]\]/)).toBeInTheDocument()
    expect(text().value).toBe('the quick fox')
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))
    expect(text().value).toBe('the slow fox')
    expect(screen.queryByRole('region', { name: 'Suggestion: Shorter' })).toBeNull()
  })

  it('tries again, and Discard leaves the text as it was', async () => {
    render(shell(<Harness initial="the quick fox" />))
    await choose('Clearer')
    const panel = await screen.findByRole('region', { name: 'Suggestion: Clearer' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(improve).toHaveBeenCalledTimes(2))
    expect(await within(panel).findByText(/red/, { selector: 'ins' })).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('region', { name: 'Suggestion: Clearer' })).toBeNull()
    expect(text().value).toBe('the quick fox')
  })

  it('sends and replaces only the selected part', async () => {
    render(shell(<Harness initial="keep this. the quick fox" />))
    text().setSelectionRange(11, 24)
    await choose('Clearer')
    const panel = await screen.findByRole('region', { name: 'Suggestion: Clearer' })
    expect(improve.mock.calls[0][1].text).toBe('the quick fox')
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))
    expect(text().value).toBe('keep this. the slow fox')
  })
})

describe('Summarise comments', () => {
  const item = makeWorkItem('w1', { projectId: 'p1', title: 'Write docs' }) as PlanningWorkItem
  const added: PlanningComment = {
    id: 'c9',
    projectId: 'p1',
    workItemId: 'w1',
    authorKind: 'ostler-ai',
    authorPersonId: null,
    body: 'Summary',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null
  }

  function install(count: number) {
    return installOstlerApi({
      getPlanningCommentCounts: async () => ({ ok: true, value: { w1: count } }),
      summariseComments: vi.fn(async () => ({
        ok: true as const,
        value: {
          workItemId: 'w1',
          summary: '**Decided**: ship on Friday.',
          from: Date.UTC(2026, 2, 1),
          to: Date.UTC(2026, 2, 9),
          count,
          total: count
        }
      })),
      addCommentSummary: vi.fn(async () => ({ ok: true as const, value: added })),
      deletePlanningComment: vi.fn(async () => ({
        ok: true as const,
        value: { ...added, deletedAt: 1 }
      }))
    })
  }

  it('is offered from 8 comments, and not below or without AI', async () => {
    install(7)
    const first = render(shell(<CommentSummaryPanel item={item} entries={[]} onAdded={() => {}} />))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Summarise/ })).toBeNull())
    first.unmount()
    install(8)
    const second = render(
      shell(<CommentSummaryPanel item={item} entries={[]} onAdded={() => {}} />)
    )
    expect(await screen.findByRole('button', { name: /Summarise/ })).toBeInTheDocument()
    second.unmount()
    render(shell(<CommentSummaryPanel item={item} entries={[]} onAdded={() => {}} />, false))
    expect(screen.queryByRole('button', { name: /Summarise/ })).toBeNull()
  })

  it('shows the summary, adds it as a comment, and undoes that', async () => {
    const api = install(8)
    const onAdded = vi.fn()
    render(shell(<CommentSummaryPanel item={item} entries={[]} onAdded={onAdded} />))
    fireEvent.click(await screen.findByRole('button', { name: /Summarise/ }))
    const panel = await screen.findByRole('region', { name: 'Summary of comments' })
    expect(within(panel).getByText('ship on Friday.', { exact: false })).toBeInTheDocument()
    expect(within(panel).getByText(/8 comments/)).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Add as a comment' }))
    await waitFor(() =>
      expect(api.addCommentSummary).toHaveBeenCalledWith('p1', 'w1', '**Decided**: ship on Friday.')
    )
    expect(onAdded).toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.deletePlanningComment).toHaveBeenCalledWith('c9'))
  })

  it('Close stores nothing', async () => {
    const api = install(8)
    render(shell(<CommentSummaryPanel item={item} entries={[]} onAdded={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /Summarise/ }))
    const panel = await screen.findByRole('region', { name: 'Summary of comments' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Summary of comments' })).toBeNull()
    expect(api.addCommentSummary).not.toHaveBeenCalled()
  })
})
