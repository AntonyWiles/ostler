import { groupProjectsByArea, type ProjectArea } from '@shared/project-areas'
import { t } from '@shared/i18n'
import type { SelectOption } from '../../ui'

/**
 * A project picker's options (N5.1): the projects in the one grouping, each
 * under its area's heading ("No area" last). With no areas there are no
 * headings. Type-to-search in the native list still finds any project.
 */
export function projectSelectOptions(
  projects: readonly { id: string; name: string; areaId?: string | null }[],
  /** Optional so a screen outside the provider (or a test's stub) lists projects plainly. */
  areas: readonly ProjectArea[] = []
): SelectOption[] {
  return groupProjectsByArea(projects, areas).flatMap((group) =>
    group.projects.map((project) => ({
      value: project.id,
      label: project.name,
      ...(areas.length > 0 ? { group: group.area?.name ?? t('projects:areas.noArea') } : {})
    }))
  )
}
