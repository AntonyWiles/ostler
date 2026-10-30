// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SyncServerState } from '@shared/ostler-api'
import { SyncServerGroup } from '@renderer/accounts/SyncServerGroup'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const empty: SyncServerState = {
  url: null,
  signIn: 'key',
  scope: null,
  accountId: null,
  hasKey: false,
  managed: false,
  ready: false
}

const renderGroup = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <SyncServerGroup />
      </ConfirmProvider>
    </ToastProvider>
  )

describe('Settings › Connections › Sync server', () => {
  it('is one button until set up, then says where it shares', async () => {
    const setSyncServer = vi.fn(async () => ({
      ok: true as const,
      value: { ...empty, url: 'https://sync.example.com', hasKey: true, ready: true }
    }))
    installOstlerApi({
      getSyncServer: async () => ({ ok: true, value: empty }),
      listAccounts: async () => ({ ok: true, value: [] }),
      setSyncServer
    })
    renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up a sync server…' }))
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://sync.example.com' }
    })
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'k-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setSyncServer).toHaveBeenCalledWith({
        url: 'https://sync.example.com',
        signIn: 'key',
        key: 'k-123'
      })
    )
    expect(
      await screen.findByText('Shares through sync.example.com with an access key.')
    ).toBeTruthy()
    expect(screen.queryByLabelText('Access key')).toBeNull()
  })

  it("asks only for the person's own sign-in when the organisation sets the server", async () => {
    installOstlerApi({
      getSyncServer: async () => ({
        ok: true,
        value: { ...empty, url: 'https://sync.contoso.com', managed: true }
      }),
      listAccounts: async () => ({ ok: true, value: [] })
    })
    renderGroup()
    expect(await screen.findByText('Set by your organisation')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to sync.contoso.com…' }))
    expect(screen.queryByLabelText('Server address')).toBeNull()
    expect(screen.getByLabelText('Access key')).toBeTruthy()
  })
})
