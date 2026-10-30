import { useEffect, useRef, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, EmptyState, InlineAlert, Spinner } from '../../../ui'
import { Plus, Presentation } from '../../../ui/icons'
import { relativeTime } from '../../project-detail/library/libraryUi'
import { NewWhiteboardDialog } from './NewWhiteboardDialog'

export interface PlanWhiteboardList {
  /** The project's whiteboards that are not archived, newest first. */
  items: LibraryItem[]
  loaded: boolean
  error: string | null
}

/** The project's whiteboards for the Plan, read again when the Library changes. */
export function usePlanWhiteboards(projectId: string): PlanWhiteboardList {
  const [list, setList] = useState<PlanWhiteboardList>({ items: [], loaded: false, error: null })

  useEffect(() => {
    let current = true
    const load = () =>
      void window.ostlerAPI.listLibraryItems(projectId, { kind: 'whiteboard' }).then((result) => {
        if (!current) return
        if (!result.ok) {
          setList((before) => ({ ...before, loaded: true, error: result.error }))
          return
        }
        const items = result.value
          .filter((item) => item.kind === 'whiteboard' && !item.archivedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        setList({ items, loaded: true, error: null })
      })
    load()
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'library') load()
    })
    return () => {
      current = false
      stop()
    }
  }, [projectId])

  return list
}

const NUMBER_MARK = '\u0001'

/**
 * A new whiteboard's title: "Whiteboard N", N the smallest number no title of
 * that form uses, so a project's first board is "Whiteboard 1".
 */
export function nextWhiteboardTitle(titles: readonly string[]): string {
  const [before, after = ''] = t('views:planView.whiteboards.defaultTitle', {
    number: NUMBER_MARK
  }).split(NUMBER_MARK)
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escape(before)}(\\d+)${escape(after)}$`)
  const used = new Set<number>()
  for (const title of titles) {
    const match = pattern.exec(title.trim())
    if (match) used.add(Number(match[1]))
  }
  let number = 1
  while (used.has(number)) number++
  return t('views:planView.whiteboards.defaultTitle', { number })
}

export interface PlanWhiteboardsProps {
  projectId: string
  /** The project's name, for the templates that use it. */
  projectName: string
  list: PlanWhiteboardList
  onOpen(whiteboardId: string): void
  /** Open New whiteboard as soon as the list is loaded (`?newWhiteboard=1`). */
  askNew?: boolean
  /** `askNew`'s dialog closed: the new board's id, or null when it was cancelled. */
  onAskNewDone?(whiteboardId: string | null): void
  /**
   * The board just closed with Back to the plan: once the list is loaded, focus
   * goes to its Open button (New whiteboard when it is gone), so it is not lost.
   */
  returnFocusTo?: string | null
}

/** The Plan's Whiteboards pane: the project's whiteboards, and New whiteboard. */
export function PlanWhiteboards({
  projectId,
  projectName,
  list,
  onOpen,
  askNew = false,
  onAskNewDone,
  returnFocusTo = null
}: PlanWhiteboardsProps) {
  const [opened, setOpened] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (returnFocusTo === null || !list.loaded || !root) return
    const open = [...root.querySelectorAll<HTMLElement>('[data-whiteboard-id]')].find(
      (button) => button.dataset.whiteboardId === returnFocusTo
    )
    ;(open ?? root.querySelector<HTMLElement>('[data-new-whiteboard]'))?.focus()
  }, [returnFocusTo, list.loaded])
  /** The one New whiteboard dialog, opened by the button or by `askNew`. */
  const dialogOpen = opened || (askNew && list.loaded)

  const closeDialog = (whiteboardId: string | null) => {
    setOpened(false)
    if (askNew) onAskNewDone?.(whiteboardId)
    else if (whiteboardId) onOpen(whiteboardId)
  }

  const error = list.error
  return (
    <div className="plan-step" ref={rootRef}>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {!list.loaded ? (
        <Spinner label={t('views:planView.whiteboards.loading')} />
      ) : list.items.length === 0 ? (
        <EmptyState
          headingLevel={3}
          icon={Presentation}
          title={t('views:planView.whiteboards.emptyTitle')}
          description={t('views:planView.whiteboards.emptyDescription')}
        />
      ) : (
        <ul className="plan-step__list">
          {list.items.map((item) => (
            <li key={item.id} className="plan-step__item">
              <div className="plan-step__item-head">
                <span className="plan-step__item-name">{item.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('views:planView.whiteboards.openNamed', { title: item.title })}
                  data-whiteboard-id={item.id}
                  onClick={() => onOpen(item.id)}
                >
                  {t('views:planView.whiteboards.open')}
                </Button>
              </div>
              <p className="plan-step__item-meta">
                {t('views:planView.whiteboards.updated', { time: relativeTime(item.updatedAt) })}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="plan-step__actions">
        <Button
          variant={list.loaded && list.items.length === 0 ? 'primary' : 'secondary'}
          icon={Plus}
          disabled={!list.loaded}
          data-new-whiteboard=""
          onClick={() => setOpened(true)}
        >
          {t('views:planView.whiteboards.new')}
        </Button>
      </div>
      {dialogOpen && (
        <NewWhiteboardDialog
          projectId={projectId}
          projectName={projectName}
          defaultTitle={nextWhiteboardTitle(list.items.map((item) => item.title))}
          onCreated={(whiteboardId) => closeDialog(whiteboardId)}
          onCancel={() => closeDialog(null)}
        />
      )}
    </div>
  )
}
