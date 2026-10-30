import { useId } from 'react'
import { cx } from './cx'
import './ProgressBar.css'

export interface ProgressBarProps {
  /** Required: names the bar ("Checklist", "Upload"). */
  label: string
  /** Omit for an indeterminate bar. */
  value?: number
  max?: number
  /** Show the label and the value text above the bar. */
  showLabel?: boolean
  /** The value as words, for example "3 of 5". Defaults to a percentage. */
  valueText?: string
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}

/** A progress bar with an accessible name and value. */
export function ProgressBar({
  label,
  value,
  max = 100,
  showLabel = false,
  valueText,
  tone = 'accent',
  className
}: ProgressBarProps) {
  const labelId = useId()
  const determinate = value !== undefined
  const clamped = determinate ? Math.min(Math.max(value, 0), max) : 0
  const percent = max > 0 ? Math.round((clamped / max) * 100) : 0
  const text = valueText ?? (determinate ? `${percent}%` : undefined)
  return (
    <div className={cx('ui-progress', `ui-progress--${tone}`, className)}>
      {showLabel && (
        <div className="ui-progress__labels">
          <span id={labelId}>{label}</span>
          {text && <span className="tabular-nums">{text}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={showLabel ? undefined : label}
        aria-labelledby={showLabel ? labelId : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? clamped : undefined}
        aria-valuetext={determinate ? text : undefined}
        className={cx('ui-progress__track', !determinate && 'is-indeterminate')}
      >
        <span
          className="ui-progress__fill"
          style={determinate ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  )
}
