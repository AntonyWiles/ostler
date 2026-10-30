import { t } from '@shared/i18n'
import {
  DEFAULT_PROJECT_STAGE_NAMES,
  normalizeProjectStageNames,
  type ProjectStage,
  type ProjectStageNames
} from '@shared/project-stages'

const DEFAULT_KEYS: Record<ProjectStage, string> = {
  planning: 'projects:projectStages.planning',
  active: 'projects:projectStages.active',
  'on-hold': 'projects:projectStages.onHold',
  done: 'projects:projectStages.done'
}

/** A stage's default name in the interface language. */
export function defaultStageName(stage: ProjectStage): string {
  return t(DEFAULT_KEYS[stage])
}

/**
 * A stage's name everywhere it shows (N5.3): the board's column, Project
 * settings, the sidebar's mark and the card menus. The person's own name for
 * the column when they renamed it, else the default.
 */
export function projectStageName(
  stage: ProjectStage,
  names: ProjectStageNames | undefined = DEFAULT_PROJECT_STAGE_NAMES
): string {
  return normalizeProjectStageNames(names)[stage] || defaultStageName(stage)
}
