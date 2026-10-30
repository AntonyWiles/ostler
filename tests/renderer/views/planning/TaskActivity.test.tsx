// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivityEntry,
  ActivityPage,
  OstlerAPI,
  PlanningComment,
  PlanningWorkItem
} from '@shared/ostler-api'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ToastProvider } from '@renderer/ui'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import {
  ActivityActorMark,
  CommentBody,
  CommentComposer,
  quoteMarkdown
} from '@renderer/views/planning/ActivityList'
import { TaskActivitySection } from '@renderer/views/planning/TaskActivitySection'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

afterEach(() => __resetDismissableStackForTests())

const comment = (overrides: Partial<PlanningComment> = {}): PlanningComment => ({
  id: 'c1',
  projectId: 'p1',
  workItemId: 'w1',
  authorKind: 'human',
  authorPersonId: null,
  body: 'Looks **good**',
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  deletedAt: null,
  ...overrides
})

const entry = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  id: 'e1',
  kind: 'change',
  projectId: 'p1',
  workItemId: 'w1',
  workItemTitle: 'Write docs',
  at: Date.now() - 3 * 60_000,
  actor: { kind: 'human', personId: null, name: 'Someone' },
  summary: 'Someone changed the priority from Medium to High',
  ...overrides
})

function withConfig(sendMessageOn: 'enter' | 'ctrlEnter', overrides: Partial<OstlerAPI> = {}) {
  return installOstlerApi({
    getConfig: async () => ({
      ok: true,
      value: { ...RENDERER_DEFAULT_CONFIG, ui: { ...RENDERER_DEFAULT_CONFIG.ui, sendMessageOn } }
    }),
    ...overrides
  })
}

describe('CommentComposer', () => {
  it('quotes a comment headed by who wrote it (MOP-22)', async () => {
    withConfig('ctrlEnter')
    expect(quoteMarkdown('First\nSecond', 'Sam')).toBe('> **Sam** wrote:\n>\n> First\n> Second')
    render(
      <CommentComposer
        onSubmit={async () => true}
        quote={{ text: 'Hi', author: 'Sam', nonce: 1 }}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(
        '> **Sam** wrote:\n>\n> Hi\n\n'
      )
    )
  })

  it('sends on Ctrl+Enter, and Enter adds a line, by default', async () => {
    withConfig('ctrlEnter')
    const onSubmit = vi.fn(async () => true)
    render(<CommentComposer onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox', { name: 'Comment' })
    await waitFor(() =>
      expect(box).toHaveAttribute('placeholder', expect.stringContaining('Ctrl+Enter'))
    )
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Hello'))
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('sends on Enter when Settings says so, the same rule as the chat', async () => {
    withConfig('enter')
    const onSubmit = vi.fn(async () => true)
    render(<CommentComposer onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox', { name: 'Comment' })
    await waitFor(() =>
      expect(box).toHaveAttribute('placeholder', expect.stringContaining('Enter sends'))
    )
    fireEvent.change(box, { target: { value: 'Hi' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Hi'))
  })

  it('does not send an empty comment', () => {
    withConfig('ctrlEnter')
    const onSubmit = vi.fn(async () => true)
    render(<CommentComposer onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), {
      key: 'Enter',
      ctrlKey: true
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('CommentBody', () => {
  it('renders markdown, and scripts and javascript: links stay inert', () => {
    const { container } = render(
      <CommentBody
        body={
          '**Bold** <script>window.hacked = true</script> [click](javascript:alert(1)) <img src=x onerror="window.hacked=true">'
        }
      />
    )
    expect(container.querySelector('strong')).toHaveTextContent('Bold')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[onerror]')).toBeNull()
    const link = screen.getByText('click').closest('a')
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript:/i)
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined()
  })
})

describe('ActivityActorMark', () => {
  it('shows an icon for an agent, Ostler AI, automation and Ostler, named for screen readers', () => {
    for (const [kind, name] of [
      ['agent', 'Built-in agent'],
      ['ostler-ai', 'Ostler AI'],
      ['automation', 'Automation API'],
      ['system', 'Ostler']
    ] as const) {
      const { unmount } = render(
        <StaticPeopleProvider people={[]}>
          <ActivityActorMark actor={{ kind, personId: null, name }} />
        </StaticPeopleProvider>
      )
      expect(screen.getByRole('img', { name })).toHaveClass('activity-actor--icon')
      unmount()
    }
  })
})

describe('TaskActivitySection', () => {
  const item = makeWorkItem('w1', { projectId: 'p1', title: 'Write docs' }) as PlanningWorkItem
  let pages: ActivityPage
  let api: OstlerAPI

  beforeEach(() => {
    pages = {
      entries: [
        entry({ id: 'c:c1', kind: 'comment', summary: 'Someone commented', comment: comment() }),
        entry({
          id: 'h:1',
          kind: 'agent',
          actor: { kind: 'agent', personId: null, name: 'Built-in agent' },
          summary: 'Built-in agent submitted its report'
        }),
        entry({ id: 'f:1' })
      ],
      nextBefore: null
    }
    api = withConfig('ctrlEnter', {
      getPlanningActivity: vi.fn(async () => ({ ok: true as const, value: pages })),
      addPlanningComment: vi.fn(async (_id: string, body: string) => ({
        ok: true as const,
        value: comment({ id: 'c2', body })
      })),
      deletePlanningComment: vi.fn(async () => ({
        ok: true as const,
        value: comment({ deletedAt: Date.now() })
      })),
      restorePlanningComment: vi.fn(async () => ({ ok: true as const, value: comment() }))
    })
  })

  const renderSection = () =>
    render(
      <ToastProvider>
        <StaticPeopleProvider people={[]}>
          <TaskActivitySection item={item} />
        </StaticPeopleProvider>
      </ToastProvider>
    )

  it('shows the composer, then the merged history with relative times and exact ones on hover', async () => {
    renderSection()
    expect(await screen.findByText('Built-in agent submitted its report')).toBeInTheDocument()
    expect(screen.getByText('Someone changed the priority from Medium to High')).toBeInTheDocument()
    expect(screen.getByText('good', { selector: 'strong' })).toBeInTheDocument()
    const time = screen.getAllByText(/minutes? ago/)[0]
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('title')).toMatch(/\d/)
    expect(screen.getByRole('img', { name: 'Built-in agent' })).toBeInTheDocument()
  })

  it('filters to comments or changes', async () => {
    renderSection()
    await screen.findByText('Built-in agent submitted its report')
    fireEvent.click(screen.getByRole('radio', { name: 'Comments' }))
    await waitFor(() =>
      expect(api.getPlanningActivity).toHaveBeenLastCalledWith('p1', 'w1', {
        limit: 20,
        before: undefined,
        filter: 'comments'
      })
    )
  })

  it('adds a comment and reloads', async () => {
    renderSection()
    await screen.findByText('Built-in agent submitted its report')
    const box = screen.getByRole('textbox', { name: 'Comment' })
    fireEvent.change(box, { target: { value: 'Ship it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(api.addPlanningComment).toHaveBeenCalledWith('w1', 'Ship it'))
    await waitFor(() =>
      expect(vi.mocked(api.getPlanningActivity).mock.calls.length).toBeGreaterThan(1)
    )
  })

  it('edits a comment in place', async () => {
    const update = vi.fn(async (_id: string, body: string) => ({
      ok: true as const,
      value: comment({ body })
    }))
    api.updatePlanningComment = update
    renderSection()
    await screen.findByText('Built-in agent submitted its report')
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }))
    const box = screen.getByRole('textbox', { name: 'Edit comment' })
    fireEvent.change(box, { target: { value: 'Changed my mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c1', 'Changed my mind'))
  })

  it('deletes a comment at once and offers undo', async () => {
    renderSection()
    await screen.findByText('Built-in agent submitted its report')
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }))
    await waitFor(() => expect(api.deletePlanningComment).toHaveBeenCalledWith('c1'))
    const toast = await screen.findByText('Comment deleted')
    const undo = within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole(
      'button',
      { name: 'Undo' }
    )
    await act(async () => fireEvent.click(undo))
    await waitFor(() => expect(api.restorePlanningComment).toHaveBeenCalledWith('c1'))
  })
})

describe('PlanningCard comment count', () => {
  it('shows how many comments a task has', async () => {
    const base: PlanningWorkspace = await renderPlanningWorkspace()
    const item = makeWorkItem('w9')
    const { container } = render(
      <StaticPeopleProvider people={[]}>
        <PlanningCard item={item} ws={withWorkspace(base, { commentCounts: { w9: 3 } })} />
      </StaticPeopleProvider>
    )
    const meta = container.querySelector('.task-card__meta') as HTMLElement
    expect(within(meta).getByTitle('3 comments')).toHaveTextContent('3')
  })
})
