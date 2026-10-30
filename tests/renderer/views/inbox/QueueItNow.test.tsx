// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { InboxEntry, InboxList, OstlerAPI } from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { InboxView } from '@renderer/views/inbox/InboxView'
import { installOstlerApi } from '../../fixtures/ostler-api'

/**
 * Scheduled agent tasks: an occurrence its schedule could not queue is never
 * queued later on its own; its Inbox note offers Queue it now.
 */

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], loading: false })
}))

const note = (extra: Partial<InboxEntry> = {}): InboxEntry => ({
  key: 'scheduled:t1',
  kind: 'scheduled',
  title: 'Not queued for agents: Update the dependencies',
  body: 'Not queued: agents are off · Site',
  projectId: 'p1',
  taskId: 't1',
  createdAt: Date.now() - 60_000,
  readAt: null,
  queueNow: true,
  ...extra
})

const list = (...items: InboxEntry[]): InboxList => ({
  items,
  unreadCount: items.filter((item) => item.readAt === null).length
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

describe("the Inbox's Queue it now offer", () => {
  it('queues the occurrence at the click, and the note then says it was queued', async () => {
    const queued = note({
      title: 'Queued for agents: Update the dependencies',
      body: 'Weekly · Site',
      queueNow: undefined
    })
    const queueScheduledTaskNow = vi.fn<OstlerAPI['queueScheduledTaskNow']>(async () => ({
      ok: true,
      value: list(queued)
    }))
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: list(note()) }),
      queueScheduledTaskNow
    })
    renderInbox()
    await screen.findByText('Not queued for agents: Update the dependencies')
    fireEvent.click(screen.getByRole('button', { name: 'Queue it now' }))
    await waitFor(() => expect(queueScheduledTaskNow).toHaveBeenCalledWith('t1'))
    // The toast and the note both say it.
    expect(
      await screen.findAllByText('Queued for agents: Update the dependencies')
    ).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Queue it now' })).toBeNull()
  })

  it('shows the plain reason when it is still refused, and reads the note again', async () => {
    const queueScheduledTaskNow = vi.fn<OstlerAPI['queueScheduledTaskNow']>(async () => ({
      ok: false,
      error: 'Not queued: agents are off'
    }))
    const getInbox = vi.fn<OstlerAPI['getInbox']>(async () => ({ ok: true, value: list(note()) }))
    installOstlerApi({ getInbox, queueScheduledTaskNow })
    renderInbox()
    await screen.findByText('Not queued for agents: Update the dependencies')
    const reads = getInbox.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Queue it now' }))
    expect(await screen.findByText('Couldn’t queue it')).toBeInTheDocument()
    expect(screen.getAllByText('Not queued: agents are off').length).toBeGreaterThan(0)
    await waitFor(() => expect(getInbox.mock.calls.length).toBeGreaterThan(reads))
  })

  it('is not offered on a note that was queued, or whose task is done', async () => {
    installOstlerApi({
      getInbox: async () => ({
        ok: true,
        value: list(
          note({
            key: 'scheduled:t2',
            taskId: 't2',
            title: 'Queued for agents: Water the plants',
            body: 'Weekly · Site',
            queueNow: undefined
          }),
          note({ key: 'scheduled:t3', taskId: 't3', queueNow: undefined })
        )
      })
    })
    renderInbox()
    await screen.findByText('Queued for agents: Water the plants')
    expect(screen.queryByRole('button', { name: 'Queue it now' })).toBeNull()
  })
})
