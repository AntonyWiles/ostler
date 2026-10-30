import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type Ref,
  type RefObject
} from 'react'
import { IconButton } from './IconButton'
import { Portal } from './Portal'
import { Check, Ellipsis, Icon, type LucideIcon } from './icons'
import { useAnchoredLayer } from './overlay/layer'
import type { Placement } from './overlay/position'
import { nextRovingIndex, typeaheadIndex } from './roving'
import { cx } from './cx'
import './Menu.css'

export interface MenuItem {
  type?: 'item'
  label: string
  icon?: LucideIcon
  /** A shortcut hint shown on the right, for example "Ctrl+D". */
  shortcut?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Shown on hover: what the item does, or why it is disabled. */
  hint?: string
  /**
   * Set for an item that is ticked or not: it shows a tick in place of its
   * icon while checked, and is read as checked or not checked (WCAG 4.1.2).
   */
  checked?: boolean
  /**
   * How a ticked item reads: 'checkbox' (the default) for a setting that is
   * on or off, 'radio' for the one chosen of a group.
   */
  checkKind?: 'checkbox' | 'radio'
  onSelect: () => void
}

/** The ARIA role of an item: a plain action, or a checkbox or radio with `checked`. */
export function menuItemRole(item: Pick<MenuItem, 'checked' | 'checkKind'>) {
  if (item.checked === undefined) return 'menuitem'
  return item.checkKind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'
}

export interface MenuSeparator {
  type: 'separator'
}

export interface MenuGroup {
  type: 'group'
  label: string
  items: MenuItem[]
}

export type MenuEntry = MenuItem | MenuSeparator | MenuGroup

/** The selectable items, in order, with groups flattened. */
function flatItems(entries: readonly MenuEntry[]): MenuItem[] {
  return entries.flatMap((entry) =>
    entry.type === 'separator' ? [] : entry.type === 'group' ? entry.items : [entry]
  )
}

const TYPEAHEAD_RESET_MS = 500

export interface MenuListProps {
  id?: string
  /** Names the menu. */
  label: string
  entries: readonly MenuEntry[]
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  placement?: Placement
  /** For context menus: open at this point rather than beside the anchor. */
  point?: { x: number; y: number } | null
  /** Which item gets focus on open. */
  initialFocus?: 'first' | 'last'
  className?: string
}

/**
 * The menu surface shared by Menu and ContextMenu (ARIA menu pattern): arrow
 * keys, Home, End, typeahead, Enter and Space to choose, Escape or Tab to
 * close. Choosing an item closes the menu first, then runs it.
 */
export function MenuList({
  id,
  label,
  entries,
  open,
  onClose,
  anchorRef,
  placement = 'bottom-start',
  point = null,
  initialFocus = 'first',
  className
}: MenuListProps) {
  const { floatingRef, style } = useAnchoredLayer({ open, onClose, anchorRef, placement, point })
  const items = flatItems(entries)
  const disabled = items.map((item) => !!item.disabled)
  const itemRefs = useRef<Array<HTMLElement | null>>([])
  const [active, setActive] = useState(-1)
  const typed = useRef({ text: '', at: 0 })

  const focusItem = (index: number | null) => {
    if (index === null) return
    setActive(index)
    itemRefs.current[index]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const start = initialFocus === 'last' ? items.length - 1 : -1
    const first = nextRovingIndex(
      initialFocus === 'last' ? 'End' : 'Home',
      start,
      disabled,
      'vertical'
    )
    if (first === null) floatingRef.current?.focus()
    else focusItem(first)
    // Only on open: later renders must not pull focus back to the first item.
  }, [open])

  if (!open) return null

  const choose = (item: MenuItem) => {
    if (item.disabled) return
    onClose()
    item.onSelect()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      onClose()
      return
    }
    const next = nextRovingIndex(event.key, active, disabled, 'vertical')
    if (next !== null) {
      event.preventDefault()
      focusItem(next)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && items[active]) {
      event.preventDefault()
      choose(items[active])
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const text =
        now - typed.current.at > TYPEAHEAD_RESET_MS ? event.key : typed.current.text + event.key
      typed.current = { text, at: now }
      // The same letter pressed again cycles through the items it starts.
      const query = /^(.)\1+$/i.test(text) ? text[0] : text
      focusItem(
        typeaheadIndex(
          query,
          active,
          items.map((item) => item.label),
          disabled
        )
      )
    }
  }

  let index = -1
  const renderItem = (item: MenuItem) => {
    index += 1
    const own = index
    const icon = item.checked === undefined ? item.icon : item.checked ? Check : undefined
    return (
      <div
        key={`item-${own}`}
        ref={(node) => {
          itemRefs.current[own] = node
        }}
        role={menuItemRole(item)}
        aria-checked={item.checked}
        tabIndex={own === active ? 0 : -1}
        aria-disabled={item.disabled || undefined}
        title={item.hint}
        // The hint (often why an item is unavailable) reaches the keyboard and
        // screen readers too, not only a mouse hover (P9.2).
        aria-description={item.hint}
        className={cx('ui-menu__item', item.tone === 'danger' && 'is-danger')}
        onClick={() => choose(item)}
        onMouseMove={() => {
          if (!item.disabled && own !== active) focusItem(own)
        }}
      >
        <span className="ui-menu__icon">{icon && <Icon icon={icon} />}</span>
        <span className="ui-menu__text">
          <span className="ui-menu__label">{item.label}</span>
          {item.hint && (
            <span className="ui-menu__hint" aria-hidden="true">
              {item.hint}
            </span>
          )}
        </span>
        {item.shortcut && <span className="ui-menu__shortcut">{item.shortcut}</span>}
      </div>
    )
  }

  return (
    <Portal>
      <div
        ref={floatingRef}
        id={id}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={cx('ui-floating', 'ui-menu', className)}
        style={style}
        onKeyDown={onKeyDown}
        onContextMenu={(event: MouseEvent) => event.preventDefault()}
      >
        {entries.map((entry, n) =>
          entry.type === 'separator' ? (
            <div key={`sep-${n}`} role="separator" className="ui-menu__separator" />
          ) : entry.type === 'group' ? (
            <div
              key={`group-${n}`}
              role="group"
              aria-label={entry.label}
              className="ui-menu__group"
            >
              <div className="ui-menu__group-label" aria-hidden="true">
                {entry.label}
              </div>
              {entry.items.map(renderItem)}
            </div>
          ) : (
            <Fragment key={`entry-${n}`}>{renderItem(entry)}</Fragment>
          )
        )}
      </div>
    </Portal>
  )
}

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface MenuProps {
  /** Names the menu, and the default "…" trigger button. */
  label: string
  /** The entries, or a function that builds them when the menu opens (cheap for long lists of cards). */
  items: MenuItems
  /** A custom trigger; spread the props onto a button. Defaults to a "…" IconButton. */
  renderTrigger?: (props: MenuTriggerProps) => ReactElement
  placement?: Placement
}

/** Menu entries, or a function that builds them only when the menu opens (P9.1). */
export type MenuItems = readonly MenuEntry[] | (() => readonly MenuEntry[])

/**
 * The entries of an open menu, as they were when it opened. Whatever changes
 * behind it meanwhile (a view joining the tabs, a list that refreshes) waits
 * until it closes, so no item moves under the pointer. Every choice closes the
 * menu, so nothing in it needs to change while it is open. A closed menu
 * builds none.
 */
export function useMenuEntries(items: MenuItems, open: boolean): readonly MenuEntry[] {
  const [taken, setTaken] = useState<readonly MenuEntry[] | null>(null)
  if (open && taken === null) {
    const entries = typeof items === 'function' ? items() : items
    setTaken(entries)
    return entries
  }
  if (!open && taken !== null) setTaken(null)
  return open && taken !== null ? taken : []
}

/** A button that opens a menu of actions. */
export function Menu({ label, items, renderTrigger, placement = 'bottom-start' }: MenuProps) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first')
  const entries = useMenuEntries(items, open)

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => {
      setInitialFocus('first')
      setOpen((wasOpen) => !wasOpen)
    },
    onKeyDown: (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      setInitialFocus(event.key === 'ArrowUp' ? 'last' : 'first')
      setOpen(true)
    }
  }

  return (
    <>
      {renderTrigger ? (
        renderTrigger(triggerProps)
      ) : (
        <IconButton label={label} icon={Ellipsis} {...triggerProps} />
      )}
      <MenuList
        id={menuId}
        label={label}
        entries={entries}
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        placement={placement}
        initialFocus={initialFocus}
      />
    </>
  )
}
