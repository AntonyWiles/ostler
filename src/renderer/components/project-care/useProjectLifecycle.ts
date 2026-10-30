import { useLocation, useNavigate } from 'react-router-dom'
import type { RendererProject } from '@shared/ostler-api'
import { useOstler } from '../../context/OstlerContext'
import { homePath, parseAppPath } from '../../navigation/paths'
import { useToast } from '../../ui'
import { t } from '@shared/i18n'

/**
 * What archiving, exporting and removing a project do, wherever they start:
 * the project's menus and Project settings › Export & import and Remove.
 * One implementation for every surface.
 */
export function useProjectLifecycle() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshProjects } = useOstler()
  const { toast, toastUndo } = useToast()

  /** A project that is gone from the sidebar takes the window Home if it was open. */
  const leaveIfOpen = (project: RendererProject) => {
    const here = parseAppPath(location.pathname)
    if (here && 'projectId' in here && here.projectId === project.id) navigate(homePath())
  }

  // Archiving hides the project everywhere but Settings › Projects, where it
  // can be turned back on; so it happens at once and offers undo.
  const archive = async (project: RendererProject): Promise<boolean> => {
    const result = await window.ostlerAPI.updateProject(project.id, { enabled: false })
    if (!result.ok) {
      toast({
        title: t('projects:projectActions.couldntArchive', { projectName: project.name }),
        body: result.error,
        tone: 'danger'
      })
      return false
    }
    leaveIfOpen(project)
    await refreshProjects()
    toastUndo(t('projects:projectActions.archived', { projectName: project.name }), async () => {
      await window.ostlerAPI.updateProject(project.id, { enabled: true })
      await refreshProjects()
    })
    return true
  }

  // Every task, every column, as CSV (P6.1); the List exports its own view.
  const exportTasks = async (project: RendererProject) => {
    const result = await window.ostlerAPI.exportTasksCsv(project.id, {
      fileName: t('projects:projectActions.tasks', { projectName: project.name })
    })
    if (!result.ok)
      toast({
        title: t('projects:projectActions.couldntExportTasks'),
        body: result.error,
        tone: 'danger'
      })
    else if (result.value)
      toast({
        title: t('projects:projectActions.exportedTasks', { projectName: project.name }),
        body: result.value,
        tone: 'success'
      })
  }

  /** After a project's data is deleted: say so, leave it, and list projects again. */
  const removed = (project: RendererProject) => {
    toast({
      title: t('projects:projectActions.removed', { removingName: project.name }),
      body: t('projects:projectActions.projectsFilesWerentTouched'),
      tone: 'success'
    })
    leaveIfOpen(project)
    void refreshProjects()
  }

  return { archive, exportTasks, removed, leaveIfOpen }
}
