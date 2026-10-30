import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { useOstler } from '../../../context/OstlerContext'
import { projectPath } from '../../../navigation/paths'
import { NewProjectWizard } from '../../../components/NewProjectWizard'
import { ProjectSettingsDialog } from '../../../components/ProjectSettingsDialog'
import { Badge, Button, EmptyState, useToast } from '../../../ui'
import { FolderKanban } from '../../../ui/icons'
import { SettingsGroup, useSettings } from '../settings-form'
import { TemplatesGroup } from './TemplatesGroup'
import { AreasGroup } from './AreasGroup'
import { TaskTemplatesGroup } from '../../../task-templates/TaskTemplatesGroup'
import { BoardDefaultsGroup } from './BoardDefaultsGroup'
import { t } from '@shared/i18n'
import { ProjectMark } from '../../../components/ProjectMark'

/** Settings › Projects: every project, archived ones too, and how to add one. */
export function ProjectsSection() {
  const { config, reloadConfig, markSaved, setError } = useSettings()
  const { refreshProjects } = useOstler()
  const navigate = useNavigate()
  const { toastUndo } = useToast()
  const [creating, setCreating] = useState(false)
  // Project settings, where the project is also backed up, exported or removed.
  const [configuring, setConfiguring] = useState<RendererProject | null>(null)
  const projects = config.projects

  const reload = async () => {
    reloadConfig()
    await refreshProjects()
  }

  // Archiving is reversible from here, so it happens at once and offers undo.
  const setArchived = async (project: RendererProject, archived: boolean) => {
    const result = await window.ostlerAPI.updateProject(project.id, { enabled: !archived })
    if (!result.ok) return setError(result.error)
    await reload()
    markSaved()
    if (archived) {
      toastUndo(
        t('settings:projectsSection.archived2', { projectName: project.name }),
        async () => {
          await window.ostlerAPI.updateProject(project.id, { enabled: true })
          await reload()
        }
      )
    }
  }

  return (
    <>
      <SettingsGroup
        id="projects"
        description={t('settings:projectsSection.archivedProjectsHiddenSidebar')}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('settings:projectsSection.newProject')}
          </Button>
        }
      >
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={t('settings:projectsSection.noProjectsYet')}
            description={t('settings:projectsSection.projectHoldsTasksMilestones')}
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t('settings:projectsSection.newProject')}
              </Button>
            }
          />
        ) : (
          <ul
            className="ostler-settings-project-list"
            aria-label={t('settings:projectsSection.projects2')}
          >
            {projects.map((project) => {
              const folder = projectFolder(project)
              return (
                <li key={project.id} className="ostler-settings-project">
                  <ProjectMark project={project} className="ostler-settings-project-dot" />
                  <div className="ostler-settings-project-text">
                    <span className="ostler-settings-project-name">
                      {project.name}
                      {!project.enabled && <Badge>{t('settings:projectsSection.archived')}</Badge>}
                    </span>
                    <span className="ostler-settings-project-folder" title={folder ?? undefined}>
                      {folder ?? t('settings:projectsSection.noFolder')}
                    </span>
                  </div>
                  <div className="ostler-settings-project-actions">
                    {project.enabled ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(projectPath(project.id))}
                      >
                        {t('settings:projectsSection.open')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={() => setConfiguring(project)}
                      aria-label={t('settings:projectsSection.settings2', {
                        projectName: project.name
                      })}
                    >
                      {t('settings:projectsSection.settings')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void setArchived(project, project.enabled)}
                      aria-label={
                        project.enabled
                          ? t('settings:projectsSection.archive2', { projectName: project.name })
                          : t('settings:projectsSection.restore2', { projectName: project.name })
                      }
                    >
                      {project.enabled
                        ? t('settings:projectsSection.archive')
                        : t('settings:projectsSection.restore')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SettingsGroup>

      <AreasGroup projects={projects} />

      <TemplatesGroup />

      <TaskTemplatesGroup />

      <BoardDefaultsGroup />

      {creating && (
        <NewProjectWizard
          onClose={() => setCreating(false)}
          onCreated={() => void reload()}
          onOpen={(project) => {
            setCreating(false)
            navigate(projectPath(project.id))
          }}
        />
      )}

      {configuring && (
        <ProjectSettingsDialog
          project={configuring}
          onClose={() => setConfiguring(null)}
          onChanged={() => void reload()}
        />
      )}
    </>
  )
}
