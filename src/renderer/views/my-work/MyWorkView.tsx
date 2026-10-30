import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type {
  AssignedTask,
  HomeChecklistItem,
  PlanningMilestone,
  PlanningPriority,
  PlanningWorkItemStatus,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import {
  MY_WORK_COLUMN_IDS,
  MY_WORK_COMPARERS,
  MY_WORK_GROUP_BY,
  groupMyWork,
  myWorkGroupByLabel,
  type MyWorkColumnId,
  type MyWorkGroupBy
} from '@shared/planning/my-work'
import { effectiveFilter, type TaskFilter, type TaskFilterField } from '@shared/task-filter'
import { ESTIMATE_UNIT_SHORT, TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { visibleStatuses } from '@shared/board-columns'
import { PERF_MARKS } from '@shared/perf-marks'
import { t } from '@shared/i18n'
import { ChecklistItemRows } from '../home/ChecklistItemRows'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { useAllProjectColumns, useStatusLabelFor } from '../../context/ColumnsContext'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { useToday } from '../../hooks/useToday'
import { useRepeatNotice } from '../../hooks/planning/useRepeatNotice'
import { useRenderedMark } from '../../lib/perf-marks'
import { homePath, myWorkPath, taskPath, timesheetPath, workloadPath } from '../../navigation/paths'
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Section,
  FilterBuilder,
  InlineAlert,
  MenuList,
  PageHeader,
  Popover,
  PriorityIcon,
  PRIORITY_ICONS,
  SearchField,
  Select,
  Skeleton,
  sortRows,
  STATUS_ICONS,
  StatusBadge,
  Toolbar,
  useToast,
  type DataTableColumn,
  type DataTableEntry,
  type FilterChoices,
  type MenuEntry,
  type RowComparer
} from '../../ui'
import { CalendarClock, ListTodo, X } from '../../ui/icons'
import { RescheduleDialog } from '../../components/reschedule/RescheduleDialog'
import { AssigneeField, PersonAvatar } from '../planning/AssigneeField'
import { DateEditor, EditableCell, dateText, muted } from '../planning/list/ListCells'
import { readMyWorkSettings, writeMyWorkSettings, type MyWorkSettings } from './my-work-settings'
import '../planning/TaskToolbar.css'
import '../planning/list/ListView.css'
import './MyWorkView.css'
import { projectSelectOptions } from '../../components/areas/project-options'

/** The filter fields that mean the same in every project. */
const SHARED_FIELDS: readonly TaskFilterField[] = [
  'text',
  'status',
  'priority',
  'due',
  'start',
  'estimate',
  'created',
  'updated'
]
/** Fields that only make sense inside one project: offered once one is chosen. */
const PROJECT_FIELDS: readonly TaskFilterField[] = ['milestone', 'labels']
const ALL_FIELDS: readonly TaskFilterField[] = [
  'text',
  'status',
  'priority',
  'assignee',
  'labels',
  'milestone',
  'goal',
  'due',
  'start',
  'estimate',
  'checklist',
  'hasComments',
  'recurring',
  'created',
  'updated',
  'custom'
]

/** How long typing in the search box settles before My work asks again. */
const SEARCH_DELAY_MS = 200

/** The cells that edit in place, as on the List. */
const EDITABLE: readonly MyWorkColumnId[] = ['status', 'priority', 'due', 'assignee']

interface Editing {
  rowId: string
  columnId: MyWorkColumnId
}

/** `value` once it has stopped changing for `delay` ms. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * My work (R3.1): every live task assigned to one person, across every
 * enabled project, in one table with the List's cells. Main answers it in one
 * query and pushes `home` when a task changes anywhere. A task opens in its
 * project with its drawer (`taskPath`): the drawer edits through its
 * project's whole workspace (milestones, dependencies, saves and undo), which
 * only the project's own view loads. The person, project, grouping, sort and
 * filters are remembered in localStorage; `?person=` opens it on someone else,
 * an archived person too.
 */
export function MyWorkView() {
  const people = usePeople()
  const { projects, areas } = useOstler()
  const navigate = useNavigate()
  const { toast } = useToast()
  // The list is read again after every change, so the notice needs no reload of its own.
  const noticeRepeat = useRepeatNotice(async () => {})
  const columnSettings = useAllProjectColumns().byProject
  const statusLabel = useStatusLabelFor()
  const [params] = useSearchParams()
  const [settings, setSettings] = useState<MyWorkSettings>(readMyWorkSettings)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [milestones, setMilestones] = useState<PlanningMilestone[]>([])
  const [rescheduling, setRescheduling] = useState<string[] | null>(null)

  const update = (next: Partial<MyWorkSettings>) =>
    setSettings((current) => {
      const merged = { ...current, ...next }
      writeMyWorkSettings(merged)
      return merged
    })

  const linkedPerson = params.get('person')
  const personId = linkedPerson ?? settings.personId ?? people.me?.id ?? null
  const person = personId ? people.byId.get(personId) : undefined
  const enabledProjects = useMemo(
    () =>
      projects.filter((project) => project.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  )
  const projectId =
    settings.projectId && enabledProjects.some((project) => project.id === settings.projectId)
      ? settings.projectId
      : null

  // Milestone and label conditions belong to one project: dropped with it.
  const filter: TaskFilter = projectId
    ? settings.filter
    : {
        ...settings.filter,
        conditions: settings.filter.conditions.filter(
          (condition) => !PROJECT_FIELDS.includes(condition.field)
        )
      }
  const today = useToday()
  const words = useSettled(query.trim(), SEARCH_DELAY_MS)
  const asked = {
    personId: personId ?? '',
    projectId,
    hideDone: settings.hideDone,
    query: words,
    filter: effectiveFilter(filter),
    today
  }
  const askedKey = JSON.stringify(asked)
  const work = useHomeFeed<AssignedTask[]>(
    () =>
      personId
        ? window.ostlerAPI.getAssignedTasks(JSON.parse(askedKey))
        : Promise.resolve({ ok: true, value: [] }),
    [askedKey]
  )
  const tasks = work.value
  // The person's dated checklist items (N2.2), whoever the task belongs to.
  const itemsKey = JSON.stringify({ personId: personId ?? '', projectId, today })
  const items = useHomeFeed<HomeChecklistItem[]>(
    () =>
      personId
        ? window.ostlerAPI.getAssignedChecklistItems(JSON.parse(itemsKey))
        : Promise.resolve({ ok: true, value: [] }),
    [itemsKey]
  )
  useRenderedMark(PERF_MARKS.myWorkRendered, tasks !== null, askedKey, {
    count: tasks?.length ?? 0
  })

  useEffect(() => {
    if (!projectId) {
      setMilestones([])
      return
    }
    let live = true
    void window.ostlerAPI.getPlanningMilestones(projectId).then((result) => {
      if (live && result.ok) setMilestones(result.value)
    })
    return () => {
      live = false
    }
  }, [projectId])

  const choices: FilterChoices = useMemo(
    () => ({
      people: [],
      goals: [],
      milestones: milestones.map((milestone) => ({ value: milestone.id, label: milestone.name })),
      labels: [...new Set((tasks ?? []).flatMap((task) => task.labels))]
        .sort((a, b) => a.localeCompare(b))
        .map((label) => ({ value: label, label }))
    }),
    [milestones, tasks]
  )
  const shown = projectId ? [...SHARED_FIELDS, ...PROJECT_FIELDS] : SHARED_FIELDS
  const hiddenFields = ALL_FIELDS.filter((field) => !shown.includes(field))

  /** One field changed in place: shown at once, saved through the drawer's own call. */
  const save = async (task: AssignedTask, patch: UpdatePlanningWorkItemInput) => {
    setEditing(null)
    setFocusRowId(task.id)
    work.setValue((current) =>
      (current ?? []).map((row) => (row.id === task.id ? { ...row, ...patch } : row))
    )
    const result = await window.ostlerAPI.updatePlanningWorkItem(task.id, patch)
    if (!result.ok) {
      toast({
        title: t('views:myWork.couldntChange', { title: task.title }),
        body: result.error,
        tone: 'danger'
      })
    } else noticeRepeat(result.value)
    // Read again: a task given to someone else leaves the list, and a refused change comes back.
    void work.reload()
  }
  const close = (task: AssignedTask) => {
    setEditing(null)
    setFocusRowId(task.id)
  }
  const isEditing = (task: AssignedTask, columnId: MyWorkColumnId) =>
    editing?.rowId === task.id && editing.columnId === columnId
  /** A click on an editable cell opens its editor, as Enter does (not clicks inside the editor). */
  const editable = (task: AssignedTask, columnId: MyWorkColumnId, cell: ReactNode) => (
    <span
      className="my-work__editable"
      onClick={(event) => {
        if (!event.currentTarget.contains(event.target as Node) || isEditing(task, columnId)) return
        if (columnId === 'status' && task.linked) open(task)
        else setEditing({ rowId: task.id, columnId })
      }}
    >
      {cell}
    </span>
  )
  const menu = (task: AssignedTask, label: string, entries: MenuEntry[]) =>
    function MenuEditor(anchor: RefObject<HTMLSpanElement | null>) {
      return (
        <MenuList
          label={label}
          entries={entries}
          open
          onClose={() => close(task)}
          anchorRef={anchor}
        />
      )
    }

  const columns: Record<MyWorkColumnId, DataTableColumn<AssignedTask>> = {
    title: {
      id: 'title',
      header: t('views:myWork.columns.title'),
      width: 340,
      minWidth: 160,
      cell: (task) => (
        <span className="list-cell__title">
          <Link
            className="list-cell__title-text my-work__title"
            to={taskPath(task.projectId, task.id)}
            tabIndex={-1}
            title={task.title}
          >
            {task.title}
          </Link>
        </span>
      )
    },
    project: {
      id: 'project',
      header: t('views:myWork.columns.project'),
      width: 180,
      cell: (task) => (
        <span className="my-work__project" title={task.projectName}>
          <span
            className="my-work__dot"
            style={{ background: task.projectColor }}
            aria-hidden="true"
          />
          <span className="list-cell__text">{task.projectName}</span>
        </span>
      )
    },
    status: {
      id: 'status',
      header: t('views:myWork.columns.status'),
      width: 140,
      cell: (task) => (
        <EditableCell
          editing={isEditing(task, 'status')}
          display={
            <StatusBadge status={task.status} columnId={task.columnId} projectId={task.projectId} />
          }
          editor={menu(
            task,
            t('views:myWork.statusOf', { title: task.title }),
            visibleStatuses(columnSettings[task.projectId], task.status).map(
              (status: PlanningWorkItemStatus) => ({
                label: statusLabel(status, task.projectId),
                icon: STATUS_ICONS[status],
                onSelect: () => {
                  if (status !== task.status) void save(task, { status })
                }
              })
            )
          )}
        />
      )
    },
    due: {
      id: 'due',
      header: t('views:myWork.columns.due'),
      width: 110,
      cell: (task) => {
        const done = task.status === 'done'
        return (
          <EditableCell
            editing={isEditing(task, 'due')}
            display={task.targetDate ? dateText(task.targetDate, done, true) : null}
            editor={(anchor) => (
              <DateEditor
                anchor={anchor}
                label={t('views:myWork.dueDate')}
                initial={task.targetDate}
                due={!done}
                onClose={() => close(task)}
                onSave={(targetDate) => {
                  if (targetDate !== task.targetDate) void save(task, { targetDate })
                  else close(task)
                }}
              />
            )}
          />
        )
      }
    },
    start: {
      id: 'start',
      header: t('views:myWork.columns.start'),
      width: 110,
      cell: (task) =>
        task.startDate ? dateText(task.startDate, task.status === 'done', false) : null
    },
    priority: {
      id: 'priority',
      header: t('views:myWork.columns.priority'),
      width: 120,
      cell: (task) => (
        <EditableCell
          editing={isEditing(task, 'priority')}
          display={<PriorityIcon priority={task.priority} showLabel />}
          editor={menu(
            task,
            t('views:myWork.priorityOf', { title: task.title }),
            [...TASK_PRIORITIES].reverse().map((priority: PlanningPriority) => ({
              label: taskPriorityLabel(priority),
              icon: PRIORITY_ICONS[priority],
              onSelect: () => {
                if (priority !== task.priority) void save(task, { priority })
              }
            }))
          )}
        />
      )
    },
    assignee: {
      id: 'assignee',
      header: t('views:myWork.columns.assignee'),
      width: 170,
      cell: (task) => {
        const assignee = task.assigneeId ? people.byId.get(task.assigneeId) : undefined
        return (
          <EditableCell
            editing={isEditing(task, 'assignee')}
            display={
              assignee ? (
                <span className="list-cell__person">
                  <PersonAvatar person={assignee} />
                  <span className="list-cell__text">{assignee.name}</span>
                </span>
              ) : (
                muted(t('views:myWork.unassigned'))
              )
            }
            editor={(anchor) => (
              <Popover
                open
                onClose={() => close(task)}
                anchorRef={anchor}
                label={t('views:myWork.assigneeOf', { title: task.title })}
                className="list-editor"
              >
                <AssigneeField
                  projectId={task.projectId}
                  value={task.assigneeId}
                  onChange={(assigneeId) => {
                    if (assigneeId !== task.assigneeId) void save(task, { assigneeId })
                  }}
                />
              </Popover>
            )}
          />
        )
      }
    },
    milestone: {
      id: 'milestone',
      header: t('views:myWork.columns.milestone'),
      width: 170,
      cell: (task) =>
        task.milestoneName ? (
          <span className="list-cell__text" title={task.milestoneName}>
            {task.milestoneName}
          </span>
        ) : null
    },
    estimate: {
      id: 'estimate',
      header: t('views:myWork.columns.estimate'),
      width: 100,
      align: 'end',
      cell: (task) =>
        task.estimate === null ? null : (
          <span className="tabular-nums">
            {task.estimate} {ESTIMATE_UNIT_SHORT[task.estimateUnit]}
          </span>
        )
    }
  }
  const visibleColumns = MY_WORK_COLUMN_IDS.map((id): DataTableColumn<AssignedTask> => {
    const column = columns[id]
    return {
      ...column,
      ...MY_WORK_COMPARERS[id],
      ...(EDITABLE.includes(id)
        ? { cell: (task, state) => editable(task, id, column.cell(task, state)) }
        : {})
    }
  })
  const comparers = MY_WORK_COMPARERS as Record<string, RowComparer<AssignedTask> | undefined>

  const groups = groupMyWork(tasks ?? [], settings.groupBy, new Date(), (status) =>
    statusLabel(status, projectId)
  )
  const grouped = settings.groupBy !== 'none'
  const entries: DataTableEntry<AssignedTask>[] = groups.flatMap((group) => {
    const shut = collapsed.has(group.key)
    const head: DataTableEntry<AssignedTask>[] = grouped
      ? [
          {
            kind: 'group',
            id: group.key,
            label: group.color ? (
              <span className="my-work__project">
                <span
                  className="my-work__dot"
                  style={{ background: group.color }}
                  aria-hidden="true"
                />
                {group.label}
              </span>
            ) : (
              group.label
            ),
            count: group.tasks.length,
            collapsed: shut
          }
        ]
      : []
    if (shut) return head
    // The overdue group offers Reschedule (N1.3) for its unfinished tasks.
    const overdueIds =
      settings.groupBy === 'due' && group.key === 'overdue'
        ? group.tasks.filter((task) => task.status !== 'done').map((task) => task.id)
        : []
    const reschedule: DataTableEntry<AssignedTask>[] =
      overdueIds.length > 0
        ? [
            {
              kind: 'extra',
              id: 'reschedule-overdue',
              onActivate: () => setRescheduling(overdueIds),
              render: () => (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={CalendarClock}
                  tabIndex={-1}
                  onClick={() => setRescheduling(overdueIds)}
                >
                  {t('views:reschedule.openOverdue')}
                </Button>
              )
            }
          ]
        : []
    return [
      ...head,
      ...sortRows(group.tasks, settings.sort, comparers).map((task) => ({
        kind: 'row' as const,
        id: task.id,
        row: task,
        label: task.title
      })),
      ...reschedule
    ]
  })

  const open = (task: AssignedTask) => navigate(taskPath(task.projectId, task.id))

  const onCellKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    task: AssignedTask,
    columnId: string
  ) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    const id = columnId as MyWorkColumnId
    if (plain && (event.key === 'Enter' || event.key === 'F2') && EDITABLE.includes(id)) {
      // A queued task's status follows its agent run: it changes in its project.
      if (id === 'status' && task.linked) {
        open(task)
        return true
      }
      setEditing({ rowId: task.id, columnId: id })
      return true
    }
    return false
  }

  const personOptions = [
    ...people.active,
    ...(person && person.archivedAt !== null ? [person] : [])
  ].map((entry) => ({
    value: entry.id,
    label: entry.isMe
      ? t('views:myWork.you', { name: entry.name })
      : entry.archivedAt !== null
        ? t('views:myWork.archivedPerson', { name: entry.name })
        : entry.name
  }))
  // The conditions the list was asked for: not the ones dropped with "All projects".
  const isFiltered = asked.filter.conditions.length > 0 || query.trim() !== '' || projectId !== null

  const toolbar = (
    <Toolbar
      label={t('views:myWork.filters')}
      className="task-toolbar"
      end={
        <>
          {tasks && (
            <span className="task-toolbar__count" aria-live="polite">
              {t('views:myWork.count', { count: tasks.length })}
            </span>
          )}
          <Select
            label={t('views:myWork.groupByLabel')}
            hideLabel
            size="sm"
            value={settings.groupBy}
            onChange={(event) => update({ groupBy: event.target.value as MyWorkGroupBy })}
            options={MY_WORK_GROUP_BY.map((value) => ({
              value,
              label: myWorkGroupByLabel(value)
            }))}
          />
          <Checkbox
            label={t('views:myWork.hideDone')}
            checked={settings.hideDone}
            onChange={(event) => update({ hideDone: event.target.checked })}
          />
        </>
      }
    >
      <Select
        label={t('views:myWork.person')}
        hideLabel
        size="sm"
        value={personId ?? ''}
        onChange={(event) => {
          update({ personId: event.target.value || null })
          if (linkedPerson) navigate(myWorkPath(), { replace: true })
        }}
        options={[
          ...(personId ? [] : [{ value: '', label: t('views:myWork.choosePerson') }]),
          ...personOptions
        ]}
      />
      <Select
        label={t('views:myWork.project')}
        hideLabel
        size="sm"
        value={projectId ?? ''}
        onChange={(event) => update({ projectId: event.target.value || null })}
        options={[
          { value: '', label: t('views:myWork.allProjects') },
          ...projectSelectOptions(enabledProjects, areas)
        ]}
      />
      <SearchField
        label={t('views:myWork.search')}
        placeholder={t('views:myWork.search')}
        className="task-toolbar__search"
        slashShortcut
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      <FilterBuilder
        value={filter}
        onChange={(next) => update({ filter: next })}
        choices={choices}
        names={{ milestone: (id) => milestones.find((entry) => entry.id === id)?.name }}
        hiddenFields={hiddenFields}
      />
    </Toolbar>
  )

  let body
  if (!personId && people.loaded) {
    body = (
      <EmptyState
        icon={ListTodo}
        title={t('views:myWork.noPersonTitle')}
        description={t('views:myWork.noPersonBody')}
      />
    )
  } else if (tasks === null) {
    body = (
      <div className="list-view__loading" aria-busy="true" aria-label={t('views:myWork.loading')}>
        <Skeleton lines={8} />
      </div>
    )
  } else if (tasks.length === 0) {
    body = (
      <EmptyState
        icon={ListTodo}
        title={isFiltered ? t('views:myWork.noMatchTitle') : t('views:myWork.nothingTitle')}
        description={
          isFiltered
            ? t('views:myWork.noMatchBody')
            : t('views:myWork.nothingBody', { name: person?.name ?? '' })
        }
        action={
          isFiltered ? (
            <Button
              icon={X}
              onClick={() => {
                setQuery('')
                update({ filter: { match: 'all', conditions: [] }, projectId: null })
              }}
            >
              {t('views:myWork.clearFilters')}
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    body = (
      <DataTable
        label={t('views:myWork.tableLabel', { name: person?.name ?? '' })}
        className="list-view__table"
        columns={visibleColumns}
        entries={entries}
        sort={settings.sort}
        onSortChange={(sort) => update({ sort })}
        onToggleGroup={(groupId) =>
          setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(groupId)) next.delete(groupId)
            else next.add(groupId)
            return next
          })
        }
        onRowActivate={open}
        onCellKeyDown={onCellKeyDown}
        focusRowId={focusRowId}
        onFocusRowDone={() => setFocusRowId(null)}
      />
    )
  }

  return (
    <div className="my-work">
      <PageHeader
        title={t('views:myWork.title')}
        subtitle={
          <>
            {t('views:myWork.subtitle')}{' '}
            <Link className="my-work__home-link" to={homePath()}>
              {t('views:myWork.todayOnHome')}
            </Link>{' '}
            <Link className="my-work__home-link" to={timesheetPath()}>
              {t('views:myWork.timesheetLink')}
            </Link>{' '}
            <Link className="my-work__home-link" to={workloadPath()}>
              {t('views:myWork.workloadLink')}
            </Link>
          </>
        }
      />
      <div className="my-work__content">
        {work.error && (
          <InlineAlert tone="danger">
            {t('views:myWork.couldntLoad', { error: work.error })}
          </InlineAlert>
        )}
        {(items.value?.length ?? 0) > 0 && (
          <Section
            title={t('views:myWork.checklistItems')}
            description={t('views:myWork.checklistItemsBody')}
          >
            <ChecklistItemRows items={items.value!} onChanged={() => void items.reload()} />
          </Section>
        )}
        <div className="list-view">
          {toolbar}
          {body}
        </div>
      </div>
      <RescheduleDialog
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        workItemIds={rescheduling ?? undefined}
        personId={personId}
        onChanged={() => void work.reload()}
      />
    </div>
  )
}
