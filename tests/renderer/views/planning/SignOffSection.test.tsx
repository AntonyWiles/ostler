// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { InboxEntry, Person, ShareRole, SignOff } from '@shared/ostler-api'
import { SignOffSection } from '@renderer/views/planning/SignOffSection'
import { SignOffBadge } from '@renderer/views/planning/SignOffBadge'
import { WaitingForSignOff } from '@renderer/views/home/WaitingForSignOff'
import { installOstlerApi } from '../../fixtures/ostler-api'

const state = vi.hoisted(() => ({ meId: 'ana', role: null as ShareRole | null }))

const person = (id: string, name: string, initials: string) =>
  ({ id, name, initials, color: '#336699', archivedAt: null, isMe: false }) as unknown as Person
const PEOPLE = [person('ana', 'Ana', 'AN'), person('bob', 'Bob', 'BO')]

vi.mock('@renderer/context/PeopleContext', () => ({
  usePeople: () => ({
    all: PEOPLE,
    active: PEOPLE,
    offered: () => PEOPLE,
    me: PEOPLE.find((entry) => entry.id === state.meId) ?? null,
    byId: new Map(PEOPLE.map((entry) => [entry.id, entry])),
    loaded: true,
    refresh: async () => {},
    createPerson: async () => PEOPLE[0]
  })
}))
vi.mock('@renderer/hooks/useMyShareRole', () => ({ useMyShareRole: () => state.role }))

const waiting = (over: Partial<SignOff> = {}): SignOff => ({
  id: 'so-1',
  projectId: 'p-1',
  itemKind: 'task',
  itemId: 'it-1',
  approverPersonId: 'ana',
  requestedByPersonId: 'bob',
  state: 'waiting',
  note: '',
  requestedAt: Date.UTC(2026, 10, 3, 12),
  answeredAt: null,
  updatedAt: Date.UTC(2026, 10, 3, 12),
  ...over
})

function install(list: SignOff[], extra: Record<string, unknown> = {}) {
  const listSignOffsForItem = vi.fn(async () => ({ ok: true as const, value: list }))
  installOstlerApi({ listSignOffsForItem, ...extra } as never)
  return listSignOffsForItem
}

describe('SignOffSection (prompt 17)', () => {
  it('gives the approver Approve and Send back, and nobody else', async () => {
    state.meId = 'ana'
    state.role = 'viewer'
    install([waiting()])
    const { unmount } = render(
      <SignOffSection projectId="p-1" item={{ kind: 'task', id: 'it-1' }} />
    )
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send back' })).toBeTruthy()
    unmount()

    state.meId = 'bob'
    state.role = 'editor'
    install([waiting()])
    render(<SignOffSection projectId="p-1" item={{ kind: 'task', id: 'it-1' }} />)
    await screen.findByText(/Ana/)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send back' })).toBeNull()
    // The requester can cancel their own waiting request.
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy()
  })

  it('needs a note to send back', async () => {
    state.meId = 'ana'
    state.role = 'viewer'
    const sendBackSignOff = vi.fn(async () => ({ ok: true as const, value: waiting() }))
    install([waiting()], { sendBackSignOff })
    render(<SignOffSection projectId="p-1" item={{ kind: 'task', id: 'it-1' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }))

    const confirm = screen.getByRole('button', { name: 'Send back with this note' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('What needs to change'), {
      target: { value: 'Fix the date' }
    })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(sendBackSignOff).toHaveBeenCalledWith('so-1', 'Fix the date'))
  })

  it('shows who signed a decision off, and works for a decision and a milestone', async () => {
    state.meId = 'bob'
    state.role = 'owner'
    const list = install([
      waiting({
        itemKind: 'decision',
        itemId: 'dec-1',
        state: 'approved',
        answeredAt: Date.UTC(2026, 10, 3, 12)
      })
    ])
    const { unmount } = render(
      <SignOffSection projectId="p-1" item={{ kind: 'decision', id: 'dec-1' }} />
    )
    expect(await screen.findByText(/Signed off by Ana/)).toBeTruthy()
    expect(list).toHaveBeenCalledWith({ kind: 'decision', id: 'dec-1' })
    unmount()

    const milestone = install([])
    render(<SignOffSection projectId="p-1" item={{ kind: 'milestone', id: 'ms-1' }} />)
    expect(await screen.findByRole('button', { name: 'Ask for sign-off' })).toBeTruthy()
    expect(milestone).toHaveBeenCalledWith({ kind: 'milestone', id: 'ms-1' })
  })

  it('hides Ask for sign-off from a Viewer', async () => {
    state.meId = 'ana'
    state.role = 'viewer'
    install([])
    render(<SignOffSection projectId="p-1" item={{ kind: 'task', id: 'it-1' }} />)
    await screen.findByText('No sign-off has been asked for.')
    expect(screen.queryByRole('button', { name: 'Ask for sign-off' })).toBeNull()
  })
})

describe('the sign-off badge on a card (prompt 17)', () => {
  it('says who it waits for, and Signed off once approved', async () => {
    installOstlerApi({
      listSignOffsForProject: async () => ({
        ok: true as const,
        value: [
          waiting({ itemId: 'it-1' }),
          waiting({ id: 'so-2', itemId: 'it-2', state: 'approved' })
        ]
      })
    } as never)
    render(
      <>
        <SignOffBadge projectId="p-1" itemId="it-1" />
        <SignOffBadge projectId="p-1" itemId="it-2" />
        <SignOffBadge projectId="p-1" itemId="it-3" />
      </>
    )
    expect(await screen.findByText('Waiting for sign-off · AN')).toBeTruthy()
    expect(screen.getByText('Signed off')).toBeTruthy()
  })
})

describe('Home › Waiting for your sign-off (prompt 17)', () => {
  it('lists the requests asked of Me and nothing when there are none', async () => {
    const entry = {
      key: 'signoff:so-1',
      kind: 'signOff',
      title: 'Paint hall',
      body: 'Bob asked you · Garden',
      projectId: 'p-1',
      taskId: 'it-1',
      createdAt: 1,
      readAt: null
    } as InboxEntry
    installOstlerApi({
      getInbox: async () => ({ ok: true as const, value: { items: [entry], unreadCount: 1 } })
    } as never)
    const { unmount } = render(
      <MemoryRouter>
        <WaitingForSignOff />
      </MemoryRouter>
    )
    expect(await screen.findByText('Waiting for your sign-off')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Paint hall' })).toBeTruthy()
    unmount()

    installOstlerApi({
      getInbox: async () => ({ ok: true as const, value: { items: [], unreadCount: 0 } })
    } as never)
    render(
      <MemoryRouter>
        <WaitingForSignOff />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.queryByText('Waiting for your sign-off')).toBeNull())
  })
})
