import { describe, expect, it } from 'vitest'
import { inviteMessage } from '../../electron/services/sync/invite-message'
import { findInvite, INVITE_PREFIX } from '../../src/shared/deep-link'
import { shareFolderName, sharePlaceKind } from '../../src/shared/sync-place'

const INVITE = `${INVITE_PREFIX}eyJzaGFyZUlkIjoiYWJjIn0`

describe('sharePlaceKind', () => {
  it('tells the sync app from the folder', () => {
    expect(sharePlaceKind('G:\\My Drive\\Ostler\\Garden')).toBe('google-drive')
    expect(sharePlaceKind('C:\\Users\\ann\\Google Drive\\Garden')).toBe('google-drive')
    expect(sharePlaceKind('C:\\Users\\ann\\OneDrive - Contoso\\Garden')).toBe('onedrive')
    expect(sharePlaceKind('D:\\Dropbox (Personal)\\Garden')).toBe('dropbox')
    expect(sharePlaceKind('\\\\nas\\team\\Garden')).toBe('folder')
    expect(sharePlaceKind('https://sync.contoso.com/spaces/1')).toBe('server')
    expect(sharePlaceKind('gdrive:1AbC_dEf')).toBe('drive')
  })

  it('names the folder by its last part', () => {
    expect(shareFolderName('G:\\My Drive\\Ostler\\Garden')).toBe('Garden')
  })
})

describe('inviteMessage', () => {
  it('gives the Google Drive steps for a Google Drive folder', () => {
    const message = inviteMessage('Garden', INVITE, 'G:\\My Drive\\Ostler\\Garden')
    expect(message).toContain('Open the Google Drive folder "Garden"')
    expect(message).toContain('Add shortcut to My Drive')
    expect(findInvite(message, 'ostler')).toBe(INVITE)
  })

  it('gives the OneDrive steps for a OneDrive folder, and no Google Drive ones', () => {
    const message = inviteMessage('Garden', INVITE, 'C:\\Users\\ann\\OneDrive\\Garden')
    expect(message).toContain('Open the OneDrive folder "Garden"')
    expect(message).not.toContain('Google Drive')
  })

  it('gives the Dropbox step for a Dropbox folder', () => {
    expect(inviteMessage('Garden', INVITE, 'D:\\Dropbox\\Garden')).toContain(
      'Accept the Dropbox folder "Garden"'
    )
  })

  it('names no sync app for another folder', () => {
    const message = inviteMessage('Garden', INVITE, '\\\\nas\\team\\Garden')
    expect(message).toContain('Make sure the folder "Garden" I shared with you is on your PC.')
  })

  it('asks for no folder for a project on the sync server, only the server', () => {
    const message = inviteMessage('Garden', INVITE, 'https://sync.contoso.com/spaces/1')
    expect(message).toContain('sync server sync.contoso.com')
    expect(message).not.toContain('folder')
    expect(findInvite(message, 'ostler')).toBe(INVITE)
  })

  it('asks for no folder for a project in Google Drive, only the Google account', () => {
    const message = inviteMessage('Garden', INVITE, 'gdrive:1AbC_dEf')
    expect(message).toContain('connect your Google account')
    expect(message).not.toContain('1AbC_dEf')
    expect(findInvite(message, 'ostler')).toBe(INVITE)
  })
})
