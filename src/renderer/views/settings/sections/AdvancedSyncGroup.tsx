import { useCallback, useEffect, useState } from 'react'
import type { R2SetupCodeView, R2SyncState, Result, SetR2SyncInput } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import {
  Button,
  Checkbox,
  InlineAlert,
  Select,
  Skeleton,
  TextArea,
  TextField,
  useConfirm
} from '../../../ui'
import { SettingsGroup } from '../settings-form'

/** The intervals offered (r2-setup-code.ts `R2_CHECK_MINUTES`). */
const CHECK_MINUTES = [0, 1, 5, 15, 30, 60]
/** How often the open group reads the state again while a copy runs. */
const REFRESH_MS = 2000

type Draft = Omit<SetR2SyncInput, 'checkMinutes'> & { checkMinutes: number }

function draftOf(state: R2SyncState): Draft {
  return {
    accountId: state.accountId,
    bucket: state.bucket,
    prefix: state.prefix,
    endpoint: state.endpoint,
    accessKeyId: state.accessKeyId,
    secretAccessKey: '',
    checkMinutes: state.checkMinutes,
    uploadSoon: state.uploadSoon,
    enabled: state.configured ? state.enabled : true
  }
}

/**
 * Settings › Devices › Advanced sync: the personal space copied to the person's own Cloudflare R2
 * bucket, for a phone that syncs through it. The secret key goes to main once and never comes back;
 * the setup code carries the bucket to the phone, sealed with a passphrase shown once.
 */
export function AdvancedSyncGroup() {
  const [state, setState] = useState<R2SyncState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [setupCode, setSetupCode] = useState<R2SetupCodeView | null>(null)
  const [importing, setImporting] = useState(false)
  const [importCode, setImportCode] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const confirm = useConfirm()

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getR2Sync()
    if (result.ok) {
      setState(result.value)
      setDraft((current) => current ?? draftOf(result.value))
    } else setError(result.error)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!state?.running) return
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [state?.running, load])

  const run = async <T,>(
    name: string,
    action: () => Promise<Result<T>>,
    done?: (value: T) => void
  ): Promise<void> => {
    setBusy(name)
    setError(null)
    setNotice(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    done?.(result.value)
  }

  const applyState = (next: R2SyncState) => {
    setState(next)
    setDraft(draftOf(next))
  }

  if (!state || !draft) {
    return (
      <SettingsGroup id="advanced-sync">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : <Skeleton lines={2} />}
      </SettingsGroup>
    )
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const remove = async () => {
    const ok = await confirm({
      title: t('settings:advancedSync.removeTitle'),
      body: t('settings:advancedSync.removeBody'),
      confirmLabel: t('settings:advancedSync.remove'),
      tone: 'danger'
    })
    if (ok) await run('remove', () => window.ostlerAPI.clearR2Sync(), applyState)
  }

  return (
    <SettingsGroup id="advanced-sync" description={t('settings:advancedSync.description')}>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {notice && (
        <InlineAlert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </InlineAlert>
      )}
      {state.spaceFolder === null && (
        <InlineAlert tone="info">{t('settings:advancedSync.needsSpace')}</InlineAlert>
      )}
      {!state.configured && (
        <p className="ostler-settings-hint">{t('settings:advancedSync.how')}</p>
      )}

      <TextField
        label={t('settings:advancedSync.accountId')}
        value={draft.accountId}
        onChange={(event) => set({ accountId: event.target.value })}
        spellCheck={false}
      />
      <TextField
        label={t('settings:advancedSync.bucket')}
        value={draft.bucket}
        onChange={(event) => set({ bucket: event.target.value })}
        spellCheck={false}
      />
      <TextField
        label={t('settings:advancedSync.accessKeyId')}
        value={draft.accessKeyId}
        onChange={(event) => set({ accessKeyId: event.target.value })}
        spellCheck={false}
        autoComplete="off"
      />
      <TextField
        label={t('settings:advancedSync.secret')}
        type="password"
        value={draft.secretAccessKey ?? ''}
        hint={state.hasSecret ? t('settings:advancedSync.secretSaved') : undefined}
        onChange={(event) => set({ secretAccessKey: event.target.value })}
        autoComplete="off"
      />
      <TextField
        label={t('settings:advancedSync.prefix')}
        value={draft.prefix ?? ''}
        onChange={(event) => set({ prefix: event.target.value })}
        spellCheck={false}
      />
      <TextField
        label={t('settings:advancedSync.endpoint')}
        hint={t('settings:advancedSync.endpointHint')}
        value={draft.endpoint ?? ''}
        onChange={(event) => set({ endpoint: event.target.value })}
        spellCheck={false}
      />
      <Select
        label={t('settings:advancedSync.checkEvery')}
        value={String(draft.checkMinutes)}
        onChange={(event) => set({ checkMinutes: Number(event.target.value) })}
        options={CHECK_MINUTES.map((minutes) => ({
          value: String(minutes),
          label:
            minutes === 0
              ? t('settings:advancedSync.onlySyncNow')
              : t('settings:advancedSync.every', { count: minutes })
        }))}
      />
      <Checkbox
        label={t('settings:advancedSync.uploadSoon')}
        hint={t('settings:advancedSync.uploadSoonHint')}
        checked={draft.uploadSoon}
        onChange={(event) => set({ uploadSoon: event.target.checked })}
      />
      <Checkbox
        label={t('settings:advancedSync.enabled')}
        checked={draft.enabled}
        onChange={(event) => set({ enabled: event.target.checked })}
      />
      <p className="ostler-settings-hint">{t('settings:advancedSync.costNote')}</p>

      <div className="ostler-settings-inline-actions">
        <Button
          variant="primary"
          loading={busy === 'save'}
          disabled={busy !== null}
          onClick={() =>
            void run(
              'save',
              () => window.ostlerAPI.setR2Sync(draft),
              (next) => {
                applyState(next)
                setNotice(t('settings:advancedSync.saved'))
              }
            )
          }
        >
          {t('settings:advancedSync.save')}
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'test'}
          disabled={busy !== null}
          onClick={() =>
            void run(
              'test',
              () => window.ostlerAPI.testR2Sync(draft),
              () => setNotice(t('settings:advancedSync.testOk'))
            )
          }
        >
          {t('settings:advancedSync.test')}
        </Button>
        {state.configured && (
          <Button
            variant="secondary"
            loading={busy === 'sync' || state.running}
            disabled={busy !== null || state.spaceFolder === null}
            onClick={() => void run('sync', () => window.ostlerAPI.r2SyncNow(), setState)}
          >
            {t('settings:advancedSync.syncNow')}
          </Button>
        )}
      </div>

      {state.configured && (
        <p className="ostler-settings-hint">
          {state.lastRunAt
            ? t('settings:advancedSync.lastRun', {
                time: new Date(state.lastRunAt).toLocaleString(),
                up: state.lastUploaded,
                down: state.lastDownloaded
              })
            : t('settings:advancedSync.neverRun')}
          {state.skippedFolders > 0 &&
            ` ${t('settings:advancedSync.skipped', { count: state.skippedFolders })}`}
        </p>
      )}
      {state.lastError && <InlineAlert tone="warning">{state.lastError}</InlineAlert>}

      {state.configured && (
        <>
          <p className="ostler-settings-hint">{t('settings:advancedSync.exportHint')}</p>
          <div className="ostler-settings-inline-actions">
            <Button
              variant="secondary"
              loading={busy === 'export'}
              disabled={busy !== null}
              onClick={() =>
                void run('export', () => window.ostlerAPI.exportR2Setup(), setSetupCode)
              }
            >
              {t('settings:advancedSync.exportCode')}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => void remove()}>
              {t('settings:advancedSync.remove')}
            </Button>
          </div>
        </>
      )}
      {setupCode && (
        <>
          <TextArea
            label={t('settings:advancedSync.codeLabel')}
            value={setupCode.code}
            readOnly
            rows={3}
          />
          <div className="ostler-settings-inline-actions">
            <Button
              variant="secondary"
              onClick={() => void window.ostlerAPI.copyText(setupCode.code)}
            >
              {t('settings:advancedSync.copy')}
            </Button>
          </div>
          <TextField
            label={t('settings:advancedSync.passphraseLabel')}
            value={setupCode.passphrase}
            readOnly
          />
        </>
      )}

      {!importing ? (
        <div className="ostler-settings-inline-actions">
          <Button variant="ghost" onClick={() => setImporting(true)}>
            {t('settings:advancedSync.importCode')}
          </Button>
        </div>
      ) : (
        <>
          <TextArea
            label={t('settings:advancedSync.codeLabel')}
            value={importCode}
            onChange={(event) => setImportCode(event.target.value)}
            rows={3}
            spellCheck={false}
          />
          <TextField
            label={t('settings:advancedSync.passphraseLabel')}
            type="password"
            value={importPassphrase}
            onChange={(event) => setImportPassphrase(event.target.value)}
            autoComplete="off"
          />
          <div className="ostler-settings-inline-actions">
            <Button
              variant="primary"
              loading={busy === 'import'}
              disabled={busy !== null || !importCode.trim() || !importPassphrase.trim()}
              onClick={() =>
                void run(
                  'import',
                  () => window.ostlerAPI.importR2Setup(importCode, importPassphrase),
                  (next) => {
                    applyState(next)
                    setImporting(false)
                    setImportCode('')
                    setImportPassphrase('')
                    setNotice(t('settings:advancedSync.saved'))
                  }
                )
              }
            >
              {t('settings:advancedSync.import')}
            </Button>
          </div>
        </>
      )}
    </SettingsGroup>
  )
}
