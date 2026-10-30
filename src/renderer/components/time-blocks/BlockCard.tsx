import type { TimeBlock } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { useProjectList } from '../../context/OstlerContext'
import { useTimer } from '../../time/TimerProvider'
import { useFocus } from '../../time/FocusProvider'
import { blockTimeRange } from '../../hooks/useTimeBlocks'
import { Button, Popover, StatusBadge } from '../../ui'
import { CalendarClock, PanelRightOpen, Target, Timer, Trash2 } from '../../ui/icons'
import { isBlockPassed, wallMoment } from '@shared/planning/free-time'
import './time-blocks.css'

/**
 * A time block's card (N3.4a): the task's title, project, time and status,
 * and Open task, Start (the task's timer, R2.3), Focus (N3.5) and Remove
 * (with undo in its toast). Starting the timer never changes the block: a
 * block is a plan.
 */
export function BlockCard({
  block,
  anchor,
  onClose,
  onOpenTask,
  onRemove,
  onMoveToFree
}: {
  block: TimeBlock
  anchor: HTMLElement | null
  onClose: () => void
  onOpenTask: (block: TimeBlock) => void
  onRemove: (block: TimeBlock) => void
  /** Move to the next free time (N3.4b), offered while the block is passed. */
  onMoveToFree?: (block: TimeBlock) => void
}) {
  const timer = useTimer()
  const focus = useFocus()
  const project = useProjectList().find((candidate) => candidate.id === block.projectId)
  const running = timer.running?.workItemId === block.workItemId
  const passed = isBlockPassed(block, wallMoment(new Date()))
  const day = formatIsoDate(block.date, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={{ current: anchor }}
      label={block.title}
      className="time-block-card"
    >
      <h3 className="time-block-card__title">{block.title}</h3>
      <p className="time-block-card__when">
        {t('views:timeBlocks.when', { day, range: blockTimeRange(block) })}
      </p>
      {project && <p className="time-block-card__project">{project.name}</p>}
      <StatusBadge status={block.status} projectId={block.projectId} />
      {passed && <p className="time-block-card__passed">{t('views:blockMoves.passed')}</p>}
      <div className="time-block-card__actions">
        {passed && onMoveToFree && (
          <Button
            size="sm"
            variant="primary"
            icon={CalendarClock}
            onClick={() => {
              onClose()
              onMoveToFree(block)
            }}
          >
            {t('views:blockMoves.moveToFree')}
          </Button>
        )}
        <Button
          size="sm"
          icon={PanelRightOpen}
          onClick={() => {
            onClose()
            onOpenTask(block)
          }}
        >
          {t('views:timeBlocks.openTask')}
        </Button>
        <Button
          size="sm"
          icon={Timer}
          disabled={running || block.status === 'done'}
          onClick={() => {
            void timer.start(block.projectId, block.workItemId)
            onClose()
          }}
        >
          {running ? t('views:timeBlocks.running') : t('views:timeBlocks.start')}
        </Button>
        <Button
          size="sm"
          icon={Target}
          disabled={block.status === 'done'}
          onClick={() => {
            onClose()
            focus.ask({
              projectId: block.projectId,
              workItemId: block.workItemId,
              title: block.title
            })
          }}
        >
          {t('tasks:focus.focus')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          onClick={() => {
            onClose()
            onRemove(block)
          }}
        >
          {t('views:timeBlocks.remove')}
        </Button>
      </div>
    </Popover>
  )
}
