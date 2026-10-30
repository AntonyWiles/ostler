import { useState, type FormEvent } from 'react'
import type { EmailSecurity } from '@shared/ostler-api'
import { Button, Select, TextField, useConfirm, useToast } from '../ui'
import { CommittedNumberField, SettingsGroup, useSettings } from '../views/settings/settings-form'
import { t } from '@shared/i18n'

/** The usual port for each way of securing the connection. */
const PORT_FOR: Record<EmailSecurity, number> = { starttls: 587, tls: 465 }

/**
 * Settings › Connections › Email (MOP-4): the person's own SMTP server, such
 * as their email provider's, so Ostler can email an invite. The password is
 * typed once, encrypted in the main process and never shown again; this
 * screen only knows whether one is saved. Until it is set up, only **Set up
 * email…** shows.
 */
export function EmailSettingsGroup() {
  const { config, setConfig, markSaved, setError } = useSettings()
  const confirm = useConfirm()
  const { toast } = useToast()
  const saved = config.email
  const isSetUp = Boolean(saved.host && saved.fromAddress)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [host, setHost] = useState(saved.host)
  const [security, setSecurity] = useState<EmailSecurity>(saved.security)
  const [port, setPort] = useState(saved.port)
  const [username, setUsername] = useState(saved.username)
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(saved.fromAddress)
  const [fromName, setFromName] = useState(saved.fromName)

  const startEditing = () => {
    setHost(saved.host)
    setSecurity(saved.security)
    setPort(saved.port)
    setUsername(saved.username)
    setPassword('')
    setFromAddress(saved.fromAddress)
    setFromName(saved.fromName)
    setEditing(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy('save')
    const result = await window.ostlerAPI.setEmailSettings({
      host,
      port,
      security,
      username,
      password,
      fromAddress,
      fromName
    })
    setBusy(null)
    if (!result.ok) return setError(result.error)
    setError(null)
    setConfig(result.value)
    setPassword('')
    setEditing(false)
    markSaved()
  }

  const sendTest = async () => {
    setBusy('test')
    const result = await window.ostlerAPI.sendTestEmail()
    setBusy(null)
    if (!result.ok) return setError(result.error)
    setError(null)
    toast({
      title: t('settings:email.testSent', { address: saved.fromAddress }),
      tone: 'success'
    })
  }

  const remove = async () => {
    const ok = await confirm({
      title: t('settings:email.removeTitle'),
      body: t('settings:email.removeBody'),
      confirmLabel: t('settings:email.remove'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.clearEmailSettings()
    if (!result.ok) return setError(result.error)
    setConfig(result.value)
    markSaved()
  }

  return (
    <SettingsGroup id="email-server" description={t('settings:email.description')}>
      {editing ? (
        <form className="ostler-settings-subsection" onSubmit={(event) => void save(event)}>
          <TextField
            label={t('settings:email.server')}
            hint={t('settings:email.serverHint')}
            required
            spellCheck={false}
            value={host}
            maxLength={255}
            onChange={(event) => setHost(event.target.value)}
          />
          <Select
            label={t('settings:email.security')}
            value={security}
            onChange={(event) => {
              const next = event.target.value as EmailSecurity
              if (port === PORT_FOR[security]) setPort(PORT_FOR[next])
              setSecurity(next)
            }}
            options={[
              { value: 'starttls', label: t('settings:email.starttls') },
              { value: 'tls', label: t('settings:email.tls') }
            ]}
          />
          <CommittedNumberField
            label={t('settings:email.port')}
            min={1}
            max={65535}
            value={port}
            onCommit={setPort}
          />
          <TextField
            label={t('settings:email.username')}
            hint={t('settings:email.usernameHint')}
            autoComplete="off"
            spellCheck={false}
            value={username}
            maxLength={255}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label={t('settings:email.password')}
            hint={
              saved.hasPassword
                ? t('settings:email.passwordKept')
                : t('settings:email.passwordHint')
            }
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            maxLength={512}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            label={t('settings:email.fromAddress')}
            type="email"
            required
            spellCheck={false}
            value={fromAddress}
            maxLength={255}
            onChange={(event) => setFromAddress(event.target.value)}
          />
          <TextField
            label={t('settings:email.fromName')}
            hint={t('settings:email.fromNameHint')}
            value={fromName}
            maxLength={120}
            onChange={(event) => setFromName(event.target.value)}
          />
          <div className="ostler-settings-inline-actions">
            <Button type="submit" size="sm" loading={busy === 'save'} disabled={busy !== null}>
              {t('settings:email.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('settings:email.cancel')}
            </Button>
          </div>
        </form>
      ) : isSetUp ? (
        <>
          <p className="ostler-settings-text">
            {t('settings:email.sendsAs', {
              from: saved.fromName ? `${saved.fromName} <${saved.fromAddress}>` : saved.fromAddress,
              server: saved.host
            })}
          </p>
          <div className="ostler-settings-inline-actions">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'test'}
              disabled={busy !== null}
              onClick={() => void sendTest()}
            >
              {t('settings:email.sendTest')}
            </Button>
            <Button size="sm" variant="ghost" onClick={startEditing}>
              {t('settings:email.change')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              {t('settings:email.remove')}
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={startEditing}>
          {t('settings:email.setUp')}
        </Button>
      )}
    </SettingsGroup>
  )
}
