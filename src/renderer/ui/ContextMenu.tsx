import {
  cloneElement,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type Ref
} from 'react'
import { MenuList, useMenuEntries, type MenuItems } from './Menu'
import { assignRef } from './assign-ref'
import './ContextMenu.css'

type TargetProps = {
  ref?: Ref<HTMLElement>
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
}

export interface ContextMenuProps {
  /** Names the menu ("Task actions"). */
  label: string
  /** The entries, or a function that builds them when the menu opens. */
  items: MenuItems
  /** The element the menu belongs to. It should be focusable for keyboard use. */
  children: ReactElement<TargetProps>
}

function isTextField(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false
  const field = target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
  if (!field) return false
  if (field instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
      field.type
    )
  return true
}

/**
 * A menu on right-click, Shift+F10 or the Menu key, at the pointer or (from
 * the keyboard) at the element. Same keyboard model as Menu.
 */
export function ContextMenu({ label, items, children }: ContextMenuProps) {
  const targetRef = useRef<HTMLElement | null>(null)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const entries = useMenuEntries(items, point !== null)
  const props = children.props

  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          targetRef.current = node
          assignRef(props.ref, node)
        },
        onContextMenu: (event: MouseEvent<HTMLElement>) => {
          props.onContextMenu?.(event)
          if (event.defaultPrevented) return
          // A right-click in a text field is the field's: its spelling
          // suggestions, Cut, Copy and Paste (main's text menu).
          if (isTextField(event.target)) return
          event.preventDefault()
          setPoint({ x: event.clientX, y: event.clientY })
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          props.onKeyDown?.(event)
          if (event.defaultPrevented || isTextField(event.target)) return
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setPoint({ x: rect.left, y: rect.bottom })
          }
        }
      })}
      <MenuList
        label={label}
        entries={entries}
        open={point !== null}
        point={point}
        onClose={() => setPoint(null)}
        anchorRef={targetRef}
        className="ui-context-menu"
      />
    </>
  )
}
