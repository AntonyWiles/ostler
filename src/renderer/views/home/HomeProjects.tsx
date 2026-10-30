import { useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import type { ProjectArea } from '@shared/project-areas'
import { t } from '@shared/i18n'
import { InlineAlert, SegmentedControl, Skeleton } from '../../ui'
import { Columns3, Grid2x2 } from '../../ui/icons'
import { PortfolioCards } from '../planning/PortfolioView'
import { usePortfolioSummary } from '../planning/usePortfolioSummary'
import { useProjectStageNames } from '../../hooks/useProjectStageNames'
import { ProjectStageBoard } from './ProjectStageBoard'

export type ProjectsLayout = 'cards' | 'board'

/** Where Home remembers Cards or Board (N5.3): a view choice, not data. */
export const PROJECTS_LAYOUT_KEY = 'ostler.home.projectsLayout'

function readLayout(): ProjectsLayout {
  try {
    return localStorage.getItem(PROJECTS_LAYOUT_KEY) === 'board' ? 'board' : 'cards'
  } catch {
    return 'cards'
  }
}

/** Cards or Board, remembered in local storage. */
export function useProjectsLayout(): [ProjectsLayout, (layout: ProjectsLayout) => void] {
  const [layout, setLayout] = useState<ProjectsLayout>(readLayout)
  const choose = (next: ProjectsLayout) => {
    setLayout(next)
    try {
      localStorage.setItem(PROJECTS_LAYOUT_KEY, next)
    } catch {
      // Storage unavailable: the choice lasts until Home closes.
    }
  }
  return [layout, choose]
}

export function ProjectsLayoutSwitch({
  value,
  onChange
}: {
  value: ProjectsLayout
  onChange: (layout: ProjectsLayout) => void
}) {
  return (
    <SegmentedControl
      size="sm"
      label={t('projects:projectStages.showAs')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'cards', label: t('projects:projectStages.cards'), icon: Grid2x2 },
        { value: 'board', label: t('projects:projectStages.board'), icon: Columns3 }
      ]}
    />
  )
}

/**
 * Home's projects as cards or as the board of projects (N5.3). Both read one
 * summary, loaded once for every project.
 */
export function HomeProjects({
  projects,
  areas,
  layout
}: {
  projects: RendererProject[]
  areas: ProjectArea[]
  layout: ProjectsLayout
}) {
  const { summary, error } = usePortfolioSummary(projects)
  const stageNames = useProjectStageNames()
  if (error) return <InlineAlert tone="danger">{error}</InlineAlert>
  if (!summary) return <Skeleton lines={3} />
  if (layout === 'cards')
    return <PortfolioCards projects={projects} areas={areas} summary={summary} />
  return (
    <ProjectStageBoard
      projects={projects}
      areas={areas}
      summary={summary}
      names={stageNames.names}
      onRename={stageNames.save}
    />
  )
}
