import { t } from '@shared/i18n'
import { Check, Clock, Icon, TriangleAlert } from '../ui/icons'
import { useCalmStatus, useSaveStatus, type SaveStatus } from '../shell/save-status'

const SAVE_STATE_KEY: Record<SaveStatus, string> = {
  saved: 'views:planView.whiteboards.saveState.saved',
  saving: 'views:planView.whiteboards.saveState.saving',
  unsaved: 'views:planView.whiteboards.saveState.unsaved',
  failed: 'views:planView.whiteboards.saveState.failed'
}

const SAVE_ICON = { saved: Check, saving: Clock, unsaved: Clock, failed: TriangleAlert }

/**
 * The status bar's quiet word on the open document's changes (MOP-29):
 * nothing when none is open; "Saving" only once a save has taken a moment.
 */
export function StatusBarSave() {
  const status = useSaveStatus()
  const shown = useCalmStatus(status, (value) => value === 'saving' || value === 'unsaved')
  if (!status || !shown) return null
  return (
    <span className="statusbar-item statusbar-save" data-state={status} data-shown={shown}>
      <Icon icon={SAVE_ICON[shown]} />
      {t(SAVE_STATE_KEY[shown])}
    </span>
  )
}
