import { useEffect, useRef, type KeyboardEvent, type Ref } from 'react'
import { setNativeValue } from './Field'
import { Icon, Search } from './icons'
import { Kbd } from './Kbd'
import { TextField, type TextFieldProps } from './TextField'
import { assignRef } from './assign-ref'
import { dialogOpen } from '../utils/dom'
import './SearchField.css'

export interface SearchFieldProps extends Omit<TextFieldProps, 'type' | 'prefix' | 'clearable'> {
  /** Pressing "/" anywhere outside a text field focuses this field. */
  slashShortcut?: boolean
  ref?: Ref<HTMLInputElement>
}

function typingElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type))
  )
}

/**
 * A search box: the search icon, a clear button, Escape clears, and an
 * optional "/" shortcut. The label is hidden by default (the icon and
 * placeholder say what it is); it is still the accessible name.
 */
export function SearchField({
  slashShortcut = false,
  hideLabel = true,
  onKeyDown,
  ref,
  ...rest
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!slashShortcut) return
    const onSlash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (typingElsewhere(event.target) || dialogOpen()) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [slashShortcut])

  return (
    <TextField
      {...rest}
      ref={(node) => {
        inputRef.current = node
        assignRef(ref, node)
      }}
      type="search"
      hideLabel={hideLabel}
      className={['ui-search-field', rest.className].filter(Boolean).join(' ')}
      prefix={<Icon icon={Search} />}
      suffix={slashShortcut && !rest.value ? <Kbd shortcut="/" /> : undefined}
      clearable
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== 'Escape') return
        // Escape with text clears it; on an empty box it falls through, so
        // it can still close whatever holds the field.
        if (event.currentTarget.value === '') return
        event.preventDefault()
        event.stopPropagation()
        if (rest.onClear) rest.onClear()
        else setNativeValue(event.currentTarget, '')
      }}
    />
  )
}
