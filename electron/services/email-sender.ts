import nodemailer from 'nodemailer'
import type { EmailSettings } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

/** One email: plain text, to one address. */
export interface OutgoingEmail {
  to: string
  subject: string
  text: string
}

/** Why an email could not go, for the person to fix in Settings › Connections › Email. */
export type EmailFailure = 'not-set-up' | 'sign-in' | 'connection' | 'refused'

export class EmailError extends Error {
  constructor(
    readonly reason: EmailFailure,
    readonly detail = ''
  ) {
    super(detail ? `${reason}: ${detail}` : reason)
    this.name = 'EmailError'
  }
}

/** A plain email address: something@somewhere.tld, with no spaces or angle brackets. */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value)
}

/** Enough is set to send: a server, a port and who it is from. */
export function emailReady(settings: EmailSettings): boolean {
  return Boolean(settings.host.trim()) && settings.port > 0 && isEmailAddress(settings.fromAddress)
}

/**
 * Sends one email through the person's own SMTP server (MOP-4), such as
 * their email provider's: TLS from the start on port 465, or STARTTLS, which
 * must succeed, on 587 or 25. Ostler never relays mail itself.
 */
export async function sendEmail(settings: EmailSettings, email: OutgoingEmail): Promise<void> {
  if (!emailReady(settings)) throw new EmailError('not-set-up')
  if (!isEmailAddress(email.to)) throw new EmailError('refused', email.to)
  const transport = nodemailer.createTransport({
    host: settings.host.trim(),
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000
  })
  try {
    await transport.sendMail({
      from: settings.fromName
        ? { name: settings.fromName, address: settings.fromAddress }
        : settings.fromAddress,
      to: email.to,
      subject: email.subject,
      text: email.text
    })
  } catch (error) {
    throw toEmailError(error)
  } finally {
    transport.close()
  }
}

/** Nodemailer's error codes, as what the person can do about them. */
function toEmailError(error: unknown): EmailError {
  const code = (error as { code?: unknown } | null)?.code
  const detail = error instanceof Error ? error.message : String(error)
  if (code === 'EAUTH') return new EmailError('sign-in', detail)
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return new EmailError('refused', detail)
  return new EmailError('connection', detail)
}

/** A failure to send, in the person's words; any other error as it is. */
export function emailRefusal(error: unknown): unknown {
  if (error instanceof EmailError) return new Refusal(t(`errors:email.${error.reason}`))
  return error
}
