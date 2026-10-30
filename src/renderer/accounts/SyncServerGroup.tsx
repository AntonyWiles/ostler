import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ConnectedAccount, SyncServerState } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Badge, Button, InlineAlert, Select, TextField, useConfirm, useToast } from '../ui'
import { SettingsGroup } from '../views/settings/settings-form'

/**
 * Settings › Connections › Sync server (docs/plans/integrations/overview.md,
 * phase 7): a server projects can be shared through in place of a folder.
 * One button until it is set up; then where it is and how this PC signs in.
 * The access key goes to main once and is never shown again. Where the
 * organisation's policy sets the server, its address and way of signing in
 * show as set by the organisation; only the key or account is the person's.
 */
export function SyncServerGroup() {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [state, setState] = useState<SyncServerState | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [server, list] = await Promise.all([
      window.ostlerAPI.getSyncServer(),
      window.ostlerAPI.listAccounts()
    ])
    if (server.ok) setState(server.value)
    if (list.ok) setAccounts(list.value.filter((account) => account.provider === 'microsoft'))
  }, [])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onAccountsChange(() => void load())
  }, [load])

  if (!state) return null

  const forget = async () => {
    const ok = await confirm({
      title: t('settings:syncServer.forgetTitle'),
      body: t('settings:syncServer.forgetBody'),
      confirmLabel: t('settings:syncServer.forget'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.clearSyncServer()
    if (result.ok) setState(result.value)
    else setError(result.error)
  }

  const set = state.url !== null && (state.ready || !state.managed)
  return (
    <SettingsGroup id="sync-server" description={t('settings:syncServer.description')}>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {state.managed && (
        <p className="ostler-settings-hint">
          <Badge>{t('settings:syncServer.setByOrganisation')}</Badge>
        </p>
      )}
      {set && !editing && state.url && (
        <div className="ostler-settings-subsection">
          <p className="ostler-settings-text">
            {state.signIn === 'key'
              ? t('settings:syncServer.usingKey', { server: hostOf(state.url) })
              : t('settings:syncServer.usingAccount', {
                  server: hostOf(state.url),
                  account:
                    accounts.find((account) => account.id === state.accountId)?.label ??
                    t('settings:syncServer.noAccount')
                })}{' '}
            {!state.ready && <Badge tone="warning">{t('settings:syncServer.notReady')}</Badge>}
          </p>
          <div className="ostler-settings-inline-actions">
            <Button size="sm" onClick={() => setEditing(true)}>
              {t('settings:syncServer.change')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void forget()}>
              {t('settings:syncServer.forget')}
            </Button>
          </div>
        </div>
      )}
      {!set && !editing && (
        <div>
          <Button size="sm" onClick={() => setEditing(true)}>
            {state.managed
              ? t('settings:syncServer.signIn', { server: hostOf(state.url ?? '') })
              : t('settings:syncServer.setUp')}
          </Button>
        </div>
      )}
      {editing && (
        <SyncServerForm
          state={state}
          accounts={accounts}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            setBusy(true)
            setError(null)
            try {
              const result = await window.ostlerAPI.setSyncServer(input)
              if (!result.ok) return setError(result.error)
              setState(result.value)
              setEditing(false)
              toast({ title: t('settings:syncServer.saved'), tone: 'success' })
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </SettingsGroup>
  )
}

function SyncServerForm({
  state,
  accounts,
  busy,
  onCancel,
  onSave
}: {
  state: SyncServerState
  accounts: ConnectedAccount[]
  busy: boolean
  onCancel(): void
  onSave(input: Parameters<typeof window.ostlerAPI.setSyncServer>[0]): Promise<void>
}) {
  const [url, setUrl] = useState(state.url ?? '')
  const [signIn, setSignIn] = useState(state.signIn)
  const [key, setKey] = useState('')
  const [scope, setScope] = useState(state.scope ?? '')
  const [accountId, setAccountId] = useState(state.accountId ?? accounts[0]?.id ?? '')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onSave({
      url: url.trim(),
      signIn,
      ...(signIn === 'key' ? (key.trim() ? { key: key.trim() } : {}) : { scope, accountId })
    })
  }

  return (
    <form className="ostler-settings-subsection" onSubmit={submit}>
      {!state.managed && (
        <>
          <TextField
            label={t('settings:syncServer.address')}
            hint={t('settings:syncServer.addressHint')}
            autoComplete="off"
            spellCheck={false}
            value={url}
            maxLength={500}
            placeholder="https://sync.example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
          <Select
            label={t('settings:syncServer.signInWith')}
            value={signIn}
            options={[
              { value: 'key', label: t('settings:syncServer.withKey') },
              { value: 'microsoft', label: t('settings:syncServer.withMicrosoft') }
            ]}
            onChange={(event) =>
              setSignIn(event.target.value === 'microsoft' ? 'microsoft' : 'key')
            }
          />
        </>
      )}
      {signIn === 'key' ? (
        <TextField
          label={t('settings:syncServer.key')}
          hint={state.hasKey ? t('settings:syncServer.keySaved') : t('settings:syncServer.keyHint')}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          maxLength={4096}
          onChange={(event) => setKey(event.target.value)}
        />
      ) : (
        <>
          {!state.managed && (
            <TextField
              label={t('settings:syncServer.scope')}
              hint={t('settings:syncServer.scopeHint')}
              autoComplete="off"
              spellCheck={false}
              value={scope}
              maxLength={500}
              onChange={(event) => setScope(event.target.value)}
            />
          )}
          {accounts.length === 0 ? (
            <p className="ostler-settings-hint">{t('settings:syncServer.connectAccountFirst')}</p>
          ) : (
            <Select
              label={t('settings:syncServer.account')}
              value={accountId}
              options={accounts.map((account) => ({ value: account.id, label: account.label }))}
              onChange={(event) => setAccountId(event.target.value)}
            />
          )}
        </>
      )}
      <div className="ostler-settings-inline-actions">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={busy}>
          {t('settings:syncServer.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('settings:syncServer.cancel')}
        </Button>
      </div>
    </form>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
