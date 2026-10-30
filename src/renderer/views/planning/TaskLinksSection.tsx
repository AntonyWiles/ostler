import { useCallback, useEffect, useState } from 'react'
import {
  PLANNING_LINK_KINDS,
  type PlanningLinkKind,
  type PlanningTaskLink,
  type PlanningWorkItem
} from '@shared/ostler-api'
import { LINK_ROLE_ORDER, linkKindLabel, linkRoleLabel } from '@shared/planning/links'
import { t } from '@shared/i18n'
import { Button, Combobox, IconButton, InlineAlert, Select, StatusBadge, useToast } from '../../ui'
import { Link2, X } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'

/** What the section needs from the workspace; the tests pass a fake. */
export interface TaskLinksWorkspace {
  workItems: PlanningWorkItem[]
  workItemsById: Map<string, PlanningWorkItem>
}

/**
 * Links (N2.4, N19): the tasks this one relates to, duplicates or was copied
 * from, and the other way round, beside Waits on but apart from it: links
 * never move dates or hold work back. Each opens its task; Link to… picks a
 * kind and a task of the project; remove happens at once, with undo.
 */
export function TaskLinksSection({
  ws,
  item,
  openTask
}: {
  ws: TaskLinksWorkspace
  item: PlanningWorkItem
  /** Opens another task in the drawer, saving what is typed in this one first. */
  openTask: (task: PlanningWorkItem) => void
}) {
  const { toastUndo } = useToast()
  const [links, setLinks] = useState<PlanningTaskLink[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<PlanningLinkKind>('relates')

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningWorkItemLinks(item.id)
    if (result.ok) setLinks(result.value)
    else setError(result.error || t('tasks:taskLinks.couldntLoad'))
  }, [item.id])

  // Read again when the project's tasks change: a title or status may have.
  useEffect(() => {
    void load()
  }, [load, ws.workItems])

  const add = async (otherId: string) => {
    setError(null)
    const result = await window.ostlerAPI.addPlanningWorkItemLink(item.id, otherId, kind)
    if (!result.ok) {
      setError(result.error || t('tasks:taskLinks.couldntAdd'))
      return
    }
    setAdding(false)
    await load()
  }

  const remove = async (link: PlanningTaskLink) => {
    setError(null)
    const result = await window.ostlerAPI.removePlanningWorkItemLink(item.id, link.id)
    if (!result.ok) {
      setError(result.error || t('tasks:taskLinks.couldntRemove'))
      return
    }
    await load()
    // Put back the way it pointed: from the duplicate or copy to its original.
    const fromThis = link.role !== 'duplicated-by' && link.role !== 'copied-to'
    toastUndo(t('tasks:taskLinks.removed', { title: link.otherTitle }), async () => {
      const back = fromThis
        ? await window.ostlerAPI.addPlanningWorkItemLink(item.id, link.otherWorkItemId, link.kind)
        : await window.ostlerAPI.addPlanningWorkItemLink(link.otherWorkItemId, item.id, link.kind)
      if (!back.ok) setError(back.error || t('tasks:taskLinks.couldntRestore'))
      await load()
    })
  }

  const linkedIds = new Set(
    links.filter((link) => link.kind === kind).map((link) => link.otherWorkItemId)
  )
  const sorted = [...links].sort(
    (a, b) => LINK_ROLE_ORDER.indexOf(a.role) - LINK_ROLE_ORDER.indexOf(b.role)
  )

  return (
    <TaskDrawerSection
      title={t('tasks:taskLinks.title')}
      description={t('tasks:taskLinks.description')}
      className="task-links"
      part={{ id: 'links', inUse: links.length > 0, start: () => setAdding(true) }}
      actions={
        !adding && (
          <Button size="sm" variant="ghost" icon={Link2} onClick={() => setAdding(true)}>
            {t('tasks:taskLinks.linkTo')}
          </Button>
        )
      }
    >
      {sorted.length === 0 && !adding && (
        <p className="task-links__empty">{t('tasks:taskLinks.none')}</p>
      )}
      {sorted.length > 0 && (
        <ul className="task-links__list" aria-label={t('tasks:taskLinks.title')}>
          {sorted.map((link) => {
            const live = ws.workItemsById.get(link.otherWorkItemId)
            return (
              <li key={link.id} className="task-links__row">
                <span className="task-links__role">{linkRoleLabel(link.role)}</span>
                <StatusBadge status={link.otherStatus} iconOnly />
                {live ? (
                  <button
                    type="button"
                    className="task-links__open"
                    title={t('tasks:taskDependencies.openTask')}
                    onClick={() => openTask(live)}
                  >
                    {link.otherTitle}
                  </button>
                ) : (
                  <span className="task-links__open">{link.otherTitle}</span>
                )}
                {link.otherClosed && (
                  <span className="task-links__closed">{t('tasks:taskLinks.closedTask')}</span>
                )}
                <IconButton
                  size="sm"
                  icon={X}
                  label={t('tasks:taskLinks.remove', { title: link.otherTitle })}
                  onClick={() => void remove(link)}
                />
              </li>
            )
          })}
        </ul>
      )}
      {adding && (
        <div className="task-links__add">
          <Select
            label={t('tasks:taskLinks.kind')}
            size="sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as PlanningLinkKind)}
            options={PLANNING_LINK_KINDS.map((value) => ({
              value,
              label: linkKindLabel(value)
            }))}
          />
          <Combobox
            label={t('tasks:taskLinks.task')}
            placeholder={t('tasks:taskLinks.pickTask')}
            emptyText={t('tasks:taskLinks.noMatchingTasks')}
            options={ws.workItems
              .filter((candidate) => candidate.id !== item.id && !linkedIds.has(candidate.id))
              .map((candidate) => ({ value: candidate.id, label: candidate.title }))}
            value={null}
            onChange={(id) => {
              if (id) void add(id)
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
            {t('tasks:taskLinks.cancel')}
          </Button>
        </div>
      )}
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
    </TaskDrawerSection>
  )
}
