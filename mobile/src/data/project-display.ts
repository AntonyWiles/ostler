import { paletteColorFor } from '../../../src/shared/project-colors'
import { t } from '@shared/i18n/index'
import { projectColorOf, projectNameOf } from '../sync/project-names'
import type { ProjectSummary } from './queries'

/** The name to show for a project: its row, else the name kept when it was joined, else a stand-in. */
export function projectName(project: Pick<ProjectSummary, 'id' | 'name'>): string {
  return project.name ?? projectNameOf(project.id) ?? t('mobile:projects.unnamed')
}

/** The colour to show: its row, else the one kept at join, else the palette colour its id maps to. */
export function projectColor(project: Pick<ProjectSummary, 'id' | 'color'>): string {
  return project.color ?? projectColorOf(project.id) ?? paletteColorFor(project.id)
}
