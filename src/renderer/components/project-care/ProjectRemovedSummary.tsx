import type { ProjectBackupEntry, ProjectRemovalPurge, RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'
import { Button, Dialog, InlineAlert } from '../../ui'
import { useProjectLifecycle } from './useProjectLifecycle'

/**
 * Project settings once its project is removed: what removal did. Closing it
 * takes the project from every list, and the window Home if it was open.
 */
export function ProjectRemovedDialog({
  project,
  purge,
  backup,
  onClose
}: {
  project: RendererProject
  purge: ProjectRemovalPurge
  backup: ProjectBackupEntry | null
  onClose: () => void
}) {
  const { removed } = useProjectLifecycle()
  const close = () => {
    removed(project)
    onClose()
  }
  return (
    <Dialog
      open
      size="lg"
      className="ostler-project-settings-dialog"
      title={t('projects:projectRemovalWizard.removed', { projectName: project.name })}
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          {t('projects:projectRemovalWizard.done')}
        </Button>
      }
    >
      <ProjectRemovedSummary project={project} purge={purge} backup={backup} />
    </Dialog>
  )
}

/** What removing a project did, and where its backup is if one was made first. */
export function ProjectRemovedSummary({
  project,
  purge,
  backup
}: {
  project: RendererProject
  purge: ProjectRemovalPurge
  backup: ProjectBackupEntry | null
}) {
  return (
    <div className="project-care-summary">
      <p className="project-care-muted">
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
      {backup && (
        <InlineAlert tone="success" title={t('projects:projectCare.backupKept')}>
          <p className="project-care-muted">{t('projects:projectCare.backupKeptBody')}</p>
          <p className="project-care-path">{backup.filePath}</p>
          <Button
            size="sm"
            onClick={() => void window.ostlerAPI.showProjectBackup(project.id, backup.id)}
          >
            {t('projects:projectCare.showInFolder')}
          </Button>
        </InlineAlert>
      )}
      {purge.failedPaths.length > 0 && (
        <InlineAlert tone="warning">
          <p className="project-care-muted">
            {t('projects:projectRemovalWizard.ostlerCouldNotDelete', {
              count: purge.failedPaths.length
            })}
          </p>
          <ul className="project-care-list">
            {purge.failedPaths.map((entry) => (
              <li key={entry.path}>
                <code>{entry.path}</code>
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}
      {projectFolder(project) !== null && (
        <p className="project-care-muted">
          {t('projects:projectRemovalWizard.projectFilesWereNot')}
        </p>
      )}
    </div>
  )
}
