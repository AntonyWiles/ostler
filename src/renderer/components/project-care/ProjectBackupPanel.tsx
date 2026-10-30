import { useCallback, useEffect, useState } from 'react'
import type {
  BackupEntry,
  ChecksumVerdict,
  ProjectBackupEntry,
  RendererProject
} from '@shared/ostler-api'
import { Badge, Button, InlineAlert, Skeleton, useConfirm, useToast } from '../../ui'
import { formatDateTime, formatFileSize } from '@shared/format'
import { t } from '@shared/i18n'
import { CareGroup, CareRow } from './CareRow'
import { useOstler } from '../../context/OstlerContext'

/** Whole-data-folder backups, newest first, for when everything was last backed up. */
export function latestFullBackup(backups: BackupEntry[]): BackupEntry | null {
  return backups.reduce<BackupEntry | null>(
    (latest, entry) => (latest === null || entry.createdAt > latest.createdAt ? entry : latest),
    null
  )
}

/**
 * Project settings › Backup: this project's own backups (project files kept
 * in Ostler's data folder, each with a checksum file) and the full backup of
 * everything.
 */
export function ProjectBackupPanel({ project }: { project: RendererProject }) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const { refreshProjects } = useOstler()
  const [backups, setBackups] = useState<ProjectBackupEntry[] | null>(null)
  const [fullBackup, setFullBackup] = useState<BackupEntry | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, ChecksumVerdict>>({})

  const load = useCallback(async () => {
    const [own, full] = await Promise.all([
      window.ostlerAPI.listProjectBackups(project.id),
      window.ostlerAPI.listBackups()
    ])
    if (own.ok) setBackups(own.value)
    else setError(own.error)
    setFullBackup(full.ok ? latestFullBackup(full.value) : null)
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  /** Runs one action at a time, naming it so only its button spins. */
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

  const backUp = async () => {
    const entry = await run('create', () => window.ostlerAPI.createProjectBackup(project.id))
    if (!entry) return
    toast({
      title: t('projects:projectCare.backedUp', { projectName: project.name }),
      tone: 'success'
    })
    await load()
  }

  const backUpEverything = async () => {
    const entry = await run('full', () => window.ostlerAPI.createBackup())
    if (!entry) return
    setFullBackup(entry)
    toast({ title: t('projects:projectCare.backedUpEverything'), tone: 'success' })
  }

  const verify = async (backup: ProjectBackupEntry) => {
    const verdict = await run(`verify:${backup.id}`, () =>
      window.ostlerAPI.verifyProjectBackup(project.id, backup.id)
    )
    if (verdict) setVerdicts((current) => ({ ...current, [backup.id]: verdict }))
  }

  const writeChecksum = async (backup: ProjectBackupEntry) => {
    const entry = await run(`checksum:${backup.id}`, () =>
      window.ostlerAPI.writeProjectBackupChecksum(project.id, backup.id)
    )
    if (entry) await load()
  }

  const openCopy = async (backup: ProjectBackupEntry) => {
    const result = await run(`open:${backup.id}`, () =>
      window.ostlerAPI.openProjectBackup(project.id, backup.id)
    )
    if (!result) return
    await refreshProjects()
    toast({
      title: t('projects:projectCare.openedAsCopy', { projectName: result.projectName }),
      body: t('projects:projectCare.openedAsCopyBody'),
      tone: 'success'
    })
  }

  const remove = async (backup: ProjectBackupEntry) => {
    const ok = await confirm({
      title: t('projects:projectCare.deleteBackupTitle'),
      body: t('projects:projectCare.deleteBackupBody', {
        when: formatDateTime(new Date(backup.createdAt))
      }),
      confirmLabel: t('projects:projectCare.deleteBackup'),
      tone: 'danger'
    })
    if (!ok) return
    const done = await run(`delete:${backup.id}`, async () => {
      const result = await window.ostlerAPI.deleteProjectBackup(project.id, backup.id)
      return result.ok ? { ok: true as const, value: true } : result
    })
    if (done) await load()
  }

  const verdictBadge = (backup: ProjectBackupEntry) => {
    const verdict = verdicts[backup.id]
    if (verdict === 'matches')
      return <Badge tone="success">{t('projects:projectCare.checksumMatches')}</Badge>
    if (verdict === 'differs')
      return <Badge tone="danger">{t('projects:projectCare.checksumDiffers')}</Badge>
    if (!backup.hasChecksum || verdict === 'missing')
      return <Badge tone="warning">{t('projects:projectCare.noChecksum')}</Badge>
    return null
  }

  return (
    <>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <CareGroup
        title={t('projects:projectCare.thisProjectsBackups')}
        description={t('projects:projectCare.thisProjectsBackupsDescription')}
        actions={
          <Button
            variant="primary"
            loading={busy === 'create'}
            disabled={busy !== null}
            onClick={() => void backUp()}
          >
            {t('projects:projectCare.backUpThisProject')}
          </Button>
        }
      >
        {backups === null ? (
          <div className="project-care-row">
            <Skeleton lines={2} />
          </div>
        ) : backups.length === 0 ? (
          <div className="project-care-row">
            <p className="project-care-muted">{t('projects:projectCare.noBackupsYet')}</p>
          </div>
        ) : (
          <ul
            className="project-care-backups"
            aria-label={t('projects:projectCare.thisProjectsBackups')}
          >
            {backups.map((backup) => {
              const when = formatDateTime(new Date(backup.createdAt))
              return (
                <li key={backup.id} className="project-care-backup">
                  <div className="project-care-backup__when">
                    <span title={backup.filePath}>{when}</span>
                    <span className="project-care-backup__size">
                      {formatFileSize(backup.sizeBytes)}
                    </span>
                    {verdictBadge(backup)}
                  </div>
                  <div className="project-care-backup__actions">
                    {backup.hasChecksum ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `verify:${backup.id}`}
                        disabled={busy !== null}
                        aria-label={t('projects:projectCare.checkBackupLabel', { when })}
                        onClick={() => void verify(backup)}
                      >
                        {t('projects:projectCare.checkBackup')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `checksum:${backup.id}`}
                        disabled={busy !== null}
                        aria-label={t('projects:projectCare.writeChecksumLabel', { when })}
                        onClick={() => void writeChecksum(backup)}
                      >
                        {t('projects:projectCare.writeChecksum')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      loading={busy === `open:${backup.id}`}
                      disabled={busy !== null}
                      aria-label={t('projects:projectCare.openAsCopyLabel', { when })}
                      onClick={() => void openCopy(backup)}
                    >
                      {t('projects:projectCare.openAsCopy')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      aria-label={t('projects:projectCare.showInFolderLabel', { when })}
                      onClick={() => void window.ostlerAPI.showProjectBackup(project.id, backup.id)}
                    >
                      {t('projects:projectCare.showInFolder')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `delete:${backup.id}`}
                      disabled={busy !== null}
                      aria-label={t('projects:projectCare.deleteBackupLabel', { when })}
                      onClick={() => void remove(backup)}
                    >
                      {t('projects:projectCare.delete')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CareGroup>

      <CareGroup title={t('projects:projectCare.everything')}>
        <CareRow
          title={t('projects:projectCare.fullBackup')}
          description={
            fullBackup === undefined
              ? t('projects:projectCare.fullBackupDescription')
              : fullBackup === null
                ? t('projects:projectCare.noFullBackupYet')
                : t('projects:projectCare.lastFullBackup', {
                    when: formatDateTime(new Date(fullBackup.createdAt))
                  })
          }
          action={
            <Button
              loading={busy === 'full'}
              disabled={busy !== null}
              onClick={() => void backUpEverything()}
            >
              {t('projects:projectCare.backUpEverything')}
            </Button>
          }
        />
      </CareGroup>
    </>
  )
}
