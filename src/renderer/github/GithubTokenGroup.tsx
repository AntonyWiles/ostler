import { useState, type FormEvent } from 'react'
import { Button, TextField, useConfirm } from '../ui'
import { SettingsGroup, useSettings } from '../views/settings/settings-form'
import { t } from '@shared/i18n'

/**
 * Settings › Connections › GitHub (R4.4, D40): an optional token, for private
 * repositories and a higher request limit. It is typed once, encrypted in
 * the main process and never shown again; this screen only knows whether one
 * is saved. Removing it cannot be undone (the token is gone), so it asks.
 */
export function GithubTokenGroup() {
  const { config, setConfig, markSaved, setError } = useSettings()
  const confirm = useConfirm()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const hasToken = config.github?.hasToken === true

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    const result = await window.ostlerAPI.setGithubToken(token)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setToken('')
    setError(null)
    setConfig(result.value)
    markSaved()
  }

  const remove = async () => {
    const ok = await confirm({
      title: t('settings:githubToken.removeTitle'),
      body: t('settings:githubToken.removeBody'),
      confirmLabel: t('settings:githubToken.remove'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.clearGithubToken()
    if (!result.ok) return setError(result.error)
    setConfig(result.value)
    markSaved()
  }

  return (
    <SettingsGroup id="github-token" description={t('settings:githubToken.description')}>
      <p className="ostler-settings-hint">{t('settings:githubToken.whatIsSent')}</p>
      {hasToken ? (
        <div className="ostler-settings-inline-actions">
          <span className="ostler-settings-text">{t('settings:githubToken.saved')}</span>
          <Button size="sm" variant="danger" onClick={() => void remove()}>
            {t('settings:githubToken.remove')}
          </Button>
        </div>
      ) : (
        <form className="ostler-settings-inline-actions" onSubmit={(event) => void save(event)}>
          <TextField
            label={t('settings:githubToken.token')}
            hint={t('settings:githubToken.tokenHint')}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            maxLength={512}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button type="submit" size="sm" loading={busy} disabled={busy || !token.trim()}>
            {t('settings:githubToken.save')}
          </Button>
        </form>
      )}
    </SettingsGroup>
  )
}
