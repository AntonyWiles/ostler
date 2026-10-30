import { useState } from 'react'
import type {
  PlanningDependencyLink,
  PlanningDependencyType,
  PlanningWorkItem
} from '@shared/ostler-api'
import { MAX_DEPENDENCY_LAG_DAYS } from '@shared/ostler-api'
import { dependencyCandidates } from '@shared/planning/dependencies'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { IconButton, NumberField, Select } from '../../ui'
import { Pencil } from '../../ui/icons'
import { WaitsOnField, type WaitsOnChoice } from './WaitsOnField'
import { dependencyLinkWords, dependencyTypeOptions } from './dependency-link-words'
import { t } from '@shared/i18n'

/**
 * What this task waits on, in the drawer: the list and its picker. The
 * picker offers what the main process accepts (`dependencyCandidates`);
 * anything already listed can always be removed. Each link says its type
 * and lag in words, with a small editor for them (N7.2a).
 */
export function TaskDependencies({
  ws,
  item,
  openTask
}: {
  ws: PlanningWorkspace
  item: PlanningWorkItem
  /** Opens another task in the drawer, saving what is typed in this one first. */
  openTask: (task: PlanningWorkItem) => void
}) {
  // Older fakes of the workspace have no links: every link is then finish to start.
  const links = new Map((ws.editDependencyLinks ?? []).map((link) => [link.id, link]))
  const chosen = waitsOnChoices(ws, ws.editDependencyIds, openTask).map((choice) => {
    const link = links.get(choice.id)
    if (!link || choice.missing) return choice
    return {
      ...choice,
      detail: (
        <DependencyLinkDetail
          link={link}
          title={choice.title}
          onChange={(change, typed) => ws.setEditDependencyLink(link.id, change, typed)}
        />
      )
    }
  })
  return (
    <>
      <WaitsOnField
        chosen={chosen}
        options={dependencyCandidates(item, ws.workItems)
          .filter((candidate) => !ws.editDependencyIds.includes(candidate.id))
          .map((candidate) => ({
            value: candidate.id,
            label: candidate.title,
            description:
              ws.projectedStatus(candidate) === 'done'
                ? t('tasks:taskDependencies.done')
                : undefined
          }))}
        onAdd={(id) => ws.setEditDependencyIds([...ws.editDependencyIds, id])}
        onRemove={(id) =>
          ws.setEditDependencyIds(ws.editDependencyIds.filter((other) => other !== id))
        }
        placeholder={
          item.parentWorkItemId
            ? t('tasks:taskDependencies.addTaskPhaseWaits')
            : t('tasks:taskDependencies.addTaskWaits')
        }
        emptyText={
          ws.workItems.length === 1
            ? t('tasks:taskDependencies.addAnotherTaskSet')
            : t('tasks:taskDependencies.noMatchingTasks')
        }
      />
      {chosen.length > 0 && (
        <p className="task-dependencies__help">{t('tasks:taskDependencies.help')}</p>
      )}
    </>
  )
}

/** One link in words, and its type and lag behind an edit button. */
export function DependencyLinkDetail({
  link,
  title,
  onChange
}: {
  link: PlanningDependencyLink
  title: string
  onChange: (
    change: Partial<Pick<PlanningDependencyLink, 'type' | 'lagDays'>>,
    typed?: boolean
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [lag, setLag] = useState<number | null>(link.lagDays)
  const [shown, setShown] = useState(link.lagDays)
  // The saved lag changed elsewhere (undo, another surface): show it.
  if (shown !== link.lagDays) {
    setShown(link.lagDays)
    setLag(link.lagDays)
  }
  const commitLag = (value: number | null, typed: boolean) => {
    setLag(value)
    if (value === null || !Number.isInteger(value)) return
    if (Math.abs(value) > MAX_DEPENDENCY_LAG_DAYS) return
    setShown(value)
    onChange({ lagDays: value }, typed)
  }
  return (
    <>
      <span className="task-dependencies__summary">
        <span>{dependencyLinkWords(link, title)}</span>
        <IconButton
          size="sm"
          icon={Pencil}
          label={t('tasks:taskDependencies.editLink', { title })}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        />
      </span>
      {open && (
        <span className="task-dependencies__editor">
          <Select
            size="sm"
            label={t('tasks:taskDependencies.linkType')}
            options={dependencyTypeOptions()}
            value={link.type}
            onChange={(event) => onChange({ type: event.target.value as PlanningDependencyType })}
          />
          <NumberField
            label={t('tasks:taskDependencies.lag')}
            value={lag}
            min={-MAX_DEPENDENCY_LAG_DAYS}
            max={MAX_DEPENDENCY_LAG_DAYS}
            unit={t('tasks:taskDependencies.lagUnit')}
            onChange={(value) => commitLag(value, true)}
          />
        </span>
      )}
    </>
  )
}

/** The chosen tasks as the list shows them, in the order they were chosen. */
export function waitsOnChoices(
  ws: PlanningWorkspace,
  ids: string[],
  openTask?: (task: PlanningWorkItem) => void
): WaitsOnChoice[] {
  return ids.map((id) => {
    const dependency = ws.workItemsById.get(id)
    if (!dependency) {
      return { id, title: t('tasks:taskDependencies.taskNoLongerExists'), missing: true }
    }
    return {
      id,
      title: dependency.title,
      status: ws.projectedStatus(dependency),
      onOpen: openTask ? () => openTask(dependency) : undefined
    }
  })
}
