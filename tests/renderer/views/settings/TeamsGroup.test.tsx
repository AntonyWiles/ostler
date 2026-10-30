// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CreateTeamInput, Person, Team } from '@shared/ostler-api'
import { TeamsGroup } from '@renderer/views/settings/sections/TeamsGroup'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

function person(id: string, name: string): Person {
  return {
    id,
    name,
    initials: name.slice(0, 1),
    color: '#3b82f6',
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function team(overrides: Partial<Team> & { id: string }): Team {
  return {
    name: 'Design',
    color: '#3b82f6',
    leadPersonId: null,
    memberIds: [],
    position: 0,
    archivedAt: null,
    ...overrides
  }
}

function setup(initial: Team[] = []) {
  let teams = [...initial]
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const api = {
    listTeams: vi.fn(async () => ok([...teams])),
    createTeam: vi.fn(async (input: CreateTeamInput) => {
      const added = team({
        id: `new-${teams.length}`,
        name: input.name,
        color: input.color,
        leadPersonId: input.leadPersonId ?? null,
        memberIds: input.memberIds ?? [],
        position: teams.length
      })
      teams.push(added)
      return ok(added)
    }),
    updateTeam: vi.fn(async (id: string, updates: Partial<Team>) => {
      teams = teams.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
      return ok(teams.find((entry) => entry.id === id)!)
    }),
    setTeamMembers: vi.fn(async (id: string, personIds: string[]) => {
      teams = teams.map((entry) => (entry.id === id ? { ...entry, memberIds: personIds } : entry))
      return ok(teams.find((entry) => entry.id === id)!)
    }),
    archiveTeam: vi.fn(async (id: string) => {
      teams = teams.map((entry) => (entry.id === id ? { ...entry, archivedAt: 1 } : entry))
      return ok(teams.find((entry) => entry.id === id)!)
    }),
    restoreTeam: vi.fn(async (id: string) => {
      teams = teams.map((entry) => (entry.id === id ? { ...entry, archivedAt: null } : entry))
      return ok(teams.find((entry) => entry.id === id)!)
    }),
    deleteTeam: vi.fn(async (id: string) => {
      teams = teams.filter((entry) => entry.id !== id)
      return ok(undefined)
    })
  }
  installOstlerApi(api as never)
  render(
    <ToastProvider>
      <SettingsProvider
        value={{
          config: RENDERER_DEFAULT_CONFIG,
          saveConfig: async () => {},
          setConfig: () => {},
          reloadConfig: () => {},
          markSaved: () => {},
          setError: () => {}
        }}
      >
        <StaticPeopleProvider people={[person('ada', 'Ada'), person('bo', 'Bo')]}>
          <TeamsGroup />
        </StaticPeopleProvider>
      </SettingsProvider>
    </ToastProvider>
  )
  return api
}

describe('TeamsGroup (team-leaders plan, D1)', () => {
  it('lists each team with its lead and how many people are in it', async () => {
    setup([
      team({ id: 't1', name: 'Design', leadPersonId: 'ada', memberIds: ['ada', 'bo'] }),
      team({ id: 't2', name: 'Site crew', memberIds: ['bo'], position: 1 })
    ])
    const list = await screen.findByRole('list', { name: 'Teams' })
    expect(within(list).getByText('Design')).toBeInTheDocument()
    expect(within(list).getByText('2 people, led by Ada')).toBeInTheDocument()
    expect(within(list).getByText('1 person')).toBeInTheDocument()
  })

  it('makes a team with a lead and members', async () => {
    const api = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'New team…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Design' } })
    fireEvent.change(within(dialog).getByLabelText('Lead'), { target: { value: 'ada' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Ada' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bo' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add team' }))

    await waitFor(() =>
      expect(api.createTeam).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Design', leadPersonId: 'ada', memberIds: ['ada', 'bo'] })
      )
    )
    expect(await screen.findByText('2 people, led by Ada')).toBeInTheDocument()
  })

  it('changes the members of a team, archives it with undo, and deletes it after asking', async () => {
    const api = setup([team({ id: 't1', name: 'Design', memberIds: ['ada'] })])
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Design' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bo' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.setTeamMembers).toHaveBeenCalledWith('t1', ['ada', 'bo']))

    fireEvent.click(await screen.findByRole('button', { name: 'Archive Design' }))
    await waitFor(() => expect(api.archiveTeam).toHaveBeenCalledWith('t1'))
    expect(
      await screen.findByText('No teams yet. Make one to group the people you work with.')
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Show 1 archived team' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Design' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete team' }))
    await waitFor(() => expect(api.deleteTeam).toHaveBeenCalledWith('t1'))
  })
})
