import { checklistRename, type ChecklistRename } from '@shared/planning/checklist-details'
import { useEffect, useRef, useState } from 'react'
import type {
  PlanningChangeField,
  PlanningFieldValue,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { continuesSitting, isTextSittingField } from '@shared/planning/sitting'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { columnIdOfKey } from '@shared/board-columns'

/** How long typing must pause before its text is saved (D30: about a second). */
export const TYPING_PAUSE_MS = 1000
/** The saved changes one drawer session can undo. */
const UNDO_LIMIT = 100

/**
 * Every field the task drawer saves. `subtaskPhase` is a subtask's phase
 * number and name together, so the main process checks them as one placement.
 */
export type DrawerField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'milestoneId'
  | 'iterationId'
  | 'typeId'
  /** The workstream (sub-project) the task belongs to. */
  | 'subprojectId'
  | 'targetDate'
  | 'startDate'
  | 'showFrom'
  | 'assigneeId'
  | 'estimate'
  | 'labels'
  | 'acceptanceCriteria'
  | 'dependencyIds'
  /** The waits-on links' types and lags (N7.2a); adding or removing one is `dependencyIds`. */
  | 'dependencyLinks'
  | 'autoQueue'
  | 'subtaskPhase'
  /** A custom field's value (R2.2): `custom:<field id>`. */
  | CustomDrawerField

export type CustomDrawerField = `custom:${string}`

/** The drawer field for a custom field. */
export function customDrawerField(fieldId: string): CustomDrawerField {
  return `custom:${fieldId}`
}

function customFieldId(field: DrawerField): string | null {
  return field.startsWith('custom:') ? field.slice('custom:'.length) : null
}

/** The drawer fields a task's custom values make, besides `DRAWER_FIELDS`. */
function customFieldsOf(...items: PlanningWorkItem[]): CustomDrawerField[] {
  return [
    ...new Set(items.flatMap((item) => Object.keys(item.fieldValues ?? {}).map(customDrawerField)))
  ]
}

export const DRAWER_FIELDS: readonly DrawerField[] = [
  'title',
  'description',
  'status',
  'priority',
  'milestoneId',
  'iterationId',
  'typeId',
  'subprojectId',
  'targetDate',
  'startDate',
  'showFrom',
  'assigneeId',
  'estimate',
  'labels',
  'acceptanceCriteria',
  'dependencyIds',
  'dependencyLinks',
  'autoQueue',
  'subtaskPhase'
]

export interface SubtaskPhase {
  subtaskPhaseNumber: number | null
  subtaskPhaseName: string
}

/**
 * How a change is saved: `now` for a picker, a toggle or a list edit that is
 * finished when made; `pause` for typing, which waits until the person stops
 * (`TYPING_PAUSE_MS`), leaves the field or closes the drawer.
 */
export type SaveTiming = 'now' | 'pause'

export interface DrawerFailure {
  field: DrawerField
  message: string
}

export interface UndoStep {
  field: DrawerField
  /** The saved value before this change (or sitting of typing). */
  before: unknown
  after: unknown
  at: number
  /** What rules did because of this change (R6.2): its undo undoes that too. */
  ruleRunId?: string
}

const cleanList = (entries: string[]) => entries.map((entry) => entry.trim()).filter(Boolean)

/**
 * The value a field saves as: text trimmed the way the main process trims it,
 * a blank date, milestone or assignee as null, a checklist without blank rows.
 * Callers compare and send normalised values only.
 */
export function normalizeSavedValue(field: DrawerField, value: unknown): unknown {
  if (customFieldId(field) !== null) {
    // Empty in any form is null: what the main process stores as no value.
    if (value === undefined || value === null || value === false) return null
    if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
    if (Array.isArray(value)) return value.length === 0 ? null : value
    return value
  }
  switch (field) {
    case 'title':
    case 'description':
      return String(value ?? '').trim()
    case 'milestoneId':
    case 'iterationId':
    case 'typeId':
    case 'subprojectId':
    case 'targetDate':
    case 'startDate':
    case 'showFrom':
    case 'assigneeId': {
      const text = typeof value === 'string' ? value.trim() : value
      return text === '' || text === undefined ? null : text
    }
    case 'labels':
    case 'acceptanceCriteria':
      return cleanList(value as string[])
    case 'subtaskPhase': {
      const phase = value as SubtaskPhase
      return {
        subtaskPhaseNumber: phase.subtaskPhaseNumber,
        subtaskPhaseName: phase.subtaskPhaseName.trim()
      }
    }
    default:
      return value
  }
}

/** Whether two values of a field are the same saved value. Dependencies are a set. */
export function sameSavedValue(field: DrawerField, left: unknown, right: unknown): boolean {
  const a = normalizeSavedValue(field, left)
  const b = normalizeSavedValue(field, right)
  if (field === 'dependencyIds') {
    const sorted = (values: unknown) => [...(values as string[])].sort().join('\n')
    return sorted(a) === sorted(b)
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A field's value as the record holds it. */
export function savedValueOf(
  item: PlanningWorkItem,
  field: DrawerField,
  /** The task's column key (`taskColumnKey`): what the drawer's status shows (MOP-26). */
  statusOf: (item: PlanningWorkItem) => string
): unknown {
  const fieldId = customFieldId(field)
  if (fieldId !== null) return item.fieldValues?.[fieldId] ?? null
  switch (field) {
    case 'status':
      return statusOf(item)
    case 'subtaskPhase':
      return {
        subtaskPhaseNumber: item.subtaskPhaseNumber,
        subtaskPhaseName: item.subtaskPhaseName
      }
    case 'milestoneId':
      return item.milestoneId
    case 'iterationId':
      return item.iterationId ?? null
    case 'typeId':
      return item.typeId ?? null
    case 'subprojectId':
      return item.subprojectId ?? null
    case 'targetDate':
      return item.targetDate
    case 'startDate':
      return item.startDate
    case 'showFrom':
      return item.showFrom ?? null
    case 'assigneeId':
      return item.assigneeId
    case 'acceptanceCriteria':
      return item.acceptanceCriteria
    case 'dependencyIds':
      return item.dependencyIds
    case 'dependencyLinks':
      return dependencyLinksOf(item)
    default:
      return item[field as keyof PlanningWorkItem]
  }
}

/** The update the main process receives for one field. */
export function patchFor(field: DrawerField, value: unknown): UpdatePlanningWorkItemInput {
  const fieldId = customFieldId(field)
  if (fieldId !== null)
    return { fieldValues: { [fieldId]: (value ?? null) as PlanningFieldValue | null } }
  // The status is a column (MOP-26): a column of the project's own sets the
  // status it counts as; a status alone is that status's own column.
  if (field === 'status') {
    const columnId = columnIdOfKey(value as string)
    return columnId ? { columnId } : { status: value as PlanningWorkItemStatus, columnId: null }
  }
  if (field === 'subtaskPhase') {
    const phase = value as SubtaskPhase
    return {
      subtaskPhaseNumber: phase.subtaskPhaseNumber,
      subtaskPhaseName: phase.subtaskPhaseName
    }
  }
  return { [field]: value } as UpdatePlanningWorkItemInput
}

/** Typed text in one field is one undo step, as long as it continues one sitting. */
const SITTING_FIELD: Partial<Record<DrawerField, PlanningChangeField>> = {
  title: 'title',
  description: 'description',
  acceptanceCriteria: 'checklist'
}

/** The undo steps after one more saved change. A sitting of typing folds into its first step. */
export function withUndoStep(steps: UndoStep[], step: UndoStep): UndoStep[] {
  const last = steps[steps.length - 1]
  const sitting = SITTING_FIELD[step.field]
  if (
    last &&
    sitting &&
    last.field === step.field &&
    isTextSittingField(sitting) &&
    continuesSitting(last.at, step.at)
  ) {
    return [
      ...steps.slice(0, -1),
      { ...last, after: step.after, at: step.at, ruleRunId: last.ruleRunId ?? step.ruleRunId }
    ]
  }
  return [...steps, step].slice(-UNDO_LIMIT)
}

export type DrawerSaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

interface Typed {
  itemId: string
  value: unknown
  before: unknown
  timer: ReturnType<typeof setTimeout> | null
}

interface Failed {
  itemId: string
  value: unknown
  before: unknown
  /** False for an undo: it is not a change of its own, so a retry does not record one. */
  record: boolean
  message: string
  /** The failed save was a checklist rename: a retry renames again, never replaces the list. */
  rename?: ChecklistRename | null
}

export interface DrawerSavesOptions {
  /** The open task, from the records. */
  item: PlanningWorkItem | null
  /** The task's column key: a status, or `custom:<id>` for a column of the project's own. */
  statusOf: (item: PlanningWorkItem) => string
  replaceRecord: (item: PlanningWorkItem) => void
  /** Shows a saved value in the editor (undo, a refresh from elsewhere, discarding a failure). */
  showValue: (field: DrawerField, value: unknown) => void
  onRepeat: (item: PlanningWorkItem) => void
  /** A save that failed after the drawer moved on to another task. */
  onError: (message: string) => void
}

/**
 * Saves the task drawer's fields as they change (D30): one request per change
 * and one per pause of typing, sent one after another so the order holds. A
 * failed save keeps the person's value and waits, for Retry or Discard. Every
 * saved change is an undo step, and a field that is being edited keeps the
 * person's text when the same task changes elsewhere.
 *
 * Owned by `useWorkItemDrawer`, the only caller. Its members are reached
 * through `ws`, so views never import this file.
 */
export function useDrawerSaves(options: DrawerSavesOptions) {
  const { item } = options
  const latest = useRef(options)
  latest.current = options

  const openId = useRef<string | null>(null)
  /** Counts drawer sessions: a task closed and opened again is a new one. */
  const session = useRef(0)
  /** The last value sent (or confirmed) per field: what a new change is compared with. */
  const requested = useRef(new Map<DrawerField, unknown>())
  const typed = useRef(new Map<DrawerField, Typed>())
  const focused = useRef(new Set<DrawerField>())
  const inFlight = useRef(new Map<DrawerField, number>())
  const failed = useRef(new Map<DrawerField, Failed>())
  const undo = useRef<UndoStep[]>([])
  const queue = useRef<Promise<void>>(Promise.resolve())
  const jobs = useRef(0)
  const completed = useRef(false)
  const previous = useRef<PlanningWorkItem | null>(null)

  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failures, setFailures] = useState<DrawerFailure[]>([])

  const syncStatus = () => {
    const working = jobs.current > 0 || typed.current.size > 0
    setBusy(working)
    setSaved(!working && failed.current.size === 0 && completed.current)
  }

  const publishFailures = () =>
    setFailures(
      [...failed.current].map(([field, failure]) => ({ field, message: failure.message }))
    )

  const remember = (field: DrawerField, failure: Failed) => {
    // A task the person has left has no open field to show the failure in.
    if (failure.itemId !== openId.current) {
      latest.current.onError(failure.message)
      return
    }
    failed.current.set(field, failure)
  }

  const save = async (
    field: DrawerField,
    value: unknown,
    before: unknown,
    itemId: string,
    record: boolean,
    ownSession: number,
    undoRuleRun?: string,
    rename?: ChecklistRename | null
  ) => {
    try {
      const result = rename
        ? await window.ostlerAPI.renamePlanningChecklistItem(itemId, rename.from, rename.to)
        : await window.ostlerAPI.updatePlanningWorkItem(itemId, {
            ...patchFor(field, value),
            ...(undoRuleRun ? { undoRuleRun } : {})
          })
      if (!result.ok) {
        remember(field, { itemId, value, before, record, message: result.error, rename })
        return
      }
      failed.current.delete(field)
      completed.current = true
      latest.current.replaceRecord(result.value)
      latest.current.onRepeat(result.value)
      if (record && itemId === openId.current && ownSession === session.current) {
        undo.current = withUndoStep(undo.current, {
          field,
          before,
          after: value,
          at: Date.now(),
          ...(result.value.ruleRun ? { ruleRunId: result.value.ruleRun.id } : {})
        })
      }
    } catch (error) {
      remember(field, {
        itemId,
        value,
        before,
        record,
        message: error instanceof Error ? error.message : String(error),
        rename
      })
    } finally {
      const left = (inFlight.current.get(field) ?? 1) - 1
      if (left > 0) inFlight.current.set(field, left)
      else inFlight.current.delete(field)
      jobs.current -= 1
      publishFailures()
      syncStatus()
    }
  }

  /** Queues one save behind the saves already waiting, so they reach the main process in order. */
  const enqueue = (
    field: DrawerField,
    value: unknown,
    before: unknown,
    itemId: string,
    record: boolean,
    undoRuleRun?: string,
    /** A retry's own rename, worked out when it was first sent. */
    retriedRename?: ChecklistRename | null
  ) => {
    const normalized = normalizeSavedValue(field, value)
    // One checklist item's text edited since the last save: a rename, so its
    // tick, date and person go with it (N2.2). Anything else replaces the list.
    const item = latest.current.item
    const sent = requested.current.has(field)
      ? requested.current.get(field)
      : item && item.id === itemId
        ? savedValueOf(item, field, latest.current.statusOf)
        : undefined
    const rename =
      retriedRename !== undefined
        ? retriedRename
        : field === 'acceptanceCriteria' && !undoRuleRun && Array.isArray(sent)
          ? checklistRename(sent as string[], normalized as string[])
          : null
    requested.current.set(field, normalized)
    inFlight.current.set(field, (inFlight.current.get(field) ?? 0) + 1)
    jobs.current += 1
    syncStatus()
    const ownSession = session.current
    queue.current = queue.current.then(() =>
      save(field, normalized, before, itemId, record, ownSession, undoRuleRun, rename)
    )
  }

  const dropTyped = (field: DrawerField) => {
    const pending = typed.current.get(field)
    if (!pending) return
    if (pending.timer) clearTimeout(pending.timer)
    typed.current.delete(field)
  }

  /** Saves a field's typed text now. */
  const settle = (field: DrawerField) => {
    const pending = typed.current.get(field)
    if (!pending) return
    dropTyped(field)
    enqueue(field, pending.value, pending.before, pending.itemId, true)
    syncStatus()
  }

  const settleAll = () => {
    for (const field of [...typed.current.keys()]) settle(field)
  }

  const isBeingEdited = (field: DrawerField) =>
    focused.current.has(field) ||
    typed.current.has(field) ||
    (inFlight.current.get(field) ?? 0) > 0 ||
    failed.current.has(field)

  /** Records a change to a field. Pass `pause` for typing, `now` for everything else. */
  const change = (field: DrawerField, raw: unknown, timing: SaveTiming) => {
    const current = latest.current.item
    if (!current) return
    const value = normalizeSavedValue(field, raw)
    const pending = typed.current.get(field)
    const baseline = requested.current.has(field)
      ? requested.current.get(field)
      : savedValueOf(current, field, latest.current.statusOf)
    if (sameSavedValue(field, value, baseline)) {
      // Typed back to what is saved: nothing to send.
      dropTyped(field)
      syncStatus()
      return
    }
    const before = pending ? pending.before : baseline
    if (timing === 'pause') {
      dropTyped(field)
      const timer = setTimeout(() => settle(field), TYPING_PAUSE_MS)
      typed.current.set(field, { itemId: current.id, value, before, timer })
      syncStatus()
      return
    }
    dropTyped(field)
    enqueue(field, value, before, current.id, true)
  }

  /** The person is typing in a field: a change from elsewhere waits until they leave it. */
  const beginEdit = (field: DrawerField) => {
    focused.current.add(field)
  }

  /** The person left a field: whatever they typed there is saved now. */
  const endEdit = (field: DrawerField) => {
    focused.current.delete(field)
    settle(field)
  }

  /** Undoes the last saved change, if there is one. Returns whether it did. */
  const undoLast = (): boolean => {
    const step = undo.current[undo.current.length - 1]
    const itemId = openId.current
    if (!step || !itemId) return false
    undo.current = undo.current.slice(0, -1)
    dropTyped(step.field)
    latest.current.showValue(step.field, step.before)
    enqueue(step.field, step.before, step.before, itemId, false, step.ruleRunId)
    return true
  }

  const retryFailed = () => {
    const retries = [...failed.current]
    failed.current.clear()
    for (const [field, failure] of retries) {
      // What was sent is already the failed value, so the rename is the one
      // worked out the first time: compared again, it would replace the list.
      enqueue(
        field,
        failure.value,
        failure.before,
        failure.itemId,
        failure.record,
        undefined,
        failure.rename ?? null
      )
    }
    publishFailures()
    syncStatus()
  }

  /** Puts each failed field back to its saved value and drops the typed text. */
  const discardFailed = () => {
    const current = latest.current.item
    for (const field of [...failed.current.keys()]) {
      dropTyped(field)
      requested.current.delete(field)
      if (current) {
        latest.current.showValue(field, savedValueOf(current, field, latest.current.statusOf))
      }
    }
    failed.current.clear()
    publishFailures()
    syncStatus()
  }

  const resetSession = () => {
    session.current += 1
    requested.current.clear()
    undo.current = []
    failed.current.clear()
    completed.current = false
    publishFailures()
    syncStatus()
  }

  // A different task, or none: what was typed in the old one is saved first,
  // under its own id. Then the session starts over for the new one.
  // The same task changed elsewhere: fields the person is not editing take it.
  useEffect(() => {
    const before = previous.current
    previous.current = item
    if (!item) {
      settleAll()
      focused.current.clear()
      openId.current = null
      resetSession()
      return
    }
    if (item.id !== openId.current) {
      settleAll()
      openId.current = item.id
      resetSession()
      return
    }
    if (!before) return
    const { statusOf } = latest.current
    for (const field of [...DRAWER_FIELDS, ...customFieldsOf(before, item)]) {
      const shown = savedValueOf(before, field, statusOf)
      const next = savedValueOf(item, field, statusOf)
      if (sameSavedValue(field, shown, next)) continue
      if (isBeingEdited(field)) continue
      requested.current.delete(field)
      latest.current.showValue(field, next)
    }
  }, [item])

  // Leaving the drawer's view with typing still unsaved must not lose it.
  useEffect(() => () => settleAll(), [])

  const status: DrawerSaveStatus =
    failures.length > 0 ? 'failed' : busy ? 'saving' : saved ? 'saved' : 'idle'

  return {
    status,
    failures,
    change,
    beginEdit,
    endEdit,
    settle: settleAll,
    /** Resolves once every save requested so far has finished. */
    idle: () => queue.current,
    /** The failures right now, not as of the last render. */
    failedNow: (): DrawerFailure[] =>
      [...failed.current].map(([field, failure]) => ({ field, message: failure.message })),
    retryFailed,
    discardFailed,
    undoLast
  }
}
