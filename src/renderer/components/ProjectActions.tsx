import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RendererProject } from '@shared/ostler-api'
import { useOstler } from '../context/OstlerContext'
import { boardLayoutPath, statusUpdatePath } from '../navigation/paths'
import { useProjectLifecycle } from './project-care/useProjectLifecycle'
import { useRemoveDemoProjects } from './project-care/useRemoveDemoProjects'
import type { ProjectSettingsSection } from './ProjectSettingsDialog'
import { ProjectColorPicker } from './ProjectColorPicker'
import { useImportDialog } from './import/useImportDialog'
import { projectNameHint } from './project-name-hint'
import { lazyNamed } from '../lib/lazy-named'
import { Button, Dialog, TextField, type MenuItem } from '../ui'
import {
  Archive,
  CalendarDays,
  Download,
  FileInput,
  FolderOutput,
  LayoutTemplate,
  Megaphone,
  Palette,
  Pencil,
  Settings,
  Columns3Cog,
  Share2,
  Trash2
} from '../ui/icons'
import { t } from '@shared/i18n'

// Each opens from a menu, so each loads the first time it opens (P9.1).
const ProjectSettingsDialog = lazyNamed(
  () => import('./ProjectSettingsDialog'),
  'ProjectSettingsDialog'
)
const SaveTemplateDialog = lazyNamed(() => import('./SaveTemplateDialog'), 'SaveTemplateDialog')
const ExportProjectDialog = lazyNamed(() => import('./ExportProjectDialog'), 'ExportProjectDialog')
const ExportCalendarDialog = lazyNamed(
  () => import('./share/ExportCalendarDialog'),
  'ExportCalendarDialog'
)
const ShareReportDialog = lazyNamed(() => import('./share/ShareReportDialog'), 'ShareReportDialog')

export type ProjectAction =
  | 'rename'
  | 'colour'
  | 'settings'
  | 'customiseBoard'
  | 'template'
  | 'import'
  | 'exportProject'
  | 'exportTasks'
  | 'exportCalendar'
  | 'shareReport'
  | 'postUpdate'
  | 'archive'
  | 'remove'

/**
 * The project actions the sidebar's context menu and the workspace's More
 * menu offer, with the dialogs they open. One implementation for both.
 */
export function useProjectActions(): {
  items: (project: RendererProject, actions?: readonly ProjectAction[]) => MenuItem[]
  dialogs: ReactNode
} {
  const navigate = useNavigate()
  const { refreshProjects } = useOstler()
  const { archive, exportTasks } = useProjectLifecycle()
  const removeDemos = useRemoveDemoProjects()
  const [renaming, setRenaming] = useState<RendererProject | null>(null)
  const [colouring, setColouring] = useState<RendererProject | null>(null)
  // Project settings, on the section it was opened for: Remove opens on Remove.
  const [configuring, setConfiguring] = useState<{
    project: RendererProject
    section?: ProjectSettingsSection
  } | null>(null)
  const [templating, setTemplating] = useState<RendererProject | null>(null)
  const [exporting, setExporting] = useState<RendererProject | null>(null)
  const [exportingCalendar, setExportingCalendar] = useState<RendererProject | null>(null)
  const [sharing, setSharing] = useState<RendererProject | null>(null)
  const importer = useImportDialog()

  const all: Record<ProjectAction, (project: RendererProject) => MenuItem> = {
    rename: (project) => ({
      label: t('projects:projectActions.rename2'),
      icon: Pencil,
      onSelect: () => setRenaming(project)
    }),
    colour: (project) => ({
      label: t('projects:projectActions.colour2'),
      icon: Palette,
      onSelect: () => setColouring(project)
    }),
    settings: (project) => ({
      label: t('projects:projectActions.projectSettings'),
      icon: Settings,
      onSelect: () => setConfiguring({ project })
    }),
    // The Board with Customise board open: its views, toolbar, options and columns.
    customiseBoard: (project) => ({
      label: t('tasks:boardLayout.openMenu'),
      icon: Columns3Cog,
      onSelect: () => navigate(boardLayoutPath(project.id))
    }),
    template: (project) => ({
      label: t('projects:projectActions.saveTemplate'),
      icon: LayoutTemplate,
      onSelect: () => setTemplating(project)
    }),
    import: (project) => ({
      label: t('projects:projectActions.importTasks'),
      icon: FileInput,
      onSelect: () => importer.open({ kind: 'project', projectId: project.id })
    }),
    exportProject: (project) => ({
      label: t('projects:projectActions.exportProject'),
      icon: FolderOutput,
      onSelect: () => setExporting(project)
    }),
    exportTasks: (project) => ({
      label: t('projects:projectActions.exportAllTasks'),
      icon: Download,
      onSelect: () => void exportTasks(project)
    }),
    exportCalendar: (project) => ({
      label: t('projects:projectActions.exportCalendarFile'),
      icon: CalendarDays,
      onSelect: () => setExportingCalendar(project)
    }),
    shareReport: (project) => ({
      label: t('projects:projectActions.shareWebPage'),
      icon: Share2,
      onSelect: () => setSharing(project)
    }),
    // Status updates (N5.5): the Overview opens with the posting dialog.
    postUpdate: (project) => ({
      label: t('projects:statusUpdates.postAnUpdate'),
      icon: Megaphone,
      onSelect: () => navigate(statusUpdatePath(project.id))
    }),
    archive: (project) => ({
      label: t('projects:projectActions.archiveProject'),
      icon: Archive,
      onSelect: () => void archive(project)
    }),
    // A demo goes with the other demo, after one confirmation.
    remove: (project) =>
      project.demo
        ? {
            label: t('projects:demoRemoval.menu'),
            icon: Trash2,
            tone: 'danger',
            onSelect: () => void removeDemos()
          }
        : {
            label: t('projects:projectActions.remove'),
            icon: Trash2,
            tone: 'danger',
            onSelect: () => setConfiguring({ project, section: 'remove' })
          }
  }

  const items = (
    project: RendererProject,
    actions: readonly ProjectAction[] = [
      'rename',
      'colour',
      'settings',
      'customiseBoard',
      'template',
      'archive',
      'remove'
    ]
  ) => actions.map((action) => all[action](project))

  const dialogs = (
    <Suspense fallback={null}>
      {configuring && (
        <ProjectSettingsDialog
          project={configuring.project}
          section={configuring.section}
          onClose={() => setConfiguring(null)}
          onChanged={() => void refreshProjects()}
        />
      )}
      {templating && (
        <SaveTemplateDialog project={templating} onClose={() => setTemplating(null)} />
      )}
      {exporting && <ExportProjectDialog project={exporting} onClose={() => setExporting(null)} />}
      {exportingCalendar && (
        <ExportCalendarDialog
          project={exportingCalendar}
          onClose={() => setExportingCalendar(null)}
        />
      )}
      {sharing && <ShareReportDialog project={sharing} onClose={() => setSharing(null)} />}
      {importer.dialog}
      {renaming && (
        <RenameProjectDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => void refreshProjects()}
        />
      )}
      {colouring && (
        <ProjectColourDialog
          project={colouring}
          onClose={() => setColouring(null)}
          onSaved={() => void refreshProjects()}
        />
      )}
    </Suspense>
  )

  return { items, dialogs }
}

/** Renames a project. Also used by the workspace header's inline rename. */
export async function renameProject(
  project: RendererProject,
  name: string
): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) return t('projects:projectActions.enterName')
  if (trimmed === project.name) return null
  const result = await window.ostlerAPI.updateProject(project.id, { name: trimmed })
  return result.ok ? null : result.error
}

function RenameProjectDialog({
  project,
  onClose,
  onSaved
}: {
  project: RendererProject
  onClose: () => void
  onSaved: () => void
}) {
  const { projects } = useOstler()
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const problem = await renameProject(project, name)
    setBusy(false)
    if (problem) {
      setError(problem)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('projects:projectActions.rename', { projectName: project.name })}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('projects:projectActions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('projects:projectActions.renameProject')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label={t('projects:projectActions.projectName')}
          value={name}
          maxLength={80}
          error={error ?? undefined}
          hint={projectNameHint(name, projects, { exceptId: project.id })}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
      </form>
    </Dialog>
  )
}

function ProjectColourDialog({
  project,
  onClose,
  onSaved
}: {
  project: RendererProject
  onClose: () => void
  onSaved: () => void
}) {
  const [colors, setColors] = useState<string[]>([])
  const [color, setColor] = useState(project.color)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.ostlerAPI.getNewProjectDefaults().then((result) => {
      if (result.ok) setColors(result.value.colors)
    })
  }, [])

  const save = async () => {
    const result = await window.ostlerAPI.updateProject(project.id, { color })
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('projects:projectActions.colour', { projectName: project.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('projects:projectActions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('projects:projectActions.saveColour')}
          </Button>
        </>
      }
    >
      <ProjectColorPicker
        colors={colors}
        value={color}
        onChange={setColor}
        name={`project-colour-${project.id}`}
      />
      {error && (
        <p className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
