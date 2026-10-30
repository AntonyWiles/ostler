import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import type {
  BackupCopyStatus,
  BackupEntry,
  ProjectBackupEntry,
  ProjectRemovalFolder,
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  RendererProject
} from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { formatDateTime, formatFileSize } from '@shared/format'
import { t } from '@shared/i18n'
import { Button, Card, Icon, InlineAlert, Skeleton, TextField, useConfirm } from '../../ui'
import { Circle, CircleCheck, TriangleAlert } from '../../ui/icons'
import { lazyNamed } from '../../lib/lazy-named'
import { useProjectLifecycle } from './useProjectLifecycle'
import { latestFullBackup } from './ProjectBackupPanel'

const ProjectRemovalWizard = lazyNamed(
  () => import('../../views/settings/ProjectRemovalWizard'),
  'ProjectRemovalWizard'
)

/** How a safety check came out: fine, worth a look, or simply not there (no harm). */
type CheckState = 'ok' | 'warn' | 'none'

const CHECK_ICONS = { ok: CircleCheck, warn: TriangleAlert, none: Circle }

function folderLabel(folder: ProjectRemovalFolder): string {
  return t(`projects:projectCare.folderKind.${folder.kind}`)
}

/**
 * Project settings › Remove, one screen to decide on: the backups Ostler can
 * find, exactly what removal deletes from this computer and what it never
 * touches, then the choices from gentlest to final: the guided removal,
 * archive, back up then remove, and remove permanently, which asks again
 * before it deletes anything.
 */
export function ProjectRemovePanel({
  project,
  onArchived,
  onRestore,
  onRemoved
}: {
  project: RendererProject
  /** The project is archived: the dialog closes (the toast offers undo). */
  onArchived: () => void
  /** Turns an archived project back on. */
  onRestore: () => void
  /** The project's data is gone; `backup` is the backup made just before, if any. */
  onRemoved: (purge: ProjectRemovalPurge, backup: ProjectBackupEntry | null) => void
}) {
  const confirm = useConfirm()
  const { archive } = useProjectLifecycle()
  const [inventory, setInventory] = useState<ProjectRemovalInventory | null>(null)
  const [backups, setBackups] = useState<ProjectBackupEntry[] | null>(null)
  const [fullBackups, setFullBackups] = useState<BackupEntry[] | null>(null)
  const [copyStatus, setCopyStatus] = useState<BackupCopyStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [guided, setGuided] = useState(false)
  // Shared with other people: removing here takes it off this PC only, and the others are told.
  const [sharedWithOthers, setSharedWithOthers] = useState(false)
  const folder = projectFolder(project)

  const load = useCallback(async () => {
    const [found, own, full, copies] = await Promise.all([
      window.ostlerAPI.getProjectRemovalInventory(project.id),
      window.ostlerAPI.listProjectBackups(project.id),
      window.ostlerAPI.listBackups(),
      window.ostlerAPI.getBackupCopyStatus()
    ])
    if (found.ok) setInventory(found.value)
    else setError(found.error)
    if (own.ok) setBackups(own.value)
    setFullBackups(full.ok ? full.value : [])
    if (copies.ok) setCopyStatus(copies.value)
    const share = await window.ostlerAPI.getShareState(project.id)
    setSharedWithOthers(
      share.ok &&
        (share.value?.members ?? []).some((member) => !member.isMe && member.leftAt === undefined)
    )
  }, [project.id])

  useEffect(() => {
    void load()
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

  // A session left open when Ostler last closed still blocks removal; stop it from here.
  const endSession = async (sessionId: string) => {
    const result = await run(`session:${sessionId}`, async () => {
      const stopped = await window.ostlerAPI.stopHarnessSession(project.id, sessionId)
      return stopped.ok ? { ok: true as const, value: true } : stopped
    })
    if (result) await load()
  }

  const backUp = async (name = 'backup') => {
    const entry = await run(name, () => window.ostlerAPI.createProjectBackup(project.id))
    if (entry) setBackups((current) => [entry, ...(current ?? [])])
    return entry
  }

  const latest = backups?.[0] ?? null
  const latestFull = fullBackups ? latestFullBackup(fullBackups) : null
  const blocked = (inventory?.runningSessions ?? 0) > 0
  const nameMatches = confirmText.trim() === project.name
  const deletedBytes = inventory?.toDelete.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0
  const deletedFiles = inventory?.toDelete.reduce((sum, entry) => sum + entry.fileCount, 0) ?? 0

  /** What removing deletes, in a few lines: for the confirmations. */
  const deletionSummary = (backupFirst: boolean): ReactNode => (
    <div className="project-care-summary">
      <p className="project-care-muted">
        {t('projects:projectCare.confirmDeletes', {
          records: t('projects:projectCare.recordCount', { count: inventory?.totalRows ?? 0 }),
          files: t('projects:projectCare.fileCount', { count: deletedFiles }),
          size: formatFileSize(deletedBytes)
        })}
      </p>
      <p className="project-care-muted">{t('projects:projectCare.confirmKeeps')}</p>
      <p className="project-care-muted">
        {backupFirst
          ? t('projects:projectCare.confirmBackupFirst')
          : latest
            ? t('projects:projectCare.confirmNoNewBackup', {
                when: formatDateTime(new Date(latest.createdAt))
              })
            : t('projects:projectCare.confirmNoBackupAtAll')}
      </p>
    </div>
  )

  const backUpAndRemove = async () => {
    const ok = await confirm({
      title: t('projects:projectCare.backUpAndRemoveTitle', { projectName: project.name }),
      body: deletionSummary(true),
      confirmLabel: t('projects:projectCare.backUpAndRemove'),
      tone: 'danger'
    })
    if (!ok) return
    const backup = await backUp('backUpAndRemove')
    if (!backup) return
    const purge = await run('backUpAndRemove', () => window.ostlerAPI.purgeProjectData(project.id))
    if (purge) onRemoved(purge, backup)
  }

  const removePermanently = async () => {
    const ok = await confirm({
      title: t('projects:projectCare.removePermanentlyTitle', { projectName: project.name }),
      body: deletionSummary(false),
      confirmLabel: t('projects:projectCare.removePermanently'),
      tone: 'danger'
    })
    if (!ok) return
    const purge = await run('remove', () => window.ostlerAPI.purgeProjectData(project.id))
    if (purge) onRemoved(purge, null)
  }

  const checks: { state: CheckState; title: string; detail: string; action?: ReactNode }[] =
    backups === null || fullBackups === null || inventory === null
      ? []
      : [
          {
            state: latest ? 'ok' : 'warn',
            title: t('projects:projectCare.checkProjectBackups'),
            detail: latest
              ? t('projects:projectCare.checkProjectBackupsFound', {
                  count: backups.length,
                  when: formatDateTime(new Date(latest.createdAt))
                })
              : t('projects:projectCare.checkProjectBackupsNone'),
            action: (
              <Button
                size="sm"
                variant={latest ? 'ghost' : 'secondary'}
                loading={busy === 'backup'}
                disabled={busy !== null}
                onClick={() => void backUp()}
              >
                {t('projects:projectCare.backUpNow')}
              </Button>
            )
          },
          {
            state: latestFull ? 'ok' : 'warn',
            title: t('projects:projectCare.checkFullBackups'),
            detail: latestFull
              ? t('projects:projectCare.checkFullBackupsFound', {
                  count: fullBackups.length,
                  when: formatDateTime(new Date(latestFull.createdAt))
                })
              : t('projects:projectCare.checkFullBackupsNone')
          },
          {
            state: copyStatus?.lastCopiedAt ? 'ok' : 'none',
            title: t('projects:projectCare.checkSecondPlace'),
            detail:
              copyStatus?.target && copyStatus.lastCopiedAt
                ? t('projects:projectCare.checkSecondPlaceFound', {
                    folder: copyStatus.target,
                    when: formatDateTime(new Date(copyStatus.lastCopiedAt))
                  })
                : t('projects:projectCare.checkSecondPlaceNone')
          },
          {
            state: inventory.archives.length > 0 ? 'ok' : 'none',
            title: t('projects:projectCare.checkArchives'),
            detail:
              inventory.archives.length > 0
                ? t('projects:projectCare.checkArchivesFound', {
                    when: formatDateTime(new Date(inventory.archives[0].writtenAt)),
                    folder: inventory.archives[0].path
                  })
                : folder === null
                  ? t('projects:projectCare.checkArchivesNoFolder')
                  : t('projects:projectCare.checkArchivesNone')
          }
        ]

  return (
    <>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {sharedWithOthers && (
        <InlineAlert tone="info" title={t('projects:projectCare.sharedRemoveTitle')}>
          {t('projects:projectCare.sharedRemoveBody')}
        </InlineAlert>
      )}

      {inventory && inventory.openSessions.length > 0 && (
        <InlineAlert tone="warning">
          {inventory.runningSessions > 0
            ? t('projects:projectRemovalWizard.agentSessionsStillRunning', {
                count: inventory.runningSessions
              })
            : t('projects:projectRemovalWizard.sessionsStillOpenOstlers', {
                count: inventory.staleSessions
              })}
          <ul className="project-care-sessions">
            {inventory.openSessions.map((session) => (
              <li key={session.id}>
                <span>{session.title}</span>
                <Button
                  size="sm"
                  loading={busy === `session:${session.id}`}
                  disabled={busy !== null}
                  onClick={() => void endSession(session.id)}
                >
                  {session.running
                    ? t('projects:projectRemovalWizard.stopAgent')
                    : t('projects:projectRemovalWizard.endSession')}
                </Button>
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}
      {inventory && inventory.reviewSessions > 0 && (
        <InlineAlert tone="warning">
          {t('projects:projectRemovalWizard.finishedWorkspacesStillAwaiting', {
            count: inventory.reviewSessions
          })}
        </InlineAlert>
      )}

      <section className="project-care-block" aria-labelledby="project-care-checks">
        <h3 id="project-care-checks" className="project-care-block__title">
          {t('projects:projectCare.backupsFound')}
        </h3>
        {checks.length === 0 ? (
          <Skeleton lines={3} />
        ) : (
          <ul className="project-care-checks">
            {checks.map((check) => (
              <li key={check.title} className={`project-care-check is-${check.state}`}>
                <Icon icon={CHECK_ICONS[check.state]} />
                <div className="project-care-check__text">
                  <span className="project-care-check__title">{check.title}</span>
                  <span className="project-care-check__detail">{check.detail}</span>
                </div>
                {check.action}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="project-care-impact">
        <section className="project-care-block" aria-labelledby="project-care-deletes">
          <h3 id="project-care-deletes" className="project-care-block__title">
            {t('projects:projectCare.deletesHeading')}
          </h3>
          {inventory === null ? (
            <Skeleton lines={4} />
          ) : (
            <>
              <ul className="project-care-impact__list">
                <li>
                  <span className="project-care-impact__what">
                    {t('projects:projectCare.deletesRecords', {
                      records: t('projects:projectCare.recordCount', {
                        count: inventory.totalRows
                      }),
                      tables: t('projects:projectCare.tableCount', {
                        count: inventory.rowCounts.length
                      })
                    })}
                  </span>
                  <span className="project-care-path">{inventory.databasePath}</span>
                </li>
                {inventory.toDelete.map((entry) => (
                  <li key={entry.path}>
                    <span className="project-care-impact__what">
                      {folderLabel(entry)}
                      {' · '}
                      {t('projects:projectCare.fileCount', { count: entry.fileCount })},{' '}
                      {formatFileSize(entry.bytes)}
                    </span>
                    <span className="project-care-path">{entry.path}</span>
                  </li>
                ))}
              </ul>
              <p className="project-care-muted">
                {t('projects:projectCare.deletesTotal', {
                  files: t('projects:projectCare.fileCount', { count: deletedFiles }),
                  size: formatFileSize(deletedBytes)
                })}
              </p>
            </>
          )}
        </section>
        <section className="project-care-block" aria-labelledby="project-care-keeps">
          <h3 id="project-care-keeps" className="project-care-block__title">
            {t('projects:projectCare.keepsHeading')}
          </h3>
          <ul className="project-care-impact__list">
            <li>
              <span className="project-care-impact__what">
                {folder === null
                  ? t('projects:projectCare.keepsNoFolder')
                  : t('projects:projectCare.keepsFolder')}
              </span>
              {folder !== null && <span className="project-care-path">{folder}</span>}
            </li>
            {folder !== null && (
              <li>
                <span className="project-care-impact__what">
                  {t('projects:projectCare.keepsGit', {
                    count: inventory?.sessionBranches.length ?? 0
                  })}
                </span>
              </li>
            )}
            <li>
              <span className="project-care-impact__what">
                {t('projects:projectCare.keepsBackups')}
              </span>
            </li>
            {(inventory?.archives.length ?? 0) > 0 && (
              <li>
                <span className="project-care-impact__what">
                  {t('projects:projectCare.keepsArchives')}
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>

      <Card as="section" className="project-care-guided">
        <div className="project-care-guided__text">
          <h3 className="project-care-choice__title">{t('projects:projectCare.guidedHeading')}</h3>
          <p className="project-care-choice__text">{t('projects:projectCare.guidedText')}</p>
        </div>
        <Button variant="primary" disabled={busy !== null} onClick={() => setGuided(true)}>
          {t('projects:projectCare.guidedOpen')}
        </Button>
      </Card>

      <div className="project-care-choices">
        <Card as="section" className="project-care-choice">
          <h3 className="project-care-choice__title">
            {project.enabled
              ? t('projects:projectCare.archiveTitle')
              : t('projects:projectCare.restoreTitle')}
          </h3>
          <p className="project-care-choice__text">
            {project.enabled
              ? t('projects:projectCare.archiveText')
              : t('projects:projectCare.restoreText')}
          </p>
          <div className="project-care-choice__actions">
            <Button
              disabled={busy !== null}
              onClick={() =>
                project.enabled
                  ? void archive(project).then((archived) => archived && onArchived())
                  : onRestore()
              }
            >
              {project.enabled
                ? t('projects:projectCare.archiveProject')
                : t('projects:projectCare.restoreProject')}
            </Button>
          </div>
        </Card>

        <Card as="section" className="project-care-choice">
          <h3 className="project-care-choice__title">
            {t('projects:projectCare.backUpAndRemoveHeading')}
          </h3>
          <p className="project-care-choice__text">
            {t('projects:projectCare.backUpAndRemoveText')}
          </p>
          <div className="project-care-choice__actions">
            <Button
              loading={busy === 'backUpAndRemove'}
              disabled={busy !== null || blocked || inventory === null}
              onClick={() => void backUpAndRemove()}
            >
              {t('projects:projectCare.backUpAndRemoveEllipsis')}
            </Button>
          </div>
        </Card>

        <Card as="section" className="project-care-choice project-care-choice--danger">
          <h3 className="project-care-choice__title">
            {t('projects:projectCare.removePermanentlyHeading')}
          </h3>
          <p className="project-care-choice__text">
            {latest
              ? t('projects:projectCare.removePermanentlyText')
              : t('projects:projectCare.removePermanentlyNoBackupText')}
          </p>
          <div className="project-care-choice__actions">
            <TextField
              label={t('projects:projectCare.typeName', { projectName: project.name })}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={project.name}
              disabled={blocked}
            />
            <Button
              variant="danger"
              loading={busy === 'remove'}
              disabled={busy !== null || blocked || !nameMatches || inventory === null}
              onClick={() => void removePermanently()}
            >
              {t('projects:projectCare.removePermanentlyEllipsis')}
            </Button>
          </div>
        </Card>
      </div>

      {guided && (
        <Suspense fallback={null}>
          <ProjectRemovalWizard
            project={project}
            onClose={() => {
              setGuided(false)
              void load()
            }}
            onRemoved={(purge) => onRemoved(purge, null)}
          />
        </Suspense>
      )}
    </>
  )
}
