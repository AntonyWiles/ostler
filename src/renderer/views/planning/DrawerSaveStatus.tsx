import { Button } from '../../ui'
import type { DrawerSaveStatus as SaveStatusValue } from '../../hooks/planning/drawer-saves'
import { t } from '@shared/i18n'

/**
 * The drawer header's save state, quietly (D30): "Saving…", then "Saved". The
 * line is a polite live region that stays in the page, so a screen reader is
 * told about each change without an alert. A failed save says so, and Retry
 * sends it again; the field itself says what failed.
 */
export function DrawerSaveStatus({
  status,
  onRetry
}: {
  status: SaveStatusValue
  onRetry: () => void
}) {
  const text = {
    idle: '',
    saving: t('tasks:workItemDrawer.saving'),
    saved: t('tasks:workItemDrawer.saved'),
    failed: t('tasks:workItemDrawer.notSaved')
  }[status]
  return (
    <div className={`task-drawer__save task-drawer__save--${status}`}>
      <span role="status" aria-live="polite" className="task-drawer__save-text">
        {text}
      </span>
      {status === 'failed' && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          {t('tasks:workItemDrawer.retry')}
        </Button>
      )}
    </div>
  )
}
