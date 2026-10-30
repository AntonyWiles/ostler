import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Menu, type MenuEntry } from './Menu'
import { tabbableIn } from './overlay/layer'
import { nextRovingIndex } from './roving'
import { cx } from './cx'
import './Toolbar.css'
import { t } from '@shared/i18n'

export interface ToolbarProps {
  /** Required: names the toolbar ("Board filters"). */
  label: string
  children: ReactNode
  /** Secondary actions, collapsed into a "More" menu at the end. */
  overflow?: readonly MenuEntry[]
  /** Content pinned to the right end (view options, counts). */
  end?: ReactNode
  className?: string
}

function isTextEntry(element: Element | null): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(element.type))
  )
}

/**
 * A horizontal row of filters, search and view options. Left and Right move
 * between its controls (except inside a text field, where they move the
 * caret). Secondary actions go in the overflow menu.
 */
export function Toolbar({ label, children, overflow, end, className }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ref.current || isTextEntry(document.activeElement)) return
    const items = tabbableIn(ref.current)
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    const next = nextRovingIndex(
      event.key,
      current,
      items.map(() => false)
    )
    if (next === null) return
    event.preventDefault()
    items[next].focus()
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className={cx('ui-toolbar', className)}
      onKeyDown={onKeyDown}
    >
      <div className="ui-toolbar__items">{children}</div>
      {(end || (overflow && overflow.length > 0)) && (
        <div className="ui-toolbar__end">
          {end}
          {overflow && overflow.length > 0 && (
            <Menu label={t('common:toolbar.moreActions')} items={overflow} placement="bottom-end" />
          )}
        </div>
      )}
    </div>
  )
}
