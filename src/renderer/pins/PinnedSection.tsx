import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { PinView, RendererProject } from '@shared/ostler-api'
import { ProjectMark } from '../components/ProjectMark'
import {
  Collapse,
  ContextMenu,
  IconButton,
  useReorderMotion,
  VisuallyHidden,
  type MenuEntry
} from '../ui'
import { ArrowDown, ArrowUp, chevronClass, ChevronRight, Icon, PinOff } from '../ui/icons'
import { usePins } from './PinsProvider'
import { useOpenPin } from './useOpenPin'
import { pinExists, pinIcon, pinShown, pinTitle } from './pin-display'
import './PinnedSection.css'
import { t } from '@shared/i18n'

/** Where the sidebar remembers that Pinned is folded: a viewer convenience, not config. */
export const FOLDED_PINS_KEY = 'ostler.sidebar.pinsFolded'

function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLDED_PINS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The sidebar's Pinned section (N5.2a): above the projects, folding like an
 * area. Each pin shows its kind's icon, its target's current title and its
 * project's colour and icon; it reorders by dragging, Alt+↑/↓, or Move up and
 * Move down in its menu. A pin whose target is gone says so and offers Unpin.
 * Nothing shows until something is pinned.
 */
export function PinnedSection({
  projects,
  collapsed
}: {
  projects: RendererProject[]
  collapsed: boolean
}) {
  const pins = usePins()
  const open = useOpenPin()
  const listRef = useRef<HTMLElement | null>(null)
  useReorderMotion(listRef)
  const [folded, setFolded] = useState(readFolded)
  const [dragging, setDragging] = useState<string | null>(null)
  const byId = new Map(projects.map((project) => [project.id, project]))
  // A pin of a project that is not shown (disabled) is left out, as its project is.
  const shown = pins.sidebar.filter((pin) => pinShown(pin, byId))
  if (!pins.available || shown.length === 0) return null

  const toggle = () => {
    setFolded((current) => {
      try {
        window.localStorage.setItem(FOLDED_PINS_KEY, current ? '0' : '1')
      } catch {
        // Storage full or off: folding still works for this session.
      }
      return !current
    })
  }

  const moveBy = (pin: PinView, delta: number) => {
    const index = shown.findIndex((entry) => entry.id === pin.id)
    const neighbour = shown[index + delta]
    if (!neighbour) return
    void pins.move(pin, delta < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id })
  }

  const items = (pin: PinView, index: number): MenuEntry[] => [
    {
      label: t('navigation:sidebar.moveUp'),
      icon: ArrowUp,
      disabled: index === 0,
      onSelect: () => moveBy(pin, -1)
    },
    {
      label: t('navigation:sidebar.moveDown'),
      icon: ArrowDown,
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
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    moveBy(pin, event.key === 'ArrowUp' ? -1 : 1)
  }

  const onDrop = (event: DragEvent, target: PinView) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData('text/x-ostler-pin') || dragging
    setDragging(null)
    const dragged = shown.find((pin) => pin.id === draggedId)
    if (!dragged || dragged.id === target.id) return
    const from = shown.indexOf(dragged)
    const to = shown.indexOf(target)
    void pins.move(dragged, from < to ? { afterId: target.id } : { beforeId: target.id })
  }

  const renderPin = (pin: PinView, index: number) => {
    const project = byId.get(pin.projectId)
    const title = pinTitle(pin)
    const gone = !pinExists(pin)
    const label = gone
      ? title
      : pin.archived
        ? `${title} (${t('common:pins.archived')})`
        : project
          ? `${title}, ${project.name}`
          : title
    return (
      <li
        key={pin.id}
        data-motion-key={pin.id}
        className={`pinned-item${dragging === pin.id ? ' is-dragging' : ''}${gone ? ' is-gone' : ''}`}
        onDragOver={(event) => {
          if (dragging) event.preventDefault()
        }}
        onDrop={(event) => onDrop(event, pin)}
      >
        <ContextMenu label={t('common:pins.actions', { title })} items={() => items(pin, index)}>
          <button
            type="button"
            className="ostler-sidebar-link pinned-link"
            aria-label={label}
            title={collapsed ? label : undefined}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            aria-disabled={gone || undefined}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/x-ostler-pin', pin.id)
              event.dataTransfer.effectAllowed = 'move'
              setDragging(pin.id)
            }}
            onDragEnd={() => setDragging(null)}
            onKeyDown={(event) => onKeyDown(event, pin)}
            onClick={() => void open(pin)}
          >
            <Icon icon={pinIcon(pin)} />
            {!collapsed && (
              <>
                <span className="ostler-sidebar-label pinned-title">{title}</span>
                {pin.archived && !gone && (
                  <span className="pinned-note">{t('common:pins.archived')}</span>
                )}
                {!gone && project && <ProjectMark project={project} className="project-color" />}
              </>
            )}
          </button>
        </ContextMenu>
        {gone && !collapsed && (
          <IconButton
            label={t('common:pins.unpin')}
            icon={PinOff}
            size="sm"
            onClick={() => void pins.unpin(pin, title)}
          />
        )}
      </li>
    )
  }

  const isFolded = !collapsed && folded
  return (
    <section
      ref={listRef}
      className="ostler-sidebar-pinned"
      aria-labelledby="ostler-sidebar-pinned-title"
    >
      {collapsed ? (
        <VisuallyHidden>
          <h2 id="ostler-sidebar-pinned-title">{t('common:pins.pinned')}</h2>
        </VisuallyHidden>
      ) : (
        <h2 className="projects-area-title">
          <button
            type="button"
            className="projects-area-heading"
            aria-expanded={!isFolded}
            onClick={toggle}
          >
            <Icon icon={ChevronRight} className={chevronClass(!isFolded)} />
            <span id="ostler-sidebar-pinned-title" className="projects-area-name">
              {t('common:pins.pinned')}
            </span>
            {isFolded && (
              <span className="projects-area-count">
                {t('common:pins.pinnedCount', { count: shown.length })}
              </span>
            )}
          </button>
        </h2>
      )}
      <Collapse open={!isFolded}>
        <ul className="projects-list pinned-list" aria-labelledby="ostler-sidebar-pinned-title">
          {shown.map(renderPin)}
        </ul>
      </Collapse>
    </section>
  )
}
