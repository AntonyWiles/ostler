import { keywordList, t } from '@shared/i18n'
import { groupProjectsByArea } from '@shared/project-areas'
import { projectFolder } from '@shared/project-folder'
import { isProjectIcon } from '@shared/project-icons'
import { SAVED_VIEW_TYPE_LABELS } from '@shared/saved-views'
import { FolderKanban, Layers, Plus } from '../../../ui/icons'
import { viewContext } from '../../../navigation/features'
import { allProjectViews } from '../../../navigation/registry'
import { projectPath, subprojectPath } from '../../../navigation/paths'
import { PROJECT_ICON_GLYPHS } from '../../project-icon-glyphs'
import type { Command, PaletteContext } from './types'

/**
 * Every project, in the one grouping (N5.1); then the workstreams; then, for
 * a search, every other project's views and its new task and note.
 */
export function buildProjectCommands(ctx: PaletteContext): Command[] {
  const { projects, currentProject, go } = ctx
  const areas = ctx.areas ?? []
  const list: Command[] = []

  // In the one grouping (N5.1): each area's projects under its own heading.
  for (const group of groupProjectsByArea(projects, areas)) {
    const areaName = group.area?.name ?? t('projects:areas.noArea')
    for (const project of group.projects) {
      list.push({
        id: `project:${project.id}`,
        group:
          areas.length > 0
            ? t('navigation:commandPalette.projectsInArea', { area: areaName })
            : t('navigation:commandPalette.projects'),
        label: project.name,
        icon: isProjectIcon(project.icon) ? PROJECT_ICON_GLYPHS[project.icon] : FolderKanban,
        keywords: areas.length > 0 ? [areaName] : undefined,
        hint: projectFolder(project) ?? t('navigation:commandPalette.noFolder'),
        run: go(projectPath(project.id))
      })
    }
  }

  // Workstreams (sub-projects), below the projects: each opens its project scoped to it.
  for (const project of projects) {
    for (const sub of ctx.subprojectsByProject.get(project.id) ?? []) {
      if (sub.archivedAt !== null) continue
      list.push({
        id: `subproject:${sub.id}`,
        group: t('projects:subprojects.workstreams'),
        label: sub.name,
        icon: Layers,
        hint: project.name,
        run: go(subprojectPath(project.id, sub.id))
      })
    }
  }

  for (const project of projects) {
    if (project.id === currentProject?.id) continue
    for (const view of allProjectViews(viewContext(ctx.features, project))) {
      list.push({
        id: `view:${project.id}:${view.id}`,
        group: t('navigation:commandPalette.projectViews'),
        label: `${project.name}: ${view.label}`,
        icon: view.icon,
        keywords: view.keywords,
        searchOnly: true,
        run: go(projectPath(project.id, view.id))
      })
    }
    list.push(
      {
        id: `new-task:${project.id}`,
        group: t('navigation:commandPalette.create'),
        label: t('navigation:commandPalette.newTask2', { projectName: project.name }),
        icon: Plus,
        searchOnly: true,
        run: go(projectPath(project.id, undefined, { newTask: '1' }))
      },
      {
        id: `note:${project.id}`,
        group: t('navigation:commandPalette.create'),
        label: t('navigation:commandPalette.newNote', { projectName: project.name }),
        icon: Plus,
        searchOnly: true,
        run: go(projectPath(project.id, 'library', { new: 'note' }))
      }
    )
  }
  return list
}

/** Every saved view whose project is still watched, for a search. */
export function buildSavedViewCommands(ctx: PaletteContext): Command[] {
  return ctx.savedViews.flatMap((view): Command[] => {
    const project = ctx.projects.find((candidate) => candidate.id === view.projectId)
    if (!project) return []
    return [
      {
        id: `saved-view:${view.id}`,
        group: t('navigation:commandPalette.savedViews'),
        label: t('navigation:commandPalette.openView', {
          viewName: view.name,
          projectName: project.name
        }),
        icon: Layers,
        hint: SAVED_VIEW_TYPE_LABELS[view.viewType],
        keywords: keywordList('navigation:commandPalette.keywords.savedView'),
        searchOnly: true,
        run: ctx.go(projectPath(project.id, view.viewType, { view: view.id }))
      }
    ]
  })
}
