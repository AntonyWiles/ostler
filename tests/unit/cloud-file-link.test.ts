import { describe, expect, it, vi } from 'vitest'
import { cloudFileOf } from '../../src/shared/cloud-file-link'
import { cloudFileName } from '../../electron/services/accounts/account-files'

describe('cloud file links (integrations phase 3)', () => {
  it('recognises OneDrive, SharePoint, Google Drive and Dropbox links, and nothing else', () => {
    expect(cloudFileOf('https://1drv.ms/w/s!AbC')).toEqual({
      service: 'onedrive',
      provider: 'microsoft'
    })
    expect(cloudFileOf('https://contoso-my.sharepoint.com/:w:/p/ann/EAbc')?.service).toBe(
      'onedrive'
    )
    expect(cloudFileOf('https://contoso.sharepoint.com/:x:/s/team/EAbc')?.service).toBe(
      'sharepoint'
    )
    expect(cloudFileOf('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')?.service).toBe(
      'googleDrive'
    )
    expect(cloudFileOf('https://drive.google.com/drive/my-drive')).toBeNull()
    expect(cloudFileOf('https://www.dropbox.com/scl/fi/abc/plan.pdf?dl=0')?.provider).toBe(
      'dropbox'
    )
    expect(cloudFileOf('http://1drv.ms/w/s!AbC')).toBeNull()
    expect(cloudFileOf('https://sharepoint.com.evil.example/x')).toBeNull()
    expect(cloudFileOf('https://example.com/file.docx')).toBeNull()
    expect(cloudFileOf(null)).toBeNull()
  })

  it('reads the name through Graph shares, Drive and Dropbox', async () => {
    const callJson = vi.fn(async (_id: string, url: string, _call?: unknown) =>
      url.startsWith('https://graph.microsoft.com')
        ? { name: 'Plan.docx', webUrl: 'https://contoso-my.sharepoint.com/x' }
        : url.startsWith('https://www.googleapis.com')
          ? { name: 'Budget', webViewLink: 'https://docs.google.com/x' }
          : { name: 'plan.pdf', url: 'https://www.dropbox.com/x' }
    )
    const accounts = { callJson }
    const one = 'https://1drv.ms/w/s!AbC'
    expect(await cloudFileName(accounts as never, 'a', one)).toEqual({
      name: 'Plan.docx',
      webUrl: 'https://contoso-my.sharepoint.com/x'
    })
    expect(callJson.mock.calls[0][1]).toBe(
      `https://graph.microsoft.com/v1.0/shares/u!${Buffer.from(one).toString('base64url')}/driveItem?$select=name,webUrl`
    )
    expect(
      (
        await cloudFileName(
          accounts as never,
          'a',
          'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit'
        )
      )?.name
    ).toBe('Budget')
    expect(String(callJson.mock.calls[1][1])).toContain('/drive/v3/files/1AbCdEfGhIjKlMnOp?')
    expect(
      (await cloudFileName(accounts as never, 'a', 'https://www.dropbox.com/scl/fi/abc/plan.pdf'))
        ?.name
    ).toBe('plan.pdf')
    expect(callJson.mock.calls[2][2]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.dropbox.com/scl/fi/abc/plan.pdf' })
    })
    expect(await cloudFileName(accounts as never, 'a', 'https://example.com/x')).toBeNull()
  })
})
