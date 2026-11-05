import { useState } from 'react'
import { DEFAULT_PROJECT_VIEW, type ProjectViewId } from '../navigation/registry'
import { sessionOwnsTask } from '@shared/work-item-status'
import { usePlanningRunner } from './planning/usePlanningRunner'
import { usePlanningRecords } from './planning/usePlanningRecords'
import { usePlanningSelectors } from './planning/usePlanningSelectors'
import { useWorkItemDrawer } from './planning/useWorkItemDrawer'
import { usePlanningCreateForm } from './planning/usePlanningCreateForm'
import { usePlanningAiDrafts } from './planning/usePlanningAiDrafts'
import { useWorkItemActions } from './planning/useWorkItemActions'
import { useBoardInteraction } from './planning/useBoardInteraction'
import { useAgentQueue } from './planning/useAgentQueue'
import { useAutoDispatchSettings } from './planning/useAutoDispatchSettings'
import { useGoalsMilestones } from './planning/useGoalsMilestones'
import { useDecisions } from './planning/useDecisions'
import { useIterations } from './planning/useIterations'
import { useSubprojects } from './planning/useSubprojects'
import { useTaskLinkActions } from './planning/useTaskLinkActions'
import { useUnseenTasks } from './planning/useUnseenTasks'

export { COLUMNS } from './planning/columns'
export type { CreateMode } from './planning/usePlanningCreateForm'
export { sessionOwnsTask }

export function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('diff --git') || line.startsWith('index ')) return 'meta'
  return 'context'
}

/** A project view, from the navigation registry. */
export type WorkspaceView = ProjectViewId

/**
 * Who owns the current view. The project workspace passes the route's view
 * and a setter that navigates, so the route is the one source of truth; tests
 * and other callers leave it out and get local state.
 */
export interface WorkspaceViewControl {
  view: WorkspaceView
  setView: (view: WorkspaceView) => void
  /** The records' slow safety poll; on unless said otherwise. The workspace runs it only with agents on (P9.1). */
  safetyPoll?: boolean
}

/**
 * Everything a planning view reads and does, as one object (`ws`).
 *
 * A facade: each domain lives in its own hook under `./planning/` (its
 * README says who owns what and what each may depend on), and this composes
 * them in dependency order. Their effects run in that same order. Each hook
 * keeps the setters its siblings need under `internal`, which is left out
 * here, so views see exactly the members they always have.
 */
export function usePlanningWorkspace(
  projectId: string,
  navigate: (path: string) => void,
  viewControl?: WorkspaceViewControl
) {
  const [localView, setLocalView] = useState<WorkspaceView>(DEFAULT_PROJECT_VIEW)
  const workspaceView = viewControl?.view ?? localView
  const setWorkspaceView = viewControl?.setView ?? setLocalView

  const runner = usePlanningRunner()
  const records = usePlanningRecords(projectId, runner.setError, {
    safetyPoll: viewControl?.safetyPoll
  })
  const selectors = usePlanningSelectors(records)
  const drawer = useWorkItemDrawer(projectId, runner, records, selectors)
  const createForm = usePlanningCreateForm()
  const aiDrafts = usePlanningAiDrafts(
    projectId,
    runner,
    records,
    createForm,
    drawer,
    setWorkspaceView
  )
  const subprojects = useSubprojects(projectId, workspaceView)
  const subprojectId = subprojects.subprojectScope?.id ?? null
  const actions = useWorkItemActions(
    projectId,
    runner,
    records,
    selectors,
    drawer,
    createForm,
    aiDrafts,
    subprojectId
  )
  const taskLinks = useTaskLinkActions({
    setError: runner.setError,
    loadPlanning: records.loadPlanning,
    openWorkItem: drawer.openWorkItem,
    closeDrawerIf: (workItemId) => {
      if (drawer.selectedWorkItemId === workItemId) drawer.closeWorkItem()
    }
  })
  const board = useBoardInteraction(projectId, runner, records, selectors, actions, subprojectId)
  const agentQueue = useAgentQueue(projectId, navigate, runner, records, selectors, drawer)
  const autoDispatch = useAutoDispatchSettings(projectId, runner, records)
  const goalsMilestones = useGoalsMilestones(runner, records)
  const decisions = useDecisions(runner, records, createForm)
  const iterations = useIterations(projectId, runner, records)
  const unseen = useUnseenTasks(projectId, records.workItems, drawer.selectedWorkItemId)

  return {
    projectId,
    workspaceView,
    setWorkspaceView,
    ...withoutInternal(runner),
    ...withoutInternal(records),
    ...selectors,
    ...drawer,
    ...withoutInternal(createForm),
    ...withoutInternal(aiDrafts),
    ...withoutInternal(actions),
    ...taskLinks,
    ...board,
    ...agentQueue,
    ...autoDispatch,
    ...goalsMilestones,
    ...decisions,
    ...iterations,
    ...subprojects,
    ...unseen
  }
}

/** A hook's members without the setters it shares only with sibling hooks. */
function withoutInternal<T extends { internal: unknown }>(hook: T): Omit<T, 'internal'> {
  const members: Partial<T> = { ...hook }
  delete members.internal
  return members as Omit<T, 'internal'>
}

export type PlanningWorkspace = ReturnType<typeof usePlanningWorkspace>
