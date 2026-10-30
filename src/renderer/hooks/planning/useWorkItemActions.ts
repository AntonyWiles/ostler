import { useRepeatNotice } from './useRepeatNotice'
import { useRequeueUndo, type LeftQueue } from './useRequeueUndo'
import React from 'react'
import { assertResult } from '../../utils/unwrap-result'
import type {
  CreatePlanningWorkItemInput,
  PlanningWorkItemBatchRow,
  Result,
  PlanningPriority,
  PlanningWorkItem,
  PlanningWorkItemPlacement,
  PlanningWorkItemStatus,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningSelectors } from './usePlanningSelectors'
import type { WorkItemDrawer } from './useWorkItemDrawer'
import type { PlanningCreateForm } from './usePlanningCreateForm'
import type { PlanningAiDrafts } from './usePlanningAiDrafts'
import { useToast } from '../../ui'
import { droppedText } from '../../task-templates/useTaskTemplates'
import { formatIsoDate } from '@shared/dates'
import { formatList } from '@shared/format'
import { previousTaskDateChange, type TaskDateChange } from '@shared/planning/timeline'
import { predictOrderKey } from '@shared/planning/board'
import { t } from '@shared/i18n'
import { BRAND } from '@shared/brand'
import { extractPictureLinks } from '@shared/item-links'
import { canCloseAsWontDo } from '@shared/planning/wont-do'
import { useAddToMyDay } from '../useMyDay'
import { undoChanges, type RescheduleChange } from '@shared/planning/reschedule'
import {
  taskDateMove,
  useMoveDependents
} from '../../components/move-dependents/MoveDependentsProvider'

type BulkUpdate = {
  milestoneId?: string | null
  subprojectId?: string | null
  priority?: PlanningPriority
  labels?: string[]
  assigneeId?: string | null
  targetDate?: string | null
}

/** A bulk update that only sets the due date. */
const isDateOnly = (updates: BulkUpdate & { status?: PlanningWorkItemStatus }) =>
  Object.keys(updates).length === 1 && updates.targetDate !== undefined

const splitList = (text: string, separator: string) =>
  text
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean)

/** A list the person typed row by row: trimmed, blank rows dropped. */
const trimmedList = (entries: string[]) => entries.map((entry) => entry.trim()).filter(Boolean)

/** The fields a subtask takes when it is created with the others. */
export type SubtaskFields = Pick<
  CreatePlanningWorkItemInput,
  'assigneeId' | 'startDate' | 'targetDate' | 'estimate' | 'dependencyIds'
>

/**
 * Changing planning records: creating any of them from the create form, and
 * moving, bulk-editing, deleting, archiving and re-assigning work items.
 * Depends on the runner, records, selectors, drawer, create form and AI
 * drafts (a goal or milestone created from a brief recommendation is recorded
 * against it).
 */
export function useWorkItemActions(
  projectId: string,
  runner: PlanningRunner,
  records: PlanningRecords,
  selectors: PlanningSelectors,
  drawer: WorkItemDrawer,
  createForm: PlanningCreateForm,
  aiDrafts: PlanningAiDrafts,
  /** The sub-project the view is scoped to: what a new task or milestone is put in (D7). */
  subprojectId: string | null = null
) {
  const { setError } = runner
  const { toast, toastUndo } = useToast()
  const { runBusy } = runner.internal
  const { workItems, loadPlanning } = records
  const { setWorkItems, setHarnessState } = records.internal
  const { projectedStatus, harnessTaskFor, deletionBlocker } = selectors
  const noticeRepeat = useRepeatNotice(loadPlanning)
  const { offer: offerMoveDependents } = useMoveDependents()
  const reload = () => void loadPlanning()
  // Add to My day (N1.4): a hidden task comes back, so the lists read again.
  const addToMyDay = useAddToMyDay(reload)
  const requeueUndo = useRequeueUndo(projectId, loadPlanning, setError)
  const refreshHarness = async () => {
    const harnessResult = await window.ostlerAPI.getHarnessState(projectId)
    if (harnessResult.ok) setHarnessState(harnessResult.value)
  }

  const replaceItem = (updated: PlanningWorkItem) =>
    setWorkItems((current) =>
      current.map((candidate) => (candidate.id === updated.id ? updated : candidate))
    )
  const patchItem = (itemId: string, patch: Partial<PlanningWorkItem>) =>
    setWorkItems((current) =>
      current.map((candidate) => (candidate.id === itemId ? { ...candidate, ...patch } : candidate))
    )

  const recordBriefCreation = async (type: 'goal' | 'milestone', createdId: string) => {
    const { briefCreationDraft } = createForm.internal
    if (briefCreationDraft?.type !== type) return
    const briefResult = await window.ostlerAPI.recordAIProjectBriefActionCreation(
      projectId,
      briefCreationDraft.actionId,
      type,
      createdId
    )
    assertResult(briefResult)
    aiDrafts.internal.setProjectBrief(briefResult.value)
  }

  /**
   * The pictures pasted into a new task's description (kept in the Library)
   * become its attachments once it exists, as a paste into the drawer does.
   */
  const attachDescriptionPictures = async (item: PlanningWorkItem) => {
    const inText = extractPictureLinks(item.description, BRAND.urlScheme)
      .filter((picture) => picture.projectId === item.projectId)
      .map((picture) => picture.id)
    const ids = new Set([...inText, ...createForm.itemPictures.map((picture) => picture.id)])
    for (const id of ids) {
      const result = await window.ostlerAPI.attachToWorkItem(item.projectId, item.id, id, 'human')
      if (!result.ok)
        toast({ title: t('tasks:attachFiles.couldNotAttach'), body: result.error, tone: 'danger' })
    }
  }

  const createPlanningRecord = async (event: React.FormEvent) => {
    event.preventDefault()
    const { createMode } = createForm
    if (!projectId || !createMode) return
    await runBusy(t('tasks:useWorkItemActions.couldntCreateTryAgain'), async () => {
      if (createMode === 'goal') {
        const result = await window.ostlerAPI.createPlanningGoal(projectId, {
          title: createForm.goalTitle,
          outcome: createForm.goalOutcome
        })
        assertResult(result)
        await recordBriefCreation('goal', result.value.id)
      } else if (createMode === 'milestone') {
        const result = await window.ostlerAPI.createPlanningMilestone(projectId, {
          name: createForm.milestoneName,
          outcome: createForm.milestoneOutcome,
          goalId: createForm.milestoneGoalId || null,
          targetDate: createForm.milestoneTargetDate || null,
          successCriteria: trimmedList(createForm.milestoneCriteria),
          ...(subprojectId ? { subprojectId } : {})
        })
        assertResult(result)
        await recordBriefCreation('milestone', result.value.id)
      } else if (createMode === 'decision') {
        const result = await window.ostlerAPI.createPlanningDecision(projectId, {
          title: createForm.decisionTitle,
          context: createForm.decisionContext,
          decision: createForm.decisionBody,
          alternativesConsidered: createForm.decisionAlternatives,
          consequences: createForm.decisionConsequences,
          date: createForm.decisionDate || undefined,
          linkedWorkItemIds: createForm.decisionLinkedWorkItemIds
        })
        assertResult(result)
      } else {
        const input = {
          title: createForm.itemTitle,
          description: createForm.itemDescription,
          status: createForm.itemStatus,
          columnId: createForm.itemColumnId,
          milestoneId: createForm.itemMilestoneId || null,
          iterationId: createForm.itemIterationId || null,
          typeId: createForm.itemTypeId || null,
          priority: createForm.itemPriority,
          labels: splitList(createForm.itemLabels, ','),
          acceptanceCriteria: splitList(createForm.itemCriteria, '\n'),
          autoQueue: createForm.itemAutoQueue,
          assigneeId: createForm.itemAssigneeId,
          startDate: createForm.itemStartDate || null,
          targetDate: createForm.itemTargetDate || null,
          estimate: createForm.itemEstimate,
          dependencyIds: createForm.itemDependencyIds,
          fieldValues: createForm.itemFieldValues,
          ...(subprojectId ? { subprojectId } : {})
        }
        if (createForm.itemTemplateId) {
          // From a task template (N2.1): the form wins, and its subtasks come too.
          const result = await window.ostlerAPI.useTaskTemplate(
            projectId,
            createForm.itemTemplateId,
            input
          )
          assertResult(result)
          const dropped = droppedText(result.value.dropped)
          if (dropped)
            toast({ title: t('tasks:taskTemplates.someLeftOut'), body: dropped, tone: 'warning' })
          await attachDescriptionPictures(result.value.workItem)
        } else {
          const result = await window.ostlerAPI.createPlanningWorkItem(projectId, input)
          assertResult(result)
          await attachDescriptionPictures(result.value)
        }
      }
      createForm.closeCreate()
      await loadPlanning()
    })
  }

  /**
   * Moving a card that already has a queue entry. The board must never claim a
   * state the harness contradicts: Blocked holds the queue entry and Ready
   * releases it; any other move takes a task nobody has started out of the
   * queue (one rule in the main process), with an Undo that moves it back and
   * queues it again. Anything with an agent actually running says what to do
   * first instead of quietly lying about it.
   *
   * Returns true when it handled the move.
   */
  const moveLinkedWorkItem = async (
    item: PlanningWorkItem,
    status: PlanningWorkItemStatus,
    columnId: string | null = null
  ): Promise<boolean> => {
    const task = harnessTaskFor(item)
    if (!item.linkedHarnessTaskId || !projectId) return false
    if (!task) return true
    const current = projectedStatus(item)
    if (current === status && (item.columnId ?? null) === columnId) return true

    if (task.status === 'claimed') {
      setError(
        status === 'blocked'
          ? t('tasks:useWorkItemActions.agentWorkingStopAgent', { itemTitle: item.title })
          : t('tasks:useWorkItemActions.agentWorkingStopFinish', { itemTitle: item.title })
      )
      return true
    }
    if (task.status === 'complete') {
      setError(
        current === 'review'
          ? t('tasks:useWorkItemActions.finishedWaitingAcceptDiscard', { itemTitle: item.title })
          : t('tasks:useWorkItemActions.alreadyDoneMoveBack', { itemTitle: item.title })
      )
      return true
    }

    // Pending: hold and release are exactly Blocked and back to Ready.
    if (status === 'blocked' || (current === 'blocked' && status === 'ready')) {
      await runBusy(
        status === 'blocked'
          ? t('tasks:useWorkItemActions.couldntHoldQueuedTask')
          : t('tasks:useWorkItemActions.couldntReleaseTaskTry'),
        async () => {
          const result = await window.ostlerAPI.setHarnessTaskHold(
            projectId,
            task.id,
            status === 'blocked'
          )
          assertResult(result)
          await refreshHarness()
        },
        { subject: item.id }
      )
      return true
    }

    // Any other column: out of the queue, in the same step as the move.
    await runBusy(
      t('tasks:useWorkItemActions.couldntMoveTaskTry'),
      async () => {
        const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { status, columnId })
        assertResult(result)
        replaceItem(result.value)
        noticeRepeat(result.value)
        await refreshHarness()
        if (result.value.leftQueue) requeueUndo.offer([{ item, undo: { status: 'ready' } }])
      },
      { subject: item.id }
    )
    return true
  }

  /** To a status's own column, or with `columnId` to a column of the project's own (MOP-26). */
  const moveWorkItem = async (
    item: PlanningWorkItem,
    status: PlanningWorkItemStatus,
    columnId: string | null = null
  ) => {
    if (item.linkedHarnessTaskId) {
      await moveLinkedWorkItem(item, status, columnId)
      return
    }
    if (item.status === status && (item.columnId ?? null) === columnId) return
    const previous = { status: item.status, columnId: item.columnId ?? null }
    await runBusy(
      t('tasks:useWorkItemActions.couldntMoveTaskTry'),
      async () => {
        patchItem(item.id, { status, columnId })
        const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { status, columnId })
        assertResult(result)
        replaceItem(result.value)
        noticeRepeat(result.value)
      },
      { subject: item.id, onFailure: () => patchItem(item.id, previous) }
    )
  }

  /**
   * Moves a task in the manual order (D31), and to `placement.status` when
   * given: a drop between two cards or rows, or Alt and an arrow key. Shown
   * at once, rolled back if the main process refuses it.
   */
  const placeWorkItem = async (item: PlanningWorkItem, placement: PlanningWorkItemPlacement) => {
    const previous = {
      status: item.status,
      columnId: item.columnId ?? null,
      orderKey: item.orderKey
    }
    const orderKey = predictOrderKey(workItems, item.id, placement)
    const patch: Partial<PlanningWorkItem> = {}
    if (orderKey !== undefined) patch.orderKey = orderKey
    if (placement.status !== undefined) {
      patch.status = placement.status
      patch.columnId = placement.columnId ?? null
    }
    await runBusy(
      t('tasks:useWorkItemActions.couldntMoveTaskTry'),
      async () => {
        patchItem(item.id, patch)
        const result = await window.ostlerAPI.movePlanningWorkItem(item.id, placement)
        assertResult(result)
        replaceItem(result.value)
        noticeRepeat(result.value)
      },
      { subject: item.id, onFailure: () => patchItem(item.id, previous) }
    )
  }

  /** Moves an item to another milestone and column together, rolling both back on failure. */
  const moveWorkItemToMilestone = async (
    item: PlanningWorkItem,
    targetMilestoneId: string | null,
    targetStatus: PlanningWorkItemStatus,
    beforeSave: () => void,
    targetColumnId: string | null = null
  ) => {
    const previous = {
      milestoneId: item.milestoneId,
      status: item.status,
      columnId: item.columnId ?? null
    }
    await runBusy(
      t('tasks:useWorkItemActions.couldntMoveTaskTry'),
      async () => {
        patchItem(item.id, {
          milestoneId: targetMilestoneId,
          status: targetStatus,
          columnId: targetColumnId
        })
        beforeSave()
        const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, {
          milestoneId: targetMilestoneId,
          status: targetStatus,
          columnId: targetColumnId
        })
        assertResult(result)
        replaceItem(result.value)
        noticeRepeat(result.value)
      },
      { subject: item.id, onFailure: () => patchItem(item.id, previous) }
    )
  }

  const bulkUpdateWorkItems = async (
    itemIds: string[],
    updates:
      | (BulkUpdate & { status?: PlanningWorkItemStatus; columnId?: string | null })
      | ((item: PlanningWorkItem) => BulkUpdate)
  ) => {
    if (itemIds.length === 0) return
    if (typeof updates !== 'function' && isDateOnly(updates)) {
      await bulkSetDueDate(itemIds, updates.targetDate ?? null)
      return
    }
    await runBusy(t('tasks:useWorkItemActions.couldntUpdateSelectedTasks'), async () => {
      const succeeded: string[] = []
      const failed: string[] = []
      const left: LeftQueue[] = []
      for (const itemId of itemIds) {
        const item = workItems.find((candidate) => candidate.id === itemId)
        if (!item) {
          failed.push(itemId)
          continue
        }
        const result = await window.ostlerAPI.updatePlanningWorkItem(
          itemId,
          typeof updates === 'function' ? updates(item) : updates
        )
        if (result.ok) {
          succeeded.push(item.title)
          replaceItem(result.value)
          noticeRepeat(result.value)
          // Queued work is Ready work: Undo puts it back there and queues it.
          if (result.value.leftQueue) left.push({ item, undo: { status: 'ready' } })
        } else {
          failed.push(`${item.title}: ${result.error}`)
        }
      }
      if (left.length > 0) {
        await refreshHarness()
        requeueUndo.offer(left)
      }
      if (failed.length > 0) {
        setError(
          t('tasks:useWorkItemActions.bulkUpdateSucceededFailed', {
            succeededCount: succeeded.length,
            failedCount: failed.length,
            join: failed.join('; ')
          })
        )
      }
    })
  }

  /**
   * Bulk edit's due date (N7.1): every selected task in one call and one
   * transaction (the same apply as Reschedule), with one undo for all, then
   * the offer to move what waits on them. A start date stays where it is.
   */
  /**
   * Sets or clears the type of every selected task (N2.7a), through the same
   * update as the drawer, and offers undo, which puts each task's own type back.
   */
  const bulkSetType = async (itemIds: string[], typeId: string | null) => {
    const before = new Map<string, string | null>()
    for (const itemId of itemIds) {
      const item = workItems.find((candidate) => candidate.id === itemId)
      if (item && (item.typeId ?? null) !== typeId) before.set(item.id, item.typeId ?? null)
    }
    if (before.size === 0) return
    await runBusy(t('tasks:useWorkItemActions.couldntUpdateSelectedTasks'), async () => {
      const changed: string[] = []
      for (const itemId of before.keys()) {
        const result = await window.ostlerAPI.updatePlanningWorkItem(itemId, { typeId })
        if (result.ok) {
          changed.push(itemId)
          replaceItem(result.value)
        } else setError(result.error)
      }
      if (changed.length === 0) return
      toastUndo(
        typeId
          ? t('tasks:taskTypes.setOn', { count: changed.length })
          : t('tasks:taskTypes.clearedOn', { count: changed.length }),
        async () => {
          for (const itemId of changed) {
            const undone = await window.ostlerAPI.updatePlanningWorkItem(itemId, {
              typeId: before.get(itemId) ?? null
            })
            if (!undone.ok) setError(undone.error)
          }
          await loadPlanning()
        }
      )
    })
  }

  const bulkSetDueDate = async (itemIds: string[], targetDate: string | null) => {
    const changes: RescheduleChange[] = []
    for (const itemId of itemIds) {
      const item = workItems.find((candidate) => candidate.id === itemId)
      if (!item || (item.targetDate ?? null) === targetDate) continue
      changes.push({
        id: item.id,
        fromDue: item.targetDate ?? null,
        toDue: targetDate,
        fromStart: item.startDate ?? null,
        toStart: item.startDate ?? null
      })
    }
    if (changes.length === 0) return
    await runBusy(t('tasks:useWorkItemActions.couldntUpdateSelectedTasks'), async () => {
      const result = await window.ostlerAPI.applyReschedule(changes)
      assertResult(result)
      await loadPlanning()
      const { changed, skipped } = result.value
      if (changed.length === 0) return
      toastUndo(
        t('tasks:useWorkItemActions.bulkDatesChanged', { count: changed.length }),
        async () => {
          const undone = await window.ostlerAPI.applyReschedule(undoChanges(changed))
          if (!undone.ok) setError(undone.error)
          await loadPlanning()
        },
        skipped.length > 0
          ? t('tasks:moveDependents.changedMeanwhile', { count: skipped.length })
          : undefined
      )
      void offerMoveDependents(changed, reload)
    })
  }

  /**
   * One field changed in place (the List's cells): shown at once, saved with
   * one call through the same service as the drawer, so every rule (start
   * after due, unknown assignee, dependencies) still applies. A refused save
   * puts the old values back and says why in a toast. A queued task's status
   * moves through the queue, as on the Board. Returns whether it saved.
   */
  const updateWorkItemInline = async (
    item: PlanningWorkItem,
    patch: UpdatePlanningWorkItemInput,
    /** Called with what was saved, rules' work included (R6.2). */
    onSaved?: (saved: PlanningWorkItem) => void
  ): Promise<boolean> => {
    if (patch.status !== undefined && item.linkedHarnessTaskId) {
      await moveLinkedWorkItem(item, patch.status)
      return true
    }
    const previous = Object.fromEntries(
      Object.keys(patch).map((key) => [key, item[key as keyof PlanningWorkItem]])
    ) as Partial<PlanningWorkItem>
    patchItem(item.id, patch as Partial<PlanningWorkItem>)
    const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, patch)
    if (result.ok) {
      replaceItem(result.value)
      noticeRepeat(result.value)
      onSaved?.(result.value)
      return true
    }
    patchItem(item.id, previous)
    toast({
      title: t('tasks:useWorkItemActions.couldntChange', { itemTitle: item.title }),
      body: result.error,
      tone: 'danger'
    })
    return false
  }

  /**
   * One checklist item ticked or unticked from outside the drawer (a Board
   * card's checklist pop-up): shown at once, put back if it is refused.
   */
  const setWorkItemChecklistItemChecked = async (
    item: PlanningWorkItem,
    criterionText: string,
    checked: boolean
  ): Promise<boolean> => {
    const before = item.checkedCriteria
    patchItem(item.id, {
      checkedCriteria: checked
        ? [...before.filter((text) => text !== criterionText), criterionText]
        : before.filter((text) => text !== criterionText)
    })
    const result = await window.ostlerAPI.setPlanningChecklistItemChecked(
      item.id,
      criterionText,
      checked
    )
    if (result.ok) {
      replaceItem(result.value)
      return true
    }
    patchItem(item.id, { checkedCriteria: before })
    toast({
      title: t('tasks:useWorkItemActions.couldntChange', { itemTitle: item.title }),
      body: result.error,
      tone: 'danger'
    })
    return false
  }

  /**
   * A task's dates moved (the Calendar's and the Timeline's drags and Alt+arrow
   * keys): the same single update as an edit in place, so validation, activity
   * and the automation API's rules all apply, then an undo toast that puts the
   * old dates back. Returns whether it saved.
   */
  const rescheduleWorkItem = async (
    item: PlanningWorkItem,
    patch: TaskDateChange
  ): Promise<boolean> => {
    const previous = previousTaskDateChange(item, patch)
    let ruleRun: string | undefined
    const saved = await updateWorkItemInline(item, patch, (result) => {
      ruleRun = result.ruleRun?.id
    })
    if (!saved) return false
    void offerMoveDependents([taskDateMove(item, patch)], reload)
    const day = (date: string) =>
      formatIsoDate(date, { weekday: 'short', day: 'numeric', month: 'short' })
    const message = patch.targetDate
      ? t('tasks:useWorkItemActions.nowDue', { itemTitle: item.title, day: day(patch.targetDate) })
      : patch.startDate
        ? t('tasks:useWorkItemActions.nowStarts', {
            itemTitle: item.title,
            day: day(patch.startDate)
          })
        : t('tasks:useWorkItemActions.hasNewDates', { itemTitle: item.title })
    // The undo puts back what rules did because of the move, too (R6.2).
    toastUndo(message, () =>
      updateWorkItemInline(
        { ...item, ...patch },
        ruleRun ? { ...previous, undoRuleRun: ruleRun } : previous
      )
    )
    return true
  }

  /**
   * The List's quick-add row: a task with just a title and the group's
   * values. Returns the new task, or null when it was refused.
   */
  const quickAddWorkItem = async (
    input: CreatePlanningWorkItemInput
  ): Promise<PlanningWorkItem | null> => {
    if (!projectId) return null
    const result = await window.ostlerAPI.createPlanningWorkItem(
      projectId,
      subprojectId && input.subprojectId === undefined ? { ...input, subprojectId } : input
    )
    if (!result.ok) {
      toast({
        title: t('tasks:useWorkItemActions.couldntAddTask'),
        body: result.error,
        tone: 'danger'
      })
      return null
    }
    setWorkItems((current) => [result.value, ...current])
    return result.value
  }

  /**
   * Creates a new child work item under `parent`, in the given (1-based)
   * subtask phase. Enabling subtasks on a plain task is nothing more than
   * calling this once — there is no separate "enable" flag to flip first.
   */
  const createSubtask = async (
    parent: PlanningWorkItem,
    title: string,
    subtaskPhaseNumber: number,
    subtaskPhaseName: string,
    fields: SubtaskFields = {}
  ): Promise<PlanningWorkItem | null> =>
    (await runBusy(t('tasks:useWorkItemActions.couldntAddSubtaskTry'), async () => {
      const result = await window.ostlerAPI.createPlanningWorkItem(parent.projectId, {
        title,
        parentWorkItemId: parent.id,
        subtaskPhaseNumber,
        subtaskPhaseName,
        ...fields
      })
      assertResult(result)
      setWorkItems((current) => [result.value, ...current])
      return result.value
    })) ?? null

  const removeFromBoard = (item: PlanningWorkItem) => {
    setWorkItems((current) => current.filter((candidate) => candidate.id !== item.id))
    if (drawer.selectedWorkItemId === item.id) drawer.closeWorkItem()
  }

  /** The plan grid's rows, checked without writing: every refused row, or none. */
  const checkPlanWorkItems = (rows: PlanningWorkItemBatchRow[]) =>
    window.ostlerAPI.checkPlanningWorkItemBatch(projectId, rows)

  /**
   * Creates a whole plan in one call (the plan grid's Create). Returns the
   * created tasks, or the refusal, which creates nothing. The caller owns the
   * dialog's busy and error state.
   */
  const createPlanWorkItems = async (
    rows: PlanningWorkItemBatchRow[]
  ): Promise<Result<PlanningWorkItem[]>> => {
    const result = await window.ostlerAPI.createPlanningWorkItemBatch(projectId, rows)
    if (result.ok) {
      setWorkItems((current) => [...result.value, ...current])
      await loadPlanning()
    }
    return result
  }

  /** Undo for a plan: every task it created goes to the recycle bin in one step. */
  const undoPlanWorkItems = async (items: PlanningWorkItem[]) => {
    for (const item of items) {
      const result = await window.ostlerAPI.deletePlanningWorkItem(item.id)
      if (result.ok) removeFromBoard(item)
    }
    await loadPlanning()
  }

  /** Undo for delete and archive: restores the item and puts it back on the Board. */
  const putBack = (
    failure: string,
    restore: () => ReturnType<typeof window.ostlerAPI.restorePlanningWorkItem>
  ) =>
    runBusy(failure, async () => {
      const result = await restore()
      assertResult(result)
      const restored = result.value
      setWorkItems((current) => [
        ...current.filter((candidate) => candidate.id !== restored.id),
        restored
      ])
    })

  const deleteWorkItem = async (item: PlanningWorkItem) => {
    const blocker = deletionBlocker(item)
    if (blocker) {
      setError(blocker)
      return
    }
    // No confirmation: deleting only moves the item to the recycle bin, where it
    // can be restored for 30 days, and the toast offers to undo it at once.
    await runBusy(t('tasks:useWorkItemActions.couldntDeleteTaskTry'), async () => {
      const result = await window.ostlerAPI.deletePlanningWorkItem(item.id)
      assertResult(result)
      removeFromBoard(item)
      toastUndo(t('tasks:useWorkItemActions.movedRecycleBin', { itemTitle: item.title }), () =>
        putBack(t('tasks:useWorkItemActions.couldntRestoreTaskTry'), () =>
          window.ostlerAPI.restorePlanningWorkItem(item.id)
        )
      )
    })
  }

  /**
   * The bulk bar's "Move to recycle bin": every selected task the single
   * delete would allow, with one undo for all of them. Tasks the rule keeps
   * (agent work in flight) are left where they are and named.
   */
  const deleteWorkItems = async (items: PlanningWorkItem[]) => {
    const allowed = items.filter((item) => deletionBlocker(item) === null)
    const kept = items.filter((item) => deletionBlocker(item) !== null)
    if (allowed.length === 0) {
      if (kept.length > 0) setError(deletionBlocker(kept[0]))
      return
    }
    await runBusy(t('tasks:useWorkItemActions.couldntDeleteSelectedTasks'), async () => {
      const deleted: PlanningWorkItem[] = []
      const failed: string[] = []
      for (const item of allowed) {
        const result = await window.ostlerAPI.deletePlanningWorkItem(item.id)
        if (result.ok) {
          deleted.push(item)
          removeFromBoard(item)
        } else failed.push(`${item.title}: ${result.error}`)
      }
      const notes = [
        ...(kept.length > 0
          ? [
              t('tasks:useWorkItemActions.notDeletedAgentWork', {
                tasks: formatList(kept.map((item) => item.title))
              })
            ]
          : []),
        ...failed
      ]
      if (notes.length > 0) setError(notes.join('; '))
      if (deleted.length === 0) return
      toastUndo(
        deleted.length === 1
          ? t('tasks:useWorkItemActions.movedRecycleBin2', { title: deleted[0].title })
          : t('tasks:useWorkItemActions.movedTasksRecycleBin', { deletedCount: deleted.length }),
        async () => {
          for (const item of deleted) {
            await putBack(t('tasks:useWorkItemActions.couldntRestoreTaskTry'), () =>
              window.ostlerAPI.restorePlanningWorkItem(item.id)
            )
          }
        }
      )
    })
  }

  /** Same gate as delete: finished work only. The item leaves the Board for the archive. */
  const archiveWorkItem = async (item: PlanningWorkItem) => {
    const blocker = deletionBlocker(item)
    if (blocker) {
      setError(blocker.replace('deleted', 'archived'))
      return
    }
    await runBusy(t('tasks:useWorkItemActions.couldntArchiveTaskTry'), async () => {
      const result = await window.ostlerAPI.archivePlanningWorkItem(item.id)
      assertResult(result)
      removeFromBoard(item)
      toastUndo(t('tasks:useWorkItemActions.archived', { itemTitle: item.title }), () =>
        putBack(t('tasks:useWorkItemActions.couldntUnarchiveTaskTry'), () =>
          window.ostlerAPI.unarchivePlanningWorkItem(item.id)
        )
      )
    })
  }

  /** The task Block time… is open for (N3.4a), or null while it is closed. */
  const [blockTimeTarget, setBlockTimeTarget] = React.useState<PlanningWorkItem | null>(null)

  /** The tasks the Won't do dialog is open for (N1.2), or null while it is closed. */
  const [wontDoTargets, setWontDoTargets] = React.useState<PlanningWorkItem[] | null>(null)

  /** Opens the Won't do dialog for one task or a bulk selection; finished tasks are left out. */
  const openWontDo = (items: PlanningWorkItem[]) => {
    const open = items.filter((item) => canCloseAsWontDo(item, projectedStatus(item)))
    if (open.length > 0) setWontDoTargets(open)
  }

  /** Why a task can't be closed as won't do right now (running or in-review work), or null. */
  const wontDoBlocker = (item: PlanningWorkItem): string | null => {
    const blocker = deletionBlocker(item)
    if (!blocker || harnessTaskFor(item)?.status === 'pending') return null
    return blocker.replace('deleted', 'archived')
  }

  /**
   * Closes the dialog's tasks as won't do, one call per task through the one
   * rule in the main process; a task already closed as another's subtask is
   * skipped. The toast's undo reopens every task it closed. Returns the error,
   * or null, so the dialog can stay open on failure.
   */
  const closeAsWontDo = async (
    items: PlanningWorkItem[],
    options: { reason: string; includeSubtasks: boolean; cancelQueuedWork: boolean }
  ): Promise<string | null> => {
    const closed: string[] = []
    let failure: string | null = null
    for (const item of items) {
      if (closed.includes(item.id)) continue
      const result = await window.ostlerAPI.closePlanningWorkItemAsWontDo(item.id, options)
      if (!result.ok) {
        failure = result.error || t('tasks:wontDo.couldntClose', { title: item.title })
        break
      }
      closed.push(...result.value.closedIds)
    }
    if (closed.length > 0) {
      setWorkItems((current) => current.filter((candidate) => !closed.includes(candidate.id)))
      if (drawer.selectedWorkItemId && closed.includes(drawer.selectedWorkItemId))
        drawer.closeWorkItem()
      const first = items.find((item) => item.id === closed[0])
      toastUndo(
        closed.length === 1 && first
          ? t('tasks:wontDo.closed', { title: first.title })
          : t('tasks:wontDo.closedTasks', { count: closed.length }),
        async () => {
          for (const id of closed)
            await putBack(t('tasks:wontDo.couldntReopen'), () =>
              window.ostlerAPI.unarchivePlanningWorkItem(id)
            )
        }
      )
      await loadPlanning()
    }
    if (!failure) setWontDoTargets(null)
    return failure
  }

  /** Reopens a won't-do task (the drawer's Reopen): back with the status it had. */
  const reopenWorkItem = async (item: PlanningWorkItem) => {
    await putBack(t('tasks:wontDo.couldntReopen'), () =>
      window.ostlerAPI.unarchivePlanningWorkItem(item.id)
    )
    toast({ title: t('tasks:wontDo.reopened', { title: item.title }) })
  }

  /**
   * Move to Someday and Bring back (N1.1a), for one task or a bulk selection:
   * one update per task through the same service as every edit, then one
   * toast whose undo puts each task back as it was.
   */
  const setSomeday = async (items: PlanningWorkItem[], someday: boolean) => {
    const changing = items.filter((item) => Boolean(item.someday) !== someday)
    if (changing.length === 0) return
    const changed: PlanningWorkItem[] = []
    // Taken out of the agent queue by the move (one rule in the main process).
    const leftQueue: PlanningWorkItem[] = []
    await runBusy(t('tasks:someday.couldntChange'), async () => {
      const failed: string[] = []
      for (const item of changing) {
        const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { someday })
        if (result.ok) {
          changed.push(item)
          replaceItem(result.value)
          if (result.value.leftQueue) leftQueue.push(item)
        } else failed.push(`${item.title}: ${result.error}`)
      }
      if (failed.length > 0) setError(failed.join('; '))
      if (leftQueue.length > 0) await refreshHarness()
    })
    if (changed.length === 0) return
    const message =
      changed.length === 1
        ? t(someday ? 'tasks:someday.moved' : 'tasks:someday.broughtBack', {
            title: changed[0].title
          })
        : t(someday ? 'tasks:someday.movedTasks' : 'tasks:someday.broughtBackTasks', {
            count: changed.length
          })
    toastUndo(
      message,
      async () => {
        for (const item of changed) {
          const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, {
            someday: !someday
          })
          if (result.ok) replaceItem(result.value)
        }
        // Back from Someday, a task that was queued is queued again.
        if (leftQueue.length > 0) {
          await requeueUndo.requeue(leftQueue)
          await loadPlanning()
        }
      },
      leftQueue.length > 0 ? t('tasks:someday.leftQueue', { count: leftQueue.length }) : undefined
    )
  }

  const assignWorkItemMilestone = async (item: PlanningWorkItem, milestoneId: string | null) => {
    await runBusy(t('tasks:useWorkItemActions.couldntAssignMilestoneTry'), async () => {
      const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { milestoneId })
      assertResult(result)
      replaceItem(result.value)
    })
  }

  return {
    createPlanningRecord,
    moveWorkItem,
    placeWorkItem,
    bulkUpdateWorkItems,
    bulkSetType,
    updateWorkItemInline,
    setWorkItemChecklistItemChecked,
    rescheduleWorkItem,
    quickAddWorkItem,
    createSubtask,
    checkPlanWorkItems,
    createPlanWorkItems,
    undoPlanWorkItems,
    deleteWorkItem,
    deleteWorkItems,
    archiveWorkItem,
    blockTimeTarget,
    setBlockTimeTarget,
    wontDoTargets,
    setWontDoTargets,
    openWontDo,
    wontDoBlocker,
    closeAsWontDo,
    reopenWorkItem,
    setSomeday,
    addToMyDay,
    assignWorkItemMilestone,
    internal: { moveLinkedWorkItem, moveWorkItemToMilestone }
  }
}

export type WorkItemActions = ReturnType<typeof useWorkItemActions>
