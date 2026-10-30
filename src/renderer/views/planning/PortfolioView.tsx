import type { RendererProject } from '@shared/ostler-api'
import { useFeatures } from '../../navigation/features'
import { useNavigate } from 'react-router-dom'
import { projectHealth } from '@shared/planning/health'
import { projectOpenPath } from '../../navigation/paths'
import { Card, InlineAlert, ProgressBar, Skeleton } from '../../ui'
import type { PortfolioSummary } from './portfolio-aggregation'
import { usePortfolioSummary } from './usePortfolioSummary'
import { HealthBadge } from './HealthBadge'
import { StatusUpdateChip } from '../../components/status-updates/StatusUpdateChip'
import { useLatestStatusUpdates } from '../../components/status-updates/useStatusUpdates'
import { useGoalGlances } from './goal-measure/useGoalCheckIns'
import { measureShort } from '@shared/goal-measures'
import './goal-measure/GoalMeasure.css'
import './PortfolioView.css'
import { t } from '@shared/i18n'
import { groupProjectsByArea, type ProjectArea } from '@shared/project-areas'
import { ProjectMark } from '../../components/ProjectMark'

/**
 * Home's project cards: the colour dot (or the project's icon), health,
 * progress across the project's tasks, and the counts in words. A card opens
 * the project. With areas (N5.1) the cards group under area headings, in the
 * sidebar's grouping.
 */
export function PortfolioView({
  projects,
  areas = []
}: {
  projects: RendererProject[]
  areas?: ProjectArea[]
}) {
  const { summary, error } = usePortfolioSummary(projects)
  if (error) return <InlineAlert tone="danger">{error}</InlineAlert>
  if (!summary) return <Skeleton lines={3} />
  return <PortfolioCards projects={projects} areas={areas} summary={summary} />
}

/** The cards themselves, from a summary already loaded (Home shares it with the board). */
export function PortfolioCards({
  projects,
  areas,
  summary
}: {
  projects: RendererProject[]
  areas: ProjectArea[]
  summary: PortfolioSummary
}) {
  const navigate = useNavigate()
  const features = useFeatures()
  const latestUpdates = useLatestStatusUpdates()
  // Active goals with a number (N5.6a): "Members: 142 of 200".
  const goalGlances = useGoalGlances()
  const byId = new Map(projects.map((project) => [project.id, project]))
  const grouped = areas.length > 0
  const CardHeading = grouped ? 'h4' : 'h3'
  const groups = groupProjectsByArea(
    summary.projects.map((entry) => ({ ...entry, areaId: byId.get(entry.projectId)?.areaId })),
    areas
  ).filter((group) => group.projects.length > 0)
  const cards = (list: PortfolioSummary['projects'], label: string) => (
    <ul className="portfolio" aria-label={label}>
      {list.map((project) => {
        const health = projectHealth({ blockedCount: project.blockedCount, risks: project.risks })
        const open = project.taskCount - project.doneCount
        return (
          <li key={project.projectId}>
            <Card
              as="article"
              interactive
              aria-label={project.projectName}
              className="portfolio__card"
              onClick={() =>
                navigate(projectOpenPath(project.projectId, byId.get(project.projectId)?.stage))
              }
            >
              <div className="portfolio__head">
                <ProjectMark project={byId.get(project.projectId)} className="portfolio__dot" />
                <CardHeading className="portfolio__name" title={project.projectName}>
                  {project.projectName}
                </CardHeading>
                <HealthBadge verdict={health} />
              </div>
              <StatusUpdateChip
                latest={latestUpdates[project.projectId] ?? null}
                reminder={byId.get(project.projectId)?.updateReminder}
              />
              {(goalGlances[project.projectId]?.length ?? 0) > 0 && (
                <ul className="portfolio__goals" aria-label={t('tasks:goalMeasure.glanceLabel')}>
                  {goalGlances[project.projectId]!.slice(0, 3).map((glance) => (
                    <li key={glance.goalId}>
                      {t('tasks:goalMeasure.glance', {
                        title: glance.title,
                        value: measureShort(glance.progress.latest, glance.measure)
                      })}
                    </li>
                  ))}
                </ul>
              )}
              <ProgressBar
                label={t('tasks:portfolioView.progress', { projectName: project.projectName })}
                value={project.doneCount}
                max={Math.max(project.taskCount, 1)}
                valueText={t('tasks:portfolioView.tasksDone', {
                  count: project.taskCount,
                  doneCount: project.doneCount
                })}
                tone={health.health === 'on-track' ? 'success' : 'accent'}
              />
              <p className="portfolio__counts">
                {[
                  t('tasks:portfolioView.openTasksDone', {
                    count: open,
                    doneCount: project.doneCount
                  }),
                  project.blockedCount > 0 &&
                    t('tasks:portfolioView.blocked', { count: project.blockedCount }),
                  features.agents &&
                    t('tasks:portfolioView.agentsRunning', { count: project.activeSessions })
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {project.risks.length > 0 && (
                <ul className="portfolio__risks">
                  {project.risks.map((risk) => (
                    <li key={risk.code}>
                      <strong>{risk.label}.</strong> {risk.evidence}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
  if (!grouped) return cards(summary.projects, t('tasks:portfolioView.projects'))
  return (
    <div className="portfolio-areas">
      {groups.map((group) => {
        const name = group.area?.name ?? t('projects:areas.noArea')
        return (
          <section key={group.area?.id ?? ''} className="portfolio-area">
            <h3 className="portfolio-area__title">{name}</h3>
            {cards(group.projects, name)}
          </section>
        )
      })}
    </div>
  )
}
