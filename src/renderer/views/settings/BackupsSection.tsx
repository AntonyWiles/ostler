import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry, BackupReason } from '@shared/ostler-api'
import type { RendererConfig, RendererConfigUpdate } from '@shared/ostler-api'
import { Button, Switch, useConfirm, VisuallyHidden } from '../../ui'
import { CommittedNumberField, SettingsGroup } from './settings-form'
import { BackupSecondPlace } from './BackupSecondPlace'
import { t } from '@shared/i18n'
import { formatDateTime, formatFileSize } from '@shared/format'

interface BackupsSectionProps {
  config: RendererConfig
  saveConfig(updates: RendererConfigUpdate): Promise<void>
}

const KIND_LABELS: Record<BackupReason, string> = {
  get manual() {
    return t('settings:backupsSection.kinds.manual')
  },
  get scheduled() {
    return t('settings:backupsSection.kinds.scheduled')
  },
  get 'pre-restore'() {
    return t('settings:backupsSection.beforeRestore')
  },
  get 'pre-migration'() {
    return t('settings:backupsSection.beforeUpdate')
  }
}

/**
 * Settings › Data › Backups. Restore and delete ask first, through the
 * app's confirm dialog.
 */
export function BackupsSection({ config, saveConfig }: BackupsSectionProps) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)
  const confirm = useConfirm()
  const showMessage = useCallback(
    (next: { text: string; isError: boolean } | null) => setMessage(next),
    []
  )

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listBackups()
    if (result.ok) setBackups(result.value)
    else setMessage({ text: result.error, isError: true })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await work()
      setMessage(
        result.ok ? { text: done, isError: false } : { text: result.error!, isError: true }
      )
    } finally {
      setBusy(false)
      await load()
    }
  }

  const backUpNow = () =>
    run(() => window.ostlerAPI.createBackup(), t('settings:backupsSection.backupCreated'))
  const restore = async (id: string, date: string) => {
    const ok = await confirm({
      title: t('settings:backupsSection.restoreBackup2', { date }),
      body: t('settings:backupsSection.willRestartCurrentData'),
      confirmLabel: t('settings:backupsSection.restoreBackup3'),
      tone: 'danger'
    })
    if (ok)
      await run(
        () => window.ostlerAPI.restoreBackup(id),
        t('settings:backupsSection.restoringRestarting')
      )
  }
  const remove = async (id: string, date: string) => {
    const ok = await confirm({
      title: t('settings:backupsSection.deleteBackup2', { date }),
      body: t('settings:backupsSection.cannotUndone'),
      confirmLabel: t('settings:backupsSection.deleteBackup3'),
      tone: 'danger'
    })
    if (ok)
      await run(() => window.ostlerAPI.deleteBackup(id), t('settings:backupsSection.backupDeleted'))
  }
  const openFolder = async () => {
    const result = await window.ostlerAPI.openBackupsFolder()
    if (!result.ok) setMessage({ text: result.error, isError: true })
  }

  return (
    <SettingsGroup
      id="backups"
      description={<>{t('settings:backupsSection.backupsHoldProjectsPlans')}</>}
      actions={
        <>
          <Button disabled={busy} onClick={() => void backUpNow()}>
            {t('settings:backupsSection.backUpNow')}
          </Button>
          <Button variant="ghost" onClick={() => void openFolder()}>
            {t('settings:backupsSection.openBackupsFolder')}
          </Button>
        </>
      }
    >
      <Switch
        label={t('settings:backupsSection.automaticBackups')}
        checked={config.backups.enabled}
        onChange={(event) => void saveConfig({ backups: { enabled: event.target.checked } })}
      />
      <CommittedNumberField
        label={t('settings:backupsSection.automaticBackupsKeep')}
        min={1}
        max={100}
        value={config.backups.keep}
        disabled={!config.backups.enabled}
        onCommit={(keep) => void saveConfig({ backups: { keep } })}
      />

      <BackupSecondPlace onMessage={showMessage} />

      {message && (
        <p
          className={message.isError ? 'ostler-settings-error' : 'ostler-settings-hint'}
          role="status"
        >
          {message.text}
        </p>
      )}

      {backups === null ? (
        <p className="ostler-settings-hint">{t('settings:backupsSection.loadingBackups')}</p>
      ) : backups.length === 0 ? (
        <p className="ostler-settings-hint">{t('settings:backupsSection.noBackupsYet')}</p>
      ) : (
        <table className="ostler-settings-table">
          <thead>
            <tr>
              <th scope="col">{t('settings:backupsSection.date')}</th>
              <th scope="col">{t('settings:backupsSection.kind')}</th>
              <th scope="col">{t('settings:backupsSection.size')}</th>
              <th scope="col">
                <VisuallyHidden>{t('settings:backupsSection.actions')}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => {
              const date = formatDateTime(new Date(backup.createdAt), {
                dateStyle: 'short',
                timeStyle: 'medium'
              })
              return (
                <tr key={backup.id}>
                  <td>{date}</td>
                  <td>{KIND_LABELS[backup.reason]}</td>
                  <td>{formatFileSize(backup.sizeBytes)}</td>
                  <td className="ostler-settings-table-actions">
                    <Button
                      size="sm"
                      disabled={busy || backup.restoreBlockedReason !== null}
                      disabledReason={backup.restoreBlockedReason ?? undefined}
                      aria-label={t('settings:backupsSection.restoreBackup', { date })}
                      onClick={() => void restore(backup.id, date)}
                    >
                      {t('settings:backupsSection.restore')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t('settings:backupsSection.deleteBackup', { date })}
                      onClick={() => void remove(backup.id, date)}
                    >
                      {t('settings:backupsSection.delete')}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </SettingsGroup>
  )
}
