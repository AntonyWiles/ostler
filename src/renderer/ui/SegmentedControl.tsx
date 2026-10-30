import { useRef, type KeyboardEvent } from 'react'
import { Icon, type LucideIcon } from './icons'
import { nextRovingIndex } from './roving'
import { cx } from './cx'
import './SegmentedControl.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  /** Required: names the group. */
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

/**
 * A small set of mutually exclusive choices shown side by side. Radio-group
 * semantics: one tab stop, arrow keys move the selection.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.findIndex((option) => option.value === value)
  const tabStop = selected >= 0 ? selected : options.findIndex((option) => !option.disabled)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(
      event.key,
      index,
      options.map((option) => !!option.disabled),
      'both'
    )
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('ui-segmented', `ui-segmented--${size}`, className)}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === tabStop ? 0 : -1}
          disabled={option.disabled}
          className="ui-segmented__option"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.icon && <Icon icon={option.icon} />}
          {option.label}
        </button>
      ))}
    </div>
  )
}
