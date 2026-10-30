import type { PlanningWorkItem } from '@shared/ostler-api'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { useToday } from '../../hooks/useToday'
import {
  blockLabel,
  blockTimeRange,
  useTimeBlockActions,
  useTimeBlocks
} from '../../hooks/useTimeBlocks'
import { Button, IconButton } from '../../ui'
import { CalendarClock, X } from '../../ui/icons'
import { useTaskPart } from '../../views/planning/TaskParts'
import './time-blocks.css'

/** How far ahead the drawer lists a task's blocks. */
const COMING_DAYS = 120

/**
 * A task's coming time blocks (N3.4a) in the drawer's dates area: today's
 * and later, in time order, each with Remove (undo in its toast), and
 * Block time…, which opens the dialog.
 */
export function TaskTimeBlocks({
  item,
  onBlockTime
}: {
  item: PlanningWorkItem
  onBlockTime: () => void
}) {
  const today = useToday()
  const live = !item.archivedAt && !item.deletedAt
  const { blocks, reload } = useTimeBlocks(today, shiftIsoDate(today, COMING_DAYS), {
    projectId: item.projectId,
    workItemId: item.id,
    enabled: live
  })
  const actions = useTimeBlockActions(reload)
  // An optional part of the drawer: shown once a block is planned, or added.
  const part = useTaskPart(live ? 'timeBlocks' : null, blocks.length > 0, onBlockTime)
  if (!live || !part.shown) return null
  return (
    <div className="task-drawer__field-wide time-block-task" {...part.anchor}>
      <div className="time-block-task__head">
        <span className="ui-field__label">{t('views:timeBlocks.coming')}</span>
        <Button size="sm" variant="ghost" icon={CalendarClock} onClick={onBlockTime}>
          {t('views:timeBlocks.menu')}
        </Button>
      </div>
      {blocks.length > 0 && (
        <ul className="time-block-list">
          {blocks.map((block) => (
            <li key={block.id} className="time-block-task__row">
              <span className="time-block-times" aria-label={blockLabel(block)}>
                {formatIsoDate(block.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                {', '}
                {blockTimeRange(block)}
              </span>
              <IconButton
                size="sm"
                icon={X}
                label={t('views:timeBlocks.removeOne', { label: blockLabel(block) })}
                onClick={() => void actions.remove(block)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
