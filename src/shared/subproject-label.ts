import { t } from '@shared/i18n'

/**
 * The name of a task's place wherever work from many projects is shown: the
 * project's name, then its sub-project's (shown as a workstream) after the
 * locale's joiner, "Project › Workstream". A task in no sub-project has just
 * the project's name. This is the one place that label is built; an archived
 * sub-project keeps its name.
 */
export function projectAndSubprojectName(
  projectName: string,
  subprojectName: string | null | undefined
): string {
  if (!subprojectName) return projectName
  return t('projects:subprojects.pathLabel', { project: projectName, subproject: subprojectName })
}
