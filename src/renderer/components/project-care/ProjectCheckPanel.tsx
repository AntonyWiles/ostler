import { useState } from 'react'
import type {
  ChecksumVerdict,
  ChecksumWritten,
  ProjectRecordsCheck,
  ProjectRecordsRepair,
  RendererProject
} from '@shared/ostler-api'
import { Button, InlineAlert, useConfirm } from '../../ui'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import { CareGroup, CareRow } from './CareRow'

/**
 * Project settings › Check and repair: checksum files for any file, and a
 * check of this project's records with a repair that backs everything up
 * before it changes anything.
 */
export function ProjectCheckPanel({ project }: { project: RendererProject }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [written, setWritten] = useState<ChecksumWritten | null>(null)
  const [checked, setChecked] = useState<{ filePath: string; verdict: ChecksumVerdict } | null>(
    null
  )
  const [records, setRecords] = useState<ProjectRecordsCheck | null>(null)
  const [repair, setRepair] = useState<ProjectRecordsRepair | null>(null)

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

  const writeChecksum = async () => {
    const value = await run('write', () => window.ostlerAPI.writeChecksumFile())
    if (value) setWritten(value)
  }

  const checkFile = async () => {
    const value = await run('verify', () => window.ostlerAPI.verifyChecksumFile())
    if (value) setChecked(value)
  }

  const checkRecords = async () => {
    const value = await run('check', () => window.ostlerAPI.checkProjectRecords(project.id))
    if (value) {
      setRecords(value)
      setRepair(null)
    }
  }

  const repairRecords = async () => {
    const ok = await confirm({
      title: t('projects:projectCare.repairTitle', { projectName: project.name }),
      body: t('projects:projectCare.repairBody'),
      confirmLabel: t('projects:projectCare.repair'),
      tone: 'danger'
    })
    if (!ok) return
    const value = await run('repair', () => window.ostlerAPI.repairProjectRecords(project.id))
    if (value) {
      setRepair(value)
      setRecords(value.after)
    }
  }

  const brokenCount = records?.brokenRecords.reduce((sum, entry) => sum + entry.rows, 0) ?? 0
  const healthy = records !== null && records.databaseOk && brokenCount === 0
  const fixedCount = (entries: { rows: number }[]) =>
    entries.reduce((sum, entry) => sum + entry.rows, 0)

  return (
    <>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <CareGroup
        title={t('projects:projectCare.records')}
        description={t('projects:projectCare.recordsDescription')}
      >
        <CareRow
          title={t('projects:projectCare.checkRecords')}
          description={
            records
              ? t('projects:projectCare.lastChecked', {
                  when: formatDateTime(new Date(records.checkedAt))
                })
              : t('projects:projectCare.checkRecordsDescription')
          }
          action={
            <>
              <Button
                loading={busy === 'check'}
                disabled={busy !== null}
                onClick={() => void checkRecords()}
              >
                {t('projects:projectCare.checkRecords')}
              </Button>
              {records && !healthy && (
                <Button
                  variant="danger"
                  loading={busy === 'repair'}
                  disabled={busy !== null}
                  onClick={() => void repairRecords()}
                >
                  {t('projects:projectCare.repairEllipsis')}
                </Button>
              )}
            </>
          }
        >
          {repair && (
            <InlineAlert tone={healthy ? 'success' : 'warning'}>
              {t('projects:projectCare.repaired', {
                cleared: t('projects:projectCare.recordCount', {
                  count: fixedCount(repair.clearedLinks)
                }),
                removed: t('projects:projectCare.recordCount', {
                  count: fixedCount(repair.removedRecords)
                })
              })}{' '}
              {t('projects:projectCare.repairBackup')}
            </InlineAlert>
          )}
          {records && healthy && !repair && (
            <InlineAlert tone="success">
              {t('projects:projectCare.recordsHealthy', {
                records: t('projects:projectCare.recordCount', { count: records.totalRows }),
                tables: t('projects:projectCare.tableCount', { count: records.tableCount })
              })}
            </InlineAlert>
          )}
          {records && !healthy && (
            <InlineAlert tone="warning">
              {!records.databaseOk && (
                <>
                  <p className="project-care-muted">{t('projects:projectCare.databaseProblems')}</p>
                  <ul className="project-care-list">
                    {records.databaseProblems.map((problem) => (
                      <li key={problem}>
                        <code>{problem}</code>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {brokenCount > 0 && (
                <>
                  <p className="project-care-muted">
                    {t('projects:projectCare.brokenRecords', {
                      records: t('projects:projectCare.recordCount', { count: brokenCount })
                    })}
                  </p>
                  <ul className="project-care-list">
                    {records.brokenRecords.map((entry) => (
                      <li key={entry.table}>
                        <code>{entry.table}</code> {entry.rows}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </InlineAlert>
          )}
        </CareRow>
      </CareGroup>

      <CareGroup
        title={t('projects:projectCare.checksumFiles')}
        description={t('projects:projectCare.checksumFilesDescription')}
      >
        <CareRow
          title={t('projects:projectCare.writeChecksumFile')}
          description={t('projects:projectCare.writeChecksumFileDescription')}
          action={
            <Button
              loading={busy === 'write'}
              disabled={busy !== null}
              onClick={() => void writeChecksum()}
            >
              {t('projects:projectCare.chooseFileEllipsis')}
            </Button>
          }
        >
          {written && (
            <InlineAlert tone="success">
              {t('projects:projectCare.checksumWritten')}{' '}
              <span className="project-care-path">{written.checksumPath}</span>
            </InlineAlert>
          )}
        </CareRow>
        <CareRow
          title={t('projects:projectCare.checkFile')}
          description={t('projects:projectCare.checkFileDescription')}
          action={
            <Button
              loading={busy === 'verify'}
              disabled={busy !== null}
              onClick={() => void checkFile()}
            >
              {t('projects:projectCare.chooseFileEllipsis')}
            </Button>
          }
        >
          {checked && (
            <InlineAlert
              tone={
                checked.verdict === 'matches'
                  ? 'success'
                  : checked.verdict === 'differs'
                    ? 'danger'
                    : 'warning'
              }
            >
              {t(`projects:projectCare.fileVerdict.${checked.verdict}`)}{' '}
              <span className="project-care-path">{checked.filePath}</span>
            </InlineAlert>
          )}
        </CareRow>
      </CareGroup>
    </>
  )
}
