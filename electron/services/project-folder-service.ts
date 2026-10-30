import type { HarnessProjectState, WatchedProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'

export interface ProjectFolderDependencies {
  getProject(projectId: string): WatchedProject
  validateProjectFolder(folderPath: string, forProjectId: string): string
  setProjectFolder(projectId: string, folder: string | null): WatchedProject
  harness: {
    getState(project: WatchedProject): HarnessProjectState
  }
  runtime: {
    start(project: WatchedProject): void
    stop(projectId: string): void
  }
}

/**
 * Links and unlinks a project's folder (D4), the one place the rules that
 * protect agent work are enforced, for the desktop UI and the automation API
 * alike. Linking writes nothing into the folder: agent work lives in the
 * folder's own history, so any folder may be linked.
 */
export class ProjectFolderService {
  constructor(private readonly dependencies: ProjectFolderDependencies) {}

  link(projectId: string, folderPath: string): WatchedProject {
    const { getProject, validateProjectFolder, setProjectFolder, runtime } = this.dependencies
    const project = getProject(projectId)
    if (projectFolder(project) !== null) {
      throw new Error(t('errors:projectFolder.alreadyLinked', { project: project.name }))
    }
    const folder = validateProjectFolder(folderPath, projectId)

    const linked = setProjectFolder(projectId, folder)
    runtime.stop(projectId)
    runtime.start(linked)
    return linked
  }

  unlink(projectId: string): WatchedProject {
    const { getProject, setProjectFolder, harness, runtime } = this.dependencies
    const project = getProject(projectId)
    if (projectFolder(project) === null) return project

    const openWork = describeOpenAgentWork(harness.getState(project))
    if (openWork) {
      throw new Error(t('errors:projectFolder.finishAgentWork', { work: openWork }))
    }

    runtime.stop(projectId)
    return setProjectFolder(projectId, null)
  }
}

/** "2 agent runs queued, 1 agent run in progress", or null when no agent work is open. */
export function describeOpenAgentWork(state: HarnessProjectState): string | null {
  const queued = state.taskQueue.filter(
    (task) => task.status === 'pending' || task.status === 'claimed'
  ).length
  const open = state.activeSessions.length
  const review = state.reviewSessions.length
  const parts = [
    queued > 0 ? t('errors:openAgentWork.queued', { count: queued }) : null,
    open > 0 ? t('errors:openAgentWork.inProgress', { count: open }) : null,
    review > 0 ? t('errors:openAgentWork.review', { count: review }) : null
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}
