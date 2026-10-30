import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type {
  AccountCapability,
  AccountProvider,
  AccountProviderInfo,
  ConnectedAccount
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Badge, Button, InlineAlert, TextField, useConfirm, useToast } from '../ui'
import { SettingsGroup } from '../views/settings/settings-form'
import { CopyTargetRow, MY_TASKS_INTO_LIST } from '../views/settings/sections/CopyTargetRow'

/** The choices Connect an account offers; iCloud is a CalDAV account with Apple's server. */
type Choice = 'google' | 'microsoft' | 'icloud' | 'caldav' | 'dropbox'
const CHOICES: Choice[] = ['microsoft', 'google', 'icloud', 'caldav', 'dropbox']
const ICLOUD_SERVER = 'https://caldav.icloud.com'

function providerOf(choice: Choice): AccountProvider {
  return choice === 'icloud' ? 'caldav' : choice
}

/** "Calendars · Contacts" for what an account gives. */
export function capabilityWords(capabilities: AccountCapability[]): string {
  return capabilities
    .map((capability) => t(`settings:accounts.capability.${capability}`))
    .join(' · ')
}

export function accountName(account: ConnectedAccount): string {
  if (account.provider === 'caldav' && account.server && /icloud\.com$/i.test(account.server)) {
    return t('settings:accounts.provider.icloud')
  }
  return t(`settings:accounts.provider.${account.provider}`)
}

/**
 * Settings › Connections › Accounts (docs/plans/integrations/overview.md,
 * phase 0): the accounts this PC is connected to, what each gives, and
 * connecting one in place. Signing in happens in the browser; a password for
 * a CalDAV server is typed once and never shown again. Nothing is connected,
 * and nothing is sent, until the person connects an account.
 */
export function AccountsGroup() {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null)
  const [providers, setProviders] = useState<AccountProviderInfo[]>([])
  const [choosing, setChoosing] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Writing back (integrations phase 6): only Google and Microsoft have task lists.
  const taskAccounts = (accounts ?? []).filter(
    (account) => account.capabilities.includes('tasks.sync') && account.status !== 'failed'
  )

  const load = useCallback(async () => {
    const [list, offered] = await Promise.all([
      window.ostlerAPI.listAccounts(),
      window.ostlerAPI.listAccountProviders()
    ])
    if (list.ok) setAccounts(list.value)
    else setError(list.error)
    if (offered.ok) setProviders(offered.value)
  }, [])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onAccountsChange(() => void load())
  }, [load])

  const run = async <T,>(
    name: string,
    action: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>
  ): Promise<T | undefined> => {
    setBusy(name)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return undefined
      }
      return result.value
    } finally {
      setBusy(null)
    }
  }

  const connected = async (account: ConnectedAccount | undefined) => {
    if (!account) return
    setChoice(null)
    setChoosing(false)
    await load()
    toast({
      title: t('settings:accounts.connected', { label: account.label }),
      body: capabilityWords(account.capabilities),
      tone: 'success'
    })
  }

  const signIn = async (provider: AccountProvider) => {
    const account = await run('connect', () => window.ostlerAPI.connectAccount({ provider }))
    await connected(account)
  }

  const reconnect = async (account: ConnectedAccount) => {
    if (account.provider === 'caldav') {
      setChoosing(true)
      setChoice(account.server && /icloud\.com$/i.test(account.server) ? 'icloud' : 'caldav')
      return
    }
    const updated = await run(`reconnect-${account.id}`, () =>
      window.ostlerAPI.connectAccount({
        provider: account.provider,
        capabilities: account.capabilities
      })
    )
    if (updated) await load()
  }

  const remove = async (account: ConnectedAccount) => {
    const ok = await confirm({
      title: t('settings:accounts.removeTitle', { label: account.label }),
      body: t('settings:accounts.removeBody'),
      confirmLabel: t('settings:accounts.remove'),
      tone: 'danger'
    })
    if (!ok) return
    const done = await run(`remove-${account.id}`, async () => {
      const result = await window.ostlerAPI.disconnectAccount(account.id)
      return result.ok ? { ok: true as const, value: true } : result
    })
    if (done) await load()
  }

  const info = (provider: AccountProvider) =>
    providers.find((candidate) => candidate.provider === provider)

  return (
    <SettingsGroup id="accounts" description={t('settings:accounts.description')}>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {accounts && accounts.length > 0 && (
        <ul className="project-care-backups" aria-label={t('settings:accounts.list')}>
          {accounts.map((account) => (
            <li key={account.id} className="project-care-backup">
              <div className="project-care-backup__when">
                <span>
                  {accountName(account)} · {account.label}
                </span>
                {account.status === 'needs-reconnect' && (
                  <Badge tone="warning">{t('settings:accounts.needsReconnect')}</Badge>
                )}
                {account.status !== 'needs-reconnect' && account.failure && (
                  <Badge tone="warning">{t(`errors:accounts.failure.${account.failure}`)}</Badge>
                )}
                <span className="project-care-backup__size">
                  {capabilityWords(account.capabilities)}
                </span>
              </div>
              <div className="ostler-settings-inline-actions">
                {account.status === 'needs-reconnect' && (
                  <Button
                    size="sm"
                    loading={busy === `reconnect-${account.id}`}
                    disabled={busy !== null}
                    onClick={() => void reconnect(account)}
                  >
                    {t('settings:accounts.signInAgain')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings:accounts.removeLabel', { label: account.label })}
                  loading={busy === `remove-${account.id}`}
                  disabled={busy !== null}
                  onClick={() => void remove(account)}
                >
                  {t('settings:accounts.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!choosing ? (
        <div>
          <Button size="sm" onClick={() => setChoosing(true)}>
            {t('settings:accounts.connect')}
          </Button>
        </div>
      ) : (
        <div className="ostler-settings-subsections">
          <div
            className="ostler-settings-inline-actions"
            role="group"
            aria-label={t('settings:accounts.chooseProvider')}
          >
            {/* A kind your organisation doesn't allow isn't offered (phase 7). */}
            {CHOICES.filter(
              (candidate) => providers.length === 0 || info(providerOf(candidate))
            ).map((candidate) => (
              <Button
                key={candidate}
                size="sm"
                variant={choice === candidate ? 'primary' : 'secondary'}
                aria-pressed={choice === candidate}
                disabled={busy !== null}
                onClick={() => {
                  setChoice(candidate)
                  setError(null)
                }}
              >
                {t(`settings:accounts.provider.${candidate}`)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setChoosing(false)
                setChoice(null)
              }}
            >
              {t('settings:accounts.cancel')}
            </Button>
          </div>
          {choice && (choice === 'icloud' || choice === 'caldav') && (
            <DavForm
              key={choice}
              icloud={choice === 'icloud'}
              busy={busy === 'connect'}
              onConnect={async (server, username, password) => {
                const account = await run('connect', () =>
                  window.ostlerAPI.connectAccount({
                    provider: 'caldav',
                    server,
                    username,
                    password
                  })
                )
                await connected(account)
              }}
            />
          )}
          {choice && choice !== 'icloud' && choice !== 'caldav' && (
            <OAuthChoice
              key={choice}
              provider={providerOf(choice) as 'google' | 'microsoft' | 'dropbox'}
              info={info(providerOf(choice))}
              busy={busy === 'connect' || busy === 'app'}
              onSignIn={() => void signIn(providerOf(choice))}
              onSaveApp={async (clientId, clientSecret) => {
                const updated = await run('app', () =>
                  window.ostlerAPI.setAccountApp({
                    provider: providerOf(choice),
                    clientId,
                    clientSecret
                  })
                )
                if (updated) setProviders(updated)
              }}
            />
          )}
        </div>
      )}
      {taskAccounts.length > 0 && (
        <CopyTargetRow kind={MY_TASKS_INTO_LIST} accounts={taskAccounts} />
      )}
    </SettingsGroup>
  )
}

function OAuthChoice({
  provider,
  info,
  busy,
  onSignIn,
  onSaveApp
}: {
  provider: 'google' | 'microsoft' | 'dropbox'
  info: AccountProviderInfo | undefined
  busy: boolean
  onSignIn(): void
  onSaveApp(clientId: string, clientSecret: string): Promise<void>
}) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  if (info?.ready) {
    return (
      <div className="ostler-settings-subsection">
        <p className="ostler-settings-hint">
          {t(`settings:accounts.signInHint.${provider}`, {
            gives: capabilityWords(
              info.capabilities.filter((c) => c !== 'calendar.write' && c !== 'tasks.sync')
            )
          })}
        </p>
        {info.registration === 'policy' && (
          <p className="ostler-settings-hint">{t('settings:accounts.registrationPolicy')}</p>
        )}
        <div>
          <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={onSignIn}>
            {t('settings:accounts.signIn')}
          </Button>
        </div>
        {busy && <p className="ostler-settings-hint">{t('settings:accounts.finishInBrowser')}</p>}
      </div>
    )
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!clientId.trim()) return
    await onSaveApp(clientId.trim(), clientSecret.trim())
  }
  return (
    <form className="ostler-settings-subsection" onSubmit={(event) => void save(event)}>
      <p className="ostler-settings-hint">{t('settings:accounts.needsRegistration')}</p>
      <TextField
        label={t('settings:accounts.clientId')}
        hint={t(`settings:accounts.clientIdHint.${provider}`)}
        autoComplete="off"
        spellCheck={false}
        value={clientId}
        maxLength={512}
        onChange={(event) => setClientId(event.target.value)}
      />
      {provider === 'google' && (
        <TextField
          label={t('settings:accounts.clientSecret')}
          hint={t('settings:accounts.clientSecretHint')}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={clientSecret}
          maxLength={512}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      )}
      <div>
        <Button type="submit" size="sm" loading={busy} disabled={busy || !clientId.trim()}>
          {t('settings:accounts.saveRegistration')}
        </Button>
      </div>
    </form>
  )
}

function DavForm({
  icloud,
  busy,
  onConnect
}: {
  icloud: boolean
  busy: boolean
  onConnect(server: string, username: string, password: string): Promise<void>
}) {
  const [server, setServer] = useState(icloud ? ICLOUD_SERVER : '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onConnect(server, username, password)
    setPassword('')
  }
  return (
    <form className="ostler-settings-subsection" onSubmit={(event) => void submit(event)}>
      <p className="ostler-settings-hint">
        {icloud ? t('settings:accounts.icloudHint') : t('settings:accounts.caldavHint')}
      </p>
      {!icloud && (
        <TextField
          label={t('settings:accounts.server')}
          hint={t('settings:accounts.serverHint')}
          autoComplete="off"
          spellCheck={false}
          value={server}
          maxLength={2048}
          onChange={(event) => setServer(event.target.value)}
        />
      )}
      <TextField
        label={icloud ? t('settings:accounts.appleId') : t('settings:accounts.username')}
        autoComplete="off"
        spellCheck={false}
        value={username}
        maxLength={320}
        onChange={(event) => setUsername(event.target.value)}
      />
      <TextField
        label={t('settings:accounts.appPassword')}
        hint={
          icloud
            ? t('settings:accounts.appPasswordHintIcloud')
            : t('settings:accounts.appPasswordHint')
        }
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={password}
        maxLength={512}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={busy || !server.trim() || !username.trim() || !password}
        >
          {t('settings:accounts.connectAccount')}
        </Button>
      </div>
    </form>
  )
}
