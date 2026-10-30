import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { useAnnounce, useToast } from '../../../ui'

/** What scoring needs from the workspace: the one inline update every edit uses. */
export interface ScoreIdeaWorkspace {
  updateWorkItemInline(
    item: PlanningWorkItem,
    patch: { impact?: number | null; effort?: number | null }
  ): Promise<boolean>
}

export interface IdeaScores {
  impact: number | null
  effort: number | null
}

/**
 * Sets an idea's two scores at once (N1.1b): the grid's drops and arrow keys.
 * One update through the same service as every edit, so activity, the API
 * and undo see it; the toast's undo puts both old scores back.
 */
export function useScoreIdea(ws: ScoreIdeaWorkspace) {
  const { toastUndo } = useToast()
  const announce = useAnnounce()
  return async (item: PlanningWorkItem, next: IdeaScores): Promise<boolean> => {
    const before: IdeaScores = { impact: item.impact ?? null, effort: item.effort ?? null }
    if (before.impact === next.impact && before.effort === next.effort) return false
    const saved = await ws.updateWorkItemInline(item, next)
    if (!saved) return false
    const message =
      next.impact === null && next.effort === null
        ? t('tasks:ideas.unscored', { title: item.title })
        : t('tasks:ideas.scored', {
            title: item.title,
            impact: next.impact ?? '–',
            effort: next.effort ?? '–'
          })
    announce(message)
    toastUndo(message, () => ws.updateWorkItemInline({ ...item, ...next }, before))
    return true
  }
}
