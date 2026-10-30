import { freeProjectName, isProjectNameTaken } from '@shared/project-names'
import { t } from '@shared/i18n'

type Named = { id: string; name: string }

/**
 * A proposed name, free of every project's (R1.4): `name`, or "Name (2)"
 * when a project already has it. The one rule, from `@shared/project-names`.
 */
export function proposeProjectName(name: string, projects: readonly Named[]): string {
  return freeProjectName(
    name,
    projects.map((project) => project.name)
  )
}

/**
 * What a project-name field says under it: why a proposed name was changed
 * ("Pomodoro Desk" is taken, so "Pomodoro Desk (2)"), or that a name typed
 * by hand is already in use. Neither blocks: two projects may share a name.
 */
export function projectNameHint(
  name: string,
  projects: readonly Named[],
  options: { proposedFrom?: string | null; exceptId?: string } = {}
): string | undefined {
  const from = options.proposedFrom?.trim()
  if (from && name.trim() !== from && name === proposeProjectName(from, projects))
    return t('projects:projectNames.proposedFree', { name: from })
  if (isProjectNameTaken(name, projects, options.exceptId))
    return t('projects:projectNames.alreadyInUse')
  return undefined
}
