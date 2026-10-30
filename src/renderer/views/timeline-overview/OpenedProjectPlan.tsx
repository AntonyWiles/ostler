import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlanningWorkspace, type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'

/**
 * An opened row's project (N5.4): the project's own planning workspace, the
 * one its Timeline uses, so a task moved here goes through the same
 * `rescheduleWorkItem`, rules, dependents offer and undo. It reads the project
 * once when the row opens (no safety poll) and draws nothing itself: it hands
 * the workspace to the Timeline across projects, and says when what it holds
 * changed.
 */
export function OpenedProjectPlan({
  projectId,
  workspaces,
  onChange
}: {
  projectId: string
  /** Where the latest workspace of each opened project is kept. */
  workspaces: Map<string, PlanningWorkspace>
  onChange: () => void
}) {
  const navigate = useNavigate()
  const ws = usePlanningWorkspace(projectId, navigate, {
    view: 'timeline',
    setView: () => {},
    safetyPoll: false
  })
  workspaces.set(projectId, ws)
  const changed = useRef(onChange)
  changed.current = onChange
  useEffect(() => {
    changed.current()
  }, [ws.workItems, ws.milestones, ws.loading, ws.projectedStatus])
  useEffect(
    () => () => {
      workspaces.delete(projectId)
      changed.current()
    },
    [projectId, workspaces]
  )
  return null
}
