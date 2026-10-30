import { projectFolder } from './project-folder'

/**
 * Per-project Ostler AI settings (P7.1): whether its planning prompts write
 * tasks for coding agents (software) or for people (general). Setting Ostler AI
 * up is the only switch: it reads every project.
 */

export const AI_PROFILE_SETTINGS = ['auto', 'software', 'general'] as const
/** "Auto" follows the project; the other two override it. */
export type AiProfileSetting = (typeof AI_PROFILE_SETTINGS)[number]
export type AiProfile = 'software' | 'general'

interface ProjectAiFields {
  path: string | null
  aiProfile?: AiProfileSetting
}

/**
 * Software when the project has a linked folder that is a Git repository,
 * otherwise general, unless the project setting chooses one.
 */
export function projectAiProfile(
  project: ProjectAiFields,
  gitState: { isGitRepo: boolean } | null
): AiProfile {
  if (project.aiProfile === 'software' || project.aiProfile === 'general') return project.aiProfile
  return projectFolder(project) !== null && gitState?.isGitRepo === true ? 'software' : 'general'
}
