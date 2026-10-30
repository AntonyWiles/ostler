import { useNavigate } from 'react-router-dom'
import type { TimeEntry } from '@shared/ostler-api'
import { formatTimerClock } from '@shared/time/duration'
import { taskPath, timesheetPath } from '../navigation/paths'
import { Icon, Square, Timer, CalendarDays } from '../ui/icons'
import { IconButton } from '../ui'
import { useNow, useTimer } from './TimerProvider'
import { useFocus } from './FocusProvider'
import './StatusBarTimer.css'
import { t } from '@shared/i18n'

/**
 * The running timer in the status bar (R2.3): the task and the time, which
 * opens the task; Stop; and the Timesheet (D35). Compact, so it fits at 900 px
 * beside the agent and AI items. The clock ticks only while a timer runs, and
 * is computed from the stored start.
 */
export function StatusBarTimer() {
  const { focus } = useFocus()
  const { running } = useTimer()
  // While a focus counts down on it, StatusBarFocus shows the task instead (N3.5).
  const focused = focus?.phase === 'focus' && focus.entryId === running?.id
  return running && !focused ? <RunningTimer running={running} /> : null
}

function RunningTimer({ running }: { running: TimeEntry }) {
  const { stop } = useTimer()
  const now = useNow(true)
  const navigate = useNavigate()
  const elapsed = formatTimerClock(now - running.startedAt)
  return (
    <span className="statusbar-timer">
      <button
        type="button"
        className="statusbar-timer__task"
        aria-label={t('tasks:time.statusBarTimer', { task: running.workItemTitle, elapsed })}
        title={running.workItemTitle}
        onClick={() => navigate(taskPath(running.projectId, running.workItemId))}
      >
        <Icon icon={Timer} className="statusbar-timer__icon" />
        <span className="statusbar-timer__title">{running.workItemTitle}</span>
        <span className="statusbar-timer__clock" aria-hidden="true">
          {elapsed}
        </span>
      </button>
      <IconButton
        size="sm"
        icon={Square}
        label={t('tasks:time.stopTimer')}
        onClick={() => void stop()}
      />
      <IconButton
        size="sm"
        icon={CalendarDays}
        label={t('tasks:time.openTimesheet')}
        onClick={() => navigate(timesheetPath())}
      />
    </span>
  )
}
