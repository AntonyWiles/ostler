// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectStateUpdate, RendererProject, ShareState } from '@shared/ostler-api'
import { ProjectSharingPanel } from '@renderer/components/ProjectSharingPanel'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

const project: RendererProject = {
  id: 'p1',
  name: 'Garden',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false,
  aiProfile: 'auto'
}

const shared: ShareState = {
  projectId: 'p1',
  status: 'up-to-date',
  folder: 'C:\\Users\\ann\\OneDrive\\Garden',
  members: [
    {
      personKey: 'key-ann',
      name: 'Ann',
      devices: [{ memberId: 'm1', name: 'Ann', isThisPc: true, joinedAt: 1 }],
      isMe: true,
      joinedAt: 1
    },
    {
      personKey: 'key-ben',
      name: 'Ben',
      devices: [{ memberId: 'm2', name: 'Ben', isThisPc: false, joinedAt: 2 }],
      isMe: false,
      joinedAt: 2
    }
  ],
  lastSyncedAt: 1_700_000_000_000,
  waitingToSend: 2,
  waitingToApply: 0,
  problems: [{ kind: 'change', reason: 'bad-signature' }],
  removed: false,
  myRole: 'owner',
  inPersonalSpace: false,
  sharedCapabilities: []
}

const renderPanel = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <ProjectSharingPanel project={project} />
      </ConfirmProvider>
    </ToastProvider>
  )

describe('Project settings › Sharing', () => {
  it('offers only the share button while the project is not shared', async () => {
    const shareProject = vi.fn(async () => ({ ok: true as const, value: shared }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: null }),
      shareProject
    })
    renderPanel()
    const button = await screen.findByRole('button', { name: 'Share this project…' })
    expect(screen.queryByRole('button', { name: 'Copy invite' })).toBeNull()

    fireEvent.click(button)
    await waitFor(() => expect(shareProject).toHaveBeenCalledWith('p1', undefined))
    expect(await screen.findByRole('button', { name: 'Copy invite' })).toBeInTheDocument()
  })

  it('asks which sync app to share through, and makes the folder in the one chosen', async () => {
    const shareProject = vi.fn(async () => ({ ok: true as const, value: shared }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: null }),
      listSyncPlaces: async () => ({
        ok: true,
        value: [
          { provider: 'google-drive', folder: 'G:\\My Drive' },
          { provider: 'onedrive', folder: 'C:\\Users\\Ann\\OneDrive' }
        ]
      }),
      shareProject
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Share this project…' }))
    expect(screen.getByRole('radio', { name: /Google Drive/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /OneDrive/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Share it here' }))
    await waitFor(() => expect(shareProject).toHaveBeenCalledWith('p1', 'C:\\Users\\Ann\\OneDrive'))

    expect(await screen.findByRole('button', { name: 'Copy invite' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Next, share the folder "Garden" with them in OneDrive. Then send them the invite message on your clipboard.'
      )
    ).toBeInTheDocument()
  })

  it('shows members, waiting changes and problems once shared, and copies the invite in main', async () => {
    const copyShareInvite = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: shared }),
      copyShareInvite
    })
    renderPanel()
    expect(await screen.findByText('Up to date')).toBeInTheDocument()
    const members = screen.getByRole('list', { name: 'Members' })
    expect(members).toHaveTextContent('Ann')
    expect(members).toHaveTextContent('This PC')
    expect(members).toHaveTextContent('Ben')
    expect(screen.getByText('2 changes waiting to be sent.')).toBeInTheDocument()
    expect(screen.getByText('A change file (bad-signature)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }))
    await waitFor(() => expect(copyShareInvite).toHaveBeenCalledWith('p1', 'editor'))
  })

  it('emails the invite through the email server, once one is set up (MOP-4)', async () => {
    const emailShareInvite = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const withEmail = {
      ...RENDERER_DEFAULT_CONFIG,
      email: { ...RENDERER_DEFAULT_CONFIG.email, host: 'smtp.example.com', fromAddress: 'a@b.co' }
    }
    let config = RENDERER_DEFAULT_CONFIG
    const listeners = new Set<(update: ProjectStateUpdate) => void>()
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: shared }),
      getConfig: async () => ({ ok: true, value: config }),
      onProjectStateChange: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      emailShareInvite
    })
    renderPanel()
    const open = await screen.findByRole('button', { name: 'Email invite' })
    fireEvent.click(open)
    expect(await screen.findByText(/set up your email server in Settings/)).toBeInTheDocument()

    // Saving the email server in Settings says the settings changed.
    config = withEmail
    act(() =>
      listeners.forEach((listener) => listener({ projectId: '', field: 'config', data: null }))
    )
    fireEvent.click(open)
    fireEvent.click(open)
    const to = await screen.findByRole('textbox', { name: 'Their email address' })
    fireEvent.change(to, { target: { value: ' ben@example.com ' } })
    fireEvent.submit(to.closest('form')!)
    await waitFor(() =>
      expect(emailShareInvite).toHaveBeenCalledWith('p1', 'editor', 'ben@example.com')
    )
    expect(await screen.findByText('Invite emailed to ben@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Their email address' })).toBeNull()
  })

  it('tells the Owner to share the folder in its sync app, then send the invite', async () => {
    const openShareFolder = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({ getShareState: async () => ({ ok: true, value: shared }), openShareFolder })
    renderPanel()
    expect(
      await screen.findByText('First, share the folder "Garden" with them in OneDrive.')
    ).toBeInTheDocument()
    expect(screen.getByText(/^Then copy the invite and send it to them/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy invite text only' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the folder' }))
    await waitFor(() => expect(openShareFolder).toHaveBeenCalledWith('p1'))
  })

  it('asks before leaving, and warns the only Owner', async () => {
    const leaveShare = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: shared }),
      leaveShare
    })
    renderPanel()
    expect(await screen.findByText(/^Only you leave\./)).toBeInTheDocument()
    expect(screen.getByText(/^Your copy stays on this PC/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Garden?' })
    expect(within(dialog).getByText(/^You're the only Owner\./)).toBeInTheDocument()
    expect(leaveShare).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(leaveShare).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('You left Garden')).toBeInTheDocument()
  })

  it('stops sharing, rather than leaving, when nobody else is in it', async () => {
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: {
          ...shared,
          members: [shared.members[0], { ...shared.members[1], leftAt: 1_700_000_000_000 }]
        }
      })
    })
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Stop sharing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave…' })).toBeNull()
  })

  it('shows a joined Editor who it is shared with, and who left', async () => {
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: {
          ...shared,
          myRole: 'editor',
          members: [
            { ...shared.members[0], isMe: false, role: 'owner' },
            { ...shared.members[1], isMe: true, role: 'editor' },
            {
              personKey: 'key-cat',
              name: 'Cat',
              devices: [{ memberId: 'm3', name: 'Cat', isThisPc: false, joinedAt: 3 }],
              isMe: false,
              joinedAt: 3,
              role: 'editor',
              leftAt: 1_700_000_000_000
            }
          ]
        }
      })
    })
    renderPanel()
    expect(await screen.findByText(/Shared with Ann · Your role: Editor/)).toBeInTheDocument()
    expect(screen.getByText(/^Left /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave…' })).toBeInTheDocument()
    expect(screen.queryByText(/^You're the only Owner/)).toBeNull()
  })

  it('removes another member after asking, and offers no remove for this PC', async () => {
    const removeSharePerson = vi.fn(async () => ({
      ok: true as const,
      value: { ...shared, members: [shared.members[0]] }
    }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: shared }),
      removeSharePerson
    })
    renderPanel()
    expect(await screen.findByRole('button', { name: 'Remove Ben' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Ann' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Ben from Garden?' })
    expect(removeSharePerson).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeSharePerson).toHaveBeenCalledWith('p1', 'key-ben', null))
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Members' })).not.toHaveTextContent('Ben')
    )
  })

  it('gives the open tasks of a removed person to the person chosen', async () => {
    const person = (id: string, name: string, isMe: boolean) =>
      ({
        id,
        name,
        isMe,
        projectId: null,
        archivedAt: null,
        initials: name[0],
        color: '#3b82f6'
      }) as never
    const removeSharePerson = vi.fn(async () => ({
      ok: true as const,
      value: { ...shared, members: [shared.members[0]] }
    }))
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: {
          ...shared,
          members: [
            { ...shared.members[0], personId: 'ann-id' },
            { ...shared.members[1], personId: 'ben-id', openTasks: 3 }
          ]
        }
      }),
      removeSharePerson
    })
    render(
      <ToastProvider>
        <ConfirmProvider>
          <StaticPeopleProvider
            people={[
              person('ann-id', 'Ann', true),
              person('cy-id', 'Cy', false),
              person('ben-id', 'Ben', false)
            ]}
          >
            <ProjectSharingPanel project={project} />
          </StaticPeopleProvider>
        </ConfirmProvider>
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ben' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Ben from Garden?' })
    expect(within(dialog).getByText('Ben has 3 open tasks here.')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Give their open tasks to'), {
      target: { value: 'cy-id' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeSharePerson).toHaveBeenCalledWith('p1', 'key-ben', 'cy-id'))
  })

  it('lists a person with two devices once, with the device count', async () => {
    const twoDevices: ShareState = {
      ...shared,
      members: [
        {
          personKey: 'key-ben',
          name: 'Ben',
          devices: [
            { memberId: 'm2', name: 'Ben', isThisPc: false, joinedAt: 2 },
            { memberId: 'm3', name: 'Ben', isThisPc: false, joinedAt: 3 }
          ],
          isMe: false,
          joinedAt: 2
        }
      ]
    }
    installOstlerApi({ getShareState: async () => ({ ok: true, value: twoDevices }) })
    renderPanel()
    const list = await screen.findByRole('list', { name: 'Members' })
    expect(list).toHaveTextContent('Ben')
    expect(list).toHaveTextContent('2 devices')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  })

  it('says when this PC was removed, and offers no removing then', async () => {
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: { ...shared, removed: true } })
    })
    renderPanel()
    expect(await screen.findByText('You were removed from this project')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Ben' })).toBeNull()
  })

  it('offers the sync server once it is set up, and shows it in place of a folder', async () => {
    const shareProjectOnServer = vi.fn(async () => ({
      ok: true as const,
      value: { ...shared, folder: 'https://sync.contoso.com/spaces/0f8fad5b' }
    }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: null }),
      getSyncServer: async () => ({
        ok: true,
        value: {
          url: 'https://sync.contoso.com',
          signIn: 'key',
          scope: null,
          accountId: null,
          hasKey: true,
          managed: false,
          ready: true
        }
      }),
      shareProjectOnServer
    })
    renderPanel()
    expect(await screen.findByText(/Kept on sync\.contoso\.com/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share through the server' }))
    await waitFor(() => expect(shareProjectOnServer).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Sync server')).toBeTruthy()
    expect(screen.getByText('sync.contoso.com')).toBeTruthy()
  })

  it('explains how to get ready for Google Drive when no account can sync through it', async () => {
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: null }),
      getDriveSharingReady: async () => ({ ok: true, value: false })
    })
    renderPanel()
    expect(
      await screen.findByText(/connect a Google account in Settings › Connections › Accounts/)
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share through Google Drive' })).toBeNull()
  })

  it('offers Google Drive once ready, and gives a teammate access to the folder', async () => {
    const shareProjectOnDrive = vi.fn(async () => ({
      ok: true as const,
      value: { ...shared, folder: 'gdrive:1AbC_dEf', problems: [] }
    }))
    const grantDriveAccess = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const copyShareInvite = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: null }),
      getDriveSharingReady: async () => ({ ok: true, value: true }),
      shareProjectOnDrive,
      grantDriveAccess,
      copyShareInvite
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Share through Google Drive' }))
    await waitFor(() => expect(shareProjectOnDrive).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Google Drive folder')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open the folder' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Their Google email address'), {
      target: { value: 'ben@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Give access' }))
    await waitFor(() =>
      expect(grantDriveAccess).toHaveBeenCalledWith('p1', 'ben@example.com', 'editor')
    )
    await waitFor(() => expect(copyShareInvite).toHaveBeenCalledWith('p1', 'editor'))
  })

  it('shows an Editor the roles but no controls to change them (people and devices, D1)', async () => {
    const editor: ShareState = {
      ...shared,
      myRole: 'editor',
      inPersonalSpace: false,
      sharedCapabilities: [],
      members: shared.members.map((member) => ({
        ...member,
        role: member.isMe ? 'editor' : 'viewer'
      }))
    }
    installOstlerApi({ getShareState: async () => ({ ok: true, value: editor }) })
    renderPanel()
    const members = await screen.findByRole('list', { name: 'Members' })
    expect(within(members).getByText('Viewer')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Role for Ben' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Ben' })).toBeNull()
  })

  it('shows an Editor the invite controls, disabled with a hint until everyone supports Editor invites (D13)', async () => {
    const editor = (sharedCapabilities: ShareState['sharedCapabilities']): ShareState => ({
      ...shared,
      myRole: 'editor',
      sharedCapabilities,
      members: shared.members.map((member) => ({
        ...member,
        role: member.isMe ? ('editor' as const) : ('viewer' as const)
      }))
    })
    installOstlerApi({ getShareState: async () => ({ ok: true, value: editor([]) }) })
    const { unmount } = renderPanel()
    const copy = await screen.findByRole('button', { name: 'Copy invite' })
    expect((copy as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/before Editors can invite people/)).toBeTruthy()
    unmount()
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: editor(['editor-invites']) })
    })
    renderPanel()
    const enabled = await screen.findByRole('button', { name: 'Copy invite' })
    expect((enabled as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('combobox', { name: 'Role for Ben' })).toBeNull()
  })

  it('lets an Owner change a member’s role', async () => {
    const setShareRole = vi.fn(async () => ({ ok: true as const, value: shared }))
    const owner: ShareState = {
      ...shared,
      myRole: 'owner',
      inPersonalSpace: false,
      sharedCapabilities: [],
      members: shared.members.map((member) => ({ ...member, role: 'editor' as const }))
    }
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: owner }),
      setShareRole
    })
    renderPanel()
    const role = await screen.findByRole('combobox', { name: 'Role for Ben' })
    fireEvent.change(role, { target: { value: 'viewer' } })
    await waitFor(() => expect(setShareRole).toHaveBeenCalledWith('p1', 'key-ben', 'viewer'))
  })

  it('offers Contributor when inviting only once everyone supports it', async () => {
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: { ...shared, sharedCapabilities: [] } })
    })
    const { unmount } = renderPanel()
    const picker = await screen.findByRole('combobox', { name: 'Invite as' })
    const without = within(picker).getByRole('option', { name: /Contributor/ }) as HTMLOptionElement
    expect(without.disabled).toBe(true)
    expect(without.textContent).toContain('Everyone needs the latest version of')
    unmount()
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: { ...shared, sharedCapabilities: ['contributor-role'] }
      })
    })
    renderPanel()
    const withIt = await screen.findByRole('combobox', { name: 'Invite as' })
    const option = within(withIt).getByRole('option', { name: 'Contributor' }) as HTMLOptionElement
    expect(option.disabled).toBe(false)
    fireEvent.change(withIt, { target: { value: 'contributor' } })
    expect(screen.getByText(/log their time and comment/)).toBeTruthy()
  })

  it('says the folder is already in the personal space, and opens it, when the project is in it', async () => {
    const openShareFolder = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getShareState: async () => ({
        ok: true,
        value: {
          ...shared,
          folder: 'C:\\Users\\ann\\Google Drive\\My Drive\\Ostler\\Garden',
          inPersonalSpace: true,
          sharedCapabilities: []
        }
      }),
      openShareFolder
    })
    renderPanel()
    expect(await screen.findByText('Invite people…')).toBeInTheDocument()
    expect(
      screen.getByText(
        "This project's folder is already in Google Drive › My Drive › Ostler › Garden. To let someone in, share that folder with them there."
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the folder' }))
    await waitFor(() => expect(openShareFolder).toHaveBeenCalledWith('p1'))
  })

  it('shows every member what each role can do', async () => {
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: { ...shared, myRole: 'viewer' } })
    })
    renderPanel()
    fireEvent.click(await screen.findByText('What each role can do'))
    const row = screen.getByRole('row', { name: /Invite people/ })
    const [owner, editor, viewer] = within(row).getAllByRole('cell')
    expect(within(owner).getByRole('img', { name: 'Yes' })).toBeInTheDocument()
    expect(within(editor).getByRole('img', { name: 'Yes' })).toBeInTheDocument()
    expect(within(viewer).queryByRole('img', { name: 'Yes' })).toBeNull()
    expect(within(viewer).getByText('No')).toBeInTheDocument()
  })

  it('lists who joined, left and changed role in a History section', async () => {
    installOstlerApi({
      getShareState: async () => ({ ok: true, value: { ...shared, myRole: 'viewer' } }),
      getMembershipHistory: async () => ({
        ok: true,
        value: [
          {
            kind: 'role-changed',
            personKey: 'key-ben',
            name: 'Ben',
            at: Date.UTC(2026, 9, 3, 12),
            role: 'editor',
            previousRole: 'viewer',
            byName: 'Ann'
          },
          { kind: 'left', personKey: 'key-dan', name: 'Dan', at: null }
        ]
      })
    })
    renderPanel()
    fireEvent.click(await screen.findByText('History'))
    expect(await screen.findByText(/Ann changed Ben to Editor · .*2026/)).toBeInTheDocument()
    expect(screen.getByText('Dan left')).toBeInTheDocument()
  })
})
