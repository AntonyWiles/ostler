import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailSettings } from '@shared/ostler-api'

const sendMail = vi.fn()
const close = vi.fn()
const createTransport = vi.fn((_options: object) => ({ sendMail, close }))
vi.mock('nodemailer', () => ({ default: { createTransport } }))

const { EmailError, emailReady, isEmailAddress, sendEmail } =
  await import('../../electron/services/email-sender')

const settings: EmailSettings = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'sam@example.com',
  password: 'app-password',
  fromAddress: 'sam@example.com',
  fromName: 'Sam'
}

const email = { to: 'alex@example.org', subject: 'Join', text: 'Click this link' }

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({})
  close.mockReset()
  createTransport.mockClear()
})

describe('sending email over SMTP (MOP-4)', () => {
  it('sends through the server set up, with STARTTLS required on 587', async () => {
    await sendEmail(settings, email)
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: 'sam@example.com', pass: 'app-password' }
      })
    )
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: 'Sam', address: 'sam@example.com' },
      ...email
    })
    expect(close).toHaveBeenCalled()
  })

  it('uses TLS from the start for port 465, and no sign-in without a user name', async () => {
    await sendEmail({ ...settings, port: 465, security: 'tls', username: '', fromName: '' }, email)
    expect(createTransport.mock.calls[0][0]).toMatchObject({ secure: true, requireTLS: false })
    expect(createTransport.mock.calls[0][0]).toHaveProperty('auth', undefined)
    expect(sendMail.mock.calls[0][0].from).toBe('sam@example.com')
  })

  it('says why it could not send', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('535 bad'), { code: 'EAUTH' }))
    await expect(sendEmail(settings, email)).rejects.toMatchObject({ reason: 'sign-in' })
    sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    await expect(sendEmail(settings, email)).rejects.toMatchObject({ reason: 'connection' })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('sends nothing until it is set up, or to an address that is not one', async () => {
    await expect(sendEmail({ ...settings, host: '' }, email)).rejects.toBeInstanceOf(EmailError)
    await expect(sendEmail(settings, { ...email, to: 'alex' })).rejects.toMatchObject({
      reason: 'refused'
    })
    expect(createTransport).not.toHaveBeenCalled()
    expect(emailReady({ ...settings, fromAddress: '' })).toBe(false)
    expect(isEmailAddress('a@b.co')).toBe(true)
    expect(isEmailAddress('A <a@b.co>')).toBe(false)
  })
})

describe('the email server in the config (MOP-4)', async () => {
  const { emailSettingsFrom } = await import('../../electron/ipc/email-handlers')
  const { toRendererConfig, fromRendererConfigUpdate } = await import('@shared/renderer-config')
  const { DEFAULT_CONFIG } = await import('@shared/ostler-api')

  it('checks what Settings sends, and keeps the saved password when none is typed', () => {
    const saved = { ...settings, password: 'kept' }
    const next = emailSettingsFrom(
      { ...settings, host: ' smtp.example.com ', port: '0', password: '', security: 'x' },
      saved
    )
    expect(next).toMatchObject({ host: 'smtp.example.com', port: 587, security: 'starttls' })
    expect(next.password).toBe('kept')
    expect(() => emailSettingsFrom({ ...settings, fromAddress: 'sam' }, saved)).toThrow()
    expect(() => emailSettingsFrom({ ...settings, host: 'smtp example' }, saved)).toThrow()
  })

  it('never gives the renderer the password, nor takes the server from updateConfig', () => {
    const config = { ...DEFAULT_CONFIG, email: settings }
    const shown = toRendererConfig(config)
    expect(shown.email).toEqual({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'sam@example.com',
      fromAddress: 'sam@example.com',
      fromName: 'Sam',
      hasPassword: true
    })
    expect(JSON.stringify(shown)).not.toContain('app-password')
    expect(fromRendererConfigUpdate({ email: settings } as never)).not.toHaveProperty('email')
  })
})
