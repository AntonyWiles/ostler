import { useState } from 'react'
import type {
  CreatePlanningWorkItemInput,
  PlanningFieldValuesInput,
  PlanningPriority,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import type { NewTaskDraft, NewTaskPicture } from '@shared/new-task-window'

export type CreateMode = 'goal' | 'milestone' | 'work-item' | 'decision' | null

const today = () => todayIsoDate()

/**
 * The create dialog's state: which kind of record it is creating, every
 * field of its form, and the project-brief recommendation it was opened
 * from, if any. State only -- saving is `useWorkItemActions`'s
 * `createPlanningRecord`. Depends on nothing.
 */
export function usePlanningCreateForm() {
  const [createMode, setCreateMode] = useState<CreateMode>(null)
  /**
   * New task is put aside, as a bar at the foot of the window, so the person
   * can look around the project and come back to it as they left it.
   */
  const [createMinimised, setCreateMinimised] = useState(false)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalOutcome, setGoalOutcome] = useState('')
  const [milestoneName, setMilestoneName] = useState('')
  const [milestoneOutcome, setMilestoneOutcome] = useState('')
  const [milestoneGoalId, setMilestoneGoalId] = useState('')
  const [milestoneTargetDate, setMilestoneTargetDate] = useState('')
  const [itemTitle, setItemTitle] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemStatus, setItemStatusValue] = useState<PlanningWorkItemStatus>('backlog')
  /** The project's own column (MOP-26) New task starts in, or null for the status's own. */
  const [itemColumnId, setItemColumnId] = useState<string | null>(null)
  /** A status's own column. */
  const setItemStatus = (status: PlanningWorkItemStatus) => {
    setItemStatusValue(status)
    setItemColumnId(null)
  }
  /** A column: a status's own, or with `columnId` one of the project's own. */
  const setItemColumn = (status: PlanningWorkItemStatus, columnId: string | null) => {
    setItemStatusValue(status)
    setItemColumnId(columnId)
  }
  const [itemPriority, setItemPriority] = useState<PlanningPriority>('medium')
  const [itemMilestoneId, setItemMilestoneId] = useState('')
  const [itemIterationId, setItemIterationId] = useState('')
  const [itemTypeId, setItemTypeId] = useState('')
  const [itemLabels, setItemLabels] = useState('')
  const [itemCriteria, setItemCriteria] = useState('')
  const [itemAutoQueue, setItemAutoQueue] = useState(false)
  const [itemAssigneeId, setItemAssigneeId] = useState<string | null>(null)
  const [itemStartDate, setItemStartDate] = useState('')
  const [itemTargetDate, setItemTargetDate] = useState('')
  const [itemEstimate, setItemEstimate] = useState<number | null>(null)
  const [itemDependencyIds, setItemDependencyIds] = useState<string[]>([])
  /** Custom field values for the new task (R2.2), by field id. */
  const [itemFieldValues, setItemFieldValues] = useState<PlanningFieldValuesInput>({})
  /** The task template (N2.1) the form was filled from; Create makes its subtasks too. */
  const [itemTemplateId, setItemTemplateId] = useState('')
  /** Pictures pasted into the description (MOP-31), attached when the task is created. */
  const [itemPictures, setItemPictures] = useState<NewTaskPicture[]>([])
  /** The success criteria a milestone is created with, as the checklist holds them. */
  const [milestoneCriteria, setMilestoneCriteria] = useState<string[]>([])
  /** The plan grid (several tasks at once) is open. */
  const [planGridOpen, setPlanGridOpen] = useState(false)
  /** Find and replace (N2.5) is open. */
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  /** Run playbook (N9.6b) is open. */
  const [runPlaybookOpen, setRunPlaybookOpen] = useState(false)
  const [decisionTitle, setDecisionTitle] = useState('')
  const [decisionContext, setDecisionContext] = useState('')
  const [decisionBody, setDecisionBody] = useState('')
  const [decisionAlternatives, setDecisionAlternatives] = useState('')
  const [decisionConsequences, setDecisionConsequences] = useState('')
  const [decisionDate, setDecisionDate] = useState(today)
  const [decisionLinkedWorkItemIds, setDecisionLinkedWorkItemIds] = useState<string[]>([])
  /** The approved brief recommendation this goal or milestone is being created from. */
  const [briefCreationDraft, setBriefCreationDraft] = useState<{
    actionId: string
    type: 'goal' | 'milestone'
  } | null>(null)

  const resetCreateForm = () => {
    setGoalTitle('')
    setGoalOutcome('')
    setMilestoneName('')
    setMilestoneOutcome('')
    setMilestoneGoalId('')
    setMilestoneTargetDate('')
    setItemTitle('')
    setItemDescription('')
    setItemStatus('backlog')
    setItemPriority('medium')
    setItemMilestoneId('')
    setItemIterationId('')
    setItemTypeId('')
    setItemLabels('')
    setItemCriteria('')
    setItemAutoQueue(false)
    setItemAssigneeId(null)
    setItemStartDate('')
    setItemTargetDate('')
    setItemEstimate(null)
    setItemDependencyIds([])
    setItemFieldValues({})
    setItemTemplateId('')
    setItemPictures([])
    setMilestoneCriteria([])
    setDecisionTitle('')
    setDecisionContext('')
    setDecisionBody('')
    setDecisionAlternatives('')
    setDecisionConsequences('')
    setDecisionDate(today())
    setDecisionLinkedWorkItemIds([])
  }

  const closeCreate = () => {
    setCreateMode(null)
    setCreateMinimised(false)
    setBriefCreationDraft(null)
    resetCreateForm()
  }

  const openWorkItemCreate = (
    status: PlanningWorkItemStatus = 'backlog',
    milestoneId = '',
    columnId: string | null = null
  ) => {
    // A task put aside comes back as it was, rather than a blank one over it.
    if (createMode === 'work-item' && createMinimised) {
      setCreateMinimised(false)
      return
    }
    setItemColumn(status, columnId)
    setItemMilestoneId(milestoneId)
    setCreateMode('work-item')
  }

  /**
   * Fills New task's form from a task template (N2.1), or clears what it
   * filled when `templateId` is empty. Status, milestone, iteration and what
   * the task waits on stay as the person set them.
   */
  const applyTaskTemplate = (templateId: string, values: CreatePlanningWorkItemInput | null) => {
    setItemTemplateId(templateId)
    setItemTitle(values?.title ?? '')
    setItemDescription(values?.description ?? '')
    setItemPriority(values?.priority ?? 'medium')
    setItemLabels((values?.labels ?? []).join(', '))
    setItemCriteria((values?.acceptanceCriteria ?? []).join('\n'))
    setItemAssigneeId(values?.assigneeId ?? null)
    setItemStartDate(values?.startDate ?? '')
    setItemTargetDate(values?.targetDate ?? '')
    setItemEstimate(values?.estimate ?? null)
    setItemFieldValues(values?.fieldValues ?? {})
  }

  /** New task's form as it stands, to hand to another window. */
  const getNewTaskDraft = (): NewTaskDraft => ({
    title: itemTitle,
    description: itemDescription,
    status: itemStatus,
    columnId: itemColumnId,
    priority: itemPriority,
    milestoneId: itemMilestoneId,
    iterationId: itemIterationId,
    typeId: itemTypeId,
    labels: itemLabels,
    criteria: itemCriteria,
    autoQueue: itemAutoQueue,
    assigneeId: itemAssigneeId,
    startDate: itemStartDate,
    targetDate: itemTargetDate,
    estimate: itemEstimate,
    dependencyIds: itemDependencyIds,
    fieldValues: itemFieldValues,
    templateId: itemTemplateId,
    pictures: itemPictures
  })

  /** Opens New task filled from a draft another window handed over. */
  const applyNewTaskDraft = (draft: NewTaskDraft) => {
    setItemTitle(draft.title ?? '')
    setItemDescription(draft.description ?? '')
    setItemColumn(
      (draft.status as PlanningWorkItemStatus) ?? 'backlog',
      typeof draft.columnId === 'string' ? draft.columnId : null
    )
    setItemPriority((draft.priority as PlanningPriority) ?? 'medium')
    setItemMilestoneId(draft.milestoneId ?? '')
    setItemIterationId(draft.iterationId ?? '')
    setItemTypeId(draft.typeId ?? '')
    setItemLabels(draft.labels ?? '')
    setItemCriteria(draft.criteria ?? '')
    setItemAutoQueue(draft.autoQueue === true)
    setItemAssigneeId(draft.assigneeId ?? null)
    setItemStartDate(draft.startDate ?? '')
    setItemTargetDate(draft.targetDate ?? '')
    setItemEstimate(typeof draft.estimate === 'number' ? draft.estimate : null)
    setItemDependencyIds(Array.isArray(draft.dependencyIds) ? draft.dependencyIds : [])
    setItemFieldValues(draft.fieldValues ?? {})
    setItemTemplateId(draft.templateId ?? '')
    setItemPictures(Array.isArray(draft.pictures) ? draft.pictures : [])
    setCreateMinimised(false)
    setCreateMode('work-item')
  }

  return {
    getNewTaskDraft,
    applyNewTaskDraft,
    createMode,
    setCreateMode,
    closeCreate,
    openWorkItemCreate,
    createMinimised,
    setCreateMinimised,
    goalTitle,
    setGoalTitle,
    goalOutcome,
    setGoalOutcome,
    milestoneName,
    setMilestoneName,
    milestoneOutcome,
    setMilestoneOutcome,
    milestoneGoalId,
    setMilestoneGoalId,
    milestoneTargetDate,
    setMilestoneTargetDate,
    itemTitle,
    setItemTitle,
    itemDescription,
    setItemDescription,
    itemStatus,
    setItemStatus,
    itemColumnId,
    setItemColumn,
    itemPriority,
    setItemPriority,
    itemMilestoneId,
    itemIterationId,
    setItemIterationId,
    itemTypeId,
    setItemTypeId,
    setItemMilestoneId,
    itemLabels,
    setItemLabels,
    itemCriteria,
    setItemCriteria,
    itemAutoQueue,
    setItemAutoQueue,
    itemAssigneeId,
    setItemAssigneeId,
    itemStartDate,
    setItemStartDate,
    itemTargetDate,
    setItemTargetDate,
    itemEstimate,
    setItemEstimate,
    itemDependencyIds,
    setItemDependencyIds,
    itemFieldValues,
    setItemFieldValues,
    itemTemplateId,
    applyTaskTemplate,
    itemPictures,
    setItemPictures,
    milestoneCriteria,
    setMilestoneCriteria,
    planGridOpen,
    setPlanGridOpen,
    findReplaceOpen,
    setFindReplaceOpen,
    runPlaybookOpen,
    setRunPlaybookOpen,
    decisionTitle,
    setDecisionTitle,
    decisionContext,
    setDecisionContext,
    decisionBody,
    setDecisionBody,
    decisionAlternatives,
    setDecisionAlternatives,
    decisionConsequences,
    setDecisionConsequences,
    decisionDate,
    setDecisionDate,
    decisionLinkedWorkItemIds,
    setDecisionLinkedWorkItemIds,
    internal: { resetCreateForm, briefCreationDraft, setBriefCreationDraft }
  }
}

export type PlanningCreateForm = ReturnType<typeof usePlanningCreateForm>
