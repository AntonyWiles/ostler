import { AI_PROFILE_SETTINGS, projectAiProfile, type AiProfile } from '@shared/ai-profile'
import type { ProjectAiSettings, WatchedProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'

interface Dependencies {
  getProject(projectId: string): WatchedProject
  updateProject(projectId: string, updates: Partial<WatchedProject>): WatchedProject
  /** Read-only: whether the project's linked folder is a Git repository. */
  isGitRepo(project: WatchedProject): Promise<boolean>
}

/**
 * A project's Ostler AI settings (P7.1) for every surface: the desktop dialog,
 * the automation API and the planning prompts read and change them here.
 */
export class ProjectAiSettingsService {
  constructor(private readonly deps: Dependencies) {}

  /** `projectAiProfile`, reading Git only when the setting is Auto and a folder is linked. */
  async profile(projectId: string): Promise<AiProfile> {
    const project = this.deps.getProject(projectId)
    const setting = project.aiProfile ?? 'auto'
    if (setting !== 'auto' || projectFolder(project) === null) {
      return projectAiProfile(project, null)
    }
    let isGitRepo = false
    try {
      isGitRepo = await this.deps.isGitRepo(project)
    } catch {
      // An unreadable folder plans like a project without one.
    }
    return projectAiProfile(project, { isGitRepo })
  }

  async get(projectId: string): Promise<ProjectAiSettings> {
    const project = this.deps.getProject(projectId)
    return {
      projectId: project.id,
      profileSetting: project.aiProfile ?? 'auto',
      profile: await this.profile(projectId)
    }
  }

  async update(
    projectId: string,
    updates: { profileSetting?: unknown }
  ): Promise<ProjectAiSettings> {
    const changes: Partial<WatchedProject> = {}
    if (updates.profileSetting !== undefined) {
      if (!AI_PROFILE_SETTINGS.includes(updates.profileSetting as never)) {
        throw new Error('profileSetting must be auto, software or general')
      }
      changes.aiProfile = updates.profileSetting as WatchedProject['aiProfile']
    }
    if (Object.keys(changes).length > 0) {
      this.deps.getProject(projectId)
      this.deps.updateProject(projectId, changes)
    }
    return this.get(projectId)
  }
}
