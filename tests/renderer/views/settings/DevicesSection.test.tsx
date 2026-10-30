// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PersonalSpaceState, Result } from '@shared/ostler-api'
import { DevicesSection } from '@renderer/views/settings/sections/DevicesSection'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const OFF: PersonalSpaceState = {
  on: false,
  folder: null,
  waitingForApproval: false,
  thisDeviceName: 'Studio-PC',
  joinCode: null,
  pulled: false,
  devices: [],
  requests: [],
  places: [],
  driveReady: false
}

const ON: PersonalSpaceState = {
  on: true,
  folder: 'C:\\Users\\ann\\Google Drive\\My Drive\\Ostler',
  waitingForApproval: false,
  thisDeviceName: 'Studio-PC',
  joinCode: null,
  pulled: true,
  devices: [
    { deviceId: 'a'.repeat(32), name: 'Studio-PC', isThisDevice: true, revoked: false },
    { deviceId: 'b'.repeat(32), name: 'Laptop', isThisDevice: false, revoked: false }
  ],
  requests: [],
  places: [],
  driveReady: false
}

const renderSection = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <DevicesSection />
      </ConfirmProvider>
    </ToastProvider>
  )

describe('Settings › Devices', () => {
  it('offers to keep devices in step when there is no personal space, then shows where it is', async () => {
    const createPersonalSpace = vi.fn(async (): Promise<Result<PersonalSpaceState | null>> => ({
      ok: true,
      value: ON
    }))
    installOstlerApi({
      getPersonalSpace: async () => ({ ok: true, value: OFF }),
      createPersonalSpace
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my devices in step…' }))
    await waitFor(() => expect(createPersonalSpace).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('In Google Drive › My Drive › Ostler')).toBeInTheDocument()
    expect(screen.getByText('This PC')).toBeInTheDocument()
  })

  it('lists the devices, and removes another one only after the person confirms', async () => {
    const removeDevice = vi.fn(async (): Promise<Result<PersonalSpaceState>> => ({
      ok: true,
      value: { ...ON, devices: [ON.devices[0]] }
    }))
    installOstlerApi({ getPersonalSpace: async () => ({ ok: true, value: ON }), removeDevice })
    renderSection()
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove…' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Laptop?' })
    expect(
      within(dialog).getByText(/stops getting changes to your projects, personal data and settings/)
    ).toBeInTheDocument()
    expect(removeDevice).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeDevice).toHaveBeenCalledWith('b'.repeat(32)))
  })

  it('shows a request with its code, allows it, and hides it on Not now', async () => {
    const requestId = 'c'.repeat(32)
    const request = { deviceId: requestId, deviceName: 'Tablet', code: '482915' }
    const allowDevice = vi.fn(async (): Promise<Result<PersonalSpaceState>> => ({
      ok: true,
      value: { ...ON, requests: [] }
    }))
    installOstlerApi({
      getPersonalSpace: async () => ({ ok: true, value: { ...ON, requests: [request] } }),
      allowDevice
    })
    renderSection()
    expect(
      await screen.findByText('Tablet wants to join. Check it shows 482915, then Allow.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(allowDevice).toHaveBeenCalledWith(requestId))
  })

  it('hides a request for this session when the person chooses Not now', async () => {
    const request = { deviceId: 'd'.repeat(32), deviceName: 'Tablet', code: '111222' }
    installOstlerApi({
      getPersonalSpace: async () => ({ ok: true, value: { ...ON, requests: [request] } })
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(/wants to join/)).toBeNull()
  })

  it('asks where to keep the space when sync apps are found, and keeps it in the one chosen', async () => {
    const drive = 'G:\\My Drive'
    const dropbox = 'C:\\Users\\ann\\Dropbox'
    const createPersonalSpace = vi.fn(
      async (_name?: string, _place?: string): Promise<Result<PersonalSpaceState | null>> => ({
        ok: true,
        value: ON
      })
    )
    installOstlerApi({
      getPersonalSpace: async () => ({
        ok: true,
        value: {
          ...OFF,
          places: [
            { provider: 'google-drive', folder: drive },
            { provider: 'dropbox', folder: dropbox }
          ]
        }
      }),
      createPersonalSpace
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my devices in step…' }))
    expect(createPersonalSpace).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'Google Drive' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Dropbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep them here' }))
    await waitFor(() => expect(createPersonalSpace).toHaveBeenCalledWith(undefined, dropbox))
  })

  it('keeps the space in a folder the person picks when they choose Another folder', async () => {
    const createPersonalSpace = vi.fn(
      async (_name?: string, _place?: string): Promise<Result<PersonalSpaceState | null>> => ({
        ok: true,
        value: null
      })
    )
    installOstlerApi({
      getPersonalSpace: async () => ({
        ok: true,
        value: { ...OFF, places: [{ provider: 'onedrive', folder: 'C:\\Users\\ann\\OneDrive' }] }
      }),
      createPersonalSpace
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my devices in step…' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Another folder…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep them here' }))
    await waitFor(() => expect(createPersonalSpace).toHaveBeenCalledWith(undefined, undefined))
  })

  it('joins from another PC: asks, shows the code to check, and waits for the first pull', async () => {
    const found = { ...OFF, folder: 'C:\\Users\\ann\\Dropbox\\Ostler' }
    const requestPairing = vi.fn(async (): Promise<Result<PersonalSpaceState>> => ({
      ok: true,
      value: { ...found, waitingForApproval: true, joinCode: '654321' }
    }))
    installOstlerApi({
      getPersonalSpace: async () => ({ ok: true, value: found }),
      requestPairing
    })
    renderSection()
    expect(await screen.findByText('Found your space in Dropbox › Ostler.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up from my other device' }))
    await waitFor(() => expect(requestPairing).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(
        'On your other PC, open Settings › Devices and allow Studio-PC. It shows 654321.'
      )
    ).toBeInTheDocument()
  })

  it('stops waiting when the person asks, back to the start', async () => {
    const found = { ...OFF, folder: 'C:\\Users\\ann\\Dropbox\\Ostler' }
    const cancelPairing = vi.fn(async (): Promise<Result<PersonalSpaceState>> => ({
      ok: true,
      value: found
    }))
    installOstlerApi({
      getPersonalSpace: async () => ({
        ok: true,
        value: { ...found, waitingForApproval: true, joinCode: '654321' }
      }),
      cancelPairing
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting' }))
    expect(
      await screen.findByRole('button', { name: 'Set up from my other device' })
    ).toBeInTheDocument()
    expect(cancelPairing).toHaveBeenCalledTimes(1)
  })

  it('starts a new space only after the person opens the explanation, and says why it failed', async () => {
    const found = { ...OFF, folder: 'C:\\Users\\ann\\Dropbox\\Ostler' }
    const startNewPersonalSpace = vi
      .fn<() => Promise<Result<PersonalSpaceState>>>()
      .mockResolvedValueOnce({ ok: false, error: 'Could not move the old space aside.' })
      .mockResolvedValueOnce({ ok: true, value: { ...ON, folder: found.folder } })
    installOstlerApi({
      getPersonalSpace: async () => ({
        ok: true,
        value: { ...found, waitingForApproval: true, joinCode: '654321' }
      }),
      startNewPersonalSpace
    })
    renderSection()
    expect(await screen.findByText(/It shows 654321\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start a new space here' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Don’t have your other device any more?' }))
    expect(screen.getByText(/moves into a folder named “Old personal space”/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start a new space here' }))
    expect(await screen.findByText('Could not move the old space aside.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start a new space here' }))
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    expect(startNewPersonalSpace).toHaveBeenCalledTimes(2)
  })

  it('lets the person choose the space folder when none is found, and says why one is refused', async () => {
    const choosePersonalSpace = vi
      .fn<() => Promise<Result<PersonalSpaceState | null>>>()
      .mockResolvedValueOnce({ ok: false, error: "There's no Ostler space in that folder." })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...OFF, folder: 'D:\\Sync\\Ostler', waitingForApproval: true, joinCode: '123456' }
      })
    installOstlerApi({
      getPersonalSpace: async () => ({ ok: true, value: OFF }),
      choosePersonalSpace
    })
    renderSection()
    expect(
      await screen.findByText(/looks for it in OneDrive, Google Drive and Dropbox/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up from my other device' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose the folder…' }))
    expect(await screen.findByText("There's no Ostler space in that folder.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose the folder…' }))
    expect(await screen.findByText(/It shows 123456\./)).toBeInTheDocument()
    expect(choosePersonalSpace).toHaveBeenCalledTimes(2)
  })
})
