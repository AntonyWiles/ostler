import { useEffect, useMemo, useState } from 'react'
import type { PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { compareBaseline, planItemDates } from '@shared/planning/baselines'
import { normalizeTimelineSettings } from '../timeline/timeline-settings'
import { milestoneBaselineWords } from './baseline-words'
import { useBaseline, useBaselines } from './useBaselines'

/**
 * What each milestone card says against a baseline (N7.4): the one chosen in
 * the Timeline's Compare with, or the newest when none is. Null for a
 * milestone with nothing to say (no baseline, or no target date).
 */
export function useMilestoneBaseline(
  projectId: string,
  workItems: readonly PlanningWorkItem[],
  milestones: readonly PlanningMilestone[]
): (milestone: PlanningMilestone) => string | null {
  const { baselines } = useBaselines(projectId)
  const [timelineChoice, setTimelineChoice] = useState<string | null>(null)
  useEffect(() => {
    setTimelineChoice(null)
    if (!projectId) return
    let active = true
    void window.ostlerAPI.getDefaultSavedView(projectId, 'timeline').then((result) => {
      if (active && result.ok && result.value)
        setTimelineChoice(normalizeTimelineSettings(result.value.config.options).compareWith)
    })
    return () => {
      active = false
    }
  }, [projectId])
  const chosen = baselines.find((entry) => entry.id === timelineChoice) ?? baselines[0] ?? null
  const record = useBaseline(projectId, chosen?.id ?? null)
  const changes = useMemo(() => {
    if (!record || !chosen) return null
    const comparison = compareBaseline(
      { ...record, name: chosen.name },
      planItemDates(
        workItems.filter((item) => !item.archivedAt && !item.deletedAt),
        milestones.filter((milestone) => milestone.status !== 'archived')
      )
    )
    return new Map(
      comparison.changes
        .filter((change) => change.kind === 'milestone')
        .map((change) => [change.itemId, change])
    )
  }, [record, chosen, workItems, milestones])
  return (milestone) =>
    changes && chosen && milestone.targetDate
      ? milestoneBaselineWords(changes.get(milestone.id), chosen.name)
      : null
}
