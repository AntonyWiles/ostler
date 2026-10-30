import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Ref,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent
} from 'react'
import { cx } from '../ui/cx'
import { stepIndex } from '../ui/roving'
import { useDismissable } from './useDismissable'
import '../ui/Markdown.css'

/** Where a trigger was typed and what follows it up to the caret. */
export interface TextTrigger {
  start: number
  query: string
}

export interface TextTriggerPicker {
  /** Spread on the textarea: its keys, caret moves and accessible relations. */
  inputProps: {
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void
    'aria-autocomplete'?: 'list'
    'aria-controls'?: string
    'aria-activedescendant'?: string
  }
  /** The picker, shown while the trigger is being typed; render it after the textarea. */
  picker: ReactNode
  open: boolean
}

interface PickerListProps<T> {
  listId: string
  label: ReactNode
  options: readonly T[]
  active: number
  optionKey: (option: T) => string
  renderOption: (option: T) => ReactNode
  onPick: (option: T) => void
  /** Shown under an empty list. */
  empty?: ReactNode
  pickerRef?: Ref<HTMLDivElement>
}

/** The listbox a text-trigger picker shows: a label, the options, the active one marked. */
export function PickerList<T>({
  listId,
  label,
  options,
  active,
  optionKey,
  renderOption,
  onPick,
  empty,
  pickerRef
}: PickerListProps<T>) {
  return (
    <div className="ui-item-link-picker" ref={pickerRef}>
      <div className="ui-item-link-picker__label" id={`${listId}-label`}>
        {label}
      </div>
      <ul role="listbox" id={listId} aria-labelledby={`${listId}-label`}>
        {options.map((option, index) => (
          <li
            key={optionKey(option)}
            id={`${listId}-option-${index}`}
            role="option"
            aria-selected={index === active}
            className={cx('ui-item-link-picker__option', index === active && 'is-active')}
            // Keep the caret in the textarea while choosing with the mouse.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(option)}
          >
            {renderOption(option)}
          </li>
        ))}
      </ul>
      {options.length === 0 && empty && <div className="ui-item-link-picker__empty">{empty}</div>}
    </div>
  )
}

/**
 * A picker that opens while a trigger (`@`, `[[`) is typed in a textarea:
 * it follows the caret, steps through its options with the arrows, inserts
 * the chosen one's text with Enter or a click and puts the caret after it.
 * Esc closes it (not the drawer or dialog around it) and leaves the typed text.
 *
 * Options come either from `options` (worked out from the query on every
 * render) or from `search` (asked once typing settles; a failed search leaves
 * the list as it was).
 */
export function useTextTriggerPicker<T>({
  value,
  onChange,
  textRef,
  enabled,
  findTrigger,
  options: optionsFor,
  search,
  searchDelayMs = 0,
  openWhenEmpty = false,
  insertText,
  optionKey,
  renderOption,
  label,
  empty
}: {
  value: string
  onChange: (next: string) => void
  textRef: RefObject<HTMLTextAreaElement | null>
  /** False turns the picker off. */
  enabled: boolean
  findTrigger: (text: string, caret: number) => TextTrigger | null
  options?: (query: string) => readonly T[]
  search?: (query: string) => Promise<readonly T[]>
  searchDelayMs?: number
  /** Open with no options (a search not yet typed, or nothing found). */
  openWhenEmpty?: boolean
  insertText: (option: T) => string
  optionKey: (option: T) => string
  renderOption: (option: T) => ReactNode
  label: (query: string) => ReactNode
  empty?: (query: string) => ReactNode
}): TextTriggerPicker {
  const listId = useId()
  const [caret, setCaret] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [found, setFound] = useState<readonly T[]>([])
  const [active, setActive] = useState(0)

  const trigger = caret === null || !enabled ? null : findTrigger(value, caret)
  const typed = trigger !== null && trigger.start !== dismissed
  const query = search ? (typed ? trigger.query.trim() : '') : (trigger?.query ?? '')
  const options = optionsFor ? (trigger !== null ? optionsFor(query) : []) : found
  const open = typed && (openWhenEmpty || options.length > 0)
  const hasOptions = open && options.length > 0

  // A synchronous list starts at the top again whenever the query changes.
  const listed = optionsFor !== undefined
  useEffect(() => {
    if (listed) setActive(0)
  }, [query, listed])

  const readCaret = useCallback(() => {
    const node = textRef.current
    setCaret(node ? node.selectionStart : null)
  }, [textRef])

  // The caret moves with every keystroke; read it after React has the new value.
  useEffect(() => {
    readCaret()
  }, [value, readCaret])

  // Leaving the text closes the picker; coming back reads the caret again.
  useEffect(() => {
    const node = textRef.current
    if (!node) return
    const leave = () => setCaret(null)
    node.addEventListener('blur', leave)
    node.addEventListener('focus', readCaret)
    return () => {
      node.removeEventListener('blur', leave)
      node.removeEventListener('focus', readCaret)
    }
  }, [textRef, readCaret])

  const searchRef = useRef(search)
  searchRef.current = search
  const searching = search !== undefined
  useEffect(() => {
    if (!searching) return
    if (!open || query === '') {
      setFound([])
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      void searchRef.current?.(query).then(
        (next) => {
          if (!live) return
          setFound(next)
          setActive(0)
        },
        () => {}
      )
    }, searchDelayMs)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [open, query, searchDelayMs, searching])

  const insert = (option: T) => {
    if (!trigger || caret === null) return
    const text = insertText(option)
    const at = trigger.start + text.length
    onChange(value.slice(0, trigger.start) + text + value.slice(caret))
    setFound([])
    requestAnimationFrame(() => {
      const node = textRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!hasOptions) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => stepIndex(current, event.key === 'ArrowDown' ? 1 : -1, options.length))
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      insert(options[Math.min(active, options.length - 1)])
    }
  }

  const escape = useDismissable(() => setDismissed(trigger?.start ?? null), {
    enabled: open,
    closeOnBackdrop: false
  })

  const picker = open ? (
    <PickerList
      listId={listId}
      label={label(query)}
      options={options}
      active={active}
      optionKey={optionKey}
      renderOption={renderOption}
      onPick={insert}
      empty={query !== '' ? empty?.(query) : undefined}
      pickerRef={escape.ref}
    />
  ) : null

  return {
    inputProps: {
      onKeyDown,
      onSelect: readCaret,
      ...(search ? { 'aria-autocomplete': 'list' as const } : {}),
      ...(open ? { 'aria-controls': listId } : {}),
      ...(hasOptions ? { 'aria-activedescendant': `${listId}-option-${active}` } : {})
    },
    picker,
    open
  }
}
