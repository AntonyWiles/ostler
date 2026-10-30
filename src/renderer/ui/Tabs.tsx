import { useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { Icon, type LucideIcon } from './icons'
import { nextRovingIndex } from './roving'
import { cx } from './cx'
import './Tabs.css'

export interface TabItem<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  /** A count or badge after the label. */
  badge?: ReactNode
  disabled?: boolean
  /** A tooltip, such as the tab's shortcut. */
  title?: string
  /** The panel. Leave out to render panels yourself with `tabPanelProps`. */
  content?: ReactNode
  /** Vertical tabs: a line above this tab starts a new group. */
  groupStart?: boolean
}

export interface TabsProps<T extends string> {
  /** Required: names the tab list. */
  label: string
  items: readonly TabItem<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  /**
   * After the tabs, on their line but outside the tab list: a menu of the
   * views that have no tab, say. It stays in sight when the tabs scroll.
   */
  trailing?: ReactNode
  /**
   * Vertical: the tabs in a column beside their panel, for a dialog's
   * sections. Up and Down move between them.
   */
  orientation?: 'horizontal' | 'vertical'
  /** The root, to measure the row: which tabs fit, say (`useTabsThatFit`). */
  ref?: Ref<HTMLDivElement>
}

function tabId(base: string, value: string) {
  return `${base}-tab-${value}`
}

function panelId(base: string, value: string) {
  return `${base}-panel-${value}`
}

/**
 * A tab list with roving tabindex: one tab stop, arrow keys (and Home, End)
 * move between tabs and select them. The selected tab's content is in a
 * `tabpanel` labelled by its tab.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
  trailing,
  orientation = 'horizontal',
  ref
}: TabsProps<T>) {
  const base = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = items.find((item) => item.value === value)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(
      event.key,
      index,
      items.map((item) => !!item.disabled),
      orientation
    )
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    onChange(items[next].value)
  }

  const list = (
    <div role="tablist" aria-label={label} aria-orientation={orientation} className="ui-tabs__list">
      {items.map((item, index) => {
        const isSelected = item.value === value
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            id={tabId(base, item.value)}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-controls={item.content !== undefined ? panelId(base, item.value) : undefined}
            // With no tab selected (the page shows something else), the first
            // tab keeps the list reachable by Tab.
            tabIndex={isSelected || (!selected && index === 0) ? 0 : -1}
            title={item.title}
            disabled={item.disabled}
            className={cx('ui-tabs__tab', item.groupStart && 'ui-tabs__tab--group-start')}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon && <Icon icon={item.icon} />}
            {item.label}
            {item.badge !== undefined && <span className="ui-tabs__badge">{item.badge}</span>}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      ref={ref}
      className={cx('ui-tabs', orientation === 'vertical' && 'ui-tabs--vertical', className)}
    >
      {trailing ? (
        <div className="ui-tabs__bar">
          {list}
          <div className="ui-tabs__trailing">{trailing}</div>
        </div>
      ) : (
        list
      )}
      {selected?.content !== undefined && (
        <div
          id={panelId(base, selected.value)}
          role="tabpanel"
          aria-labelledby={tabId(base, selected.value)}
          tabIndex={0}
          className="ui-tabs__panel"
        >
          {selected.content}
        </div>
      )}
    </div>
  )
}
