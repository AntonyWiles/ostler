import { Suspense, useState } from 'react'
import type { ProjectRemovalArchive, RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { Button, InlineAlert } from '../../ui'
import { lazyNamed } from '../../lib/lazy-named'
import { useImportDialog } from '../import/useImportDialog'
import { useOstler } from '../../context/OstlerContext'
import { t } from '@shared/i18n'
import { CareGroup, CareRow } from './CareRow'
import { useProjectLifecycle } from './useProjectLifecycle'

const ExportProjectDialog = lazyNamed(() => import('../ExportProjectDialog'), 'ExportProjectDialog')
const ExportCalendarDialog = lazyNamed(
  () => import('../share/ExportCalendarDialog'),
  'ExportCalendarDialog'
)
const ShareReportDialog = lazyNamed(() => import('../share/ShareReportDialog'), 'ShareReportDialog')
const SaveTemplateDialog = lazyNamed(() => import('../SaveTemplateDialog'), 'SaveTemplateDialog')

type Opened = 'projectFile' | 'calendar' | 'webPage' | 'template'

/**
 * Project settings › Export and import: every way to take this project's work
 * out of Ostler, and to bring work in. The same dialogs the project's menu
 * opens.
 */
export function ProjectExportImportPanel({ project }: { project: RendererProject }) {
  const { refreshProjects } = useOstler()
  const { exportTasks } = useProjectLifecycle()
  const importer = useImportDialog({ onImported: () => void refreshProjects() })
  const [opened, setOpened] = useState<Opened | null>(null)
  const [archive, setArchive] = useState<ProjectRemovalArchive | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => setOpened(null)

  // The records as JSON files, as the guided removal writes them.
  const writeRecords = async () => {
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.archiveProjectData(project.id)
    setBusy(false)
    if (!result.ok) setError(result.error)
    else if (result.value) setArchive(result.value)
  }

  return (
    <>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <CareGroup title={t('projects:projectCare.export')}>
        <CareRow
          title={t('projects:projectCare.projectFile')}
          description={t('projects:projectCare.projectFileDescription')}
          action={
            <Button onClick={() => setOpened('projectFile')}>
              {t('projects:projectCare.exportEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.tasksCsv')}
          description={t('projects:projectCare.tasksCsvDescription')}
          action={
            <Button onClick={() => void exportTasks(project)}>
              {t('projects:projectCare.exportEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.calendarFile')}
          description={t('projects:projectCare.calendarFileDescription')}
          action={
            <Button onClick={() => setOpened('calendar')}>
              {t('projects:projectCare.exportEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.webPage')}
          description={t('projects:projectCare.webPageDescription')}
          action={
            <Button onClick={() => setOpened('webPage')}>
              {t('projects:projectCare.saveEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.template')}
          description={t('projects:projectCare.templateDescription')}
          action={
            <Button onClick={() => setOpened('template')}>
              {t('projects:projectCare.saveEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.recordsAsFiles')}
          description={
            projectFolder(project) === null
              ? t('projects:projectCare.recordsAsFilesNoFolder')
              : t('projects:projectCare.recordsAsFilesDescription')
          }
          action={
            <Button loading={busy} disabled={busy} onClick={() => void writeRecords()}>
              {t('projects:projectCare.writeEllipsis')}
            </Button>
          }
        >
          {archive && (
            <InlineAlert tone="success">
              {t('projects:projectCare.recordsWritten', { count: archive.files.length })}{' '}
              <span className="project-care-path">{archive.archivePath}</span>
            </InlineAlert>
          )}
        </CareRow>
      </CareGroup>

      <CareGroup title={t('projects:projectCare.import')}>
        <CareRow
          title={t('projects:projectCare.importTasks')}
          description={t('projects:projectCare.importTasksDescription')}
          action={
            <Button onClick={() => importer.open({ kind: 'project', projectId: project.id })}>
              {t('projects:projectCare.importEllipsis')}
            </Button>
          }
        />
        <CareRow
          title={t('projects:projectCare.openProjectFile')}
          description={t('projects:projectCare.openProjectFileDescription')}
          action={
            <Button onClick={() => importer.open({ kind: 'new' })}>
              {t('projects:projectCare.openEllipsis')}
            </Button>
          }
        />
      </CareGroup>

      <Suspense fallback={null}>
        {opened === 'projectFile' && <ExportProjectDialog project={project} onClose={close} />}
        {opened === 'calendar' && <ExportCalendarDialog project={project} onClose={close} />}
        {opened === 'webPage' && <ShareReportDialog project={project} onClose={close} />}
        {opened === 'template' && <SaveTemplateDialog project={project} onClose={close} />}
      </Suspense>
      {importer.dialog}
    </>
  )
}
