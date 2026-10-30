// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Person, PersonUsage, RendererProject } from '@shared/ostler-api'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { offeredIn, StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { PeopleList } from '@renderer/views/settings/sections/PeopleList'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

function person(overrides: Partial<Person> & { id: string; name: string }): Person {
  return {
    initials: overrides.name.slice(0, 1),
    color: '#3b82f6',
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

const me = person({ id: 'me', name: 'Alex', isMe: true })
const sam = person({ id: 'sam', name: 'Sam' })
const gardener = person({ id: 'gardener', name: 'Gardener', projectId: 'garden' })
const everyone = [me, sam, gardener]
const projects = [
  { id: 'garden', name: 'Garden', enabled: true },
  { id: 'kitchen', name: 'Kitchen', enabled: true }
] as RendererProject[]

const nothing: PersonUsage = { projects: [], rules: 0, isMe: false, sharedMember: false }

function setup(projectId: string | null, usage: PersonUsage = nothing) {
  const api = {
    getProjects: vi.fn(async () => ({ ok: true as const, value: projects })),
    getPersonUsage: vi.fn(async () => ({ ok: true as const, value: usage })),
    deletePerson: vi.fn(async () => ({ ok: true as const, value: undefined }))
  }
  installOstlerApi(api as never)
  render(
    <OstlerProvider>
      <ToastProvider>
        <StaticPeopleProvider people={everyone}>
          <PeopleList projectId={projectId} label="People" onSaved={() => {}} onError={() => {}} />
        </StaticPeopleProvider>
      </ToastProvider>
    </OstlerProvider>
  )
  return api
}

describe('people in two places (D5)', () => {
  it('lists only the address book in Settings › People', () => {
    setup(null)
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.queryByText('Gardener')).not.toBeInTheDocument()
  })

  it('lists only a project’s own people in its settings', () => {
    setup('garden')
    expect(screen.getByText('Gardener')).toBeInTheDocument()
    expect(screen.queryByText('Sam')).not.toBeInTheDocument()
  })

  it('offers a project the address book and its own people', () => {
    expect(offeredIn(everyone, 'garden').map((entry) => entry.id)).toEqual([
      'me',
      'sam',
      'gardener'
    ])
    expect(offeredIn(everyone, 'kitchen').map((entry) => entry.id)).toEqual(['me', 'sam'])
    expect(offeredIn(everyone, null).map((entry) => entry.id)).toEqual(['me', 'sam'])
  })

  it('offers no Delete for Me', () => {
    setup(null)
    expect(screen.queryByRole('button', { name: 'Delete Alex' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Sam' })).toBeInTheDocument()
  })
})

describe('deleting a person (D5)', () => {
  it('only asks when they have no work', async () => {
    const api = setup(null)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sam' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sam?' })
    expect(await within(dialog).findByText(/This can't be undone/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deletePerson).toHaveBeenCalledWith('sam', { giveTasksTo: null }))
    expect(await screen.findByText('Deleted Sam')).toBeInTheDocument()
  })

  it('says where their tasks are, and gives them to Me first', async () => {
    const api = setup(null, {
      ...nothing,
      projects: [
        { projectId: 'garden', tasks: 2 },
        { projectId: 'kitchen', tasks: 1 }
      ]
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sam' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sam?' })
    expect(
      await within(dialog).findByText('Sam has 3 tasks in Garden and Kitchen.')
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Give it to someone else' })).toBeChecked()
    // Work in two projects: only the address book can take it all.
    const picker = within(dialog).getByRole('combobox', { name: 'Who takes their work' })
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Alex (you)'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deletePerson).toHaveBeenCalledWith('sam', { giveTasksTo: 'me' }))
  })

  it('leaves their work unassigned when asked, and says rules are turned off', async () => {
    const api = setup(null, { ...nothing, projects: [{ projectId: 'garden', tasks: 1 }], rules: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sam' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sam?' })
    expect(await within(dialog).findByText('2 rules name them.')).toBeInTheDocument()
    // All in Garden, so Garden's own people can take it too.
    const picker = within(dialog).getByRole('combobox', { name: 'Who takes their work' })
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Alex (you)', 'Gardener'])
    fireEvent.click(within(dialog).getByRole('radio', { name: /Leave it unassigned/ }))
    expect(within(dialog).getByText('Rules that name them are turned off.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deletePerson).toHaveBeenCalledWith('sam', { giveTasksTo: null }))
  })

  it('says why a member of a shared project can’t be deleted', async () => {
    const api = setup(null, { ...nothing, sharedMember: true })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sam' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Sam?' })
    expect(
      await within(dialog).findByText(/Sam is a member of a shared project/)
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(api.deletePerson).not.toHaveBeenCalled()
  })
})
