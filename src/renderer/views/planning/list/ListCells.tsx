import { useRef, useState, type ReactNode, type RefObject } from 'react'
import type {
  EstimateUnit,
  PlanningFieldDefinition,
  PlanningFieldValue,
  PlanningWorkItem,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { formatIsoDate, formatIsoDateShort, todayIsoDate } from '@shared/dates'
import { hiddenReason } from '@shared/planning/show-from'
import type { ScoreField } from '@shared/planning/idea-scores'
import {
  fieldColumnId,
  fieldComparer,
  listComparers,
  type FieldColumnId,
  type ListTreeRow
} from '@shared/planning/list'
import { fieldValueText } from '@shared/planning/custom-fields'
import { ESTIMATE_UNIT_SHORT } from '@shared/task-labels'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import type { PeopleState } from '../../../context/PeopleContext'
import {
  Badge,
  Button,
  Chip,
  IconButton,
  MenuList,
  Popover,
  PriorityIcon,
  STATUS_ICONS,
  StatusBadge,
  VisuallyHidden,
  type DataTableColumn,
  type MenuEntry
} from '../../../ui'
import { absoluteTimeText, relativeTimeText } from '../../../ui/date-text'
import { CalendarX2, chevronClass, ChevronRight, Icon } from '../../../ui/icons'
import { AssigneeField, PersonAvatar } from '../AssigneeField'
import { TaskLabelsField } from '../TaskLabelsField'
import { cardDue } from '../card-due'
import { CustomFieldInput } from '../CustomFieldInput'
import { AiValueMark } from '../AiFieldMark'
import type { ListColumnId, ListColumnKey } from './list-settings'
import { t } from '@shared/i18n'
import { taskIdLabel, taskKey } from '@shared/task-key'
import { TaskTypeIconFor } from '../../../task-types/TaskTypeIcon'
import { UnseenMark } from '../UnseenMark'
import { DateEditor, EstimateEditor, TitleEditor, priorityMenuEntries } from '../inline-editors'
import { SubprojectChip, subprojectOptions } from '../subproject-ui'

/** The List's date editor, also used by My work. */
export { DateEditor }

/** The cell being edited: its task and column. */
export interface ListEditing {
  rowId: string
  /** A built-in column or a custom field's (R2.2), or the Someday view's scores (N1.1b). */
  columnId: ListColumnKey | ScoreField
}

/** What every cell reads: the workspace, people and the editing state. */
export interface ListCellContext {
  ws: PlanningWorkspace
  people: PeopleState
  estimateUnit: EstimateUnit
  /** The project's task prefix (N9.8a), for the ID column. */
  taskPrefix?: string | null
  editing: ListEditing | null
  setEditing: (editing: ListEditing | null) => void
  /** After an edit ends, focus goes back to its cell. */
  refocus: (rowId: string) => void
  collapsedParents: ReadonlySet<string>
  toggleParent: (id: string) => void
  knownLabels: string[]
  /** The project's most used labels, a click each in the labels editor. */
  usualLabels?: string[]
  /** Mark hidden tasks (N1.1a) shown in place: greyed, with why in words. Off in the Someday view. */
  markHidden?: boolean
}

/** The columns that can be edited in place, and how they open. */
export const EDITABLE_COLUMNS: readonly ListColumnId[] = [
  'title',
  'status',
  'priority',
  'assignee',
  'start',
  'due',
  'estimate',
  'milestone',
  'subproject',
  'labels'
]

/** A date as the card shows it ("Today", "Fri", "3 Nov"); a due date in its warning colours. */
export function dateText(value: string, done: boolean, due: boolean) {
  const shown = cardDue(value, done || !due)
  if (!shown) return null
  const title = due
    ? shown.title
    : t('views:listCells.starts', { date: formatIsoDate(value, { dateStyle: 'full' }) })
  return (
    <span
      className={shown.tone !== 'plain' ? `list-cell__due is-${shown.tone}` : undefined}
      title={title}
    >
      {/* Overdue has its own icon and words, not only its colour (P9.2, WCAG 1.4.1). */}
      {shown.tone === 'overdue' && <Icon icon={CalendarX2} />}
      {shown.text}
      {shown.tone === 'overdue' && <VisuallyHidden> {t('views:listCells.overdue')}</VisuallyHidden>}
    </span>
  )
}

function timeText(at: number) {
  return <time title={absoluteTimeText(at)}>{relativeTimeText(at)}</time>
}

export const muted = (text: string) => <span className="list-cell__empty">{text}</span>

/**
 * One cell's anchor and its editor: the shown value, and while editing, the
 * editor hung from it. `editor` gets the anchor and a close callback.
 */
export function EditableCell({
  editing,
  display,
  editor
}: {
  editing: boolean
  display: ReactNode
  editor: (anchor: RefObject<HTMLSpanElement | null>) => ReactNode
}) {
  const anchor = useRef<HTMLSpanElement | null>(null)
  return (
    <>
      <span ref={anchor} className="list-cell__value">
        {display}
      </span>
      {editing && editor(anchor)}
    </>
  )
}

/** A custom field's value edited in a pop-up (R2.2): Save or Enter saves it, Clear empties it. */
function FieldValueEditor({
  anchor,
  field,
  label,
  initial,
  onSave,
  onClose
}: {
  anchor: RefObject<HTMLSpanElement | null>
  field: PlanningFieldDefinition
  label: string
  initial: PlanningFieldValue | undefined
  onSave: (value: PlanningFieldValue | null) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<PlanningFieldValue | null>(initial ?? null)
  return (
    <Popover open onClose={onClose} anchorRef={anchor} label={label} className="list-editor">
      <form
        className="list-editor__form"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <CustomFieldInput
          field={field}
          autoFocus
          value={draft ?? undefined}
          onChange={(value) => setDraft(value)}
        />
        <div className="list-editor__actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSave(null)}
            disabled={initial === undefined}
          >
            {t('views:listCells.clear')}
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {t('views:listCells.save')}
          </Button>
        </div>
      </form>
    </Popover>
  )
}

/**
 * A column per custom field (R2.2): the value as text (a choice with its
 * colour), sorted by the field's type, and edited in place like any other
 * cell. Saved through `updateWorkItemInline`, as the drawer saves.
 */
export function fieldListColumns(
  context: ListCellContext,
  fields: readonly PlanningFieldDefinition[]
): Record<FieldColumnId, DataTableColumn<ListTreeRow>> {
  const { ws, editing, setEditing, refocus } = context
  const close = (row: ListTreeRow) => {
    setEditing(null)
    refocus(row.item.id)
  }
  return Object.fromEntries(
    fields.map((field) => {
      const id = fieldColumnId(field.id)
      const sorting = fieldComparer(field)
      const display = (row: ListTreeRow) => {
        const value = row.item.fieldValues?.[field.id]
        if (value === undefined) return null
        // A value Ostler AI filled (N8.4) carries its sparkle and says so.
        const mark = (
          <AiValueMark fill={row.item.fieldFills?.[field.id]} item={row.item} focusable={false} />
        )
        if (field.type === 'choice' || field.type === 'choices') {
          const ids = Array.isArray(value) ? value : [String(value)]
          const options = field.options.filter((option) => ids.includes(option.id))
          return (
            <span className="list-cell__labels" title={fieldValueText(field, value)}>
              {options.slice(0, 2).map((option) => (
                <Chip key={option.id} color={option.color}>
                  {option.name}
                </Chip>
              ))}
              {options.length > 2 && <span className="list-cell__more">+{options.length - 2}</span>}
              {mark}
            </span>
          )
        }
        const text = fieldValueText(field, value)
        return field.type === 'number' ? (
          <span className="tabular-nums">{text}</span>
        ) : field.type === 'date' ? (
          formatIsoDate(text, { dateStyle: 'medium' })
        ) : (
          <span className="list-cell__text" title={text}>
            {text}
            {mark}
          </span>
        )
      }
      const column: DataTableColumn<ListTreeRow> = {
        id,
        header: field.name,
        width: field.type === 'text' || field.type === 'choices' ? 200 : 140,
        align: field.type === 'number' ? 'end' : undefined,
        compare: (a, b) => sorting.compare(a.item, b.item),
        isEmpty: (row) => sorting.isEmpty!(row.item),
        // One plain click opens the field's editor (MOP-8).
        onCellClick: (row, event) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
          if (editing?.rowId === row.item.id && editing.columnId === id) return
          setEditing({ rowId: row.item.id, columnId: id })
        },
        cell: (row) => (
          <EditableCell
            editing={editing?.rowId === row.item.id && editing.columnId === id}
            display={display(row)}
            editor={(anchor) => (
              <FieldValueEditor
                anchor={anchor}
                field={field}
                label={t('views:listCells.fieldOfTask', {
                  fieldName: field.name,
                  itemTitle: row.item.title
                })}
                initial={row.item.fieldValues?.[field.id]}
                onClose={() => close(row)}
                onSave={(value) => {
                  close(row)
                  void ws.updateWorkItemInline(row.item, { fieldValues: { [field.id]: value } })
                }}
              />
            )}
          />
        )
      }
      return [id, column]
    })
  ) as Record<FieldColumnId, DataTableColumn<ListTreeRow>>
}

/**
 * The List's columns (P5.3), each with how it shows, sorts and edits. Edits
 * go through `updateWorkItemInline`: one call to the same service as the
 * drawer.
 */
export function listColumns(
  context: ListCellContext
): Record<ListColumnId, DataTableColumn<ListTreeRow>> {
  const { ws, people, editing, setEditing, refocus } = context
  const isEditing = (row: ListTreeRow, columnId: ListColumnId) =>
    editing?.rowId === row.item.id && editing.columnId === columnId
  const close = (row: ListTreeRow) => {
    setEditing(null)
    refocus(row.item.id)
  }
  // One plain click on a cell opens its picker (MOP-8), as Enter or F2 does.
  const clickToEdit = (
    columnId: ListColumnId
  ): Pick<DataTableColumn<ListTreeRow>, 'onCellClick'> => ({
    onCellClick: (row, event) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      // A click inside the open editor reaches the cell through its portal.
      if (isEditing(row, columnId)) return
      setEditing({ rowId: row.item.id, columnId })
    }
  })
  const save = (row: ListTreeRow, patch: UpdatePlanningWorkItemInput) => {
    close(row)
    void ws.updateWorkItemInline(row.item, patch)
  }
  const menu = (row: ListTreeRow, label: string, entries: MenuEntry[]) =>
    function MenuEditor(anchor: RefObject<HTMLSpanElement | null>) {
      return (
        <MenuList
          label={label}
          entries={entries}
          open
          onClose={() => close(row)}
          anchorRef={anchor}
        />
      )
    }
  const personName = (id: string | null) => (id ? (people.byId.get(id)?.name ?? '') : '')
  const milestoneName = (id: string | null) => (id ? (ws.milestoneNames.get(id) ?? '') : '')
  const subprojectName = (id: string | null) =>
    id ? (ws.subprojects?.find((sub) => sub.id === id)?.name ?? '') : ''
  const checklist = (row: ListTreeRow) => {
    const total = row.item.acceptanceCriteria.length
    const ticked = row.item.acceptanceCriteria.filter((text) =>
      row.item.checkedCriteria.includes(text)
    ).length
    return { total, ticked }
  }
  const comments = (row: ListTreeRow) => ws.commentCounts[row.item.id] ?? 0
  const unit = ESTIMATE_UNIT_SHORT[context.estimateUnit]
  // The one sort rule per column, shared with the printed List (P6.1).
  const sorting = listComparers({
    status: ws.projectedStatus,
    personName,
    milestoneName,
    subprojectName,
    commentCount: (id) => ws.commentCounts[id] ?? 0
  })
  const sortBy = (id: ListColumnId): Pick<DataTableColumn<ListTreeRow>, 'compare' | 'isEmpty'> => {
    const { compare, isEmpty } = sorting[id]
    return {
      compare: (a, b) => compare(a.item, b.item),
      ...(isEmpty ? { isEmpty: (row: ListTreeRow) => isEmpty(row.item) } : {})
    }
  }

  return {
    key: {
      id: 'key',
      header: t('views:listCells.key'),
      width: 90,
      ...sortBy('key'),
      cell: (row) => {
        const id = taskKey(context.taskPrefix, row.item.number)
        return id ? <span className="list-cell__key tabular-nums">{taskIdLabel(id)}</span> : null
      }
    },
    title: {
      id: 'title',
      header: t('views:listCells.title'),
      width: 360,
      minWidth: 160,
      ...sortBy('title'),
      onCellClick: (row, event) => {
        // A plain click anywhere in the title's cell opens the task in the side drawer.
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        if (isEditing(row, 'title')) return
        ws.openWorkItem(row.item)
      },
      cell: (row) => {
        const collapsed = context.collapsedParents.has(row.item.id)
        return (
          <span
            className="list-cell__title"
            style={{
              paddingInlineStart: `calc(var(--space-500) * ${row.depth})`
            }}
          >
            {row.childCount > 0 ? (
              <IconButton
                size="sm"
                tabIndex={-1}
                icon={ChevronRight}
                iconClassName={chevronClass(!collapsed)}
                aria-expanded={!collapsed}
                label={
                  collapsed
                    ? t('views:listCells.showSubtasks', {
                        count: row.childCount,
                        title: row.item.title
                      })
                    : t('views:listCells.hideSubtasks', {
                        count: row.childCount,
                        title: row.item.title
                      })
                }
                onClick={(event) => {
                  event.stopPropagation()
                  context.toggleParent(row.item.id)
                }}
              />
            ) : (
              row.depth > 0 && <span className="list-cell__twig" aria-hidden="true" />
            )}
            <TaskTypeIconFor typeId={row.item.typeId} types={ws.taskTypeById} />
            <UnseenMark kind={ws.unseenTasks[row.item.id]} />
            {isEditing(row, 'title') ? (
              <TitleEditor
                initial={row.item.title}
                onCancel={() => close(row)}
                onSave={(title) => save(row, { title })}
              />
            ) : (
              <span className="list-cell__title-text" title={row.item.title}>
                {row.item.title}
              </span>
            )}
            {context.markHidden && <HiddenMark item={row.item} />}
          </span>
        )
      }
    },
    status: {
      id: 'status',
      header: t('views:listCells.status'),
      width: 140,
      ...sortBy('status'),
      ...clickToEdit('status'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'status')}
          display={
            <StatusBadge status={ws.projectedStatus(row.item)} columnId={row.item.columnId} />
          }
          editor={menu(
            row,
            t('views:listCells.status2', { itemTitle: row.item.title }),
            ws.statusWords
              .places(ws.columnOf(row.item))
              .map(({ key, status, columnId, label }) => ({
                label,
                icon: STATUS_ICONS[status],
                onSelect: () => {
                  if (key !== ws.columnOf(row.item)) save(row, { status, columnId })
                }
              }))
          )}
        />
      )
    },
    priority: {
      id: 'priority',
      header: t('views:listCells.priority'),
      width: 120,
      ...sortBy('priority'),
      ...clickToEdit('priority'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'priority')}
          display={<PriorityIcon priority={row.item.priority} showLabel />}
          editor={menu(
            row,
            t('views:listCells.priority2', { itemTitle: row.item.title }),
            priorityMenuEntries(row.item.priority, (priority) => save(row, { priority }))
          )}
        />
      )
    },
    assignee: {
      id: 'assignee',
      header: t('views:listCells.assignee2'),
      width: 170,
      ...sortBy('assignee'),
      ...clickToEdit('assignee'),
      cell: (row) => {
        const person = row.item.assigneeId ? people.byId.get(row.item.assigneeId) : undefined
        return (
          <EditableCell
            editing={isEditing(row, 'assignee')}
            display={
              person ? (
                <span className="list-cell__person">
                  <PersonAvatar person={person} />
                  <span className="list-cell__text">
                    {person.isMe
                      ? t('views:listCells.you', { personName: person.name })
                      : person.name}
                  </span>
                </span>
              ) : (
                muted(t('views:listCells.unassigned'))
              )
            }
            editor={(anchor) => (
              <Popover
                open
                onClose={() => close(row)}
                anchorRef={anchor}
                label={t('views:listCells.assignee', { itemTitle: row.item.title })}
                className="list-editor"
              >
                <AssigneeField
                  projectId={row.item.projectId}
                  value={row.item.assigneeId}
                  onChange={(assigneeId) => {
                    if (assigneeId !== row.item.assigneeId) save(row, { assigneeId })
                  }}
                />
              </Popover>
            )}
          />
        )
      }
    },
    start: {
      id: 'start',
      header: t('views:listCells.start'),
      width: 110,
      ...sortBy('start'),
      ...clickToEdit('start'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'start')}
          display={
            row.item.startDate
              ? dateText(row.item.startDate, ws.projectedStatus(row.item) === 'done', false)
              : null
          }
          editor={(anchor) => (
            <DateEditor
              anchor={anchor}
              label={t('views:listCells.startDate')}
              initial={row.item.startDate}
              due={false}
              onClose={() => close(row)}
              onSave={(startDate) => {
                if (startDate !== row.item.startDate) save(row, { startDate })
                else close(row)
              }}
            />
          )}
        />
      )
    },
    due: {
      id: 'due',
      header: t('views:listCells.due'),
      width: 110,
      ...sortBy('due'),
      ...clickToEdit('due'),
      cell: (row) => {
        const done = ws.projectedStatus(row.item) === 'done'
        return (
          <EditableCell
            editing={isEditing(row, 'due')}
            display={row.item.targetDate ? dateText(row.item.targetDate, done, true) : null}
            editor={(anchor) => (
              <DateEditor
                anchor={anchor}
                label={t('views:listCells.dueDate')}
                initial={row.item.targetDate}
                due={!done}
                onClose={() => close(row)}
                onSave={(targetDate) => {
                  if (targetDate !== row.item.targetDate) save(row, { targetDate })
                  else close(row)
                }}
              />
            )}
          />
        )
      }
    },
    estimate: {
      id: 'estimate',
      header: t('views:listCells.estimate'),
      width: 100,
      align: 'end',
      ...sortBy('estimate'),
      ...clickToEdit('estimate'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'estimate')}
          display={
            row.item.estimate === null ? null : (
              <span className="tabular-nums">
                {row.item.estimate} {unit}
              </span>
            )
          }
          editor={(anchor) => (
            <EstimateEditor
              anchor={anchor}
              initial={row.item.estimate}
              unit={context.estimateUnit}
              onClose={() => close(row)}
              onSave={(estimate) => {
                if (estimate !== row.item.estimate) save(row, { estimate })
                else close(row)
              }}
            />
          )}
        />
      )
    },
    milestone: {
      id: 'milestone',
      header: t('views:listCells.milestone'),
      width: 170,
      ...sortBy('milestone'),
      ...clickToEdit('milestone'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'milestone')}
          display={
            row.item.milestoneId ? (
              <span className="list-cell__text" title={milestoneName(row.item.milestoneId)}>
                {milestoneName(row.item.milestoneId)}
              </span>
            ) : null
          }
          editor={menu(row, t('views:listCells.milestone2', { itemTitle: row.item.title }), [
            {
              label: t('views:listCells.noMilestone'),
              onSelect: () => {
                if (row.item.milestoneId) save(row, { milestoneId: null })
              }
            },
            ...ws.milestones.map((milestone) => ({
              label: milestone.name,
              onSelect: () => {
                if (milestone.id !== row.item.milestoneId) save(row, { milestoneId: milestone.id })
              }
            }))
          ])}
        />
      )
    },
    subproject: {
      id: 'subproject',
      header: t('tasks:subprojects.field'),
      width: 170,
      ...sortBy('subproject'),
      ...clickToEdit('subproject'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'subproject')}
          display={
            row.item.subprojectId ? (
              <SubprojectChip subprojects={ws.subprojects} subprojectId={row.item.subprojectId} />
            ) : null
          }
          editor={menu(
            row,
            t('tasks:subprojects.menuLabel', { itemTitle: row.item.title }),
            subprojectOptions(ws.subprojects, row.item.subprojectId).map((option) => ({
              label: option.label,
              disabled: option.disabled,
              onSelect: () => {
                const next = option.value || null
                if (next !== (row.item.subprojectId ?? null)) save(row, { subprojectId: next })
              }
            }))
          )}
        />
      )
    },
    labels: {
      id: 'labels',
      header: t('views:listCells.labels2'),
      width: 200,
      ...sortBy('labels'),
      ...clickToEdit('labels'),
      cell: (row) => (
        <EditableCell
          editing={isEditing(row, 'labels')}
          display={
            <span className="list-cell__labels" title={row.item.labels.join(', ') || undefined}>
              {row.item.labels.slice(0, 2).map((label) => (
                <Chip key={label} color={ws.labelColor(label)}>
                  {label}
                </Chip>
              ))}
              {row.item.labels.length > 2 && (
                <span className="list-cell__more">+{row.item.labels.length - 2}</span>
              )}
            </span>
          }
          editor={(anchor) => (
            <Popover
              open
              onClose={() => close(row)}
              anchorRef={anchor}
              label={t('views:listCells.labels', { itemTitle: row.item.title })}
              className="list-editor"
              autoFocus={false}
            >
              <TaskLabelsField
                labels={row.item.labels}
                known={context.knownLabels}
                frequent={context.usualLabels}
                colorOf={ws.labelColor}
                openPicker
                onChange={(labels) => void ws.updateWorkItemInline(row.item, { labels })}
              />
            </Popover>
          )}
        />
      )
    },
    checklist: {
      id: 'checklist',
      header: t('views:listCells.checklist'),
      width: 100,
      align: 'end',
      ...sortBy('checklist'),
      cell: (row) => {
        const { total, ticked } = checklist(row)
        return total === 0 ? null : (
          <span className="tabular-nums" title={t('views:listCells.done', { ticked, total })}>
            {ticked}/{total}
          </span>
        )
      }
    },
    comments: {
      id: 'comments',
      header: t('views:listCells.comments'),
      width: 100,
      align: 'end',
      ...sortBy('comments'),
      cell: (row) =>
        comments(row) === 0 ? null : <span className="tabular-nums">{comments(row)}</span>
    },
    updated: {
      id: 'updated',
      header: t('views:listCells.updated'),
      width: 130,
      ...sortBy('updated'),
      cell: (row) => timeText(row.item.updatedAt)
    },
    created: {
      id: 'created',
      header: t('views:listCells.created'),
      width: 130,
      ...sortBy('created'),
      cell: (row) => timeText(row.item.createdAt)
    }
  }
}

/** Column headers as words, for the column picker. */
export { LIST_COLUMN_LABELS } from '@shared/planning/list'

/** A hidden task shown in place (N1.1a): "Someday" or "From 3 Mar", the row's title greyed. */
function HiddenMark({ item }: { item: PlanningWorkItem }) {
  const hidden = hiddenReason(item, todayIsoDate())
  if (!hidden) return null
  return (
    <Badge className="list-cell__hidden">
      {hidden.kind === 'triage'
        ? t('tasks:triage.badge')
        : hidden.kind === 'someday'
          ? t('tasks:someday.badge')
          : t('tasks:someday.fromDate', { date: formatIsoDateShort(hidden.showFrom) })}
    </Badge>
  )
}
