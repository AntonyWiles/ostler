/**
 * Project stages (N5.3, N38): where a project is in its life. Home's board of
 * projects shows them in four columns. On hold and Done projects step out of
 * the daily lists (Today, Upcoming, My work, the Inbox's blocker nudges)
 * through `isProjectInPlay`, the one rule every one of those lists uses.
 *
 * The stage is a second, softer rule beside `enabled`: a disabled project
 * leaves everything, whatever its stage. Reminders the person set, agent
 * questions and reviews, agents and auto-dispatch ignore the stage.
 */

export const PROJECT_STAGES = ['planning', 'active', 'on-hold', 'done'] as const

export type ProjectStage = (typeof PROJECT_STAGES)[number]

/** Every project starts here (config migration 28 writes it for existing ones). */
export const DEFAULT_PROJECT_STAGE: ProjectStage = 'active'

/**
 * The board's column names as the person renamed them, '' for the default
 * in the interface language. Display only: the stage ids never change.
 */
export type ProjectStageNames = Record<ProjectStage, string>

export const MAX_STAGE_NAME_LENGTH = 40

export const DEFAULT_PROJECT_STAGE_NAMES: ProjectStageNames = {
  planning: '',
  active: '',
  'on-hold': '',
  done: ''
}

export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === 'string' && (PROJECT_STAGES as readonly string[]).includes(value)
}

/** A stored stage, or Active for anything this version does not know. */
export function normalizeProjectStage(value: unknown): ProjectStage {
  return isProjectStage(value) ? value : DEFAULT_PROJECT_STAGE
}

/** A stage a caller asked to set: one of the four ids (throws otherwise). */
export function parseProjectStage(value: unknown): ProjectStage {
  if (!isProjectStage(value)) {
    throw new Error(`stage must be one of ${PROJECT_STAGES.join(', ')}`)
  }
  return value
}

/** Column names as saved: trimmed text up to 40 characters, '' for the default. */
export function normalizeProjectStageNames(raw: unknown): ProjectStageNames {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const names = { ...DEFAULT_PROJECT_STAGE_NAMES }
  for (const stage of PROJECT_STAGES) {
    const value = record[stage]
    names[stage] = typeof value === 'string' ? value.trim().slice(0, MAX_STAGE_NAME_LENGTH) : ''
  }
  return names
}

/**
 * Whether a stage is in play: Planning or Active. On hold and Done are at
 * rest. `isProjectInPlay` and the sidebar's quiet stage mark both read it.
 */
export function isStageInPlay(stage: unknown): boolean {
  const normalized = normalizeProjectStage(stage)
  return normalized === 'planning' || normalized === 'active'
}

/**
 * The one rule (N38): a project is in play when it is enabled and its stage
 * is Planning or Active. Home's Today, Upcoming and Needs you, My work, the
 * Inbox's blocker nudges and status update reminders keep only projects in play.
 */
export function isProjectInPlay(project: { enabled: boolean; stage?: unknown }): boolean {
  return project.enabled && isStageInPlay(project.stage)
}
