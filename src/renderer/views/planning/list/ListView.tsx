import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  CreatePlanningWorkItemInput,
  PlanningWorkItem,
  PlanningWorkItemPlacement
} from '@shared/ostler-api'
import { stepPlacement } from '@shared/planning/board'
import {
  fieldIdOf,
  groupTasks,
  listGroupByOptions,
  nestSubtasks,
  type ListGroupBy,
  type ListTreeRow
} from '@shared/planning/list'
import { ESTIMATE_UNIT_SHORT, TASK_STATUSES } from '@shared/task-labels'
import { compareBestFirst, type ScoreField } from '@shared/planning/idea-scores'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import type { ViewOutput } from '../../../navigation/view-props'
import { shortcut } from '../../../navigation/shortcuts'
import { applyTaskFilters, useTaskView } from '../../../hooks/useTaskFilters'
import { useHiddenTasks } from '../../../hooks/useHiddenTasks'
import { ASSIGNEE_ME, ASSIGNEE_NOBODY, type TaskFilter } from '@shared/task-filter'
import { useMyShareRole } from '../../../hooks/useMyShareRole'
import { capabilitiesOf } from '@shared/share-roles'
import { usePeople } from '../../../context/PeopleContext'
import { useProjectEstimateUnit, useProjectTaskPrefix } from '../../../context/OstlerContext'
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  IconButton,
  Popover,
  SearchField,
  Select,
  Skeleton,
  sortRows,
  TextField,
  Toolbar,
  useAnnounce,
  type DataTableEntry,
  type RowComparer,
  type SortKey
} from '../../../ui'
import {
  ArrowDown,
  ArrowUp,
  Columns3Cog,
  Lightbulb,
  List,
  Plus,
  Replace,
  SlidersHorizontal,
  X
} from '../../../ui/icons'
import { SCORE_COLUMN_IDS, ideaActionsColumn, scoreColumn } from '../ideas/idea-columns'
import { TaskBulkBar, TaskToolbarRow } from '../TaskBulkBar'
import { frequentLabels } from '@shared/planning/frequent-labels'
import { TaskFilterFields } from '../TaskFilterFields'
import { HiddenTasksNote } from '../HiddenTasksNote'
import {
  EDITABLE_COLUMNS,
  LIST_COLUMN_LABELS,
  fieldListColumns,
  listColumns,
  type ListEditing
} from './ListCells'
import {
  LIST_VIEW_SPEC,
  isListColumnShown,
  withFieldColumns,
  type ListColumnId,
  type ListColumnKey,
  type ListViewSettings
} from './list-settings'
import type { PlanningFieldDefinition } from '@shared/ostler-api'
import { countInScope, groupableSubprojects, liveSubprojects } from '../subproject-ui'
import '../TaskToolbar.css'
import './ListView.css'
import { t } from '@shared/i18n'

/** A row of the table: a task with its place in the subtask tree. */
type Row = ListTreeRow

/** The quick-add row at the end of a group: a button, then a title field. */
function QuickAddRow({
  label,
  open,
  onOpen,
  onClose,
  onAdd
}: {
  label: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  onAdd: (title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  if (!open) {
    return (
      <button type="button" tabIndex={-1} className="list-quick-add" onClick={onOpen}>
        <Plus aria-hidden="true" className="list-quick-add__icon" />
        {label}
      </button>
    )
  }
  const submit = async () => {
    const text = title.trim()
    if (!text || saving) return
    setSaving(true)
    const added = await onAdd(text)
    setSaving(false)
    if (added) setTitle('')
  }
  return (
    <TextField
      label={label}
      hideLabel
      autoFocus
      placeholder={t('views:listView.taskTitleThenEnter')}
      className="list-quick-add__field"
      value={title}
      maxLength={200}
      disabled={saving}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => {
        if (!title.trim()) onClose()
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void submit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setTitle('')
          onClose()
        }
      }}
    />
  )
}

/** With more custom fields than this, the column picker offers a box to find one. */
const FIELD_SEARCH_FROM = 6

/**
 * Shows, hides and reorders the List's columns. The title always shows.
 * Custom fields (R2.2) are listed under their own heading, searchable once
 * there are many, and move among themselves.
 */
function ColumnPicker({
  settings,
  fields,
  hasSubprojects,
  onChange
}: {
  settings: ListViewSettings
  fields: readonly PlanningFieldDefinition[]
  /** The project has a workstream and the view shows all of it: the column is on offer. */
  hasSubprojects: boolean
  onChange: (columns: ListViewSettings['columns']) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const move = (from: number, to: number) => {
    const next = [...settings.columns]
    const [column] = next.splice(from, 1)
    next.splice(to, 0, column)
    onChange(next)
  }
  const fieldName = (id: ListColumnKey) => {
    const fieldId = fieldIdOf(id)
    return fieldId === null
      ? LIST_COLUMN_LABELS[id as ListColumnId]
      : (fields.find((field) => field.id === fieldId)?.name ?? '')
  }
  const isField = (id: ListColumnKey) => fieldIdOf(id) !== null
  const builtIn = settings.columns.filter(
    (column) => !isField(column.id) && (column.id !== 'subproject' || hasSubprojects)
  )
  const custom = settings.columns.filter((column) => isField(column.id))
  const needle = query.trim().toLowerCase()
  const shownCustom = custom.filter((column) => fieldName(column.id).toLowerCase().includes(needle))
  const item = (column: ListViewSettings['columns'][number], list: typeof builtIn) => {
    const name = fieldName(column.id)
    const index = settings.columns.indexOf(column)
    const at = list.indexOf(column)
    return (
      <li key={column.id} className="list-columns__item">
        <Checkbox
          label={name}
          checked={column.visible}
          disabled={column.id === 'title'}
          onChange={(event) =>
            onChange(
              settings.columns.map((candidate) =>
                candidate.id === column.id
                  ? { ...candidate, visible: event.target.checked }
                  : candidate
              )
            )
          }
        />
        <span className="list-columns__moves">
          <IconButton
            size="sm"
            icon={ArrowUp}
            label={t('views:listView.moveUp', { name })}
            disabled={at === 0}
            onClick={() => move(index, settings.columns.indexOf(list[at - 1]))}
          />
          <IconButton
            size="sm"
            icon={ArrowDown}
            label={t('views:listView.moveDown', { name })}
            disabled={at === list.length - 1}
            onClick={() => move(index, settings.columns.indexOf(list[at + 1]))}
          />
        </span>
      </li>
    )
  }
  return (
    <>
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        icon={Columns3Cog}
        className="list-view__columns"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('views:listView.columns')}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={t('views:listView.columns')}
        placement="bottom-end"
        className="list-columns"
      >
        <ul className="list-columns__list">{builtIn.map((column) => item(column, builtIn))}</ul>
        {custom.length > 0 && (
          <section className="list-columns__custom" aria-label={t('views:listView.customFields')}>
            <h3 className="list-columns__heading">{t('views:listView.customFields')}</h3>
            {custom.length >= FIELD_SEARCH_FROM && (
              <SearchField
                label={t('views:listView.findField')}
                placeholder={t('views:listView.findField')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
              />
            )}
            <ul className="list-columns__list">
              {shownCustom.map((column) => item(column, custom))}
            </ul>
          </section>
        )}
      </Popover>
    </>
  )
}

/** Order, group by, Hide done and the keys, under "View options" as on the Board. */
function ListViewOptions({
  manual,
  onManual,
  groupBy,
  onGroupBy,
  hideDone,
  onHideDone,
  fields,
  hasTypes,
  hasSubprojects
}: {
  /** No column sort: the project's manual order (D31), the Board's own. */
  manual: boolean
  onManual: () => void
  groupBy: ListGroupBy
  onGroupBy: (value: ListGroupBy) => void
  hideDone: boolean
  onHideDone: (value: boolean) => void
  fields: readonly PlanningFieldDefinition[]
  /** The project has task types (N2.7a), so Group by offers Type. */
  hasTypes: boolean
  /** The project has a workstream and the view shows all of it, so Group by offers Workstream. */
  hasSubprojects: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        ref={buttonRef}
        size="sm"
        variant="ghost"
        icon={SlidersHorizontal}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t('views:listView.viewOptions')}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={t('views:listView.viewOptions')}
        placement="bottom-end"
        className="task-view-options"
      >
        <Select
          label={t('views:listView.order')}
          size="sm"
          value={manual ? 'manual' : 'columns'}
          onChange={(event) => {
            if (event.target.value === 'manual') onManual()
          }}
          options={[
            { value: 'manual', label: t('views:listView.manualOrder') },
            ...(manual ? [] : [{ value: 'columns', label: t('views:listView.sortedByColumns') }])
          ]}
        />
        {!manual && <p className="task-view-options__hint">{t('views:listView.sortedHint')}</p>}
        <Select
          label={t('views:listView.group')}
          size="sm"
          value={groupBy}
          onChange={(event) => onGroupBy(event.target.value as ListGroupBy)}
          options={listGroupByOptions(fields, { hasTypes, hasSubprojects, current: groupBy }).map(
            (option) => ({
              value: option.value,
              label: option.label
            })
          )}
        />
        <Checkbox
          label={t('views:listView.hideDone')}
          checked={hideDone}
          onChange={(event) => onHideDone(event.target.checked)}
        />
        <p className="task-view-options__hint">{t('views:listView.arrowKeysMoveBetween')}</p>
      </Popover>
    </>
  )
}

/** The estimate total of a group's tasks, as "12 pts", or nothing. */
function estimateTotal(items: readonly PlanningWorkItem[], unit: string): string | undefined {
  const estimated = items.filter((item) => item.estimate !== null)
  if (estimated.length === 0) return undefined
  const total = estimated.reduce((sum, item) => sum + (item.estimate ?? 0), 0)
  return `${Math.round(total * 10) / 10} ${unit}`
}

/**
 * The List view (P5.3): a project's tasks as a table. Sort by any column,
 * group them, edit in place, add at the end of a group, select and change
 * many at once, all by keyboard. The toolbar, filters and bulk bar are the
 * Board's own. Column set, widths, sort and grouping are remembered per
 * project.
 */
export function ListView({
  ws,
  toolbarEnd,
  onViewOutput,
  someday = false
}: {
  ws: PlanningWorkspace
  toolbarEnd?: ReactNode
  /** What the List shows, for Print and Export to CSV (P6.1). */
  onViewOutput?: (output: ViewOutput | null) => void
  /**
   * The Someday view (N1.1a): the List's table with one fixed filter, the
   * project's Someday tasks, each with Bring back and Not now (Won't do). Its
   * own filters, grouping and quick add are left out. Its ideas have Impact
   * and Effort columns and sort "best first" until a header is clicked
   * (N1.1b); that sort is the view's own, not the List's.
   */
  someday?: boolean
}) {
  const people = usePeople()
  const canCreate = capabilitiesOf(useMyShareRole(ws.projectId)).createTasks
  const announce = useAnnounce()
  const estimateUnit = useProjectEstimateUnit(ws.projectId)
  const taskPrefix = useProjectTaskPrefix(ws.projectId)
  // Workstreams show only once the project has one, and in a view of the whole project.
  const showSubprojects = liveSubprojects(ws.subprojects).length > 0 && !ws.subprojectScope
  const filters = useTaskView(ws.projectId, 'list', LIST_VIEW_SPEC)
  // The project's fields as they are now: their columns, and none for a deleted one (R2.2).
  const settings = useMemo(
    () => withFieldColumns(filters.options, ws.fields),
    [filters.options, ws.fields]
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set())
  const [collapsedParents, setCollapsedParents] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<ListEditing | null>(null)
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [ideaSort, setIdeaSort] = useState<SortKey[]>([])

  const update = (next: Partial<ListViewSettings>) => filters.setOptions(next)

  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const knownLabels = useMemo(
    () => [...new Set(ws.workItems.flatMap((item) => item.labels))].sort(),
    [ws.workItems]
  )
  const usualLabels = useMemo(() => frequentLabels(ws.workItems), [ws.workItems])

  const columnsById = listColumns({
    ws,
    people,
    estimateUnit,
    taskPrefix,
    editing,
    setEditing,
    refocus: setFocusRowId,
    collapsedParents,
    toggleParent: (id) => setCollapsedParents((current) => toggle(current, id)),
    knownLabels,
    usualLabels,
    markHidden: !someday
  })
  const fieldColumnsById = fieldListColumns(
    {
      ws,
      people,
      estimateUnit,
      editing,
      setEditing,
      refocus: setFocusRowId,
      collapsedParents,
      toggleParent: (id) => setCollapsedParents((current) => toggle(current, id)),
      knownLabels,
      usualLabels,
      markHidden: !someday
    },
    ws.fields
  )
  const allColumns: Record<string, (typeof columnsById)[ListColumnId]> = {
    ...columnsById,
    ...fieldColumnsById
  }
  if (!someday) {
    // Status and Assignee offer their values as a filter from the header; it
    // is the same condition the filter bar edits.
    const chosen = (field: 'status' | 'assignee'): string[] => {
      const condition = filters.filter.conditions.find(
        (c) => c.field === field && c.op === 'is' && Array.isArray(c.value)
      )
      return (condition?.value as string[] | undefined) ?? []
    }
    const choose = (field: 'status' | 'assignee', values: string[]) => {
      const others = filters.filter.conditions.filter(
        (c) => !(c.field === field && c.op === 'is' && Array.isArray(c.value))
      )
      filters.setFilter({
        ...filters.filter,
        conditions: values.length > 0 ? [...others, { field, op: 'is', value: values }] : others
      })
    }
    const entries = (field: 'status' | 'assignee', options: { value: string; label: string }[]) => {
      const now = chosen(field)
      return [
        ...options.map(({ value, label }) => ({
          label,
          checked: now.includes(value),
          onSelect: () =>
            choose(field, now.includes(value) ? now.filter((v) => v !== value) : [...now, value])
        })),
        { type: 'separator' as const },
        {
          label: t('views:listView.clearFilters'),
          disabled: now.length === 0,
          onSelect: () => choose(field, [])
        }
      ]
    }
    allColumns.status = {
      ...allColumns.status,
      filter: {
        label: t('views:listView.filterBy', { header: allColumns.status.header }),
        active: chosen('status').length > 0,
        items: () =>
          entries(
            'status',
            TASK_STATUSES.map((status) => ({ value: status, label: ws.statusWords.label(status) }))
          )
      }
    }
    allColumns.assignee = {
      ...allColumns.assignee,
      filter: {
        label: t('views:listView.filterBy', { header: allColumns.assignee.header }),
        active: chosen('assignee').length > 0,
        items: () =>
          entries('assignee', [
            ...people.active.map((person) => ({
              value: person.isMe ? ASSIGNEE_ME : person.id,
              label: person.name
            })),
            { value: ASSIGNEE_NOBODY, label: t('tasks:assigneeField.unassigned') }
          ])
      }
    }
  }
  const shown = (column: ListViewSettings['columns'][number]) =>
    isListColumnShown(column, taskPrefix !== null, showSubprojects)
  const ideaColumns = someday
    ? SCORE_COLUMN_IDS.map((field) =>
        scoreColumn(field, { ws, editing, setEditing, refocus: setFocusRowId })
      )
    : []
  const visibleColumns = [
    ...settings.columns
      .filter((column) => shown(column) && allColumns[column.id])
      .map((column) => allColumns[column.id]),
    ...ideaColumns,
    ...(someday ? [ideaActionsColumn(ws)] : [])
  ]
  const sortKeys = someday ? ideaSort : settings.sort
  const widths = Object.fromEntries(
    settings.columns.flatMap((column) => (column.width ? [[column.id, column.width]] : []))
  )
  const comparers: Record<string, RowComparer<Row> | undefined> = Object.fromEntries(
    [...Object.values(allColumns), ...ideaColumns].map((column) => [
      column.id,
      column.compare && { compare: column.compare, isEmpty: column.isEmpty }
    ])
  )
  const order = (items: PlanningWorkItem[]) =>
    // Ideas come "best first" until a header says otherwise (N1.1b).
    someday && sortKeys.length === 0
      ? [...items].sort(compareBestFirst)
      : sortRows(
          items.map((item) => ({ item, depth: 0, childCount: 0 })),
          sortKeys,
          comparers
        ).map((row) => row.item)

  const filterSources = {
    projectedStatus: ws.projectedStatus,
    goalIdForItem: ws.goalIdForItem,
    commentCounts: ws.commentCounts,
    taskContacts: ws.taskContacts,
    meId: people.me?.id ?? null,
    currentIterationId: ws.currentIterationId,
    subprojectId: ws.subprojectScope?.id ?? null
  }
  const matching = applyTaskFilters(
    ws.workItems,
    someday ? { filter: SOMEDAY_FILTER, query: '', hideDone: false } : filters,
    filterSources
  )
  // Someday and shown-later tasks stay off the List unless asked for (N1.1a).
  const hidden = useHiddenTasks(ws.projectId, 'list', matching)
  const filtered = someday ? matching : hidden.items
  const groupBy: ListGroupBy = someday ? 'none' : settings.groupBy
  const groups = groupTasks(filtered, groupBy, {
    projectedStatus: ws.projectedStatus,
    milestones: ws.milestones,
    people: people.all,
    fields: ws.fields,
    taskTypes: ws.taskTypes,
    subprojects: groupableSubprojects(ws.subprojects, filtered),
    columns: ws.statusWords.columns
  })
  const unit = ESTIMATE_UNIT_SHORT[estimateUnit]
  const grouped = groupBy !== 'none'
  // Rows are placed by hand only where the order shown is the manual one.
  const manual = settings.sort.length === 0
  const reorderable =
    !someday && manual && (settings.groupBy === 'none' || settings.groupBy === 'status')

  // Every row in the order shown, whatever is collapsed: what an export or a printout holds.
  const output: ViewOutput = {
    config: {
      filter: filters.filter,
      query: filters.query,
      options: { ...settings, hideDone: filters.hideDone }
    },
    taskIds: groups.flatMap((group) =>
      nestSubtasks(group.items, order, new Set()).map((row) => row.item.id)
    ),
    columns: settings.columns.filter(shown).map((column) => column.id)
  }
  const outputKey = JSON.stringify(output)
  const reportRef = useRef(onViewOutput)
  reportRef.current = onViewOutput
  useEffect(() => {
    reportRef.current?.(JSON.parse(outputKey) as ViewOutput)
  }, [outputKey])
  useEffect(() => () => reportRef.current?.(null), [])

  const quickAdd = async (input: Partial<CreatePlanningWorkItemInput>, title: string) => {
    const created = await ws.quickAddWorkItem({ ...input, title })
    return created !== null
  }

  const entries: DataTableEntry<Row>[] = groups.flatMap((group) => {
    const collapsed = collapsedGroups.has(group.key)
    const head: DataTableEntry<Row>[] = grouped
      ? [
          {
            kind: 'group',
            id: group.key,
            label: group.label,
            count: group.items.length,
            aggregate: estimateTotal(group.items, unit),
            collapsed
          }
        ]
      : []
    if (collapsed) return head
    const rows: DataTableEntry<Row>[] = nestSubtasks(group.items, order, collapsedParents).map(
      (row) => ({ kind: 'row', id: row.item.id, row, label: row.item.title })
    )
    const prefill = someday ? null : group.quickAdd
    const addKey = `add:${group.key}`
    const addLabel = grouped
      ? t('views:listView.addTask', { groupLabel: group.label })
      : t('views:listView.addTask2')
    const add: DataTableEntry<Row>[] =
      prefill === null
        ? []
        : [
            {
              kind: 'extra',
              id: addKey,
              onActivate: () => setAdding(addKey),
              render: () => (
                <QuickAddRow
                  label={addLabel}
                  open={adding === addKey}
                  onOpen={() => setAdding(addKey)}
                  onClose={() => {
                    setAdding(null)
                    setFocusRowId(addKey)
                  }}
                  onAdd={(title) => quickAdd(prefill, title)}
                />
              )
            }
          ]
    return [...head, ...rows, ...add]
  })

  const moveColumn = (columnId: string, toIndex: number) => {
    const visibleIds = settings.columns
      .filter((column) => column.visible && column.id !== columnId)
      .map((column) => column.id)
    const moved = settings.columns.find((column) => column.id === columnId)
    if (!moved) return
    const rest = settings.columns.filter((column) => column.id !== columnId)
    const before = visibleIds[toIndex]
    const after = visibleIds[visibleIds.length - 1]
    const at = before
      ? rest.findIndex((column) => column.id === before)
      : rest.findIndex((column) => column.id === after) + 1
    rest.splice(at, 0, moved)
    update({ columns: rest })
  }

  /**
   * Alt and Up or Down: the task one place up or down among the rows beside
   * it (its siblings in its group), in Manual order only (D31).
   */
  const stepRow = (item: PlanningWorkItem, step: -1 | 1) => {
    const group = groups.find((candidate) => candidate.items.some((i) => i.id === item.id))
    const siblings = (group?.items ?? []).filter(
      (candidate) => candidate.parentWorkItemId === item.parentWorkItemId
    )
    const placement = stepPlacement(siblings, item, step)
    if (!placement) {
      announce(t('tasks:boardView.cannotMoveFurther'))
      return
    }
    const index = siblings.findIndex((candidate) => candidate.id === item.id)
    const neighbour = siblings[index + step]
    void ws.placeWorkItem(item, placement)
    setFocusRowId(item.id)
    announce(
      t(step < 0 ? 'tasks:boardView.movedAbove' : 'tasks:boardView.movedBelow', {
        title: neighbour.title,
        position: index + step + 1,
        count: siblings.length
      })
    )
  }

  /** A row dropped on another, in Manual order: above or below it, and into its status group. */
  const dropRow = (rowId: string, targetId: string, side: 'before' | 'after') => {
    const item = ws.workItemsById.get(rowId)
    const target = ws.workItemsById.get(targetId)
    if (!item || !target) return
    const placement: PlanningWorkItemPlacement =
      side === 'before' ? { beforeId: target.id } : { afterId: target.id }
    const status = ws.projectedStatus(target)
    const changesStatus = settings.groupBy === 'status' && status !== ws.projectedStatus(item)
    // Queued work changes status through the harness, as on the Board.
    if (changesStatus && item.linkedHarnessTaskId) {
      void ws.moveWorkItem(item, status)
      return
    }
    void ws.placeWorkItem(item, changesStatus ? { ...placement, status } : placement)
  }

  const onCellKeyDown = (event: KeyboardEvent<HTMLElement>, row: Row, columnId: string) => {
    if (
      reorderable &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      stepRow(row.item, event.key === 'ArrowUp' ? -1 : 1)
      return true
    }
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    const id = columnId as ListColumnKey
    if (plain && !event.shiftKey && event.key.toLowerCase() === 'e') {
      setEditing({ rowId: row.item.id, columnId: 'title' })
      return true
    }
    const editable =
      EDITABLE_COLUMNS.includes(id as ListColumnId) || (fieldIdOf(id) !== null && !!allColumns[id])
    if (plain && (event.key === 'Enter' || event.key === 'F2') && editable) {
      setEditing({ rowId: row.item.id, columnId: id })
      return true
    }
    if (
      plain &&
      (event.key === 'Enter' || event.key === 'F2') &&
      someday &&
      SCORE_COLUMN_IDS.includes(columnId as ScoreField)
    ) {
      setEditing({ rowId: row.item.id, columnId: columnId as ScoreField })
      return true
    }
    if (plain && id === 'title' && row.childCount > 0) {
      const collapsed = collapsedParents.has(row.item.id)
      if ((event.key === 'ArrowRight' && collapsed) || (event.key === 'ArrowLeft' && !collapsed)) {
        setCollapsedParents((current) => toggle(current, row.item.id))
        return true
      }
    }
    if (plain && event.key === 'Delete') {
      void ws.deleteWorkItem(row.item)
      return true
    }
    return false
  }

  const filterBar = someday ? (
    <Toolbar label={t('tasks:someday.viewTitle')} className="task-toolbar" end={toolbarEnd}>
      <span className="task-toolbar__count" aria-live="polite">
        {t('tasks:someday.viewCount', { count: filtered.length })}
      </span>
    </Toolbar>
  ) : (
    <Toolbar
      label={t('views:listView.listFilters')}
      className="task-toolbar"
      end={
        <>
          <span className="task-toolbar__count" aria-live="polite">
            {t('views:listView.tasks', {
              filteredCount: filtered.length,
              workItemCount: countInScope(ws.workItems, ws.subprojectScope)
            })}
          </span>
          <HiddenTasksNote hidden={hidden} />
          <ColumnPicker
            settings={settings}
            fields={ws.fields}
            hasSubprojects={showSubprojects}
            onChange={(columns) => update({ columns })}
          />
          <ListViewOptions
            manual={manual}
            onManual={() => update({ sort: [] })}
            groupBy={settings.groupBy}
            onGroupBy={(groupBy) => update({ groupBy })}
            hideDone={filters.hideDone}
            onHideDone={filters.setHideDone}
            fields={ws.fields}
            hasTypes={ws.taskTypes.length > 0}
            hasSubprojects={showSubprojects}
          />
          <IconButton
            icon={Replace}
            variant="secondary"
            label={t('navigation:projectWorkspace.findReplace')}
            shortcut={shortcut('find-replace').keys}
            onClick={() => ws.setFindReplaceOpen(true)}
          />
          {toolbarEnd}
        </>
      }
    >
      <TaskFilterFields filters={filters} ws={ws} workItems={ws.workItems} />
    </Toolbar>
  )

  let body: ReactNode
  if (ws.loading && ws.workItems.length === 0) {
    body = (
      <div
        className="list-view__loading"
        aria-busy="true"
        aria-label={t('views:listView.loadingTasks')}
      >
        <Skeleton lines={8} />
      </div>
    )
  } else if (ws.workItems.length === 0) {
    body = (
      <EmptyState
        icon={List}
        title={t('views:listView.noTasksYet')}
        description={t('views:listView.tasksStepsProjectAdd', { keys: shortcut('new-task').keys })}
        action={
          <Button
            variant="primary"
            icon={Plus}
            disabled={!canCreate}
            onClick={() => ws.openWorkItemCreate()}
          >
            {t('views:listView.newTask')}
          </Button>
        }
      />
    )
  } else if (someday && filtered.length === 0) {
    body = (
      <EmptyState
        icon={Lightbulb}
        title={t('tasks:someday.viewEmptyTitle')}
        description={t('tasks:someday.viewEmptyBody')}
      />
    )
  } else if (filtered.length === 0 && !grouped) {
    body = (
      <EmptyState
        icon={List}
        title={t('views:listView.noTasksMatch')}
        description={
          filters.isFiltered
            ? t('views:listView.nothingHereMatchesThese')
            : t('views:listView.everyTaskDoneShow')
        }
        action={
          filters.isFiltered ? (
            <Button icon={X} onClick={filters.clear}>
              {t('views:listView.clearFilters')}
            </Button>
          ) : (
            <Button onClick={() => filters.setHideDone(false)}>
              {t('views:listView.showDoneTasks')}
            </Button>
          )
        }
      />
    )
  } else {
    body = (
      <DataTable
        label={t('views:listView.tasks2')}
        className="list-view__table"
        columns={visibleColumns}
        entries={entries}
        widths={widths}
        onColumnResize={(columnId, width) =>
          update({
            columns: settings.columns.map((column) =>
              column.id === columnId ? { ...column, width } : column
            )
          })
        }
        onColumnMove={moveColumn}
        sort={sortKeys}
        onSortChange={(sort: SortKey[]) => (someday ? setIdeaSort(sort) : update({ sort }))}
        selectable
        selectedIds={new Set(selectedIds)}
        onSelectionChange={setSelectedIds}
        onToggleGroup={(groupId) => setCollapsedGroups((current) => toggle(current, groupId))}
        onRowActivate={(row) => {
          // A double-click's first click opened a cell's picker (MOP-8): the drawer replaces it.
          setEditing(null)
          ws.openWorkItem(row.item)
        }}
        onCellKeyDown={onCellKeyDown}
        activeRowId={ws.selectedWorkItemId}
        focusRowId={focusRowId}
        onFocusRowDone={() => setFocusRowId(null)}
        rowDrag={
          reorderable ? { canDrag: () => !ws.busy && editing === null, onDrop: dropRow } : undefined
        }
      />
    )
  }

  return (
    <div className="list-view" aria-busy={ws.loading}>
      <TaskToolbarRow
        toolbar={filterBar}
        bulkBar={
          selectedIds.length > 0 ? (
            <TaskBulkBar ws={ws} selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
          ) : null
        }
      />
      {body}
    </div>
  )
}

/** The Someday view's one fixed filter (N1.1a), through the one `matchesFilter`. */
const SOMEDAY_FILTER: TaskFilter = {
  match: 'all',
  conditions: [{ field: 'someday', op: 'is', value: true }]
}
