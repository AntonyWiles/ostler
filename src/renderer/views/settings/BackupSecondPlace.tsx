import { useEffect, useState } from 'react'
import type { BackupEntry } from '@shared/ostler-api'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { Button, Dialog, InlineAlert, useConfirm, VisuallyHidden } from '../../ui'
import { formatDateTime, formatFileSize } from '@shared/format'
import { toIsoDate, shiftIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import './BackupSecondPlace.css'

/** "today at 09:12", "yesterday at 18:40", or the date and time. */
export function lastCopiedText(at: number, now: number = Date.now()): string {
  const time = formatDateTime(at, { timeStyle: 'short' })
  const day = toIsoDate(new Date(at))
  const today = toIsoDate(new Date(now))
  if (day === today) return t('settings:backupsSection.todayAt', { time })
  if (day === shiftIsoDate(today, -1)) return t('settings:backupsSection.yesterdayAt', { time })
  return formatDateTime(at, { dateStyle: 'medium', timeStyle: 'short' })
}

interface BackupSecondPlaceProps {
  /** Shows the outcome of an action in the Backups group's message line. */
  onMessage(message: { text: string; isError: boolean } | null): void
}

/**
 * Settings › Data › Backups › Second place (N6.1): also copy each backup to
 * a folder elsewhere, and restore from there. The folder is chosen in main's
 * own folder picker; the renderer never sends a path.
 */
export function BackupSecondPlace({ onMessage }: BackupSecondPlaceProps) {
  // Read again when main pushes `home`: a copy finished or failed.
  const feed = useHomeFeed(() => window.ostlerAPI.getBackupCopyStatus())
  const status = feed.value
  const setStatus = feed.setValue
  const [busy, setBusy] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)
  const confirm = useConfirm()

  useEffect(() => {
    if (feed.error) onMessage({ text: feed.error, isError: true })
  }, [feed.error, onMessage])

  const choose = async () => {
    setBusy(true)
    onMessage(null)
    try {
      const result = await window.ostlerAPI.chooseBackupCopyFolder()
      if (!result.ok) onMessage({ text: result.error, isError: true })
      else if (result.value) setStatus(result.value)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    onMessage(null)
    try {
      const result = await window.ostlerAPI.stopBackupCopy()
      if (result.ok) {
        setStatus(result.value)
        onMessage({ text: t('settings:backupsSection.stoppedCopying'), isError: false })
      } else onMessage({ text: result.error, isError: true })
    } finally {
      setBusy(false)
    }
  }

  const openList = async () => {
    setBackups(null)
    setListOpen(true)
    const result = await window.ostlerAPI.listSecondPlaceBackups()
    if (result.ok) setBackups(result.value)
    else {
      setBackups([])
      onMessage({ text: result.error, isError: true })
    }
  }

  const restore = async (id: string, date: string) => {
    const ok = await confirm({
      title: t('settings:backupsSection.restoreBackup2', { date }),
      body: t('settings:backupsSection.willRestartCurrentData'),
      confirmLabel: t('settings:backupsSection.restoreBackup3'),
      tone: 'danger'
    })
    if (!ok) return
    setBusy(true)
    try {
      const result = await window.ostlerAPI.restoreFromSecondPlace(id)
      onMessage(
        result.ok
          ? { text: t('settings:backupsSection.restoringRestarting'), isError: false }
          : { text: result.error, isError: true }
      )
      if (result.ok) setListOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const target = status?.target ?? ''

  return (
    <div className="ostler-backup-second-place">
      <h4 className="ostler-backup-second-place-heading">
        {t('settings:backupsSection.secondPlace')}
      </h4>
      <p className="ostler-settings-hint">{t('settings:backupsSection.secondPlaceHint')}</p>
      {status?.folder && (
        <>
          {status.copyFailedAt !== null ? (
            <InlineAlert tone="warning">
              {t('settings:backupsSection.copyFailed', { folder: target })}
            </InlineAlert>
          ) : (
            <p className="ostler-settings-text">
              {status.lastCopiedAt !== null
                ? t('settings:backupsSection.lastCopied', {
                    when: lastCopiedText(status.lastCopiedAt),
                    folder: target
                  })
                : t('settings:backupsSection.notCopiedYet', { folder: target })}
            </p>
          )}
          {status.syncedBy && (
            <p className="ostler-settings-hint">
              {t('settings:backupsSection.syncedBy', { service: status.syncedBy })}
            </p>
          )}
        </>
      )}
      <div className="ostler-backup-second-place-actions">
        <Button disabled={busy || status === null} onClick={() => void choose()}>
          {status?.folder
            ? t('settings:backupsSection.chooseAnother')
            : t('settings:backupsSection.alsoCopyTo')}
        </Button>
        {status?.folder && (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void stop()}>
              {t('settings:backupsSection.stopCopying')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void openList()}>
              {t('settings:backupsSection.restoreFromSecondPlace')}
            </Button>
          </>
        )}
      </div>

      <Dialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        title={t('settings:backupsSection.secondPlaceBackups')}
        description={t('settings:backupsSection.secondPlaceBackupsHint')}
        size="lg"
        canDismiss={!busy}
        footer={
          <Button variant="ghost" disabled={busy} onClick={() => setListOpen(false)}>
            {t('settings:backupsSection.close')}
          </Button>
        }
      >
        {backups === null ? (
          <p className="ostler-settings-hint">{t('settings:backupsSection.loadingBackups')}</p>
        ) : backups.length === 0 ? (
          <p className="ostler-settings-hint">
            {t('settings:backupsSection.noSecondPlaceBackups')}
          </p>
        ) : (
          <table className="ostler-settings-table">
            <thead>
              <tr>
                <th scope="col">{t('settings:backupsSection.date')}</th>
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Dialog>
    </div>
  )
}
