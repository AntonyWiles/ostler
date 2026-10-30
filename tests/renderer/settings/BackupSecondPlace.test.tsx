// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BackupCopyStatus, BackupEntry } from '@shared/ostler-api'
import { BackupSecondPlace, lastCopiedText } from '@renderer/views/settings/BackupSecondPlace'
import { ConfirmProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const OFF: BackupCopyStatus = {
  folder: null,
  target: null,
  syncedBy: null,
  lastCopiedAt: null,
  copyFailedAt: null
}

const ON: BackupCopyStatus = {
  folder: 'E:\\',
  target: 'E:\\Ostler backups',
  syncedBy: null,
  lastCopiedAt: null,
  copyFailedAt: null
}

function renderSection(onMessage = vi.fn()) {
  render(
    <ConfirmProvider>
      <BackupSecondPlace onMessage={onMessage} />
    </ConfirmProvider>
  )
  return onMessage
}

describe('BackupSecondPlace', () => {
  it('chooses a folder, then shows it is not copied yet', async () => {
    const chooseBackupCopyFolder = vi.fn(async () => ({ ok: true as const, value: ON }))
    installOstlerApi({
      getBackupCopyStatus: async () => ({ ok: true, value: OFF }),
      chooseBackupCopyFolder
    })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Also copy backups to…' }))

    expect(
      await screen.findByText('Not copied yet. The next backup is copied to E:\\Ostler backups.')
    ).toBeTruthy()
    expect(chooseBackupCopyFolder).toHaveBeenCalledWith()
    expect(screen.getByRole('button', { name: 'Choose another folder…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop copying' })).toBeTruthy()
  })

  it('shows a refused folder as an error', async () => {
    installOstlerApi({
      getBackupCopyStatus: async () => ({ ok: true, value: OFF }),
      chooseBackupCopyFolder: async () => ({
        ok: false,
        error: 'Windows reports this folder as read-only.'
      })
    })
    const onMessage = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Also copy backups to…' }))
    await waitFor(() =>
      expect(onMessage).toHaveBeenLastCalledWith({
        text: 'Windows reports this folder as read-only.',
        isError: true
      })
    )
  })

  it('shows when and where the last copy was made', async () => {
    const at = new Date()
    at.setHours(9, 12, 0, 0)
    installOstlerApi({
      getBackupCopyStatus: async () => ({
        ok: true,
        value: { ...ON, lastCopiedAt: at.getTime() }
      })
    })
    renderSection()
    expect(
      await screen.findByText(`Last copied: ${lastCopiedText(at.getTime())} to E:\\Ostler backups`)
    ).toBeTruthy()
    expect(lastCopiedText(at.getTime())).toMatch(/^today at /)
  })

  it('says yesterday, then the date, for older copies', () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime()
    expect(lastCopiedText(new Date(2026, 9, 14, 18, 40).getTime(), now)).toMatch(/^yesterday at /)
    expect(lastCopiedText(new Date(2026, 9, 1, 18, 40).getTime(), now)).not.toMatch(/at /)
  })

  it('warns when the last copy failed', async () => {
    installOstlerApi({
      getBackupCopyStatus: async () => ({ ok: true, value: { ...ON, copyFailedAt: 5 } })
    })
    renderSection()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('E:\\Ostler backups could not be reached')
    )
  })

  it('notes a folder a sync service stores', async () => {
    installOstlerApi({
      getBackupCopyStatus: async () => ({
        ok: true,
        value: { ...ON, folder: 'C:\\Users\\sam\\OneDrive', syncedBy: 'OneDrive' }
      })
    })
    renderSection()
    expect(
      await screen.findByText(
        'This folder is in OneDrive: the backups will be stored by OneDrive too.'
      )
    ).toBeTruthy()
  })

  it('stops copying', async () => {
    const stopBackupCopy = vi.fn(async () => ({ ok: true as const, value: OFF }))
    installOstlerApi({
      getBackupCopyStatus: async () => ({ ok: true, value: ON }),
      stopBackupCopy
    })
    const onMessage = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop copying' }))
    expect(await screen.findByRole('button', { name: 'Also copy backups to…' })).toBeTruthy()
    expect(stopBackupCopy).toHaveBeenCalled()
    expect(onMessage).toHaveBeenLastCalledWith({
      text: 'Backups are no longer copied. Copies already there stay.',
      isError: false
    })
  })

  it('lists the backups in the second place and restores one after asking', async () => {
    const backup: BackupEntry = {
      id: '20261014-091200-000-scheduled',
      reason: 'scheduled',
      createdAt: new Date(2026, 9, 14, 9, 12).getTime(),
      sizeBytes: 2048,
      appVersion: '1.0.0',
      schemaVersion: 1,
      restoreBlockedReason: null
    }
    const restoreFromSecondPlace = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      getBackupCopyStatus: async () => ({ ok: true, value: ON }),
      listSecondPlaceBackups: async () => ({ ok: true, value: [backup] }),
      restoreFromSecondPlace
    })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Restore from the second place…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Backups in the second place' })
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Restore backup from/ }))
    const ask = await screen.findByRole('alertdialog')
    expect(restoreFromSecondPlace).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'Restore backup' }))

    await waitFor(() => expect(restoreFromSecondPlace).toHaveBeenCalledWith(backup.id))
  })
})
