// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccountProviderInfo, ConnectedAccount } from '@shared/ostler-api'
import { AccountsGroup } from '@renderer/accounts/AccountsGroup'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

const providers: AccountProviderInfo[] = [
  {
    provider: 'google',
    method: 'oauth',
    capabilities: ['calendar.read', 'contacts.read'],
    ready: false,
    registration: null
  },
  {
    provider: 'microsoft',
    method: 'oauth',
    capabilities: ['calendar.read', 'calendar.write', 'contacts.read'],
    ready: true,
    registration: 'policy'
  },
  {
    provider: 'caldav',
    method: 'password',
    capabilities: ['calendar.read', 'contacts.read'],
    ready: true,
    registration: null
  },
  {
    provider: 'dropbox',
    method: 'oauth',
    capabilities: ['files.pick'],
    ready: false,
    registration: null
  }
]

const account: ConnectedAccount = {
  id: 'a1',
  provider: 'microsoft',
  label: 'ann@example.com',
  server: null,
  capabilities: ['calendar.read', 'contacts.read'],
  status: 'needs-reconnect',
  failure: 'expired',
  createdAt: 1,
  lastUsedAt: 2
}

const renderGroup = () =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <AccountsGroup />
      </ConfirmProvider>
    </ToastProvider>
  )

describe('Settings › Connections › Accounts', () => {
  it('lists accounts with what they give, and asks before removing one', async () => {
    const disconnectAccount = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({
      listAccounts: async () => ({ ok: true, value: [account] }),
      listAccountProviders: async () => ({ ok: true, value: providers }),
      disconnectAccount,
      onAccountsChange: () => () => undefined
    })
    renderGroup()
    const list = await screen.findByRole('list', { name: 'Connected accounts' })
    expect(list).toHaveTextContent('Microsoft 365 or Outlook.com · ann@example.com')
    expect(list).toHaveTextContent('Calendars · Contacts')
    expect(within(list).getByRole('button', { name: 'Sign in again…' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove ann@example.com' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove ann@example.com?' })
    expect(disconnectAccount).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(disconnectAccount).toHaveBeenCalledWith('a1'))
  })

  it('asks for a client ID where there is no registration, and signs in where there is', async () => {
    const connectAccount = vi.fn(async () => ({
      ok: true as const,
      value: { ...account, status: 'connected' as const, failure: null }
    }))
    const setAccountApp = vi.fn(async () => ({
      ok: true as const,
      value: providers.map((p) => (p.provider === 'google' ? { ...p, ready: true } : p))
    }))
    installOstlerApi({
      listAccounts: async () => ({ ok: true, value: [] }),
      listAccountProviders: async () => ({ ok: true, value: providers }),
      connectAccount,
      setAccountApp,
      onAccountsChange: () => () => undefined
    })
    renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect an account…' }))

    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(screen.getByText(/isn't registered with this provider yet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'abc.apps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setAccountApp).toHaveBeenCalledWith({
        provider: 'google',
        clientId: 'abc.apps',
        clientSecret: ''
      })
    )
    expect(await screen.findByRole('button', { name: 'Sign in…' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Microsoft 365 or Outlook.com' }))
    expect(screen.getByText(/organisation's app registration/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in…' }))
    await waitFor(() => expect(connectAccount).toHaveBeenCalledWith({ provider: 'microsoft' }))
  })

  it('connects iCloud with an Apple ID and an app-specific password', async () => {
    const connectAccount = vi.fn(async () => ({
      ok: true as const,
      value: { ...account, provider: 'caldav' as const, status: 'connected' as const }
    }))
    installOstlerApi({
      listAccounts: async () => ({ ok: true, value: [] }),
      listAccountProviders: async () => ({ ok: true, value: providers }),
      connectAccount,
      onAccountsChange: () => () => undefined
    })
    renderGroup()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect an account…' }))
    fireEvent.click(screen.getByRole('button', { name: 'iCloud' }))
    expect(screen.queryByLabelText('Server address')).toBeNull()
    fireEvent.change(screen.getByLabelText('Apple ID'), { target: { value: 'ann@icloud.com' } }) // hygiene-allow: fake test account
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'abcd-efgh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() =>
      expect(connectAccount).toHaveBeenCalledWith({
        provider: 'caldav',
        server: 'https://caldav.icloud.com',
        username: 'ann@icloud.com', // hygiene-allow: fake test account
        password: 'abcd-efgh'
      })
    )
  })
})
