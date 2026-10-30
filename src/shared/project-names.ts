/**
 * Project names (R1.4): one rule for every path that proposes a name
 * (importing a project file, CSV or Trello into a new project, a template,
 * the sample project) and for the warning a duplicate typed by hand shows.
 * Names compare trimmed and case-insensitively. A duplicate is allowed:
 * the warning never blocks.
 */

export const MAX_PROJECT_NAME = 80

/** The key two names are compared by. */
export function projectNameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** Whether `name` is already a project's name; `exceptId` is the project being renamed. */
export function isProjectNameTaken(
  name: string,
  projects: readonly { id: string; name: string }[],
  exceptId?: string
): boolean {
  const key = projectNameKey(name)
  return (
    key.length > 0 &&
    projects.some((project) => project.id !== exceptId && projectNameKey(project.name) === key)
  )
}

/**
 * `name`, or the first free "Name (2)", "Name (3)"… when a project already
 * has it. A name that already ends in " (n)" counts on from its stem.
 */
export function freeProjectName(name: string, existingNames: readonly string[]): string {
  const base = name.trim().slice(0, MAX_PROJECT_NAME)
  const taken = new Set(existingNames.map(projectNameKey))
  if (!base || !taken.has(projectNameKey(base))) return base
  const stem = base.replace(/\s\(\d+\)$/, '')
  for (let index = 2; ; index++) {
    const suffix = ` (${index})`
    const candidate = `${stem.slice(0, MAX_PROJECT_NAME - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(projectNameKey(candidate))) return candidate
  }
}
