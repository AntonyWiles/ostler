import { useNavigate } from 'react-router-dom'
import type { FocusState } from '@shared/ostler-api'
import { countdownEnd, minutesLeft, msLeft } from '@shared/focus'
import { formatTimerClock } from '@shared/time/duration'
import { taskPath } from '../navigation/paths'
import { Coffee, Icon, Square, Target } from '../ui/icons'
import { IconButton } from '../ui'
import { useFocus } from './FocusProvider'
import { useNow } from './TimerProvider'
import './StatusBarTimer.css'
import { t } from '@shared/i18n'

/**
 * A focus or its break in the status bar (N3.5): the task and the time left,
 * which opens the task, and Stop focus (or End break). Time left comes from
 * the stored end, so a laptop that slept shows the right time at once.
 * While a focus counts down, the running timer's own item steps aside.
 */
export function StatusBarFocus() {
  const { focus } = useFocus()
  const end = focus ? countdownEnd(focus) : null
  return focus && end !== null ? <Countdown focus={focus} end={end} /> : null
}

function Countdown({ focus, end }: { focus: FocusState; end: number }) {
  const { stop } = useFocus()
  const now = useNow(true)
  const navigate = useNavigate()
  const left = formatTimerClock(msLeft(end, now))
  const onBreak = focus.phase === 'break'
  const label = onBreak
    ? t('tasks:focus.statusBarBreak', { count: minutesLeft(end, now) })
    : t('tasks:focus.statusBarFocus', { count: minutesLeft(end, now), task: focus.workItemTitle })
  return (
    <span className="statusbar-timer statusbar-focus">
      <button
        type="button"
        className="statusbar-timer__task"
        aria-label={label}
        title={label}
        onClick={() => navigate(taskPath(focus.projectId, focus.workItemId))}
      >
        <Icon icon={onBreak ? Coffee : Target} className="statusbar-timer__icon" />
        <span className="statusbar-timer__title">
          {onBreak ? t('tasks:focus.onBreak') : focus.workItemTitle}
        </span>
        <span className="statusbar-timer__clock" aria-hidden="true">
          {left}
        </span>
      </button>
      <IconButton
        size="sm"
        icon={Square}
        label={onBreak ? t('tasks:focus.endBreak') : t('tasks:focus.stopFocus')}
        onClick={() => void stop()}
      />
    </span>
  )
}
