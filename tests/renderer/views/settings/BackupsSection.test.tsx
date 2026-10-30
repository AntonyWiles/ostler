// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type BackupEntry } from '@shared/ostler-api'
import { BackupsSection } from '@renderer/views/settings/BackupsSection'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const render = (ui: ReactElement) =>
  rtlRender(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>
  )

const BACKUP: BackupEntry = {
  id: '20261008-101500-000-manual',
  reason: 'manual',
  createdAt: Date.UTC(2026, 9, 8, 10, 15),
  sizeBytes: 2048,
  appVersion: '0.1.0',
  schemaVersion: 2,
  restoreBlockedReason: null
}

describe('BackupsSection', () => {
  it('lists backups with their kind and size, and says what is not included', async () => {
    installOstlerApi({ listBackups: async () => ({ ok: true, value: [BACKUP] }) })
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={vi.fn()} />)

    expect(await screen.findByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('2 kB')).toBeInTheDocument()
    expect(screen.getByText(/Agent workspaces are\s+not included/)).toBeInTheDocument()
    expect(screen.getByText(/only works for this Windows user on this PC/)).toBeInTheDocument()
  })

  it('restores only after the confirmation', async () => {
    const restoreBackup = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      listBackups: async () => ({ ok: true, value: [BACKUP] }),
      restoreBackup
    })
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Restore backup from/ }))
    let dialog = await screen.findByRole('alertdialog', { name: /^Restore the backup from/ })
    expect(restoreBackup).not.toHaveBeenCalled()
    expect(
      within(dialog).getByText('Ostler will restart. Your current data is saved first.')
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(restoreBackup).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Restore backup from/ }))
    dialog = await screen.findByRole('alertdialog', { name: /^Restore the backup from/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore backup' }))
    await waitFor(() => expect(restoreBackup).toHaveBeenCalledWith(BACKUP.id))
  })

  it('deletes only after the confirmation', async () => {
    const deleteBackup = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      listBackups: async () => ({ ok: true, value: [BACKUP] }),
      deleteBackup
    })
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Delete backup from/ }))
    const dialog = await screen.findByRole('alertdialog', { name: /^Delete the backup from/ })
    expect(within(dialog).getByText('This cannot be undone.')).toBeInTheDocument()
    expect(deleteBackup).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete backup' }))
    await waitFor(() => expect(deleteBackup).toHaveBeenCalledWith(BACKUP.id))
  })

  it('backs up now and refreshes the list', async () => {
    const listBackups = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValue({ ok: true, value: [BACKUP] })
    const createBackup = vi.fn(async () => ({ ok: true as const, value: BACKUP }))
    installOstlerApi({ listBackups, createBackup })
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={vi.fn()} />)

    expect(await screen.findByText('No backups yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))

    expect(await screen.findByText('Manual')).toBeInTheDocument()
    expect(createBackup).toHaveBeenCalledOnce()
    expect(screen.getByText('Backup created.')).toBeInTheDocument()
  })

  it('cannot restore a backup from a newer version', async () => {
    installOstlerApi({
      listBackups: async () => ({
        ok: true,
        value: [{ ...BACKUP, restoreBlockedReason: 'Written by a newer version of Ostler.' }]
      })
    })
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={vi.fn()} />)

    // Disabled with a reason: still focusable, so the reason can be read.
    expect(await screen.findByRole('button', { name: /^Restore backup from/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('saves the automatic-backup switch and the keep count', async () => {
    installOstlerApi({ listBackups: async () => ({ ok: true, value: [] }) })
    const saveConfig = vi.fn().mockResolvedValue(undefined)
    render(<BackupsSection config={RENDERER_DEFAULT_CONFIG} saveConfig={saveConfig} />)
    await screen.findByText('No backups yet.')

    fireEvent.click(screen.getByRole('switch', { name: 'Automatic backups' }))
    expect(saveConfig).toHaveBeenCalledWith({ backups: { enabled: false } })

    const keep = screen.getByRole('spinbutton', { name: 'Automatic backups to keep' })
    fireEvent.change(keep, { target: { value: '10' } })
    expect(saveConfig).not.toHaveBeenCalledWith({ backups: { keep: 10 } })
    fireEvent.blur(keep)
    expect(saveConfig).toHaveBeenCalledWith({ backups: { keep: 10 } })
  })
})
