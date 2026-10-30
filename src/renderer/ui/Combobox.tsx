import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Field, useFieldIds, type FieldChromeProps } from './Field'
import { Portal } from './Portal'
import { Check, ChevronDown, Icon, Plus } from './icons'
import { useAnchoredLayer } from './overlay/layer'
import { cx } from './cx'
import './Combobox.css'
import { t } from '@shared/i18n'

export interface ComboboxOption {
  value: string
  label: string
  /** A second, quieter line. */
  description?: string
  disabled?: boolean
  /** Shown before the label in the list: an avatar or a colour dot. */
  prefix?: ReactNode
}

export interface ComboboxProps extends FieldChromeProps {
  options: readonly ComboboxOption[]
  /** The chosen value, or null. */
  value: string | null
  onChange: (value: string | null) => void
  /** Offers "Create '…'" when the typed text matches no option. */
  onCreate?: (text: string) => void
  /** The create row's words. Defaults to Create “…”. */
  createLabel?: (text: string) => string
  placeholder?: string
  disabled?: boolean
  /** Shown when nothing matches. */
  emptyText?: string
  id?: string
  /**
   * Free text: called with the text as it is typed, which is the value, so the
   * options are only suggestions. The box shows `value` itself.
   */
  onType?: (text: string) => void
  maxLength?: number
}

/** Options whose label contains the query, case-insensitive. */
export function filterOptions(options: readonly ComboboxOption[], query: string): ComboboxOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...options]
  return options.filter((option) => option.label.toLowerCase().includes(needle))
}

/**
 * Pick one value from a long list by typing (ARIA combobox with a listbox):
 * type to filter, arrow keys move, Enter selects, Escape closes. For people,
 * labels, milestones and tasks. Short fixed lists use Select.
 */
export function Combobox({
  label,
  hideLabel,
  hint,
  error,
  className,
  options,
  value,
  onChange,
  onCreate,
  createLabel = (text) => t('common:combobox.create', { text }),
  placeholder,
  disabled,
  emptyText = t('common:combobox.noMatches'),
  id,
  onType,
  maxLength
}: ComboboxProps) {
  const ids = useFieldIds(id, { hint, error })
  const listId = useId()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selected = options.find((option) => option.value === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const text = query ?? (onType ? (value ?? '') : (selected?.label ?? ''))
  const filtered = useMemo(() => filterOptions(options, query ?? ''), [options, query])
  const trimmed = (query ?? '').trim()
  const canCreate =
    !!onCreate &&
    trimmed !== '' &&
    !options.some((option) => option.label.toLowerCase() === trimmed.toLowerCase())
  const count = filtered.length + (canCreate ? 1 : 0)

  const close = () => {
    setOpen(false)
    setQuery(null)
  }
  const { floatingRef, style } = useAnchoredLayer({
    open,
    onClose: close,
    anchorRef: boxRef,
    matchWidth: true
  })

  useEffect(() => {
    if (active >= count) setActive(Math.max(0, count - 1))
  }, [active, count])

  const optionId = (index: number) => `${listId}-option-${index}`

  const commit = (index: number) => {
    if (index < filtered.length) {
      const option = filtered[index]
      if (option.disabled) return
      onChange(option.value)
    } else if (canCreate) {
      onCreate?.(trimmed)
    }
    close()
  }

  const step = (from: number, direction: 1 | -1): number => {
    for (let n = 1; n <= count; n++) {
      const index = (((from + direction * n) % count) + count) % count
      if (index >= filtered.length || !filtered[index].disabled) return index
    }
    return from
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        const selectedIndex = filtered.findIndex((option) => option.value === value)
        setActive(selectedIndex >= 0 ? selectedIndex : 0)
        return
      }
      if (count > 0) setActive(step(active, event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Enter') {
      if (!open || count === 0) return
      event.preventDefault()
      commit(active)
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setActive(Math.max(0, count - 1))
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
      ids={ids}
    >
      <div ref={boxRef} className={cx('ui-input-box', 'ui-combobox', disabled && 'is-disabled')}>
        <input
          ref={inputRef}
          id={ids.controlId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && count > 0 ? optionId(active) : undefined}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          maxLength={maxLength}
          onChange={(event) => {
            onType?.(event.target.value)
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          onClick={() => setOpen(true)}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="ui-combobox__toggle"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            inputRef.current?.focus()
            if (open) close()
            else setOpen(true)
          }}
        >
          <Icon icon={ChevronDown} />
        </button>
      </div>
      {open && !(onType && count === 0) && (
        <Portal>
          <div ref={floatingRef} className="ui-floating ui-combobox__popup" style={style}>
            <ul
              id={listId}
              role="listbox"
              aria-label={typeof label === 'string' ? label : undefined}
              aria-labelledby={typeof label === 'string' ? undefined : ids.labelId}
              className="ui-combobox__list"
            >
              {filtered.map((option, index) => (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={cx('ui-combobox__option', index === active && 'is-active')}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => commit(index)}
                >
                  <span className="ui-combobox__check">
                    {option.value === value && <Icon icon={Check} />}
                  </span>
                  {option.prefix && <span className="ui-combobox__prefix">{option.prefix}</span>}
                  <span className="ui-combobox__text">
                    <span>{option.label}</span>
                    {option.description && (
                      <span className="ui-combobox__description">{option.description}</span>
                    )}
                  </span>
                </li>
              ))}
              {canCreate && (
                <li
                  id={optionId(filtered.length)}
                  role="option"
                  aria-selected={false}
                  className={cx('ui-combobox__option', active === filtered.length && 'is-active')}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(filtered.length)}
                  onClick={() => commit(filtered.length)}
                >
                  <span className="ui-combobox__check">
                    <Icon icon={Plus} />
                  </span>
                  <span className="ui-combobox__text">{createLabel(trimmed)}</span>
                </li>
              )}
              {count === 0 && <li className="ui-combobox__empty">{emptyText}</li>}
            </ul>
          </div>
        </Portal>
      )}
    </Field>
  )
}

export interface SuggestFieldProps extends FieldChromeProps {
  value: string
  onChange: (value: string) => void
  /** Earlier answers, offered in Ostler's own list as the person types. */
  suggestions: readonly string[]
  maxLength?: number
  placeholder?: string
  disabled?: boolean
}

/**
 * Free text with suggestions: what a native `<datalist>` did, drawn like every
 * other list in Ostler (MOP-33).
 */
export function SuggestField({ value, onChange, suggestions, ...rest }: SuggestFieldProps) {
  const options = useMemo(
    () => [...new Set(suggestions)].map((text) => ({ value: text, label: text })),
    [suggestions]
  )
  return (
    <Combobox
      {...rest}
      options={options}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onType={onChange}
    />
  )
}
