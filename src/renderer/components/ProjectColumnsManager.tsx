import { useEffect, useState } from 'react'
import {
  MAX_COLUMN_NAME_LENGTH,
  MAX_CUSTOM_COLUMNS,
  type PlanningColumnSettings,
  type PlanningCustomColumn,
  type PlanningWorkItemStatus,
  type UpdatePlanningColumnSettingsInput
} from '@shared/ostler-api'
import {
  AGENT_STATUSES,
  customColumns,
  HIDEABLE_STATUSES,
  isStatusHidden
} from '@shared/board-columns'
import { TASK_STATUSES, TASK_STATUS_LABELS, taskStatusLabel } from '@shared/task-labels'
import { Button, Checkbox, IconButton, Select, TextField, useConfirm } from '../ui'
import { ArrowDown, ArrowUp, Plus, Trash2 } from '../ui/icons'
import { useAllProjectColumns, useProjectColumns } from '../context/ColumnsContext'
import { t } from '@shared/i18n'

/**
 * A project's Board columns (R2.4, D34), in Project settings › Board: a name
 * for each column (blank goes back to the standard word) and a Show switch
 * for Ready, Blocked and In review. Below each status come the project's own
 * columns that count as it (MOP-26), which can be renamed, moved, hidden and
 * deleted, and Add column makes another. Main refuses to hide a column that
 * holds tasks, or one agents use; the refusal shows as the dialog's error.
 */
export function ProjectColumnsManager({
  projectId,
  agentsLocked,
  onError,
  onSaved
}: {
  projectId: string
  /** Agents are on and the project has a folder: Ready and In review stay. */
  agentsLocked: boolean
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const known = useProjectColumns(projectId)
  const { set } = useAllProjectColumns()
  const confirm = useConfirm()
  const [columns, setColumns] = useState<PlanningColumnSettings>(known)
  /** Names being typed, by status or custom column id. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [newCountsAs, setNewCountsAs] = useState<PlanningWorkItemStatus>('active')

  // A change from elsewhere (the automation API) shows here too.
  useEffect(() => setColumns(known), [known])

  const save = async (change: UpdatePlanningColumnSettingsInput) => {
    const result = await window.ostlerAPI.updatePlanningColumnSettings(projectId, change)
    if (!result.ok) {
      onError(result.error)
      return false
    }
    setColumns(result.value)
    set(projectId, result.value)
    onError(null)
    onSaved()
    return true
  }

  const takeDraft = (key: string): string | undefined => {
    const draft = drafts[key]
    setDrafts(({ [key]: _done, ...rest }) => rest)
    return draft
  }

  const saveName = (status: PlanningWorkItemStatus) => {
    const draft = takeDraft(status)
    if (draft === undefined || draft.trim() === (columns.names[status] ?? '')) return
    void save({ names: { [status]: draft } })
  }

  const setShown = (status: PlanningWorkItemStatus, shown: boolean) =>
    void save({
      hidden: shown
        ? columns.hidden.filter((entry) => entry !== status)
        : [...columns.hidden, status]
    })

  // The project's own columns: every change sends the whole list, in order.
  const own = customColumns(columns)
  const saveOwn = (next: PlanningCustomColumn[]) => save({ custom: next })
  const changeOwn = (id: string, change: Partial<PlanningCustomColumn>) =>
    void saveOwn(own.map((column) => (column.id === id ? { ...column, ...change } : column)))

  const saveOwnName = (column: PlanningCustomColumn) => {
    const draft = takeDraft(column.id)
    if (draft === undefined || draft.trim() === column.name) return
    if (!draft.trim()) return
    changeOwn(column.id, { name: draft })
  }

  /** Up or down among the columns counting as the same status. */
  const moveOwn = (column: PlanningCustomColumn, step: -1 | 1) => {
    const siblings = own.filter((other) => other.countsAs === column.countsAs)
    const at = siblings.indexOf(column)
    const swap = siblings[at + step]
    if (!swap) return
    void saveOwn(own.map((other) => (other === column ? swap : other === swap ? column : other)))
  }

  const deleteOwn = async (column: PlanningCustomColumn) => {
    const ok = await confirm({
      title: t('projects:boardColumns.deleteTitle', { column: column.name }),
      body: t('projects:boardColumns.deleteBody', {
        status: taskStatusLabel(column.countsAs, columns)
      }),
      confirmLabel: t('projects:boardColumns.deleteConfirm'),
      tone: 'danger'
    }).catch(() => true)
    if (ok) void saveOwn(own.filter((other) => other.id !== column.id))
  }

  const addOwn = async () => {
    const name = newName.trim()
    if (!name) return
    if (await saveOwn([...own, { id: '', name, countsAs: newCountsAs, hidden: false }]))
      setNewName('')
  }

  const ownRow = (column: PlanningCustomColumn) => {
    const siblings = own.filter((other) => other.countsAs === column.countsAs)
    const at = siblings.indexOf(column)
    return (
      <div key={column.id} className="ostler-project-columns__row ostler-project-columns__own">
        <TextField
          label={t('projects:boardColumns.customName', {
            status: taskStatusLabel(column.countsAs, columns)
          })}
          value={drafts[column.id] ?? column.name}
          maxLength={MAX_COLUMN_NAME_LENGTH}
          onChange={(event) =>
            setDrafts((current) => ({ ...current, [column.id]: event.target.value }))
          }
          onBlur={() => saveOwnName(column)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveOwnName(column)
          }}
        />
        <div className="ostler-project-columns__own-actions">
          <Checkbox
            label={t('projects:boardColumns.show', { column: column.name })}
            checked={!column.hidden}
            onChange={(event) => changeOwn(column.id, { hidden: !event.target.checked })}
          />
          <IconButton
            size="sm"
            icon={ArrowUp}
            label={t('projects:boardColumns.moveUp', { column: column.name })}
            disabled={at === 0}
            onClick={() => moveOwn(column, -1)}
          />
          <IconButton
            size="sm"
            icon={ArrowDown}
            label={t('projects:boardColumns.moveDown', { column: column.name })}
            disabled={at === siblings.length - 1}
            onClick={() => moveOwn(column, 1)}
          />
          <IconButton
            size="sm"
            icon={Trash2}
            label={t('projects:boardColumns.delete', { column: column.name })}
            onClick={() => void deleteOwn(column)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="ostler-project-columns">
      {TASK_STATUSES.map((status) => {
        const hideable = HIDEABLE_STATUSES.includes(status)
        const locked = agentsLocked && AGENT_STATUSES.includes(status)
        const word = taskStatusLabel(status, columns)
        return [
          <div key={status} className="ostler-project-columns__row">
            <TextField
              label={t('projects:boardColumns.nameFor', { status: TASK_STATUS_LABELS[status] })}
              value={drafts[status] ?? columns.names[status] ?? ''}
              placeholder={TASK_STATUS_LABELS[status]}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [status]: event.target.value }))
              }
              onBlur={() => saveName(status)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveName(status)
              }}
            />
            {hideable ? (
              <Checkbox
                label={t('projects:boardColumns.show', { column: word })}
                hint={locked ? t('projects:boardColumns.agentsUseIt') : undefined}
                checked={!isStatusHidden(status, columns)}
                disabled={locked && !isStatusHidden(status, columns)}
                onChange={(event) => setShown(status, event.target.checked)}
              />
            ) : (
              <span className="ostler-project-settings-muted">
                {t('projects:boardColumns.alwaysShown')}
              </span>
            )}
          </div>,
          ...own.filter((column) => column.countsAs === status).map(ownRow)
        ]
      })}
      <form
        className="ostler-project-columns__add"
        onSubmit={(event) => {
          event.preventDefault()
          void addOwn()
        }}
      >
        <TextField
          label={t('projects:boardColumns.addName')}
          value={newName}
          maxLength={MAX_COLUMN_NAME_LENGTH}
          disabled={own.length >= MAX_CUSTOM_COLUMNS}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Select
          label={t('projects:boardColumns.addCountsAs')}
          value={newCountsAs}
          onChange={(event) => setNewCountsAs(event.target.value as PlanningWorkItemStatus)}
          options={TASK_STATUSES.map((status) => ({
            value: status,
            label: taskStatusLabel(status, columns)
          }))}
        />
        <Button
          type="submit"
          variant="secondary"
          icon={Plus}
          disabled={!newName.trim() || own.length >= MAX_CUSTOM_COLUMNS}
        >
          {t('projects:boardColumns.add')}
        </Button>
        <p className="ostler-project-settings-muted ostler-project-columns__add-hint">
          {t('projects:boardColumns.addHint')}
        </p>
      </form>
    </div>
  )
}
