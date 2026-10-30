import { renderHook, waitFor } from '@testing-library/react'
import type { OstlerAPI } from '@shared/ostler-api'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { installOstlerApi } from './ostler-api'
import { fakeSavedViews } from './saved-views'

export interface RenderPlanningWorkspaceOptions {
  projectId?: string
  /** API methods to replace, on top of the empty planning reads below. */
  api?: Partial<OstlerAPI>
  navigate?: (path: string) => void
}

/** Every read the workspace makes on load, answering with an empty project. */
export function emptyPlanningReads(): Partial<OstlerAPI> {
  return {
    getPlanningGoals: async () => ({ ok: true, value: [] }),
    getPlanningMilestones: async () => ({ ok: true, value: [] }),
    getPlanningWorkItems: async () => ({ ok: true, value: [] }),
    getPlanningDecisions: async () => ({ ok: true, value: [] }),
    getPlanningWipLimits: async () => ({ ok: true, value: {} }),
    getPlanningLatestStatusChanges: async () => ({ ok: true, value: {} }),
    listOpenBlockers: async () => ({ ok: true, value: [] }),
    getAIProjectBrief: async () => ({ ok: true, value: null }),
    listWorkItemsWithChangedSources: async () => ({ ok: true, value: [] }),
    countWorkItemAttachments: async () => ({ ok: true, value: {} }),
    getPlanningFields: async () => ({ ok: true, value: [] }),
    getPlanningWorkItemLinks: async () => ({ ok: true, value: [] }),
    getPlanningDescriptionVersions: async () => ({ ok: true, value: [] }),
    ...fakeSavedViews().api
  }
}

/**
 * Renders the real `usePlanningWorkspace` against a fake API and waits for its first load.
 *
 * Tests start from the hook's real shape, so a member added to the workspace is never missing
 * from a test's copy of it. Use `withWorkspace` to replace the few members a test controls.
 */
export async function renderPlanningWorkspace(
  options: RenderPlanningWorkspaceOptions = {}
): Promise<PlanningWorkspace> {
  const { projectId = 'p1', api = {}, navigate = () => {} } = options
  installOstlerApi({ ...emptyPlanningReads(), ...api })
  const { result } = renderHook(() => usePlanningWorkspace(projectId, navigate))
  await waitFor(() => {
    if (result.current.loading) throw new Error('planning workspace is still loading')
    if (result.current.error) throw new Error(result.current.error)
  })
  return result.current
}

/** A copy of a real workspace with a few members replaced. */
export function withWorkspace(
  base: PlanningWorkspace,
  overrides: Partial<PlanningWorkspace>
): PlanningWorkspace {
  return { ...base, ...overrides }
}
