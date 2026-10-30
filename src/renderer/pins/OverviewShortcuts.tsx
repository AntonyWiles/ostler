import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { PinView, RendererProject } from '@shared/ostler-api'
import { Button, ContextMenu, Menu, useReorderMotion, type MenuEntry } from '../ui'
import { ArrowLeft, ArrowRight, Icon, PinOff, Plus } from '../ui/icons'
import { usePins } from './PinsProvider'
import { useOpenPin } from './useOpenPin'
import { pinExists, pinIcon, pinTitle } from './pin-display'
import { AddShortcutDialog } from './AddShortcutDialog'
import './OverviewShortcuts.css'
import { t } from '@shared/i18n'

/**
 * The Shortcuts strip at the top of a project's Overview (N5.2a): its
 * Overview pins, in their order, and Add a shortcut. Each opens in one click
 * (a link or file asks first); each has a menu to move it or unpin it, and
 * drags to reorder.
 */
export function OverviewShortcuts({ project }: { project: RendererProject }) {
  const pins = usePins()
  const open = useOpenPin()
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  useReorderMotion(listRef)
  if (!pins.available) return null
  const shown = pins.overview(project.id)

  const moveBy = (pin: PinView, delta: number) => {
    const index = shown.findIndex((entry) => entry.id === pin.id)
    const neighbour = shown[index + delta]
    if (!neighbour) return
    void pins.move(pin, delta < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id })
  }

  const items = (pin: PinView, index: number): MenuEntry[] => [
    {
      label: t('common:pins.moveLeft'),
      icon: ArrowLeft,
      disabled: index === 0,
      onSelect: () => moveBy(pin, -1)
    },
    {
      label: t('common:pins.moveRight'),
      icon: ArrowRight,
      disabled: index === shown.length - 1,
      onSelect: () => moveBy(pin, 1)
    },
    { type: 'separator' },
    ...pins.countdownItems(pin),
    {
      label: t('common:pins.unpin'),
      icon: PinOff,
      onSelect: () => void pins.unpin(pin, pinTitle(pin))
    }
  ]

  const onKeyDown = (event: KeyboardEvent, pin: PinView) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    moveBy(pin, event.key === 'ArrowLeft' ? -1 : 1)
  }

  const onDrop = (event: DragEvent, target: PinView) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData('text/x-ostler-shortcut') || dragging
    setDragging(null)
    const dragged = shown.find((pin) => pin.id === draggedId)
    if (!dragged || dragged.id === target.id) return
    const from = shown.indexOf(dragged)
    const to = shown.indexOf(target)
    void pins.move(dragged, from < to ? { afterId: target.id } : { beforeId: target.id })
  }

  return (
    <section className="overview-shortcuts" aria-labelledby="overview-shortcuts-title">
      <h2 id="overview-shortcuts-title" className="overview-shortcuts__title">
        {t('common:pins.shortcuts')}
      </h2>
      <ul ref={listRef} className="overview-shortcuts__list">
        {shown.map((pin, index) => {
          const title = pinTitle(pin)
          const gone = !pinExists(pin)
          return (
            <li
              key={pin.id}
              data-motion-key={pin.id}
              className={`overview-shortcut${gone ? ' is-gone' : ''}${dragging === pin.id ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                if (dragging) event.preventDefault()
              }}
              onDrop={(event) => onDrop(event, pin)}
            >
              <ContextMenu
                label={t('common:pins.shortcutActions', { title })}
                items={() => items(pin, index)}
              >
                <button
                  type="button"
                  className="overview-shortcut__open"
                  aria-disabled={gone || undefined}
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/x-ostler-shortcut', pin.id)
                    event.dataTransfer.effectAllowed = 'move'
                    setDragging(pin.id)
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(event) => onKeyDown(event, pin)}
                  onClick={() => void open(pin)}
                >
                  <Icon icon={pinIcon(pin)} />
                  <span className="overview-shortcut__title">{title}</span>
                  {pin.archived && !gone && (
                    <span className="overview-shortcut__note">{t('common:pins.archived')}</span>
                  )}
                </button>
              </ContextMenu>
              <Menu
                label={t('common:pins.shortcutActions', { title })}
                items={() => items(pin, index)}
              />
            </li>
          )
        })}
        <li>
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
            {t('common:pins.addShortcut')}
          </Button>
        </li>
      </ul>
      {shown.length === 0 && (
        <p className="overview-shortcuts__empty">{t('common:pins.noShortcuts')}</p>
      )}
      {adding && <AddShortcutDialog project={project} onClose={() => setAdding(false)} />}
    </section>
  )
}
