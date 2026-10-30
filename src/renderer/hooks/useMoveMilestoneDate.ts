import { useCallback } from 'react'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import { useToast } from '../ui'
import { t } from '@shared/i18n'

/** What moving a milestone needs to know about it. */
export interface MovableMilestone {
  id: string
  name: string
  targetDate: string
}

/**
 * A milestone's target date moved on a timeline (N5.4): the normal milestone
 * update (`updatePlanningMilestone`, as editing the milestone saves it), then
 * an undo toast that puts the old date back. `onChanged` runs after the save
 * and after the undo, so the view reads again. Returns whether it saved.
 */
export function useMoveMilestoneDate(
  onChanged: () => void
): (milestone: MovableMilestone, days: number) => Promise<boolean> {
  const { toast, toastUndo } = useToast()
  return useCallback(
    async (milestone, days) => {
      if (days === 0) return false
      const previous = milestone.targetDate
      const next = shiftIsoDate(previous, days)
      const result = await window.ostlerAPI.updatePlanningMilestone(milestone.id, {
        targetDate: next
      })
      if (!result.ok) {
        toast({
          title: t('views:timelineOverview.couldntMoveMilestone', { name: milestone.name }),
          body: result.error,
          tone: 'danger'
        })
        return false
      }
      onChanged()
      toastUndo(
        t('views:timelineOverview.milestoneNowDue', {
          name: milestone.name,
          day: formatIsoDate(next, { weekday: 'short', day: 'numeric', month: 'short' })
        }),
        async () => {
          const back = await window.ostlerAPI.updatePlanningMilestone(milestone.id, {
            targetDate: previous
          })
          if (!back.ok)
            toast({
              title: t('views:timelineOverview.couldntMoveMilestone', { name: milestone.name }),
              body: back.error,
              tone: 'danger'
            })
          onChanged()
        }
      )
      return true
    },
    [onChanged, toast, toastUndo]
  )
}
