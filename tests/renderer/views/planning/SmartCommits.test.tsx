// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { InboxList, OstlerAPI, PlanningWorkItem, TaskCommit } from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { TaskCommitsSection } from '@renderer/views/planning/TaskCommitsSection'
import { InboxView } from '@renderer/views/inbox/InboxView'
import { installOstlerApi } from '../../fixtures/ostler-api'

/** Smart commits (N9.8b): the drawer's Commits section and the Inbox's offer. */

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false })
}))

const task = { id: 't1', projectId: 'p1', title: 'Fix the login' } as unknown as PlanningWorkItem

const commits: TaskCommit[] = [
  {
    hash: 'b'.repeat(40),
    abbreviatedHash: 'bbbbbbb',
    subject: 'Fixes SHOP-1 <script>alert(1)</script>',
    author: 'Ana',
    date: new Date(Date.now() - 60_000).toISOString(),
    fixes: true
  },
  {
    hash: 'a'.repeat(40),
    abbreviatedHash: 'aaaaaaa',
    subject: 'Start on SHOP-1',
    author: 'Ben',
    date: new Date(Date.now() - 3_600_000).toISOString(),
    fixes: false
  }
]

describe("the drawer's Commits section", () => {
  it('lists the commits newest first, marks Fixes in words and copies a hash', async () => {
    const copyText = vi.fn<OstlerAPI['copyText']>(async () => ({ ok: true, value: undefined }))
    const getWorkItemCommits = vi.fn<OstlerAPI['getWorkItemCommits']>(async () => ({
      ok: true,
      value: commits
    }))
    installOstlerApi({ getWorkItemCommits, copyText })
    render(
      <ToastProvider>
        <TaskCommitsSection item={task} />
      </ToastProvider>
    )
    const list = await screen.findByRole('list', { name: 'Commits that name this task' })
    expect(getWorkItemCommits).toHaveBeenCalledWith('p1', 't1')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('bbbbbbb')
    // Untrusted text, shown as text.
    expect(rows[0]).toHaveTextContent('Fixes SHOP-1 <script>alert(1)</script>')
    expect(list.querySelector('script')).toBeNull()
    expect(within(rows[0]).getByText('Fixes')).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('Ana')
    expect(within(rows[1]).queryByText('Fixes')).toBeNull()
    expect(rows[1]).toHaveTextContent('Ben')

    fireEvent.click(screen.getByRole('button', { name: 'Copy hash aaaaaaa' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('a'.repeat(40)))
  })

  it('shows nothing for a task no commit names', async () => {
    const getWorkItemCommits = vi.fn<OstlerAPI['getWorkItemCommits']>(async () => ({
      ok: true,
      value: []
    }))
    installOstlerApi({ getWorkItemCommits })
    const { container } = render(
      <ToastProvider>
        <TaskCommitsSection item={task} />
      </ToastProvider>
    )
    await waitFor(() => expect(getWorkItemCommits).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

const offer = (): InboxList => ({
  items: [
    {
      key: 'commit:7',
      kind: 'commit',
      title: 'Commit a1b2c3d says it fixes SHOP-1: Fix the login',
      body: 'Shop',
      projectId: 'p1',
      taskId: 't1',
      fromStatus: 'active',
      createdAt: Date.now() - 60_000,
      readAt: null
    }
  ],
  unreadCount: 1
})

function renderInbox() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <InboxView />
      </MemoryRouter>
    </ToastProvider>
  )
}

describe("the Inbox's Mark as done offer", () => {
  it('marks the task done through the normal status change, and Undo puts it back', async () => {
    const updatePlanningWorkItem = vi.fn(async (_id: string, updates: { status?: string }) => ({
      ok: true as const,
      value: { id: 't1', title: 'Fix the login', status: updates.status } as never
    }))
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: offer() }),
      updatePlanningWorkItem
    })
    renderInbox()
    expect(
      await screen.findByText('Commit a1b2c3d says it fixes SHOP-1: Fix the login')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('t1', { status: 'done' })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('t1', { status: 'active' })
    )
  })

  it('Dismiss archives the item, with undo', async () => {
    const archiveInboxItems = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], unreadCount: 0 }
    }))
    const updatePlanningWorkItem = vi.fn()
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: offer() }),
      archiveInboxItems,
      updatePlanningWorkItem
    })
    renderInbox()
    await screen.findByText('Commit a1b2c3d says it fixes SHOP-1: Fix the login')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(archiveInboxItems).toHaveBeenCalledWith(['commit:7']))
    expect(await screen.findByText('Dismissed')).toBeInTheDocument()
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })
})
