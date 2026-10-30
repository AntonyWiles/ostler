// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import type {
  Contact,
  ContactInput,
  ContactTask,
  TaskContact,
  TaskContactLink
} from '@shared/contacts'
import type { VCardContact } from '@shared/vcard'
import { ContactsView } from '@renderer/views/contacts/ContactsView'
import { TaskContactsSection } from '@renderer/contacts/TaskContactsSection'
import { ImportContactsDialog } from '@renderer/contacts/ImportContactsDialog'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const TASK = {
  id: 't1',
  projectId: 'p1',
  title: 'Book the flowers',
  archivedAt: null,
  deletedAt: null
} as unknown as PlanningWorkItem

function contact(partial: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    organisation: '',
    role: '',
    phones: [],
    emails: [],
    website: '',
    address: '',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

/** An in-memory contacts service behind the fake API. */
function fakeContacts(initial: Contact[], tasks: Record<string, ContactTask[]> = {}) {
  let contacts = [...initial]
  let links: TaskContact[] = []
  let next = 1
  const api: Partial<OstlerAPI> = {
    listContacts: async () => ({
      ok: true,
      value: [...contacts].sort((a, b) => a.name.localeCompare(b.name))
    }),
    createContact: vi.fn(async (input: ContactInput) => {
      const made = contact({ id: `c${next++}`, name: input.name ?? '', ...input })
      contacts.push(made)
      return { ok: true as const, value: made }
    }),
    updateContact: vi.fn(async (id: string, input: ContactInput) => {
      contacts = contacts.map((entry) => (entry.id === id ? { ...entry, ...input } : entry))
      return { ok: true as const, value: contacts.find((entry) => entry.id === id)! }
    }),
    deleteContact: vi.fn(async (id: string) => {
      const gone = contacts.find((entry) => entry.id === id)!
      contacts = contacts.filter((entry) => entry.id !== id)
      return { ok: true as const, value: { contact: gone, links: [] } }
    }),
    restoreContact: vi.fn(async (deleted) => {
      contacts.push(deleted.contact)
      return { ok: true as const, value: deleted.contact }
    }),
    contactTasks: async (id: string) => ({ ok: true, value: tasks[id] ?? [] }),
    openContact: vi.fn(async () => ({ ok: true as const, value: undefined })),
    taskContacts: async () => ({ ok: true, value: links }),
    linkTaskContact: vi.fn(async (projectId, workItemId, contactId, role) => {
      const link: TaskContact = {
        id: `l${next++}`,
        projectId,
        workItemId,
        contactId,
        role,
        createdAt: 0,
        contact: contacts.find((entry) => entry.id === contactId)!
      }
      links = [...links, link]
      return { ok: true as const, value: link }
    }),
    unlinkTaskContact: vi.fn(async (_projectId, _workItemId, linkId) => {
      const gone = links.find((entry) => entry.id === linkId)!
      links = links.filter((entry) => entry.id !== linkId)
      const stored: TaskContactLink = {
        id: gone.id,
        projectId: gone.projectId,
        workItemId: gone.workItemId,
        contactId: gone.contactId,
        role: gone.role,
        createdAt: gone.createdAt
      }
      return { ok: true as const, value: stored }
    }),
    relinkTaskContact: vi.fn(async (_projectId, _workItemId, link: TaskContactLink) => {
      links = [...links, { ...link, contact: contacts.find((c) => c.id === link.contactId)! }]
      return { ok: true as const, value: links }
    })
  }
  return { api, contacts: () => contacts, links: () => links }
}

function wrap(element: ReactElement, path = '/contacts') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>{element}</ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

const ROSA = contact({
  id: 'rosa',
  name: 'Rosa Bloom',
  organisation: 'Bloom & Co',
  role: 'Florist',
  phones: [{ label: 'Mobile', number: '+44 7700 900123' }],
  emails: ['rosa@bloom.example'],
  website: 'bloom.example'
})
const ADAM = contact({ id: 'adam', name: 'Adam Plumb', organisation: 'Plumb Ltd' })

describe('the Contacts view (N6.5)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists contacts, searches them, and opens one with Call, Email and Open website', async () => {
    const { api } = fakeContacts([ROSA, ADAM], {
      rosa: [
        {
          linkId: 'l1',
          projectId: 'p1',
          workItemId: 't1',
          title: 'Book the flowers',
          status: 'backlog',
          role: 'supplier',
          closed: false
        }
      ]
    })
    installOstlerApi(api)
    wrap(<ContactsView />)
    const list = await screen.findByRole('region', { name: 'Contact list' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Adam PlumbPlumb Ltd', 'Rosa BloomFlorist, Bloom & Co'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search contacts' }), {
      target: { value: 'florist' }
    })
    expect(within(list).queryByRole('button', { name: /Adam Plumb/ })).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: /Rosa Bloom/ }))
    expect(await screen.findByRole('heading', { name: 'Rosa Bloom' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Call +44 7700 900123' }))
    fireEvent.click(screen.getByRole('button', { name: 'Email rosa@bloom.example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open website' }))
    await waitFor(() => expect(api.openContact).toHaveBeenCalledTimes(3))
    expect(api.openContact).toHaveBeenNthCalledWith(1, 'rosa', { kind: 'call', index: 0 })
    expect(api.openContact).toHaveBeenNthCalledWith(2, 'rosa', { kind: 'email', index: 0 })
    expect(api.openContact).toHaveBeenNthCalledWith(3, 'rosa', { kind: 'website' })

    // The tasks that name the contact, with their roles, each a link to the task.
    const task = await screen.findByRole('link', { name: 'Book the flowers' })
    expect(task.getAttribute('href')).toBe('/projects/p1/tasks/t1')
    expect(screen.getByText('Supplier')).toBeTruthy()
  })

  it('makes a new contact, edits it with Undo, and deletes after asking, with Undo', async () => {
    const { api, contacts } = fakeContacts([])
    installOstlerApi(api)
    wrap(<ContactsView />)
    expect(await screen.findByText('No contacts yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New contact' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Sam Rivera' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add a phone number' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone 1' }), {
      target: { value: '0161 496 0000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    await waitFor(() =>
      expect(api.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sam Rivera',
          phones: [{ label: '', number: '0161 496 0000' }]
        })
      )
    )
    expect(await screen.findByRole('heading', { name: 'Sam Rivera' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Organisation' }), {
      target: { value: 'Rivera Plumbing' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateContact).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ organisation: 'Rivera Plumbing' })
      )
    )
    expect(await screen.findByText('Sam Rivera saved')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sam Rivera' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete contact' }))
    await waitFor(() => expect(api.deleteContact).toHaveBeenCalledWith('c1'))
    expect(contacts()).toEqual([])
    await screen.findByText('Sam Rivera deleted')
    const undos = screen.getAllByRole('button', { name: 'Undo' })
    fireEvent.click(undos[undos.length - 1])
    await waitFor(() => expect(api.restoreContact).toHaveBeenCalled())
    expect(contacts().map((entry) => entry.name)).toEqual(['Sam Rivera'])
  })
})

describe("the drawer's Contacts section (N6.5)", () => {
  it('names a contact with a role, shows Call and Email, and removes it with Undo', async () => {
    const { api, links } = fakeContacts([ROSA, ADAM])
    installOstlerApi(api)
    wrap(<TaskContactsSection item={TASK} />, '/projects/p1/tasks/t1')
    expect(await screen.findByText(/No contacts named/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a contact' }))
    const box = screen.getByRole('combobox', { name: 'Contact' })
    fireEvent.change(box, { target: { value: 'Rosa' } })
    fireEvent.click(await screen.findByRole('option', { name: /Rosa Bloom/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), {
      target: { value: 'supplier' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(api.linkTaskContact).toHaveBeenCalledWith('p1', 't1', 'rosa', 'supplier')
    )
    const entry = await screen.findByRole('link', { name: 'Rosa Bloom' })
    expect(entry.getAttribute('href')).toBe('/contacts?contact=rosa')
    expect(screen.getByText('Supplier · Florist, Bloom & Co')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Call Rosa Bloom on +44 7700 900123' }))
    await waitFor(() =>
      expect(api.openContact).toHaveBeenCalledWith('rosa', { kind: 'call', index: 0 })
    )
    expect(
      screen.getByRole('button', { name: 'Email Rosa Bloom at rosa@bloom.example' })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Rosa Bloom (Supplier)' }))
    await waitFor(() => expect(links()).toEqual([]))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(links()).toHaveLength(1))
  })

  it('makes a new contact inline from what was typed', async () => {
    const { api } = fakeContacts([])
    installOstlerApi(api)
    wrap(<TaskContactsSection item={TASK} />, '/projects/p1/tasks/t1')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a contact' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Contact' }), {
      target: { value: 'Venue manager' }
    })
    fireEvent.click(await screen.findByRole('option', { name: /New contact “Venue manager”/ }))
    await waitFor(() => expect(api.createContact).toHaveBeenCalledWith({ name: 'Venue manager' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    )
  })
})

describe('the import preview (N6.5)', () => {
  it('lists the cards, offers a matching email as an update, and imports what is ticked', async () => {
    const card = (name: string, emails: string[] = []): VCardContact => ({
      name,
      organisation: '',
      role: '',
      phones: [],
      emails,
      website: '',
      address: '',
      notes: ''
    })
    const importContacts = vi.fn(async () => ({
      ok: true as const,
      value: { created: [ADAM], updated: [ROSA] }
    }))
    installOstlerApi({
      readVCardFile: async () => ({
        ok: true,
        value: {
          fileName: 'contacts.vcf',
          cards: [
            { card: card('Rosa B', ['rosa@bloom.example']), match: ROSA },
            { card: card('Adam Plumb'), match: null },
            { card: card('Left out'), match: null }
          ],
          skipped: 1,
          tooManyCards: false
        }
      }),
      importContacts
    })
    const onImported = vi.fn()
    wrap(<ImportContactsDialog onClose={() => {}} onImported={onImported} />)
    expect(await screen.findByText(/From contacts\.vcf/)).toBeTruthy()
    expect(screen.getByText('1 card had no name or email and was left out.')).toBeTruthy()
    const choice = screen.getByRole('combobox', { name: 'What to do with Rosa B' })
    expect((choice as HTMLSelectElement).value).toBe('update')
    fireEvent.click(screen.getByRole('checkbox', { name: /Left out/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 contacts' }))
    await waitFor(() =>
      expect(importContacts).toHaveBeenCalledWith([
        { card: expect.objectContaining({ name: 'Rosa B' }), updateId: 'rosa' },
        { card: expect.objectContaining({ name: 'Adam Plumb' }), updateId: null }
      ])
    )
    expect(onImported).toHaveBeenCalled()
  })

  it('imports from a connected account with the same preview, reading the one picked', async () => {
    const accounts = [
      { id: 'g1', provider: 'google', label: 'ann@example.com' },
      { id: 'm1', provider: 'microsoft', label: 'ann@work.example' }
    ].map((account) => ({
      ...account,
      server: null,
      capabilities: ['contacts.read'],
      status: 'connected',
      failure: null,
      createdAt: 1,
      lastUsedAt: null
    })) as never
    const readAccountContacts = vi.fn(async (accountId: string) => ({
      ok: true as const,
      value: {
        fileName: accountId === 'g1' ? 'Google · ann@example.com' : 'Microsoft · ann@work.example',
        cards: [
          {
            card: {
              name: accountId === 'g1' ? 'Gina' : 'Mo',
              organisation: '',
              role: '',
              phones: [],
              emails: [],
              website: '',
              address: '',
              notes: ''
            },
            match: null
          }
        ],
        skipped: 0,
        tooManyCards: false
      }
    }))
    const readVCardFile = vi.fn()
    installOstlerApi({ readAccountContacts, readVCardFile })
    wrap(<ImportContactsDialog accounts={accounts} onClose={() => {}} onImported={() => {}} />)
    expect(await screen.findByText(/From Google · ann@example\.com/)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Gina/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Account' }), {
      target: { value: 'm1' }
    })
    expect(await screen.findByRole('checkbox', { name: /Mo/ })).toBeTruthy()
    expect(readAccountContacts).toHaveBeenLastCalledWith('m1')
    expect(readVCardFile).not.toHaveBeenCalled()
  })
})
