// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RendererConfig } from '@shared/ostler-api'
import { EmailSettingsGroup } from '@renderer/email/EmailSettingsGroup'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../fixtures/ostler-api'

function renderGroup(initial: RendererConfig = RENDERER_DEFAULT_CONFIG) {
  let config = initial
  const setConfig = vi.fn((next: RendererConfig) => {
    config = next
    view.rerender(tree())
  })
  const tree = () => (
    <ToastProvider>
      <ConfirmProvider>
        <SettingsProvider
          value={
            {
              config,
              setConfig,
              markSaved: () => {},
              setError: () => {},
              saveConfig: async () => {}
            } as never
          }
        >
          <EmailSettingsGroup />
        </SettingsProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  const view = render(tree())
  return { setConfig }
}

describe('Settings › Connections › Email (MOP-4)', () => {
  it('shows only Set up email… until it is set up, then saves the server', async () => {
    const saved = {
      ...RENDERER_DEFAULT_CONFIG,
      email: {
        ...RENDERER_DEFAULT_CONFIG.email,
        host: 'smtp.example.com',
        fromAddress: 'sam@example.com',
        fromName: 'Sam',
        hasPassword: true
      }
    }
    const setEmailSettings = vi.fn(async () => ({ ok: true as const, value: saved }))
    installOstlerApi({ setEmailSettings })
    renderGroup()
    expect(screen.queryByRole('textbox', { name: /Server/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set up email…' }))

    fireEvent.change(screen.getByRole('textbox', { name: /Server/ }), {
      target: { value: 'smtp.example.com' }
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection' }), {
      target: { value: 'tls' }
    })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'app-password' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'From address' }), {
      target: { value: 'sam@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setEmailSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          security: 'tls',
          // The usual port follows the connection until it is changed by hand.
          port: 465,
          password: 'app-password',
          fromAddress: 'sam@example.com'
        })
      )
    )
    expect(
      await screen.findByText('Sends as Sam <sam@example.com> through smtp.example.com.')
    ).toBeTruthy()
  })

  it('sends a test email from the saved server', async () => {
    const sendTestEmail = vi.fn(async () => ({ ok: true as const, value: undefined }))
    installOstlerApi({ sendTestEmail })
    renderGroup({
      ...RENDERER_DEFAULT_CONFIG,
      email: {
        ...RENDERER_DEFAULT_CONFIG.email,
        host: 'smtp.example.com',
        fromAddress: 'sam@example.com'
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))
    expect(await screen.findByText('Test email sent to sam@example.com')).toBeTruthy()
    expect(sendTestEmail).toHaveBeenCalled()
  })
})
