import type { HiddenTasks } from '../../hooks/useHiddenTasks'
import { Button } from '../../ui'
import { t } from '@shared/i18n'

/**
 * The Board's and the List's note about hidden tasks (N1.1a): "12 hidden
 * until later · 3 in Someday", with a link that shows them in place, greyed,
 * or hides them again. Nothing when no task the filters match is hidden.
 */
export function HiddenTasksNote({ hidden }: { hidden: HiddenTasks }) {
  if (hidden.later === 0 && hidden.someday === 0) return null
  const parts = [
    ...(hidden.later > 0 ? [t('tasks:someday.hiddenLater', { count: hidden.later })] : []),
    ...(hidden.someday > 0 ? [t('tasks:someday.inSomedayCount', { count: hidden.someday })] : [])
  ]
  return (
    <span className="task-toolbar__hidden">
      <span className="task-toolbar__count">{parts.join(' · ')}</span>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={hidden.showHidden}
        onClick={() => hidden.setShowHidden(!hidden.showHidden)}
      >
        {hidden.showHidden ? t('tasks:someday.hideHidden') : t('tasks:someday.showHidden')}
      </Button>
    </span>
  )
}
