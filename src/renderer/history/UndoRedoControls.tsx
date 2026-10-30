import { t } from '@shared/i18n'
import { IconButton } from '../ui'
import { History, Redo2, Undo2 } from '../ui/icons'
import { shortcut } from '../navigation/shortcuts'
import { useChangeHistory } from './ChangeHistoryProvider'
import { describeStep } from './describe-change'
import { cx } from '../ui/cx'
import './history.css'

/**
 * Undo, Redo and the undo history, always in reach: in the title bar, or at
 * the start of the status bar when Windows draws the title bar. Each button's
 * tooltip names the step it would act on.
 */
export function UndoRedoControls({ className }: { className?: string }) {
  const history = useChangeHistory()
  const { undo, redo } = history.head
  return (
    <div
      className={cx('undo-redo-controls', className)}
      role="group"
      aria-label={t('views:undoHistory.title')}
    >
      <IconButton
        icon={Undo2}
        size="sm"
        label={
          undo
            ? t('views:undoHistory.toolbar.undoStep', { step: describeStep(undo) })
            : t('views:undoHistory.toolbar.nothingToUndo')
        }
        shortcut={shortcut('undo').keys}
        disabled={!undo}
        onClick={() => void history.undo()}
      />
      <IconButton
        icon={Redo2}
        size="sm"
        label={
          redo
            ? t('views:undoHistory.toolbar.redoStep', { step: describeStep(redo) })
            : t('views:undoHistory.toolbar.nothingToRedo')
        }
        shortcut={shortcut('redo').keys}
        disabled={!redo}
        onClick={() => void history.redo()}
      />
      <IconButton
        icon={History}
        size="sm"
        label={t('views:undoHistory.toolbar.history')}
        shortcut={shortcut('undo-history').keys}
        onClick={history.openHistory}
      />
    </div>
  )
}
