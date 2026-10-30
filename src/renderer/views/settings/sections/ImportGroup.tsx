import { useCallback, useEffect, useState } from 'react'
import type { ImportBatch, ImportSource } from '@shared/ostler-api'
import { useOstler } from '../../../context/OstlerContext'
import { useImportDialog } from '../../../components/import/useImportDialog'
import { useUndoImport } from '../../../hooks/useUndoImport'
import { absoluteTimeText, relativeTimeText } from '../../../ui/date-text'
import { Button, EmptyState } from '../../../ui'
import { FileInput } from '../../../ui/icons'
import { SettingsGroup } from '../settings-form'
import { t } from '@shared/i18n'

const SOURCES: Record<ImportSource, string> = {
  get csv() {
    return t('settings:importGroup.spreadsheetCsv')
  },
  get trello() {
    return t('settings:importGroup.trelloBoard')
  },
  get package() {
    return t('settings:importGroup.project')
  },
  get github() {
    return t('settings:importGroup.githubIssues')
  }
}

/**
 * Settings › Data › Import (P6.1): import a file into any project or a new
 * one, and the history of imports, each with Undo import until it is undone.
 */
export function ImportGroup() {
  const { projects } = useOstler()
  const [batches, setBatches] = useState<ImportBatch[] | null>(null)
  const undoImport = useUndoImport()

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listImportBatches()
    if (result.ok) setBatches(result.value)
  }, [])
  const importer = useImportDialog({ onImported: () => void load() })

  useEffect(() => {
    void load()
  }, [load])

  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? ''

  return (
    <SettingsGroup
      id="import"
      description={t('settings:importGroup.bringTasksSpreadsheetCsv')}
      actions={
        <Button icon={FileInput} onClick={() => importer.open({ kind: 'choose' })}>
          {t('settings:importGroup.import2')}
        </Button>
      }
    >
      {batches !== null && batches.length === 0 ? (
        <EmptyState
          icon={FileInput}
          title={t('settings:importGroup.noImportsYet')}
          description={t('settings:importGroup.eachImportListedHere')}
        />
      ) : (
        <ul
          className="ostler-settings-project-list"
          aria-label={t('settings:importGroup.importHistory')}
        >
          {(batches ?? []).map((batch) => (
            <li key={batch.id} className="ostler-settings-project">
              <div className="ostler-settings-project-text">
                <span className="ostler-settings-project-name">
                  {t('settings:importGroup.tasksInto', {
                    count: batch.itemCount,
                    projectName: projectName(batch.projectId)
                  })}
                </span>
                <span className="ostler-settings-project-folder">
                  {`${SOURCES[batch.source]} · ${batch.fileName} · `}
                  <time
                    dateTime={new Date(batch.createdAt).toISOString()}
                    title={absoluteTimeText(batch.createdAt)}
                  >
                    {relativeTimeText(batch.createdAt)}
                  </time>
                  {batch.undoneAt !== null ? t('settings:importGroup.undone') : ''}
                </span>
              </div>
              <div className="ostler-settings-project-actions">
                {batch.undoneAt === null && batch.itemCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void undoImport(batch.id, () => void load())}
                    aria-label={t('settings:importGroup.undoImport2', { fileName: batch.fileName })}
                  >
                    {t('settings:importGroup.undoImport')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {importer.dialog}
    </SettingsGroup>
  )
}
