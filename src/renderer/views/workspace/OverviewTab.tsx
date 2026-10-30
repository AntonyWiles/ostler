import { Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GitProjectState } from '@shared/ostler-api'
import type { ProjectViewProps } from '../../navigation/view-props'
import { projectPath, settingsPath } from '../../navigation/paths'
import { OverviewStats } from '../planning/OverviewStats'
import { OverviewShortcuts } from '../../pins/OverviewShortcuts'
import { StatusUpdateSection } from '../../components/status-updates/StatusUpdateSection'
import { OverviewNeedsYou, OverviewWork } from '../planning/OverviewWork'
import { MilestonesGlance } from '../planning/MilestonesGlance'
import { RecentActivity } from '../planning/RecentActivity'
import { AiSummarySection } from '../planning/AiSummarySection'
import { ProjectBriefCard } from '../project-detail/ProjectBriefCard'
import { BudgetCard } from '../../costs/BudgetCard'
import { FolderOverview } from '../project-detail/FolderOverview'
import { AutomationPromptCard } from '../project-detail/AutomationPromptCard'
import { useOstler } from '../../context/OstlerContext'
import { InlineAlert, SegmentedControl, Section, Skeleton, Spinner } from '../../ui'
import { lazyNamed } from '../../lib/lazy-named'
import { NewWorkstreamButton, OverviewWorkstreams, WorkstreamHeader } from './OverviewWorkstreams'
import { ProjectSettingsDialog } from '../../components/ProjectSettingsDialog'
import '../planning/Overview.css'
import { t } from '@shared/i18n'

// The reports and the AI notes chat load after the rest of the Overview
// (P9.1): the charts and the Markdown renderer are most of its weight.
const OverviewInsights = lazyNamed(
  () => import('../planning/insights/OverviewInsights'),
  'OverviewInsights'
)
const ProjectNotesChat = lazyNamed(
  () => import('../../components/ProjectNotesChat'),
  'ProjectNotesChat'
)

type OverviewPane = 'summary' | 'insights' | 'code'

const PANE_KEY = 'ostler.overviewPane'

/** A per-viewer convenience in localStorage; without storage it is simply forgotten. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // See readStored.
  }
}

/** A tip someone can put away for good: remembered per viewer. */
function useDismissedTip(key: string): { dismissed: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => readStored(key) === 'true')
  return {
    dismissed,
    dismiss: () => {
      setDismissed(true)
      writeStored(key, 'true')
    }
  }
}

/**
 * Overview, a calm dashboard in panes, so it fits on a screen rather than
 * running on. Summary: its Shortcuts (N5.2a), the status, Needs you, four
 * numbers, the workstreams, then In progress, Up next and Recent activity
 * beside milestones at a glance, the budget, the brief, the AI summary (AI on)
 * and the notes chat. Setup tips come last: they are offers, not news.
 * Insights: the charts (P6.2). Code, with a folder linked or agents on: the
 * folder's drift and Git status and the agent task prompt. The pane last
 * chosen is remembered per viewer.
 */
export function OverviewTab({ project, ws, features }: ProjectViewProps) {
  const navigate = useNavigate()
  const { refreshProjects } = useOstler()
  const [configuring, setConfiguring] = useState(false)
  const aiTip = useDismissedTip('ostler.tip.setUpAi.dismissed')
  const folderTip = useDismissedTip('ostler.tip.linkFolder.dismissed')
  const gitState = useGitState(project.id, features.hasFolder)
  const panes: OverviewPane[] =
    features.hasFolder || features.agents
      ? ['summary', 'insights', 'code']
      : ['summary', 'insights']
  const [pane, setPane] = useState<OverviewPane>(() => {
    const stored = readStored(PANE_KEY)
    return stored === 'insights' || stored === 'code' ? stored : 'summary'
  })
  // Code, remembered from a project that had it, is Summary here.
  const shownPane = panes.includes(pane) ? pane : 'summary'
  const choosePane = (next: OverviewPane) => {
    setPane(next)
    writeStored(PANE_KEY, next)
  }

  // Until the project's tasks first arrive, its numbers would read "0 Open".
  // A load that failed says so above the view instead.
  if (!ws.loaded && !ws.error) {
    return (
      <div className="ostler-workspace-loading">
        <Spinner label={t('navigation:projectWorkspace.loading')} />
      </div>
    )
  }

  return (
    <div className="overview">
      {/*
       * Panes, so no one of them runs on: the summary people come for, the
       * charts (Insights) and, with a folder linked or agents on, Code.
       */}
      <div className="overview__panes">
        <SegmentedControl
          label={t('navigation:overviewTab.show')}
          size="sm"
          value={shownPane}
          onChange={choosePane}
          options={panes.map((value) => ({
            value,
            label: t(`navigation:overviewTab.panes.${value}`)
          }))}
        />
      </div>

      {shownPane === 'summary' && (
        <>
          {ws.subprojectScope && (
            <WorkstreamHeader project={project} ws={ws} subproject={ws.subprojectScope} />
          )}
          <OverviewShortcuts project={project} />
          {/* Status updates are the whole project's: a workstream's Overview shows its own
              status in its header, and the updates stay on the project's Overview. */}
          {!ws.subprojectScope && <StatusUpdateSection project={project} />}
          <OverviewNeedsYou ws={ws} />
          <OverviewStats ws={ws} />
          {!ws.subprojectScope && <OverviewWorkstreams project={project} ws={ws} />}

          <div className="overview__columns">
            <div className="overview__column">
              <OverviewWork ws={ws} />
              <RecentActivity ws={ws} />
            </div>
            <div className="overview__column">
              <MilestonesGlance
                ws={ws}
                onOpenMilestones={() => navigate(projectPath(project.id, 'milestones'))}
              />
              {!ws.subprojectScope && <NewWorkstreamButton project={project} ws={ws} />}
              <BudgetCard projectId={project.id} />
              <ProjectBriefCard projectId={project.id} />
              {features.ai && <AiSummarySection ws={ws} />}
              {features.ai && (
                <Section title={t('navigation:overviewTab.notesChat')}>
                  <Suspense fallback={<Skeleton lines={3} />}>
                    <ProjectNotesChat
                      projectId={project.id}
                      projectName={project.name}
                      onStatusSaved={() => void refreshProjects()}
                    />
                  </Suspense>
                </Section>
              )}
            </div>
          </div>

          <div className="overview__tips">
            {!features.hasFolder && !folderTip.dismissed && (
              <InlineAlert
                tone="info"
                title={t('navigation:overviewTab.softwareProject')}
                action={{
                  label: t('navigation:overviewTab.linkFolder'),
                  onClick: () => setConfiguring(true)
                }}
                onDismiss={folderTip.dismiss}
              >
                {features.agents
                  ? t('navigation:overviewTab.linkFolderBrowseFiles')
                  : t('navigation:overviewTab.linkFolderBrowseFiles2')}
              </InlineAlert>
            )}
            {!features.ai && !aiTip.dismissed && (
              <InlineAlert
                tone="info"
                title={t('navigation:overviewTab.canHelpPlan')}
                action={{
                  label: t('navigation:overviewTab.setUpAi'),
                  onClick: () => navigate(settingsPath('ai'))
                }}
                onDismiss={aiTip.dismiss}
              >
                {t('navigation:overviewTab.canSuggestTasksBreak')}
              </InlineAlert>
            )}
          </div>
        </>
      )}

      {shownPane === 'insights' && (
        <Suspense fallback={<Skeleton lines={4} />}>
          <OverviewInsights
            ws={ws}
            onOpenMilestones={() => navigate(projectPath(project.id, 'milestones'))}
          />
        </Suspense>
      )}

      {shownPane === 'code' && (
        <>
          {features.hasFolder && (
            <FolderOverview
              id={project.id}
              gitState={gitState}
              recentCommits={gitState?.recentCommits ?? []}
            />
          )}
          {features.agents && <AutomationPromptCard project={project} />}
        </>
      )}
      {configuring && (
        <ProjectSettingsDialog
          project={project}
          section="folder"
          onClose={() => setConfiguring(false)}
          onChanged={() => void refreshProjects()}
        />
      )}
    </div>
  )
}

/** The Git state while a folder is linked, kept current by pushes. */
function useGitState(projectId: string, hasFolder: boolean): GitProjectState | null {
  const [gitState, setGitState] = useState<GitProjectState | null>(null)

  useEffect(() => {
    let active = true
    setGitState(null)
    const loadGit = async () => {
      if (!hasFolder) return
      const result = await window.ostlerAPI.getGitState(projectId)
      if (active && result.ok) setGitState(result.value)
    }
    void loadGit()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'git') void loadGit()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [projectId, hasFolder])

  return gitState
}
