import { useEffect, useState } from 'react'
import type {
  ProjectRemovalArchive,
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  RendererProject
} from '@shared/ostler-api'
import { Button, Dialog, InlineAlert, Skeleton, TextField } from '../../ui'
import { ChevronLeft, ChevronRight } from '../../ui/icons'
import { WizardSteps } from '../../components/WizardSteps'
import '../planning/planning-dialogs.css'
import './ProjectRemovalWizard.css'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'
import { formatDateTime, formatFileSize } from '@shared/format'
import { Trans } from '../../i18n/Trans'

/**
 * Guided removal. Removing a project destroys more than the config entry -
 * planning records, event history, transcripts, AI drafts and the agents'
 * copies - and a confirm() box could neither
 * show what was at stake nor offer a way to keep it.
 *
 * The steps are deliberately separate and each one is optional except the
 * last: someone who has already exported can walk past those steps, and
 * someone who only wanted to look can close the dialog at any point without
 * having changed anything.
 */
type Step = 'review' | 'archive' | 'confirm' | 'done'

const ALL_STEPS: { id: Step; label: string }[] = [
  {
    id: 'review',
    get label() {
      return t('projects:projectRemovalWizard.whatOstlerHolds')
    }
  },
  {
    id: 'archive',
    get label() {
      return t('projects:projectRemovalWizard.records2')
    }
  },
  {
    id: 'confirm',
    get label() {
      return t('projects:projectRemovalWizard.remove2')
    }
  }
]

export function ProjectRemovalWizard({
  project,
  onClose,
  onRemoved
}: {
  project: RendererProject
  onClose: () => void
  onRemoved: (purge: ProjectRemovalPurge) => void
}) {
  const [step, setStep] = useState<Step>('review')
  const [inventory, setInventory] = useState<ProjectRemovalInventory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archive, setArchive] = useState<ProjectRemovalArchive | null>(null)
  const [purge, setPurge] = useState<ProjectRemovalPurge | null>(null)
  const [confirmText, setConfirmText] = useState('')
  // A project with no folder has its archive go wherever the human chooses (D4).
  const folder = projectFolder(project)
  const STEPS = ALL_STEPS

  const loadInventory = async () => {
    const result = await window.ostlerAPI.getProjectRemovalInventory(project.id)
    if (result.ok) setInventory(result.value)
    else setError(result.error)
  }

  useEffect(() => {
    void (async () => {
      setBusy(true)
      await loadInventory()
      setBusy(false)
    })()
  }, [project.id])

  /**
   * Stops one open session from here. A session left open when Ostler last
   * closed has no process behind it but still blocks removal, and the board
   * may not list it.
   */
  const endSession = async (sessionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.stopHarnessSession(project.id, sessionId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await loadInventory()
    } finally {
      setBusy(false)
    }
  }

  const run = async <T,>(
    action: () => Promise<{ ok: boolean; value?: T | null; error?: string }>
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? t('projects:projectRemovalWizard.actionFailed'))
        return null
      }
      return (result.value ?? null) as T | null
    } finally {
      setBusy(false)
    }
  }

  const writeArchive = async () => {
    const value = await run<ProjectRemovalArchive>(() =>
      window.ostlerAPI.archiveProjectData(project.id)
    )
    if (value) setArchive(value)
  }

  const removeForever = async () => {
    const value = await run<ProjectRemovalPurge>(() =>
      window.ostlerAPI.purgeProjectData(project.id)
    )
    if (value) {
      setPurge(value)
      setStep('done')
      onRemoved(value)
    }
  }

  const stepIndex = STEPS.findIndex((entry) => entry.id === step)

  const footer =
    step === 'done' ? (
      <Button variant="primary" onClick={onClose}>
        {t('projects:projectRemovalWizard.done')}
      </Button>
    ) : (
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('projects:projectRemovalWizard.close')}
        </Button>
        {stepIndex > 0 && (
          <Button
            icon={ChevronLeft}
            disabled={busy}
            onClick={() => setStep(STEPS[stepIndex - 1].id)}
          >
            {t('projects:projectRemovalWizard.back')}
          </Button>
        )}
        {step !== 'confirm' && (
          <Button
            variant="primary"
            iconEnd={ChevronRight}
            disabled={busy || !inventory || (inventory?.runningSessions ?? 0) > 0}
            onClick={() => setStep(STEPS[stepIndex + 1].id)}
          >
            {t('projects:projectRemovalWizard.next')}
          </Button>
        )}
        {step === 'confirm' && (
          <Button
            variant="danger"
            loading={busy}
            disabled={busy || confirmText.trim() !== project.name}
            onClick={() => void removeForever()}
          >
            {busy
              ? t('projects:projectRemovalWizard.removing')
              : t('projects:projectRemovalWizard.removePermanently')}
          </Button>
        )}
      </>
    )

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={
        step === 'done'
          ? t('projects:projectRemovalWizard.removed', { projectName: project.name })
          : t('projects:projectRemovalWizard.remove', { projectName: project.name })
      }
      description={
        step === 'done'
          ? undefined
          : t('projects:projectRemovalWizard.stepOf', {
              step: stepIndex + 1,
              total: STEPS.length,
              title: STEPS[stepIndex]?.label ?? ''
            })
      }
      footer={footer}
      className="removal-wizard"
    >
      <div className="dialog-form">
        {step !== 'done' && (
          <WizardSteps steps={STEPS.map((entry) => entry.label)} current={stepIndex} />
        )}

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {step === 'review' && (
          <>
            {folder === null ? (
              <p className="removal-wizard__text">
                {t('projects:projectRemovalWizard.projectHasNoFolder')}
              </p>
            ) : (
              <p className="removal-wizard__text">
                <Trans
                  i18nKey="projects:projectRemovalWizard.projectFilesNeverDeleted"
                  values={{ folder }}
                  components={{ code: <code /> }}
                />
              </p>
            )}
            {!inventory &&
              (busy ? (
                <Skeleton lines={4} />
              ) : (
                <p className="dialog-muted">
                  {t('projects:projectRemovalWizard.inventoryUnavailable')}
                </p>
              ))}
            {inventory && (
              <>
                <dl className="removal-wizard__facts">
                  <div>
                    <dt>{t('projects:projectRemovalWizard.databaseRecords')}</dt>
                    <dd>
                      {t('projects:projectRemovalWizard.rowsAcrossTables', {
                        rows: t('projects:projectRemovalWizard.rowCount', {
                          count: inventory.totalRows
                        }),
                        tables: t('projects:projectRemovalWizard.tableCount', {
                          count: inventory.rowCounts.length
                        })
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('projects:projectRemovalWizard.agentSessionBranches')}</dt>
                    <dd>{inventory.sessionBranches.length}</dd>
                  </div>
                  <div>
                    <dt>{t('projects:projectRemovalWizard.library')}</dt>
                    <dd>
                      <Trans
                        i18nKey={
                          inventory.libraryDir
                            ? 'projects:projectRemovalWizard.libraryItemsIn'
                            : 'projects:projectRemovalWizard.libraryItemsNoFolder'
                        }
                        count={inventory.libraryItemCount}
                        values={{
                          count: inventory.libraryItemCount,
                          bytes: formatFileSize(inventory.libraryBytes),
                          folder: inventory.libraryDir ?? ''
                        }}
                        components={{ code: <code /> }}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{t('projects:projectRemovalWizard.aiDraftsAdvisories')}</dt>
                    <dd>
                      {t('projects:projectRemovalWizard.folders', {
                        count: inventory.aiDirectories.length
                      })}
                    </dd>
                  </div>
                </dl>
                {inventory.rowCounts.length > 0 && (
                  <details className="removal-wizard__details">
                    <summary>{t('projects:projectRemovalWizard.recordsTable')}</summary>
                    <ul className="removal-wizard__rows">
                      {inventory.rowCounts.map((entry) => (
                        <li key={entry.table}>
                          <code>{entry.table}</code>
                          <span>{entry.rows}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {inventory.openSessions.length > 0 && (
                  <InlineAlert tone="warning">
                    <p className="removal-wizard__text">
                      {inventory.runningSessions > 0
                        ? t('projects:projectRemovalWizard.agentSessionsStillRunning', {
                            count: inventory.runningSessions
                          })
                        : t('projects:projectRemovalWizard.sessionsStillOpenOstlers', {
                            count: inventory.staleSessions
                          })}
                    </p>
                    <ul className="removal-wizard__rows">
                      {inventory.openSessions.map((session) => (
                        <li key={session.id}>
                          <span>
                            {session.title}
                            {session.lastSeenAt && (
                              <small>
                                {' · '}
                                {t('projects:projectRemovalWizard.lastSeen', {
                                  when: formatDateTime(new Date(session.lastSeenAt))
                                })}
                              </small>
                            )}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
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
                {inventory.reviewSessions > 0 && (
                  <InlineAlert tone="warning">
                    {t('projects:projectRemovalWizard.finishedWorkspacesStillAwaiting', {
                      count: inventory.reviewSessions
                    })}
                  </InlineAlert>
                )}
              </>
            )}
          </>
        )}

        {step === 'archive' && (
          <section className="dialog-section">
            <h3 className="dialog-section__title">
              {t('projects:projectRemovalWizard.planningRecordsHistory')}
            </h3>
            <p className="removal-wizard__text">
              {folder === null ? (
                <>{t('projects:projectRemovalWizard.theseRowsOstlersDatabase')}</>
              ) : (
                <Trans
                  i18nKey="projects:projectRemovalWizard.rowsWrittenAt"
                  values={{ folder: inventory?.archiveRoot ?? '.ostler-archive' }}
                  components={{ code: <code /> }}
                />
              )}
              {(inventory?.libraryFileCount ?? 0) > 0 && ' '}
              {(inventory?.libraryFileCount ?? 0) > 0 &&
                t('projects:projectRemovalWizard.archiveAlsoIncludesLibrarys', {
                  count: inventory?.libraryFileCount,
                  bytes: formatFileSize(inventory?.libraryBytes ?? 0)
                })}
            </p>
            <div>
              <Button
                variant="primary"
                loading={busy}
                disabled={busy || archive !== null || (inventory?.totalRows ?? 0) === 0}
                onClick={() => void writeArchive()}
              >
                {archive
                  ? t('projects:projectRemovalWizard.written')
                  : busy
                    ? t('projects:projectRemovalWizard.writing')
                    : (inventory?.totalRows ?? 0) === 0
                      ? t('projects:projectRemovalWizard.nothingArchive')
                      : folder === null
                        ? t('projects:projectRemovalWizard.chooseFolderWriteArchive')
                        : t('projects:projectRemovalWizard.writeArchiveIntoMy')}
              </Button>
            </div>
            {archive && (
              <InlineAlert tone="success">
                <p className="removal-wizard__text">
                  <Trans
                    i18nKey={
                      archive.libraryFileCount > 0
                        ? 'projects:projectRemovalWizard.wroteFilesPlusLibrary'
                        : 'projects:projectRemovalWizard.wroteFilesTo'
                    }
                    count={archive.files.length}
                    values={{
                      count: archive.files.length,
                      folder: archive.archivePath,
                      libraryCount: archive.libraryFileCount
                    }}
                    components={{ code: <code /> }}
                  />
                </p>
                <ul className="removal-wizard__rows">
                  {archive.files.map((file) => (
                    <li key={file.name}>
                      <code>{file.name}</code>
                      <span>
                        {file.rows > 0
                          ? t('projects:projectRemovalWizard.rowsAndSize', {
                              count: file.rows,
                              size: formatFileSize(file.bytes)
                            })
                          : formatFileSize(file.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            )}
          </section>
        )}

        {step === 'confirm' && (
          <section className="dialog-section">
            <h3 className="dialog-section__title">
              {t('projects:projectRemovalWizard.removeOstler', { projectName: project.name })}
            </h3>
            <p className="removal-wizard__text">
              {t('projects:projectRemovalWizard.deletesPermanentlyWithoutUndo')}
            </p>
            <ul className="dialog-list">
              <li>
                {archive
                  ? t('projects:projectRemovalWizard.recordsArchived', {
                      count: inventory?.totalRows ?? 0
                    })
                  : t('projects:projectRemovalWizard.recordsNotArchived', {
                      count: inventory?.totalRows ?? 0
                    })}
              </li>
              <li>{t('projects:projectRemovalWizard.agentCopiesRemoved')}</li>
              <li>{t('projects:projectRemovalWizard.allAiDraftsAdvisories')}</li>
              {inventory?.libraryDir && (
                <li>
                  <Trans
                    i18nKey={
                      archive
                        ? archive.libraryFileCount > 0
                          ? 'projects:projectRemovalWizard.libraryFolderArchived'
                          : 'projects:projectRemovalWizard.libraryFolderFiles'
                        : 'projects:projectRemovalWizard.libraryFolderNotArchived'
                    }
                    count={inventory.libraryFileCount}
                    values={{
                      count: inventory.libraryFileCount,
                      bytes: formatFileSize(inventory.libraryBytes),
                      folder: inventory.libraryDir
                    }}
                    components={{ code: <code /> }}
                  />
                </li>
              )}
            </ul>
            {folder !== null && (
              <p className="removal-wizard__text">
                {t('projects:projectRemovalWizard.projectFilesGitRepository')}
              </p>
            )}
            {!archive && (inventory?.totalRows ?? 0) > 0 && (
              <InlineAlert tone="warning">
                {t('projects:projectRemovalWizard.recordsHaveNotBeen')}
              </InlineAlert>
            )}
            <TextField
              label={t('projects:projectRemovalWizard.typeProjectNameConfirm')}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={project.name}
              autoFocus
            />
          </section>
        )}

        {step === 'done' && purge && (
          <section className="dialog-section">
            <p className="removal-wizard__text">
              {t('projects:projectRemovalWizard.deletedSummary', {
                records: t('projects:projectRemovalWizard.recordCount', {
                  count: purge.deletedRows.reduce((sum, entry) => sum + entry.rows, 0)
                }),
                tables: t('projects:projectRemovalWizard.tableCount', {
                  count: purge.deletedRows.length
                }),
                folders: t('projects:projectRemovalWizard.directoryCount', {
                  count: purge.removedPaths.length
                })
              })}
            </p>
            {archive && (
              <p className="removal-wizard__text">
                <Trans
                  i18nKey="projects:projectRemovalWizard.recordsAt"
                  values={{ folder: archive.archivePath }}
                  components={{ code: <code /> }}
                />
              </p>
            )}
            {purge.failedPaths.length > 0 && (
              <InlineAlert tone="warning">
                <p className="removal-wizard__text">
                  {t('projects:projectRemovalWizard.ostlerCouldNotDelete', {
                    count: purge.failedPaths.length
                  })}
                </p>
                <ul className="removal-wizard__rows">
                  {purge.failedPaths.map((entry) => (
                    <li key={entry.path}>
                      <code>{entry.path}</code>
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            {folder !== null && (
              <p className="removal-wizard__text">
                {t('projects:projectRemovalWizard.projectFilesWereNot')}
              </p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  )
}
