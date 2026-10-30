import type { ReactNode, Ref, SelectHTMLAttributes } from 'react'
import { Field, useFieldIds, type FieldChromeProps } from './Field'
import { ChevronDown, Icon } from './icons'
import { cx } from './cx'
import './Select.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /**
   * Shows the option under this heading (`<optgroup>`). Options of one group
   * must sit together; options with no group stay outside any heading.
   */
  group?: string
}

/** Options in runs: each run is one group's options, in order. */
function optionRuns(
  options: readonly SelectOption[]
): { group?: string; options: SelectOption[] }[] {
  const runs: { group?: string; options: SelectOption[] }[] = []
  for (const option of options) {
    const last = runs[runs.length - 1]
    if (last && last.group === option.group) last.options.push(option)
    else runs.push({ group: option.group, options: [option] })
  }
  return runs
}

export interface SelectProps
  extends FieldChromeProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'> {
  /** The choices. Or pass `<option>` children. */
  options?: SelectOption[]
  size?: 'sm' | 'md'
  children?: ReactNode
  ref?: Ref<HTMLSelectElement>
}

/**
 * A styled native `<select>`. Native on purpose: its pop-up is accessible and
 * follows `color-scheme`, so it matches the theme. Use Combobox to search.
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  className,
  options,
  size = 'md',
  children,
  id,
  ref,
  ...select
}: SelectProps) {
  const ids = useFieldIds(id, { hint, error }, select['aria-describedby'])
  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
      ids={ids}
    >
      <div className={cx('ui-select', `ui-select--${size}`)}>
        <select
          {...select}
          ref={ref}
          id={ids.controlId}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
        >
          {options &&
            optionRuns(options).map((run, index) => {
              const items = run.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
              return run.group === undefined ? (
                items
              ) : (
                <optgroup key={`group-${index}`} label={run.group}>
                  {items}
                </optgroup>
              )
            })}
          {children}
        </select>
        <span className="ui-select__chevron">
          <Icon icon={ChevronDown} />
        </span>
      </div>
    </Field>
  )
}
