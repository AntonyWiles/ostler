import { DEFAULT_CONFIG, type EmailSettings } from '@shared/ostler-api'
import { toRendererConfig } from '@shared/renderer-config'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { ConfigStore } from '../config-store'
import { emailRefusal, isEmailAddress, sendEmail } from '../services/email-sender'
import { handleApi } from './handle-ipc'

export interface EmailHandlerDependencies {
  configStore: ConfigStore
}

const MAX_TEXT = 255
const MAX_PASSWORD = 512

/**
 * The email server's settings from the renderer, checked: a server name, a
 * port, a from address that is one, and short plain text everywhere. An
 * empty password keeps the saved one.
 */
export function emailSettingsFrom(value: unknown, saved: EmailSettings): EmailSettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const text = (key: string, max = MAX_TEXT) => {
    const field = input[key]
    return typeof field === 'string' ? field.trim().slice(0, max) : ''
  }
  const host = text('host')
  const fromAddress = text('fromAddress')
  const port = Number(input.port)
  if (!host || /\s/.test(host) || !isEmailAddress(fromAddress)) {
    throw new Refusal(t('errors:email.invalidSettings'))
  }
  const password = typeof input.password === 'string' ? input.password.slice(0, MAX_PASSWORD) : ''
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_CONFIG.email.port,
    security: input.security === 'tls' ? 'tls' : 'starttls',
    username: text('username'),
    password: password || saved.password,
    fromAddress,
    fromName: text('fromName', 120)
  }
}

/**
 * Settings › Connections › Email (MOP-4): the email server, set and cleared
 * here only, and a test email to the from address.
 */
export function registerEmailHandlers({ configStore }: EmailHandlerDependencies): void {
  handleApi('setEmailSettings', (_event, value: unknown) => {
    const email = emailSettingsFrom(value, configStore.get().email)
    return toRendererConfig(configStore.update({ email }))
  })

  handleApi('clearEmailSettings', () =>
    toRendererConfig(configStore.update({ email: { ...DEFAULT_CONFIG.email } }))
  )

  handleApi('sendTestEmail', async () => {
    const settings = configStore.get().email
    try {
      await sendEmail(settings, {
        to: settings.fromAddress,
        subject: t('settings:email.testSubject'),
        text: t('settings:email.testBody', { server: settings.host })
      })
    } catch (error) {
      throw emailRefusal(error)
    }
  })
}
