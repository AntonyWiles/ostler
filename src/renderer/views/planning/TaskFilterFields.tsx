import { useCallback, useMemo, type ReactNode } from 'react'
import type {
  PlanningFieldDefinition,
  PlanningIteration,
  PlanningSubproject,
  PlanningTaskType,
  PlanningWorkItem
} from '@shared/ostler-api'
import { ITERATION_CURRENT } from '@shared/planning/iterations'
import type { FilterNames, TaskFilterCondition } from '@shared/task-filter'
import { useProjectColumns } from '../../context/ColumnsContext'
import type { TaskView } from '../../hooks/useTaskFilters'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, FilterBuilder, SearchField, type FilterChoices } from '../../ui'
import { IterationCw } from '../../ui/icons'
import { usePeople } from '../../context/PeopleContext'
import { peopleOptions } from './task-options'
import { ViewsMenu } from './ViewsMenu'
import { DescribeFilter } from './DescribeFilter'
import './TaskToolbar.css'
import { t } from '@shared/i18n'
import { contactRoleLabel, type TaskContactMarks } from '@shared/contacts'
import { useContacts } from '../../contacts/useContacts'

/**
 * The Contact filter's choices (N6.5): each contact the project's tasks
 * name, by name, then once for each role it is named in.
 */
function contactChoices(
  marks: TaskContactMarks | undefined,
  name: (id: string) => string | undefined
): { value: string; label: string }[] {
  const roles = new Map<string, Set<string>>()
  for (const links of Object.values(marks ?? {}))
    for (const link of links)
      roles.set(link.contactId, (roles.get(link.contactId) ?? new Set()).add(link.role))
  return [...roles.entries()]
    .map(([id, used]) => ({ id, label: name(id), used }))
    .filter((entry): entry is { id: string; label: string; used: Set<string> } => !!entry.label)
    .sort((a, b) => a.label.localeCompare(b.label))
    .flatMap(({ id, label, used }) => [
      { value: id, label },
      ...[...used].sort().map((role) => ({
        value: `${id}:${role}`,
        label: t('tasks:taskFilter.contactInRole', {
          name: label,
          role: contactRoleLabel(role as never)
        })
      }))
    ])
}

/** "Iteration is the current iteration", the condition the "Current iteration" toggle adds (R6.1). */
function isCurrentIteration(condition: TaskFilterCondition): boolean {
  return (
    condition.field === 'iteration' &&
    condition.op === 'is' &&
    Array.isArray(condition.value) &&
    condition.value.length === 1 &&
    condition.value[0] === ITERATION_CURRENT
  )
}

/** What the filter fields read and set: a view's filter, search and saved views. */
export type TaskFilterFieldsValue = TaskView<object>

/**
 * What every task view's toolbar starts with (Board, List, Calendar,
 * Timeline): the Views menu, the search box, "Assigned to me" (a shortcut
 * for the chip "Assignee is me") and the filter chips (FilterBuilder), then
 * the view's own extras (`children`).
 */
export function TaskFilterFields({
  filters,
  ws,
  workItems,
  embedded = false,
  children
}: {
  /**
   * Shown inside Customise board, beside the toolbar it mirrors: no Views
   * menu (the panel lists the views) and no / shortcut (the toolbar keeps it).
   */
  embedded?: boolean
  filters: TaskFilterFieldsValue
  ws: Pick<PlanningWorkspace, 'milestones' | 'goals'> & {
    /** The project, for Describe it (N8.1); without one the button is not shown. */
    projectId?: string
    /** The project's custom fields (R2.2), offered in Add filter. */
    fields?: readonly PlanningFieldDefinition[]
    /** The project's iterations (R6.1): with any, the "Current iteration" toggle and filter. */
    iterations?: readonly PlanningIteration[]
    /** The project's task types (N2.7a): with any, the Type filter. */
    taskTypes?: readonly PlanningTaskType[]
    /** The project's workstreams: with any, the Workstream filter. */
    subprojects?: readonly PlanningSubproject[]
    /** The contacts each task names (N6.5): with any, the Contact filter. */
    taskContacts?: TaskContactMarks
  }
  /** The view's tasks, so archived people who still have work are offered. */
  workItems: readonly PlanningWorkItem[]
  children?: ReactNode
}) {
  const people = usePeople()
  // Read the contact list only when a task here names a contact (the scale budgets).
  const namesContacts = Object.keys(ws.taskContacts ?? {}).length > 0
  const { contacts } = useContacts(namesContacts)
  const contactName = useCallback(
    (id: string) => contacts?.find((contact) => contact.id === id)?.name,
    [contacts]
  )
  const choices: FilterChoices = useMemo(
    () => ({
      people: peopleOptions(people, workItems),
      milestones: ws.milestones.map((milestone) => ({
        value: milestone.id,
        label: milestone.name
      })),
      goals: ws.goals.map((goal) => ({ value: goal.id, label: goal.title })),
      labels: [...new Set(workItems.flatMap((item) => item.labels))]
        .sort((a, b) => a.localeCompare(b))
        .map((label) => ({ value: label, label })),
      iterations: (ws.iterations ?? []).map((iteration) => ({
        value: iteration.id,
        label: iteration.name
      })),
      types: (ws.taskTypes ?? []).map((type) => ({ value: type.id, label: type.name })),
      subprojects: (ws.subprojects ?? []).map((sub) => ({ value: sub.id, label: sub.name })),
      contacts: contactChoices(ws.taskContacts, contactName)
    }),
    [
      people,
      workItems,
      ws.milestones,
      ws.goals,
      ws.iterations,
      ws.taskTypes,
      ws.subprojects,
      ws.taskContacts,
      contactName
    ]
  )
  const current = filters.filter.conditions.some(isCurrentIteration)
  const hasIterations = (ws.iterations?.length ?? 0) > 0
  // This project's column words, and only the columns it shows (R2.4).
  const columns = useProjectColumns()
  const names: FilterNames = {
    person: (id) => people.all.find((person) => person.id === id)?.name,
    milestone: (id) => ws.milestones.find((milestone) => milestone.id === id)?.name,
    goal: (id) => ws.goals.find((goal) => goal.id === id)?.title,
    iteration: (id) => ws.iterations?.find((iteration) => iteration.id === id)?.name,
    taskType: (id) => ws.taskTypes?.find((type) => type.id === id)?.name,
    subproject: (id) => ws.subprojects?.find((sub) => sub.id === id)?.name,
    contact: contactName,
    customField: (id) => ws.fields?.find((field) => field.id === id),
    columns
  }
  return (
    <>
      {!embedded && <ViewsMenu view={filters} />}
      <SearchField
        label={t('tasks:taskFilterFields.searchTasks')}
        placeholder={t('tasks:taskFilterFields.searchTasks')}
        className="task-toolbar__search"
        slashShortcut={!embedded}
        value={filters.query}
        onChange={(event) => filters.setQuery(event.target.value)}
        onClear={() => filters.setQuery('')}
      />
      {(hasIterations || current) && (
        <Button
          size="sm"
          variant={current ? 'secondary' : 'ghost'}
          icon={IterationCw}
          aria-pressed={current}
          onClick={() =>
            filters.setFilter({
              ...filters.filter,
              conditions: current
                ? filters.filter.conditions.filter((condition) => !isCurrentIteration(condition))
                : [
                    ...filters.filter.conditions,
                    { field: 'iteration', op: 'is', value: [ITERATION_CURRENT] }
                  ]
            })
          }
        >
          {t('tasks:taskFilterFields.currentIteration')}
        </Button>
      )}
      {ws.projectId && (
        <DescribeFilter
          projectId={ws.projectId}
          filter={filters.filter}
          setFilter={filters.setFilter}
        />
      )}
      <FilterBuilder
        value={filters.filter}
        onChange={filters.setFilter}
        choices={choices}
        names={names}
        customFields={ws.fields}
      />
      {children}
    </>
  )
}
