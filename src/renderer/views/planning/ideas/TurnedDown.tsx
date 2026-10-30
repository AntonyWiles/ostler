import { useCallback, useEffect, useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, InlineAlert } from '../../../ui'
import { chevronClass, ChevronRight, Icon, RotateCcw } from '../../../ui/icons'
import './TurnedDown.css'

/** What Turned down needs from the workspace; the tests pass a fake. */
export interface TurnedDownWorkspace {
  projectId: string
  /** The live tasks: a change to them (a new Not now, say) reloads the list. */
  workItems: PlanningWorkItem[]
  reopenWorkItem(item: PlanningWorkItem): Promise<void>
  openClosedWorkItem?(item: PlanningWorkItem): void
}

/** Whether an archived task is a turned-down idea: closed as won't do while in Someday. */
export function isTurnedDownIdea(item: PlanningWorkItem): boolean {
  return item.resolution === 'wont-do' && Boolean(item.someday)
}

/**
 * Turned down (N1.1b): the ideas closed as won't do while in Someday, which
 * keep their Someday flag in the Archive. Collapsed at first; each shows its
 * reason, and Reopen puts it back in Someday (never on the Board: it kept
 * its flag), through the one unarchive every Reopen uses.
 */
export function TurnedDown({ ws }: { ws: TurnedDownWorkspace }) {
  const [items, setItems] = useState<PlanningWorkItem[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { projectId } = ws

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningWorkItems(projectId, 'archived')
    if (result.ok) {
      setError(null)
      setItems(result.value.filter(isTurnedDownIdea))
    } else setError(t('tasks:ideas.couldntLoad'))
  }, [projectId])

  // One read when the live tasks change: a Not now or a Reopen moves an idea between the two.
  useEffect(() => {
    void load()
  }, [load, ws.workItems])

  if (items.length === 0 && !error) return null

  const reopen = async (item: PlanningWorkItem) => {
    await ws.reopenWorkItem(item)
    await load()
  }

  return (
    <section className="turned-down" aria-labelledby="turned-down-heading">
      <h3 id="turned-down-heading" className="turned-down__heading">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="turned-down-list"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon icon={ChevronRight} className={chevronClass(open)} />
          {t('tasks:ideas.turnedDownCount', { count: items.length })}
        </Button>
      </h3>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {open && (
        <>
          <p className="turned-down__hint">{t('tasks:ideas.turnedDownHint')}</p>
          <ul
            id="turned-down-list"
            className="turned-down__list"
            aria-label={t('tasks:ideas.turnedDownList')}
          >
            {items.map((item) => (
              <li key={item.id} className="turned-down__item">
                <span className="turned-down__text">
                  {ws.openClosedWorkItem ? (
                    <button
                      type="button"
                      className="turned-down__title"
                      onClick={() => ws.openClosedWorkItem?.(item)}
                    >
                      {item.title}
                    </button>
                  ) : (
                    <span className="turned-down__title">{item.title}</span>
                  )}
                  <span className="turned-down__reason">
                    {item.resolutionReason || t('tasks:ideas.noReason')}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={RotateCcw}
                  aria-label={t('tasks:ideas.reopenFor', { title: item.title })}
                  onClick={() => void reopen(item)}
                >
                  {t('tasks:ideas.reopen')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
