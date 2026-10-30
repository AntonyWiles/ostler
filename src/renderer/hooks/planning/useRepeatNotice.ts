import type { PlanningWorkItem } from '@shared/ostler-api'
import { useToast } from '../../ui'
import { t } from '@shared/i18n'

/**
 * After a task reached Done (P5.6): a repeating one has a new occurrence, so
 * the project's tasks are read again and a toast says so. If the next one
 * could not be made, the task is still done and the toast says why.
 */
export function useRepeatNotice(loadPlanning: () => Promise<unknown>) {
  const { toast } = useToast()
  return (item: PlanningWorkItem) => {
    if (item.repeatError) {
      toast({
        title: t('tasks:useRepeatNotice.done', { itemTitle: item.title }),
        body: item.repeatError,
        tone: 'danger'
      })
    } else if (item.repeatedAs) {
      toast({
        title: t('tasks:useRepeatNotice.nextOccurrenceAdded'),
        body: t('tasks:useRepeatNotice.repeatsSoNextOne', { itemTitle: item.title })
      })
      void loadPlanning()
    }
  }
}
