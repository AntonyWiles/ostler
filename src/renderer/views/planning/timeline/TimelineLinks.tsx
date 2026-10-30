import { useState } from 'react'
import type {
  PlanningDependencyLink,
  PlanningDependencyType,
  PlanningWorkItem
} from '@shared/ostler-api'
import { MAX_DEPENDENCY_LAG_DAYS } from '@shared/ostler-api'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { dependencyCandidates } from '@shared/planning/dependencies'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import { Button, NumberField, Popover, Select, useToast } from '../../../ui'
import { dependencyTypeOptions, timelineLinkWords } from '../dependency-link-words'
import { t } from '@shared/i18n'

type LinkChange = Pick<PlanningDependencyLink, 'type' | 'lagDays'>

/**
 * Making, changing and removing waits-on links from the Timeline (N7.2b).
 * One path with the drawer: every change is the task's normal update with
 * `dependencyIds` and `dependencyLinks`, so the main process's checks (no
 * cycles, a subtask only to its siblings) and activity are the same, and
 * each change offers undo in its toast.
 */
export function useTimelineLinks(ws: PlanningWorkspace) {
  const { toastUndo } = useToast()

  const save = async (
    item: PlanningWorkItem,
    links: PlanningDependencyLink[],
    message: string
  ): Promise<boolean> => {
    const before = {
      dependencyIds: item.dependencyIds,
      dependencyLinks: dependencyLinksOf(item)
    }
    const after = { dependencyIds: links.map((link) => link.id), dependencyLinks: links }
    const saved = await ws.updateWorkItemInline(item, after)
    if (!saved) return false
    toastUndo(message, () => ws.updateWorkItemInline({ ...item, ...after }, before))
    return true
  }

  const words = (item: PlanningWorkItem, dependencyId: string) => ({
    itemTitle: item.title,
    title: ws.workItems.find((other) => other.id === dependencyId)?.title ?? ''
  })

  return {
    /** `item` now waits on `dependencyId`. */
    add: (item: PlanningWorkItem, dependencyId: string, change: LinkChange) =>
      save(
        item,
        [...dependencyLinksOf(item), { id: dependencyId, ...change }],
        t('views:timelineView.linkAdded', words(item, dependencyId))
      ),
    change: (item: PlanningWorkItem, dependencyId: string, change: LinkChange) =>
      save(
        item,
        dependencyLinksOf(item).map((link) =>
          link.id === dependencyId ? { ...link, ...change } : link
        ),
        t('views:timelineView.linkChanged', words(item, dependencyId))
      ),
    remove: (item: PlanningWorkItem, dependencyId: string) =>
      save(
        item,
        dependencyLinksOf(item).filter((link) => link.id !== dependencyId),
        t('views:timelineView.linkRemoved', words(item, dependencyId))
      )
  }
}

export type TimelineLinks = ReturnType<typeof useTimelineLinks>

/**
 * The tasks that may be set to wait on `dependency`: what the drawer would
 * offer each of them (`dependencyCandidates`), less those already waiting on it.
 */
export function linkTargets(
  dependency: PlanningWorkItem,
  items: PlanningWorkItem[]
): PlanningWorkItem[] {
  return items.filter(
    (item) =>
      item.id !== dependency.id &&
      !item.dependencyIds.includes(dependency.id) &&
      dependencyCandidates(item, items).some((candidate) => candidate.id === dependency.id)
  )
}

/** What the link popover is about. */
export type LinkPopoverState =
  | {
      kind: 'new'
      anchor: Element
      /** The task waited on. */
      dependency: PlanningWorkItem
      /** The task that waits, or null to pick one (Link to…). */
      item: PlanningWorkItem | null
      type: PlanningDependencyType
    }
  | {
      kind: 'edit'
      anchor: Element
      dependency: PlanningWorkItem
      item: PlanningWorkItem
      link: PlanningDependencyLink
    }

/**
 * The small popover that confirms a new link's type and lag, or changes or
 * removes an existing one. With no task yet (Link to…), it picks the task
 * that waits first, so the whole thing works from the keyboard.
 */
export function LinkPopover({
  state,
  items,
  links,
  onClose
}: {
  state: LinkPopoverState
  items: PlanningWorkItem[]
  links: TimelineLinks
  onClose: () => void
}) {
  const initial = state.kind === 'edit' ? state.link : { type: state.type, lagDays: 0 }
  const targets = state.kind === 'new' && !state.item ? linkTargets(state.dependency, items) : []
  const [itemId, setItemId] = useState<string>(state.item?.id ?? targets[0]?.id ?? '')
  const [type, setType] = useState<PlanningDependencyType>(initial.type)
  const [lag, setLag] = useState<number | null>(initial.lagDays)
  const item = state.item ?? items.find((candidate) => candidate.id === itemId) ?? null
  const lagOk = lag !== null && Number.isInteger(lag) && Math.abs(lag) <= MAX_DEPENDENCY_LAG_DAYS
  const label = item
    ? t('views:timelineView.linkEditLabel', {
        title: state.dependency.title,
        itemTitle: item.title
      })
    : t('views:timelineView.linkToLabel', { title: state.dependency.title })

  const submit = async () => {
    if (!item || !lagOk) return
    const change = { type, lagDays: lag }
    onClose()
    if (state.kind === 'edit') await links.change(item, state.dependency.id, change)
    else await links.add(item, state.dependency.id, change)
  }

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={{ current: state.anchor as HTMLElement }}
      label={label}
      className="timeline-link-popover"
    >
      <form
        className="timeline-link-popover__form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {state.kind === 'new' && !state.item && targets.length === 0 ? (
          <p className="timeline-link-popover__note">
            {t('views:timelineView.noLinkTargets', { title: state.dependency.title })}
          </p>
        ) : (
          <>
            {state.kind === 'new' && !state.item && (
              <Select
                size="sm"
                label={t('views:timelineView.linkWaitingTask')}
                options={targets.map((target) => ({ value: target.id, label: target.title }))}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              />
            )}
            <Select
              size="sm"
              label={t('tasks:taskDependencies.linkType')}
              options={dependencyTypeOptions()}
              value={type}
              onChange={(event) => setType(event.target.value as PlanningDependencyType)}
            />
            <NumberField
              label={t('tasks:taskDependencies.lag')}
              value={lag}
              min={-MAX_DEPENDENCY_LAG_DAYS}
              max={MAX_DEPENDENCY_LAG_DAYS}
              unit={t('tasks:taskDependencies.lagUnit')}
              onChange={setLag}
            />
            {item && lagOk && (
              <p className="timeline-link-popover__words">
                {timelineLinkWords({ type, lagDays: lag }, item.title, state.dependency.title)}
              </p>
            )}
          </>
        )}
        <div className="timeline-link-popover__actions">
          {state.kind === 'edit' && (
            <Button
              size="sm"
              variant="danger"
              className="timeline-link-popover__remove"
              onClick={() => {
                onClose()
                void links.remove(state.item, state.dependency.id)
              }}
            >
              {t('views:timelineView.removeLink')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('views:timelineView.cancelLink')}
          </Button>
          {(state.kind === 'edit' || item) && (
            <Button size="sm" variant="primary" type="submit" disabled={!item || !lagOk}>
              {state.kind === 'edit'
                ? t('views:timelineView.saveLink')
                : t('views:timelineView.addLink')}
            </Button>
          )}
        </div>
      </form>
    </Popover>
  )
}
