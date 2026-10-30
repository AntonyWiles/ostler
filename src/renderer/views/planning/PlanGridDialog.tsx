import { iterationOptions } from '../../iterations/IterationField'
import { taskTypeOptions } from '../../task-types/TaskTypeField'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import {
  MAX_ESTIMATE,
  type PlanningWorkItemBatchRowError,
  type RendererProject
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { dependencyCandidates } from '@shared/planning/dependencies'
import { ESTIMATE_UNIT_SHORT } from '@shared/task-labels'
import type { QuickAddContext } from '@shared/quick-add'
import {
  clampPlanDepths,
  indentPlanRow,
  planBatchRows,
  planGridSummary,
  planRowsToCreate,
  planRowsFromText,
  waitsOnCandidates,
  type PlanRow,
  type PlanWaitsOn
} from '@shared/plan-grid'
import { t } from '@shared/i18n'
import { SCORE_STEPS, type ScoreField } from '@shared/planning/idea-scores'
import { useProjectEstimateUnit } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { shortcut, useShortcuts } from '../../navigation/shortcuts'
import {
  Button,
  DateField,
  Dialog,
  IconButton,
  InlineAlert,
  NumberField,
  Select,
  TextField,
  useAnnounce,
  useConfirm,
  useToast,
  type SelectOption
} from '../../ui'
import { Plus, X } from '../../ui/icons'
import { CustomFieldInput } from './CustomFieldInput'
import { fieldsForTypes, taskTypeOf } from '@shared/task-type-fields'
import './plan-grid.css'

/** How long the grid waits after the last edit before it checks the plan. */
const CHECK_DELAY_MS = 300

interface CheckState {
  /** The row ids the errors were checked against, in batch order. */
  ids: string[]
  errors: PlanningWorkItemBatchRowError[]
}

function blankRow(id: string, depth: number): PlanRow {
  return {
    id,
    depth,
    title: '',
    assigneeId: null,
    startDate: '',
    dueDate: '',
    estimate: null,
    waitsOn: [],
    milestoneId: '',
    labels: '',
    priority: null
  }
}

/** A wait as the picker names it: `row:<id>` or `task:<id>`. */
function waitKey(wait: PlanWaitsOn): string {
  return wait.kind === 'row' ? `row:${wait.rowId}` : `task:${wait.taskId}`
}

function parseWaitValue(value: string): PlanWaitsOn | null {
  const cut = value.indexOf(':')
  if (cut < 0) return null
  const kind = value.slice(0, cut)
  const id = value.slice(cut + 1)
  if (kind === 'row') return { kind: 'row', rowId: id }
  if (kind === 'task') return { kind: 'task', taskId: id }
  return null
}

/** The errors that belong to one column of a row. */
function errorsFor(
  errors: PlanningWorkItemBatchRowError[],
  column: 'title' | 'dueDate' | 'dependencyIds'
): string {
  const matching = errors.filter((error) => {
    if (column === 'title') return error.field === null || error.field === 'parentWorkItemId'
    return error.field === column
  })
  return matching.map((error) => error.message).join(' ')
}

/**
 * The plan grid (R1.1): a whole plan typed or pasted at once, created in one
 * transaction. Nothing is written until Create; each refused row shows its
 * message on the cell it concerns. Keyboard first: Tab moves between cells,
 * Enter in the last cell adds a row, Alt+Shift+arrows move a row in the tree.
 */
export function PlanGridDialog({
  ws,
  project
}: {
  ws: PlanningWorkspace
  project: RendererProject
}) {
  const people = usePeople()
  const estimateUnit = useProjectEstimateUnit(project.id)
  const announce = useAnnounce()
  const { toastUndo } = useToast()
  const confirm = useConfirm()
  const nextId = useRef(1)
  const newId = () => {
    nextId.current += 1
    return `plan-row-${nextId.current}`
  }

  const [rows, setRows] = useState<PlanRow[]>(() => [blankRow('plan-row-1', 0)])
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckState>({ ids: [], errors: [] })
  /** The custom fields shown as columns (R2.2), by id, in the order they were added. */
  const [fieldColumnIds, setFieldColumnIds] = useState<string[]>([])
  const fieldColumns = fieldColumnIds
    .map((id) => ws.fields.find((field) => field.id === id))
    .filter((field) => field !== undefined)
  // Offered columns (N2.7b): the fields the rows' types show; every field while a row has no type.
  const unshownFields = fieldsForTypes(
    ws.fields,
    rows.map((row) => taskTypeOf(ws.taskTypes, row.typeId))
  ).filter((field) => !fieldColumnIds.includes(field.id))
  /** Impact and Effort (N1.1b), shown as columns once added, in the order they were added. */
  const [scoreColumns, setScoreColumns] = useState<ScoreField[]>([])
  const unshownScores = (['impact', 'effort'] as const).filter(
    (field) => !scoreColumns.includes(field)
  )
  const removeScoreColumn = (field: ScoreField) => {
    setScoreColumns((fields) => fields.filter((candidate) => candidate !== field))
    // A hidden column's values do not go into the plan.
    setRows((current) => current.map((row) => ({ ...row, [field]: null })))
  }
  const scoreOptions: SelectOption[] = [
    { value: '', label: t('tasks:ideas.none') },
    ...SCORE_STEPS.map((step) => ({ value: String(step), label: String(step) }))
  ]
  const removeFieldColumn = (fieldId: string) => {
    setFieldColumnIds((ids) => ids.filter((id) => id !== fieldId))
    // A hidden column's values do not go into the plan.
    setRows((current) =>
      current.map((row) => {
        if (!row.fieldValues || !(fieldId in row.fieldValues)) return row
        const rest = { ...row.fieldValues }
        delete rest[fieldId]
        return { ...row, fieldValues: rest }
      })
    )
  }
  const focusRef = useRef<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /** The rows Create sends (`planRowsToCreate`): the batch is what Create sends. */
  const plan = useMemo(() => {
    const filled = planRowsToCreate(rows)
    return {
      ids: filled.map((row) => row.id),
      batch: planBatchRows(filled),
      summary: planGridSummary(filled)
    }
  }, [rows])

  // Checks the plan a moment after the last edit, and ignores a check that a newer edit overtook.
  useEffect(() => {
    if (plan.batch.length === 0) {
      setCheck({ ids: [], errors: [] })
      return undefined
    }
    let live = true
    const timer = window.setTimeout(() => {
      void ws.checkPlanWorkItems(plan.batch).then((result) => {
        if (!live) return
        setCheck({
          ids: plan.ids,
          errors: result.ok ? result.value : [{ index: -1, field: null, message: result.error }]
        })
      })
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [plan])

  // Moves the focus to a row a key or a paste just made.
  useEffect(() => {
    const id = focusRef.current
    if (!id) return
    focusRef.current = null
    gridRef.current
      ?.querySelector<HTMLInputElement>(`tr[data-row-id="${id}"] input[data-column="title"]`)
      ?.focus()
  })

  const errorsByRow = useMemo(() => {
    const map = new Map<string, PlanningWorkItemBatchRowError[]>()
    for (const error of check.errors) {
      const id = check.ids[error.index]
      if (id) map.set(id, [...(map.get(id) ?? []), error])
    }
    return map
  }, [check])
  const planErrors = check.errors.filter((error) => check.ids[error.index] === undefined)

  const rowName = (row: PlanRow, index: number) =>
    row.title.trim() || t('tasks:planGrid.untitledRow', { row: index + 1 })

  const updateRow = (id: string, patch: Partial<PlanRow>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const addRowAfter = (index: number) => {
    const id = newId()
    setRows((current) => {
      const depth = current[index]?.depth ?? 0
      return [...current.slice(0, index + 1), blankRow(id, depth), ...current.slice(index + 1)]
    })
    focusRef.current = id
  }

  const removeRow = (index: number) => {
    const removed = rows[index]
    if (!removed) return
    const remaining = rows
      .filter((_, position) => position !== index)
      .map((row) => ({
        ...row,
        waitsOn: row.waitsOn.filter((wait) => wait.kind !== 'row' || wait.rowId !== removed.id)
      }))
    if (remaining.length === 0) {
      const id = newId()
      setRows([blankRow(id, 0)])
      focusRef.current = id
      return
    }
    const focusIndex = Math.max(0, index - 1)
    focusRef.current = remaining[focusIndex].id
    setRows(clampPlanDepths(remaining))
  }

  const addWait = (index: number, value: string) => {
    const wait = parseWaitValue(value)
    const row = rows[index]
    if (!wait || !row) return
    updateRow(row.id, { waitsOn: [...row.waitsOn, wait] })
  }

  const removeWait = (index: number, key: string) => {
    const row = rows[index]
    if (!row) return
    updateRow(row.id, { waitsOn: row.waitsOn.filter((wait) => waitKey(wait) !== key) })
  }

  /** Indents (+1) or outdents (-1) the row the focus is in, with the rows under it. */
  const moveRow = (delta: 1 | -1) => {
    const id = document.activeElement?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
    if (!id) return
    const index = rows.findIndex((row) => row.id === id)
    const next = indentPlanRow(rows, index, delta)
    if (!next) {
      announce(t(delta === 1 ? 'tasks:planGrid.cannotIndent' : 'tasks:planGrid.cannotOutdent'))
      return
    }
    setRows(next)
    announce(t('tasks:planGrid.level', { level: next[index].depth + 1 }))
  }

  useShortcuts({
    'plan-indent': () => moveRow(1),
    'plan-outdent': () => moveRow(-1)
  })

  /** A pasted block of several lines becomes rows; a single line pastes as usual. */
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!/\r?\n/.test(text.trim())) return
    event.preventDefault()
    const context: QuickAddContext = {
      today: todayIsoDate(),
      locale: navigator.language,
      people: people.offered(project.id).map((person) => ({
        id: person.id,
        name: person.name,
        isMe: person.isMe
      })),
      labels: Array.from(new Set(ws.workItems.flatMap((item) => item.labels))),
      projects: []
    }
    const pasted = planRowsFromText(text, context, newId)
    if (pasted.length === 0) return
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row-id]')?.dataset.rowId
    const index = rows.findIndex((row) => row.id === id)
    const anchor = rows[index]
    const replaceBlank = anchor !== undefined && anchor.title.trim() === ''
    const shifted = pasted.map((row) => ({ ...row, depth: row.depth + (anchor?.depth ?? 0) }))
    setRows((current) => {
      if (index < 0) return clampPlanDepths([...current, ...shifted])
      const head = current.slice(0, replaceBlank ? index : index + 1)
      const tail = current.slice(index + 1)
      return clampPlanDepths([...head, ...shifted, ...tail])
    })
    focusRef.current = shifted[shifted.length - 1].id
  }

  const hasContent = rows.some((row) => row.title.trim() !== '')

  const close = async () => {
    if (
      hasContent &&
      !(await confirm({
        title: t('tasks:planGrid.discardTitle'),
        body: t('tasks:planGrid.discardBody'),
        confirmLabel: t('tasks:planGrid.discard'),
        tone: 'danger'
      }))
    )
      return
    ws.setPlanGridOpen(false)
  }

  const create = async () => {
    setCreateError(null)
    if (plan.batch.length === 0 || saving) return
    setSaving(true)
    const checked = await ws.checkPlanWorkItems(plan.batch)
    if (!checked.ok) {
      setSaving(false)
      setCreateError(checked.error)
      return
    }
    if (checked.value.length > 0) {
      setCheck({ ids: plan.ids, errors: checked.value })
      setSaving(false)
      const firstRow = plan.ids[checked.value[0].index]
      if (firstRow) focusRef.current = firstRow
      announce(
        t('tasks:planGrid.rowsNeedFixes', {
          count: new Set(checked.value.map((e) => e.index)).size
        })
      )
      return
    }
    const created = await ws.createPlanWorkItems(plan.batch)
    setSaving(false)
    if (!created.ok) {
      setCreateError(created.error)
      return
    }
    const items = created.value
    ws.setPlanGridOpen(false)
    toastUndo(t('tasks:planGrid.created', { count: items.length }), () =>
      ws.undoPlanWorkItems(items)
    )
  }

  const summaryText = [
    t('tasks:planGrid.tasksCount', { count: plan.summary.tasks }),
    t('tasks:planGrid.subtasksCount', { count: plan.summary.subtasks }),
    t('tasks:planGrid.dependenciesCount', { count: plan.summary.dependencies })
  ].join(', ')

  const personOptions: SelectOption[] = [
    { value: '', label: t('tasks:planGrid.noAssignee') },
    ...people.offered(project.id).map((person) => ({ value: person.id, label: person.name }))
  ]
  const milestoneOptions: SelectOption[] = [
    { value: '', label: t('tasks:createRecordModal.noMilestone') },
    ...ws.milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
  ]
  const estimateColumn = t('tasks:planGrid.columns.estimate', {
    unit: ESTIMATE_UNIT_SHORT[estimateUnit]
  })

  /** What a row may wait on, as the picker offers it: earlier rows, and for a task, existing tasks. */
  const waitOptionsFor = (index: number): SelectOption[] => {
    const row = rows[index]
    const chosen = new Set(row.waitsOn.map(waitKey))
    const rowOptions = waitsOnCandidates(rows, index)
      .filter((candidate) => !chosen.has(`row:${candidate.id}`))
      .map((candidate) => ({
        value: `row:${candidate.id}`,
        label: rowName(candidate, rows.indexOf(candidate))
      }))
    const taskOptions =
      row.depth === 0
        ? dependencyCandidates(
            { id: '', parentWorkItemId: null, subtaskPhaseNumber: null },
            ws.workItems
          )
            .filter((candidate) => !chosen.has(`task:${candidate.id}`))
            .map((candidate) => ({ value: `task:${candidate.id}`, label: candidate.title }))
        : []
    return [...rowOptions, ...taskOptions]
  }

  const waitsFor = (row: PlanRow) =>
    row.waitsOn.flatMap((wait) => {
      if (wait.kind === 'row') {
        const position = rows.findIndex((candidate) => candidate.id === wait.rowId)
        if (position < 0) return []
        return [{ key: waitKey(wait), label: rowName(rows[position], position), missing: false }]
      }
      const task = ws.workItemsById.get(wait.taskId)
      return [
        {
          key: waitKey(wait),
          label: task?.title ?? t('tasks:taskDependencies.taskNoLongerExists'),
          missing: task === undefined
        }
      ]
    })

  const onLastCellEnter = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    addRowAfter(index)
  }

  return (
    <Dialog
      open
      size="full"
      onClose={() => void close()}
      canDismiss={!saving}
      closeOnBackdrop={false}
      title={t('tasks:planGrid.title')}
      description={t('tasks:planGrid.description', { projectName: project.name })}
      footer={
        <>
          <Button onClick={() => void close()} disabled={saving}>
            {t('tasks:planGrid.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={plan.batch.length === 0 || saving}
            onClick={() => void create()}
          >
            {t('tasks:planGrid.create', { count: plan.batch.length })}
          </Button>
        </>
      }
    >
      <div className="plan-grid">
        <div className="plan-grid__status">
          <p className="plan-grid__summary" aria-live="polite">
            {summaryText}
          </p>
          {errorsByRow.size > 0 && (
            <p className="plan-grid__count-errors">
              {t('tasks:planGrid.rowsNeedFixes', { count: errorsByRow.size })}
            </p>
          )}
        </div>
        {unshownFields.length > 0 && (
          <div className="plan-grid__field-columns">
            <Select
              label={t('tasks:planGrid.addFieldColumn')}
              size="sm"
              value=""
              onChange={(event) => {
                const id = event.target.value
                if (id) setFieldColumnIds((ids) => [...ids, id])
              }}
              options={[
                { value: '', label: t('tasks:planGrid.chooseField'), disabled: true },
                ...unshownFields.map((field) => ({ value: field.id, label: field.name }))
              ]}
            />
          </div>
        )}
        {unshownScores.length > 0 && (
          <div className="plan-grid__field-columns">
            <Select
              label={t('tasks:planGrid.addScoreColumn')}
              size="sm"
              value=""
              onChange={(event) => {
                const field = event.target.value as ScoreField | ''
                if (field) setScoreColumns((fields) => [...fields, field])
              }}
              options={[
                { value: '', label: t('tasks:planGrid.chooseScore'), disabled: true },
                ...unshownScores.map((field) => ({
                  value: field,
                  label: t(`tasks:ideas.${field}`)
                }))
              ]}
            />
          </div>
        )}
        {createError && <InlineAlert tone="danger">{createError}</InlineAlert>}
        {planErrors.map((error) => (
          <InlineAlert key={error.message} tone="danger">
            {error.message}
          </InlineAlert>
        ))}
        <div className="plan-grid__scroll" ref={gridRef} onPaste={onPaste}>
          <table className="plan-grid__table" aria-label={t('tasks:planGrid.table')}>
            <thead>
              <tr>
                <th scope="col">{t('tasks:planGrid.columns.title')}</th>
                <th scope="col">{t('tasks:planGrid.columns.assignee')}</th>
                <th scope="col">{t('tasks:planGrid.columns.startDate')}</th>
                <th scope="col">{t('tasks:planGrid.columns.dueDate')}</th>
                <th scope="col">{estimateColumn}</th>
                <th scope="col">{t('tasks:planGrid.columns.waitsOn')}</th>
                <th scope="col">{t('tasks:planGrid.columns.milestone')}</th>
                {ws.iterations.length > 0 && <th scope="col">{t('tasks:iterations.field')}</th>}
                {ws.taskTypes.length > 0 && <th scope="col">{t('tasks:taskTypes.field')}</th>}
                <th scope="col">{t('tasks:planGrid.columns.labels')}</th>
                {scoreColumns.map((field) => (
                  <th key={field} scope="col">
                    <span className="plan-grid__field-head">
                      {t(`tasks:ideas.${field}`)}
                      <IconButton
                        size="sm"
                        icon={X}
                        label={t('tasks:planGrid.removeFieldColumn', {
                          fieldName: t(`tasks:ideas.${field}`)
                        })}
                        onClick={() => removeScoreColumn(field)}
                      />
                    </span>
                  </th>
                ))}
                {fieldColumns.map((field) => (
                  <th key={field.id} scope="col">
                    <span className="plan-grid__field-head">
                      {field.name}
                      <IconButton
                        size="sm"
                        icon={X}
                        label={t('tasks:planGrid.removeFieldColumn', { fieldName: field.name })}
                        onClick={() => removeFieldColumn(field.id)}
                      />
                    </span>
                  </th>
                ))}
                <th scope="col">
                  <span className="ui-visually-hidden">{t('tasks:planGrid.columns.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const errors = errorsByRow.get(row.id) ?? []
                const cellName = (column: string) =>
                  t('tasks:planGrid.cellName', { row: index + 1, column })
                const waitOptions = waitOptionsFor(index)
                const waits = waitsFor(row)
                return (
                  <tr key={row.id} data-row-id={row.id} className="plan-grid__row">
                    <td>
                      <div
                        className="plan-grid__title"
                        style={{ '--plan-depth': row.depth } as CSSProperties}
                      >
                        <TextField
                          label={cellName(t('tasks:planGrid.columns.title'))}
                          hideLabel
                          data-column="title"
                          data-autofocus={index === 0 ? '' : undefined}
                          placeholder={t('tasks:planGrid.titlePlaceholder')}
                          value={row.title}
                          error={errorsFor(errors, 'title') || undefined}
                          onChange={(event) => updateRow(row.id, { title: event.target.value })}
                        />
                      </div>
                    </td>
                    <td>
                      <Select
                        label={cellName(t('tasks:planGrid.columns.assignee'))}
                        hideLabel
                        size="sm"
                        value={row.assigneeId ?? ''}
                        onChange={(event) =>
                          updateRow(row.id, { assigneeId: event.target.value || null })
                        }
                        options={personOptions}
                      />
                    </td>
                    <td>
                      <DateField
                        label={cellName(t('tasks:planGrid.columns.startDate'))}
                        hideLabel
                        due={false}
                        value={row.startDate}
                        onChange={(startDate) => updateRow(row.id, { startDate })}
                      />
                    </td>
                    <td>
                      <DateField
                        label={cellName(t('tasks:planGrid.columns.dueDate'))}
                        hideLabel
                        value={row.dueDate}
                        error={errorsFor(errors, 'dueDate') || undefined}
                        onChange={(dueDate) => updateRow(row.id, { dueDate })}
                      />
                    </td>
                    <td>
                      <NumberField
                        label={cellName(estimateColumn)}
                        hideLabel
                        min={0}
                        max={MAX_ESTIMATE}
                        unit={ESTIMATE_UNIT_SHORT[estimateUnit]}
                        value={row.estimate}
                        onChange={(estimate) => updateRow(row.id, { estimate })}
                      />
                    </td>
                    <td>
                      <ul
                        className="plan-grid__waits"
                        aria-label={cellName(t('tasks:planGrid.columns.waitsOn'))}
                      >
                        {waits.map((wait) => (
                          <li key={wait.key} className="plan-grid__wait">
                            <span className={wait.missing ? 'plan-grid__wait-missing' : undefined}>
                              {wait.label}
                            </span>
                            <IconButton
                              size="sm"
                              icon={X}
                              label={t('tasks:taskDependencies.removeDependencies', {
                                title: wait.label
                              })}
                              onClick={() => removeWait(index, wait.key)}
                            />
                          </li>
                        ))}
                      </ul>
                      <Select
                        label={t('tasks:planGrid.addWait', { row: index + 1 })}
                        hideLabel
                        size="sm"
                        value=""
                        onChange={(event) => addWait(index, event.target.value)}
                        options={[
                          {
                            value: '',
                            label:
                              waitOptions.length > 0
                                ? t('tasks:planGrid.addWaitPlaceholder')
                                : t('tasks:planGrid.noWaitOptions'),
                            disabled: true
                          },
                          ...waitOptions
                        ]}
                      />
                      {errorsFor(errors, 'dependencyIds') && (
                        <p className="plan-grid__error">{errorsFor(errors, 'dependencyIds')}</p>
                      )}
                    </td>
                    <td>
                      <Select
                        label={cellName(t('tasks:planGrid.columns.milestone'))}
                        hideLabel
                        size="sm"
                        value={row.milestoneId}
                        onChange={(event) => updateRow(row.id, { milestoneId: event.target.value })}
                        options={milestoneOptions}
                      />
                    </td>
                    {ws.iterations.length > 0 && (
                      <td>
                        <Select
                          label={cellName(t('tasks:iterations.field'))}
                          hideLabel
                          size="sm"
                          value={row.iterationId ?? ''}
                          onChange={(event) =>
                            updateRow(row.id, { iterationId: event.target.value })
                          }
                          options={iterationOptions(ws.iterations, row.iterationId || null)}
                        />
                      </td>
                    )}
                    {ws.taskTypes.length > 0 && (
                      <td>
                        <Select
                          label={cellName(t('tasks:taskTypes.field'))}
                          hideLabel
                          size="sm"
                          value={row.typeId ?? ''}
                          onChange={(event) => updateRow(row.id, { typeId: event.target.value })}
                          options={taskTypeOptions(ws.taskTypes)}
                        />
                      </td>
                    )}
                    <td>
                      <TextField
                        label={cellName(t('tasks:planGrid.columns.labels'))}
                        hideLabel
                        placeholder={t('tasks:planGrid.labelsPlaceholder')}
                        value={row.labels}
                        onChange={(event) => updateRow(row.id, { labels: event.target.value })}
                        onKeyDown={(event) =>
                          fieldColumns.length === 0 &&
                          scoreColumns.length === 0 &&
                          onLastCellEnter(event, index)
                        }
                      />
                    </td>
                    {scoreColumns.map((field) => (
                      <td key={field}>
                        <Select
                          label={cellName(t(`tasks:ideas.${field}`))}
                          hideLabel
                          size="sm"
                          value={row[field] == null ? '' : String(row[field])}
                          options={scoreOptions}
                          onChange={(event) =>
                            updateRow(row.id, {
                              [field]: event.target.value === '' ? null : Number(event.target.value)
                            })
                          }
                        />
                      </td>
                    ))}
                    {fieldColumns.map((field) => (
                      <td key={field.id}>
                        <CustomFieldInput
                          field={field}
                          hideLabel
                          label={cellName(field.name)}
                          value={row.fieldValues?.[field.id] ?? undefined}
                          onChange={(value) =>
                            updateRow(row.id, {
                              fieldValues: { ...row.fieldValues, [field.id]: value }
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <IconButton
                        size="sm"
                        icon={X}
                        label={t('tasks:planGrid.removeRow', { row: index + 1 })}
                        onClick={() => removeRow(index)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="plan-grid__footer">
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => addRowAfter(rows.length - 1)}
          >
            {t('tasks:planGrid.addRow')}
          </Button>
          <p className="plan-grid__hint">
            {t('tasks:planGrid.hint', {
              indent: shortcut('plan-indent').keys,
              outdent: shortcut('plan-outdent').keys
            })}
          </p>
        </div>
      </div>
    </Dialog>
  )
}
