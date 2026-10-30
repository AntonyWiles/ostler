import { useRepeatNotice } from './useRepeatNotice'
import { useRequeueUndo } from './useRequeueUndo'
import { useEffect, useState } from 'react'
import { assertResult } from '../../utils/unwrap-result'
import type {
  AIWorkItemImprovement,
  PlanningChecklistDetailInput,
  PlanningFieldValue,
  PlanningFieldValues,
  PlanningPriority,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  PlanningDependencyLink,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { placeOfKey, taskColumnKey } from '@shared/board-columns'
import { useProjectColumns } from '../../context/ColumnsContext'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningSelectors } from './usePlanningSelectors'
import {
  customDrawerField,
  useDrawerSaves,
  type DrawerField,
  type SubtaskPhase
} from './drawer-saves'
import { t } from '@shared/i18n'
import {
  taskDateMove,
  useMoveDependents
} from '../../components/move-dependents/MoveDependentsProvider'

/**
 * The work item drawer: which item is open, its fields, and the AI "improve"
 * and re-draft pass. Every field saves as it changes (D30) through
 * `drawer-saves.ts`, which this hook drives and nothing else calls. Depends on
 * the runner, records and selectors.
 */
export function useWorkItemDrawer(
  projectId: string,
  runner: PlanningRunner,
  records: PlanningRecords,
  selectors: PlanningSelectors
) {
  const { setError } = runner
  const { runWith } = runner.internal
  const { workItems, loadPlanning } = records
  const { setWorkItems } = records.internal
  const noticeRepeat = useRepeatNotice(loadPlanning)
  const requeueUndo = useRequeueUndo(projectId, loadPlanning, setError)
  const { offer: offerMoveDependents } = useMoveDependents()

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null)
  const [titleValue, setTitleValue] = useState('')
  const [descriptionValue, setDescriptionValue] = useState('')
  /** The column key the status shows (MOP-26): a status, or `custom:<id>`. */
  const [statusValue, setStatusValue] = useState<string>('backlog')
  const columnSettings = useProjectColumns(projectId)
  const columnOf = (item: PlanningWorkItem) =>
    taskColumnKey(item, columnSettings, selectors.projectedStatus(item))
  const [priorityValue, setPriorityValue] = useState<PlanningPriority>('medium')
  const [milestoneValue, setMilestoneValue] = useState('')
  const [iterationValue, setIterationValue] = useState('')
  const [typeValue, setTypeValue] = useState('')
  const [subprojectValue, setSubprojectValue] = useState('')
  const [targetDateValue, setTargetDateValue] = useState('')
  const [startDateValue, setStartDateValue] = useState('')
  const [showFromValue, setShowFromValue] = useState('')
  const [assigneeValue, setAssigneeValue] = useState<string | null>(null)
  const [estimateValue, setEstimateValue] = useState<number | null>(null)
  const [labelsValue, setLabelsValue] = useState<string[]>([])
  /** The checklist, one row per entry. Blank rows are dropped when saved. */
  const [criteriaValue, setCriteriaValue] = useState<string[]>([])
  const [dependencyIdsValue, setDependencyIdsValue] = useState<string[]>([])
  const [dependencyLinksValue, setDependencyLinksValue] = useState<PlanningDependencyLink[]>([])
  const [autoQueueValue, setAutoQueueValue] = useState(false)
  const [phaseNumberValue, setPhaseNumberValue] = useState<number | null>(null)
  const [phaseNameValue, setPhaseNameValue] = useState('')
  /** Custom field values as shown (R2.2), by field id; a field with no value has no key. */
  const [fieldValues, setFieldValues] = useState<PlanningFieldValues>({})
  const [aiWorkItemDraft, setAiWorkItemDraft] = useState<AIWorkItemImprovement | null>(null)
  const [aiImproveBusy, setAiImproveBusy] = useState(false)
  const [redraftSourceIds, setRedraftSourceIds] = useState<string[] | null>(null)

  /** The AI "improve" calls run long, so they spin a flag of their own. */
  const runImproving = runWith(setAiImproveBusy)

  useEffect(() => {
    setSelectedWorkItemId(null)
    setAiWorkItemDraft(null)
  }, [projectId])

  /**
   * An archived task opened from the Archive (N1.2: a won't-do task, to read
   * its reason and Reopen it). Live tasks come from the Board's list.
   */
  const [closedItem, setClosedItem] = useState<PlanningWorkItem | null>(null)
  const selectedWorkItem =
    workItems.find((item) => item.id === selectedWorkItemId) ??
    (closedItem && closedItem.id === selectedWorkItemId ? closedItem : null)

  /** Shows a saved value in the editor: undo, a change from elsewhere, a discarded failure. */
  const applyValue = (field: DrawerField, value: unknown) => {
    if (field.startsWith('custom:')) {
      const fieldId = field.slice('custom:'.length)
      setFieldValues((current) => withFieldValue(current, fieldId, value))
      return
    }
    switch (field) {
      case 'title':
        setTitleValue(value as string)
        return
      case 'description':
        setDescriptionValue(value as string)
        return
      case 'status':
        setStatusValue(value as string)
        return
      case 'priority':
        setPriorityValue(value as PlanningPriority)
        return
      case 'milestoneId':
        setMilestoneValue((value as string | null) ?? '')
        return
      case 'iterationId':
        setIterationValue((value as string | null) ?? '')
        return
      case 'typeId':
        setTypeValue((value as string | null) ?? '')
        return
      case 'subprojectId':
        setSubprojectValue((value as string | null) ?? '')
        return
      case 'targetDate':
        setTargetDateValue((value as string | null) ?? '')
        return
      case 'startDate':
        setStartDateValue((value as string | null) ?? '')
        return
      case 'showFrom':
        setShowFromValue((value as string | null) ?? '')
        return
      case 'assigneeId':
        setAssigneeValue(value as string | null)
        return
      case 'estimate':
        setEstimateValue(value as number | null)
        return
      case 'labels':
        setLabelsValue(value as string[])
        return
      case 'acceptanceCriteria':
        setCriteriaValue(value as string[])
        return
      case 'dependencyIds':
        setDependencyIdsValue(value as string[])
        return
      case 'dependencyLinks':
        setDependencyLinksValue(value as PlanningDependencyLink[])
        return
      case 'autoQueue':
        setAutoQueueValue(value as boolean)
        return
      case 'subtaskPhase': {
        const phase = value as SubtaskPhase
        setPhaseNumberValue(phase.subtaskPhaseNumber)
        setPhaseNameValue(phase.subtaskPhaseName)
        return
      }
    }
  }

  const saves = useDrawerSaves({
    item: selectedWorkItem,
    statusOf: columnOf,
    replaceRecord: (updated) => {
      const before = workItems.find((candidate) => candidate.id === updated.id)
      setWorkItems((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate))
      )
      // An archived task is not on the Board: the drawer and the Archive's
      // row read this copy, so it takes what was saved too.
      setClosedItem((current) => (current?.id === updated.id ? updated : current))
      // The change took it out of the agent queue (a move out of Ready, Someday,
      // a later show-from date): the queue is read again, and Undo queues it.
      if (updated.leftQueue && before) {
        void loadPlanning()
        requeueUndo.offer([{ item: before, undo: queueUndoOf(before, updated) }])
      }
      // A due date moved later: offer to move what waits on it (N7.1).
      if (before)
        void offerMoveDependents([taskDateMove(before, updated)], () => void loadPlanning())
    },
    showValue: applyValue,
    onRepeat: noticeRepeat,
    onError: setError
  })

  const openWorkItem = (item: PlanningWorkItem) => {
    setError(null)
    setSelectedWorkItemId(item.id)
    setTitleValue(item.title)
    setDescriptionValue(item.description)
    setStatusValue(columnOf(item))
    setPriorityValue(item.priority)
    setMilestoneValue(item.milestoneId ?? '')
    setIterationValue(item.iterationId ?? '')
    setTypeValue(item.typeId ?? '')
    setSubprojectValue(item.subprojectId ?? '')
    setTargetDateValue(item.targetDate ?? '')
    setStartDateValue(item.startDate ?? '')
    setShowFromValue(item.showFrom ?? '')
    setAssigneeValue(item.assigneeId)
    setEstimateValue(item.estimate)
    setLabelsValue(item.labels)
    setCriteriaValue(item.acceptanceCriteria)
    setDependencyIdsValue(item.dependencyIds)
    setDependencyLinksValue(dependencyLinksOf(item))
    setAutoQueueValue(item.autoQueue)
    setPhaseNumberValue(item.subtaskPhaseNumber)
    setPhaseNameValue(item.subtaskPhaseName)
    setFieldValues(item.fieldValues ?? {})
    setAiWorkItemDraft(null)
  }

  /** Opens an archived task, which is not on the Board, in the drawer. */
  const openClosedWorkItem = (item: PlanningWorkItem) => {
    setClosedItem(item)
    openWorkItem(item)
  }

  const closeWorkItem = () => {
    // Closing must never be blocked by an in-flight action (e.g. an AI improve
    // call, which can take a long time): the drawer becoming unclosable read as
    // the whole app freezing. Any async result that lands after close is still
    // applied to state harmlessly by its own handler. Typed text is saved by
    // the drawer before it calls this (`drawer-saves.ts`).
    setSelectedWorkItemId(null)
    setAiWorkItemDraft(null)
  }

  /**
   * `sourceIds` is the drawer's "Re-draft with AI": the work item's library
   * sources are read at their current revisions, and applying the draft
   * re-links them at those revisions.
   */
  const improveWorkItem = async (sourceIds?: string[]) => {
    if (!selectedWorkItem) return
    await runImproving(t('tasks:useWorkItemDrawer.couldntImproveTaskTry'), async () => {
      const result = await window.ostlerAPI.improvePlanningWorkItem(
        selectedWorkItem.projectId,
        selectedWorkItem.id,
        sourceIds
      )
      assertResult(result)
      setRedraftSourceIds(sourceIds && sourceIds.length > 0 ? sourceIds : null)
      setAiWorkItemDraft(result.value)
    })
  }

  const improveSpecificWorkItem = async (item: PlanningWorkItem) => {
    openWorkItem(item)
    await runImproving(t('tasks:useWorkItemDrawer.couldntImproveTaskTry2'), async () => {
      const result = await window.ostlerAPI.improvePlanningWorkItem(item.projectId, item.id)
      assertResult(result)
      setRedraftSourceIds(null)
      setAiWorkItemDraft(result.value)
    })
  }

  /**
   * Applying a draft changes the editor and saves those fields at once. Its
   * Library changes (re-linked sources and ticked attachments) are made at once
   * too, since there is no Save to wait for. `attachmentIds` are the draft's
   * proposed attachments the human left ticked.
   */
  const applyWorkItemImprovement = (attachmentIds: string[] = []) => {
    if (!aiWorkItemDraft || !selectedWorkItem) return
    const draft = aiWorkItemDraft
    setTitleValue(draft.title)
    setDescriptionValue(draft.description)
    setPriorityValue(draft.priority)
    setCriteriaValue(draft.acceptanceCriteria)
    saves.change('title', draft.title, 'now')
    saves.change('description', draft.description, 'now')
    saves.change('priority', draft.priority, 'now')
    saves.change('acceptanceCriteria', draft.acceptanceCriteria, 'now')
    // A re-draft from changed sources was written from their current
    // revisions, so applying it brings the links up to those revisions.
    const read = new Set((draft.sources ?? []).map((source) => source.libraryItemId))
    const sourceIds = (redraftSourceIds ?? []).filter((itemId) => read.has(itemId))
    setRedraftSourceIds(null)
    setAiWorkItemDraft(null)
    void linkDraftLibraryChanges(
      selectedWorkItem.projectId,
      draft.workItemId,
      sourceIds,
      attachmentIds
    )
  }

  const linkDraftLibraryChanges = async (
    itemProjectId: string,
    workItemId: string,
    sourceIds: string[],
    attachmentIds: string[]
  ) => {
    const errors: string[] = []
    for (const itemId of sourceIds) {
      const linked = await window.ostlerAPI.addWorkItemSource(itemProjectId, workItemId, itemId)
      if (!linked.ok) errors.push(linked.error)
    }
    for (const itemId of attachmentIds) {
      const attached = await window.ostlerAPI.attachToWorkItem(
        itemProjectId,
        workItemId,
        itemId,
        'ostler-ai'
      )
      if (!attached.ok) errors.push(attached.error)
    }
    if (errors.length > 0) {
      setError(t('tasks:useWorkItemDrawer.draftLinksNotAdded', { errors: errors.join('; ') }))
    }
  }

  /**
   * Ticks a saved checklist item straight away: a tick is a fact about the
   * work, not an edit to the task. Only the tick changes; the task stays in its
   * column, and the checklist's text is not saved a second time.
   */
  const setChecklistItemChecked = async (criterionText: string, checked: boolean) => {
    if (!selectedWorkItemId) return
    const result = await window.ostlerAPI.setPlanningChecklistItemChecked(
      selectedWorkItemId,
      criterionText,
      checked
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    setWorkItems((current) =>
      current.map((item) => (item.id === result.value.id ? result.value : item))
    )
  }

  /**
   * Description history (N2.6): saves what is typed first, then makes a
   * version's text the description as a change of its own. Resolves to an
   * undo that puts back the text it replaced, through the normal update.
   */
  const restoreDescriptionVersion = async (
    versionId: number
  ): Promise<{ ok: true; undo: () => Promise<boolean> } | { ok: false; error: string }> => {
    const workItemId = selectedWorkItemId
    if (!workItemId) return { ok: false, error: '' }
    // What the editor shows is what the settle below saves: the text replaced.
    const replaced = descriptionValue
    saves.settle()
    await saves.idle()
    const replace = (updated: PlanningWorkItem) =>
      setWorkItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    const result = await window.ostlerAPI.restorePlanningDescriptionVersion(workItemId, versionId)
    if (!result.ok) return { ok: false, error: result.error }
    replace(result.value)
    return {
      ok: true,
      undo: async () => {
        const back = await window.ostlerAPI.updatePlanningWorkItem(workItemId, {
          description: replaced
        })
        if (!back.ok) {
          setError(back.error)
          return false
        }
        replace(back.value)
        return true
      }
    }
  }

  /** Sets a saved checklist item's due date or person (N2.2) straight away, like a tick. */
  const setChecklistItemDetails = async (
    criterionText: string,
    input: PlanningChecklistDetailInput
  ) => {
    if (!selectedWorkItemId) return
    const result = await window.ostlerAPI.setPlanningChecklistItemDetails(
      selectedWorkItemId,
      criterionText,
      input
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    setWorkItems((current) =>
      current.map((item) => (item.id === result.value.id ? result.value : item))
    )
  }

  // Each setter shows the value and saves it. Typing (`pause`) waits for the
  // pause; a picker, toggle or finished list edit (`now`) saves at once.
  const setEditTitle = (value: string) => {
    setTitleValue(value)
    saves.change('title', value, 'pause')
  }
  const setEditDescription = (value: string) => {
    setDescriptionValue(value)
    saves.change('description', value, 'pause')
  }
  /** A column (MOP-26) by key: a status's own, or `custom:<id>`. */
  const setEditColumn = (key: string) => {
    setStatusValue(key)
    saves.change('status', key, 'now')
  }
  /** A status's own column. */
  const setEditStatus = (value: PlanningWorkItemStatus) => setEditColumn(value)
  const editStatus: PlanningWorkItemStatus =
    placeOfKey(statusValue, columnSettings)?.status ??
    (selectedWorkItem ? selectors.projectedStatus(selectedWorkItem) : 'backlog')
  const setEditPriority = (value: PlanningPriority) => {
    setPriorityValue(value)
    saves.change('priority', value, 'now')
  }
  const setEditMilestoneId = (value: string) => {
    setMilestoneValue(value)
    saves.change('milestoneId', value, 'now')
  }
  const setEditIterationId = (value: string) => {
    setIterationValue(value)
    saves.change('iterationId', value, 'now')
  }
  const setEditTypeId = (value: string) => {
    setTypeValue(value)
    saves.change('typeId', value, 'now')
  }
  const setEditSubprojectId = (value: string) => {
    setSubprojectValue(value)
    saves.change('subprojectId', value, 'now')
  }
  const setEditTargetDate = (value: string) => {
    setTargetDateValue(value)
    saves.change('targetDate', value, 'pause')
  }
  const setEditStartDate = (value: string) => {
    setStartDateValue(value)
    saves.change('startDate', value, 'pause')
  }
  const setEditShowFrom = (value: string) => {
    setShowFromValue(value)
    saves.change('showFrom', value, 'pause')
  }
  const setEditAssigneeId = (value: string | null) => {
    setAssigneeValue(value)
    saves.change('assigneeId', value, 'now')
  }
  const setEditEstimate = (value: number | null) => {
    setEstimateValue(value)
    saves.change('estimate', value, 'pause')
  }
  const setEditLabels = (value: string[]) => {
    setLabelsValue(value)
    saves.change('labels', value, 'now')
  }
  /** The checklist. `typed` is true for an edit to a row's text; adding, moving or deleting a row is `now`. */
  const setEditCriteria = (value: string[], typed = false) => {
    setCriteriaValue(value)
    saves.change('acceptanceCriteria', value, typed ? 'pause' : 'now')
  }
  const setEditDependencyIds = (value: string[]) => {
    setDependencyIdsValue(value)
    // A kept link keeps its type and lag; a new one is finish to start, 0 days.
    setDependencyLinksValue((links) =>
      dependencyLinksOf({ dependencyIds: value, dependencyLinks: links })
    )
    saves.change('dependencyIds', value, 'now')
  }
  /** One waits-on link's type or lag (N7.2a). `typed` is true for the lag as it is typed. */
  const setEditDependencyLink = (
    id: string,
    change: Partial<Pick<PlanningDependencyLink, 'type' | 'lagDays'>>,
    typed = false
  ) => {
    const links = dependencyLinksOf({
      dependencyIds: dependencyIdsValue,
      dependencyLinks: dependencyLinksValue
    }).map((link) => (link.id === id ? { ...link, ...change } : link))
    setDependencyLinksValue(links)
    saves.change('dependencyLinks', links, typed ? 'pause' : 'now')
  }
  const setEditAutoQueue = (value: boolean) => {
    setAutoQueueValue(value)
    saves.change('autoQueue', value, 'now')
  }
  /** A subtask's phase, picked from the phases of its parent: the number and name save together. */
  const setEditSubtaskPhase = (number: number | null, name: string) => {
    setPhaseNumberValue(number)
    setPhaseNameValue(name)
    saves.change('subtaskPhase', { subtaskPhaseNumber: number, subtaskPhaseName: name }, 'now')
  }
  const setEditSubtaskPhaseName = (name: string) => {
    setPhaseNameValue(name)
    saves.change(
      'subtaskPhase',
      { subtaskPhaseNumber: phaseNumberValue, subtaskPhaseName: name },
      'pause'
    )
  }

  /**
   * A custom field's value (R2.2). `typed` is true for text and numbers,
   * which save after the pause like the title; pickers save at once.
   */
  const setEditFieldValue = (fieldId: string, value: unknown, typed = false) => {
    setFieldValues((current) => withFieldValue(current, fieldId, value))
    saves.change(customDrawerField(fieldId), value, typed ? 'pause' : 'now')
  }

  return {
    selectedWorkItemId,
    selectedWorkItem,
    openWorkItem,
    openClosedWorkItem,
    /** The archived task last opened from the Archive, as last saved; null when none was. */
    closedWorkItem: closedItem,
    closeWorkItem,
    editTitle: titleValue,
    setEditTitle,
    editDescription: descriptionValue,
    setEditDescription,
    restoreDescriptionVersion,
    editStatus,
    setEditStatus,
    /** The column key the drawer's status shows. */
    editColumn: statusValue,
    setEditColumn,
    editPriority: priorityValue,
    setEditPriority,
    editMilestoneId: milestoneValue,
    setEditMilestoneId,
    editIterationId: iterationValue,
    setEditIterationId,
    editTypeId: typeValue,
    setEditTypeId,
    editSubprojectId: subprojectValue,
    setEditSubprojectId,
    editTargetDate: targetDateValue,
    setEditTargetDate,
    editStartDate: startDateValue,
    setEditStartDate,
    editShowFrom: showFromValue,
    setEditShowFrom,
    editAssigneeId: assigneeValue,
    setEditAssigneeId,
    editEstimate: estimateValue,
    setEditEstimate,
    setChecklistItemChecked,
    setChecklistItemDetails,
    editLabels: labelsValue,
    setEditLabels,
    editCriteria: criteriaValue,
    setEditCriteria,
    editDependencyIds: dependencyIdsValue,
    setEditDependencyIds,
    editDependencyLinks: dependencyLinksOf({
      dependencyIds: dependencyIdsValue,
      dependencyLinks: dependencyLinksValue
    }),
    setEditDependencyLink,
    editAutoQueue: autoQueueValue,
    setEditAutoQueue,
    editSubtaskPhaseNumber: phaseNumberValue,
    editSubtaskPhaseName: phaseNameValue,
    setEditSubtaskPhase,
    setEditSubtaskPhaseName,
    editFieldValues: fieldValues,
    setEditFieldValue,
    aiWorkItemDraft,
    setAiWorkItemDraft,
    aiImproveBusy,
    improveWorkItem,
    improveSpecificWorkItem,
    applyWorkItemImprovement,
    /** Saves what is typed in the drawer now, rather than after the pause. */
    flushEdits: saves.settle,
    /** The field is being typed in: a change from elsewhere waits until it is left. */
    beginEdit: saves.beginEdit,
    /** The field was left: what was typed there saves now. */
    endEdit: saves.endEdit,
    /** Resolves once every save requested so far has finished. */
    waitForSaves: saves.idle,
    /** The drawer's undo: the last saved change. Returns whether there was one. */
    undoLastSave: saves.undoLast,
    saveStatus: saves.status,
    saveFailures: saves.failures,
    /** The failed saves right now (read when closing, so not from the last render). */
    failedSaves: saves.failedNow,
    retrySaves: saves.retryFailed,
    discardSaves: saves.discardFailed
  }
}

export type WorkItemDrawer = ReturnType<typeof useWorkItemDrawer>

/** What puts back the change that took a queued task out of the queue. */
function queueUndoOf(
  before: PlanningWorkItem,
  after: PlanningWorkItem
): UpdatePlanningWorkItemInput {
  const undo: UpdatePlanningWorkItemInput = {}
  // Queued work is Ready work.
  if (after.status !== before.status) undo.status = 'ready'
  if (Boolean(after.someday) !== Boolean(before.someday)) undo.someday = Boolean(before.someday)
  if ((after.showFrom ?? null) !== (before.showFrom ?? null))
    undo.showFrom = before.showFrom ?? null
  return undo
}

/** `values` with one field set, or without it when `value` is empty. */
function withFieldValue(
  values: PlanningFieldValues,
  fieldId: string,
  value: unknown
): PlanningFieldValues {
  const next = { ...values }
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
    delete next[fieldId]
  else next[fieldId] = value as PlanningFieldValue
  return next
}
