import { useState } from 'react'
import { IterationField } from '../../iterations/IterationField'
import { TaskTypeField } from '../../task-types/TaskTypeField'
import type { PlanningPriority, RendererProject } from '@shared/ostler-api'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { columnKey, placeOfKey } from '@shared/board-columns'
import { type CreateMode, type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { Button, Checkbox, DateField, Dialog, Select, TextArea, TextField } from '../../ui'
import { DecisionFields, type DecisionDraftFields } from './DecisionFields'
import { AssigneeField } from './AssigneeField'
import { MoreDetails } from './MoreDetails'
import { SuccessCriteriaEditor } from './SuccessCriteriaEditor'
import { TaskDueDateField, TaskEstimateField, TaskStartDateField } from './TaskScheduleFields'
import { WaitsOnField } from './WaitsOnField'
import { usePasteDescriptionPictures } from './useAttachFiles'
import { NewTaskPictures } from './NewTaskPictures'
import { TaskLabelsField } from './TaskLabelsField'
import { frequentLabels } from '@shared/planning/frequent-labels'
import { CustomFieldInput } from './CustomFieldInput'
import { TasksFromTextButton } from '../../components/tasks-from-text/TasksFromTextDialog'
import { waitsOnChoices } from './TaskDependencies'
import { dependencyCandidates } from '@shared/planning/dependencies'
import { usePeople } from '../../context/PeopleContext'
import { TaskTemplateSelect } from '../../task-templates/TaskTemplateSelect'
import { useTaskTemplates } from '../../task-templates/useTaskTemplates'
import { templateFormValues } from '@shared/task-templates'
import { fieldsForType, fillFromTypeTemplate, taskTypeOf } from '@shared/task-type-fields'
import { todayIsoDate } from '@shared/dates'
import { AppWindow, ExternalLink, Maximize2, Minimize2 } from '../../ui/icons'
import './planning-dialogs.css'
import { t } from '@shared/i18n'

const COPY: Record<
  NonNullable<CreateMode>,
  { title: string; description: string; submit: string }
> = {
  goal: {
    get title() {
      return t('tasks:createRecordModal.newGoal')
    },
    get description() {
      return t('tasks:createRecordModal.outcomeAfterMilestonesTasks')
    },
    get submit() {
      return t('tasks:createRecordModal.createGoal')
    }
  },
  milestone: {
    get title() {
      return t('tasks:createRecordModal.newMilestone')
    },
    get description() {
      return t('tasks:createRecordModal.pointDeliverLinkTasks')
    },
    get submit() {
      return t('tasks:createRecordModal.createMilestone')
    }
  },
  decision: {
    get title() {
      return t('tasks:createRecordModal.newDecision')
    },
    get description() {
      return t('tasks:createRecordModal.whatWasChosenWhy')
    },
    get submit() {
      return t('tasks:createRecordModal.saveDecision')
    }
  },
  'work-item': {
    get title() {
      return t('tasks:createRecordModal.newTask')
    },
    get description() {
      return t('tasks:createRecordModal.stepProjectOnePerson')
    },
    get submit() {
      return t('tasks:createRecordModal.createTask')
    }
  }
}

const FORM_ID = 'create-planning-record'

/** The form keeps a new task's labels as one comma-separated line. */
const splitLabels = (text: string) =>
  text
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

/**
 * New task put aside: a bar at the foot of the window with the task's title,
 * to open it again as it was or discard it, while the person looks around
 * the project.
 */
function MinimisedTask({ ws }: { ws: PlanningWorkspace }) {
  const title = ws.itemTitle.trim()
  return (
    <section
      className="create-task-minimised"
      aria-label={t('tasks:createRecordModal.taskPutAside')}
    >
      <span className="create-task-minimised__title">
        {title
          ? t('tasks:createRecordModal.newTaskNamed', { title })
          : t('tasks:createRecordModal.newTask')}
      </span>
      <Button
        size="sm"
        variant="primary"
        icon={Maximize2}
        onClick={() => ws.setCreateMinimised(false)}
      >
        {t('tasks:createRecordModal.carryOn')}
      </Button>
      <Button size="sm" variant="ghost" onClick={ws.closeCreate}>
        {t('tasks:createRecordModal.discard')}
      </Button>
    </section>
  )
}

const NEW_MILESTONE = 'new-milestone'

/**
 * A new task's milestone: one of the project's, or **New milestone…**, which
 * opens a small dialog for the milestone's name, outcome, goal and due date,
 * creates it and chooses it, so the task need not wait for a trip to
 * Milestones. The success criteria are added later on Milestones.
 */
function NewTaskMilestoneField({ ws }: { ws: PlanningWorkspace }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [outcome, setOutcome] = useState('')
  const [goalId, setGoalId] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stop = () => {
    setCreating(false)
    setName('')
    setOutcome('')
    setGoalId('')
    setTargetDate('')
    setError(null)
  }
  const add = async () => {
    const text = name.trim()
    if (!text || saving) return
    setSaving(true)
    const result = await window.ostlerAPI.createPlanningMilestone(ws.projectId, {
      name: text,
      outcome: outcome.trim() || undefined,
      goalId: goalId || null,
      targetDate: targetDate || null,
      ...(ws.subprojectScope ? { subprojectId: ws.subprojectScope.id } : {})
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await ws.loadPlanning()
    ws.setItemMilestoneId(result.value.id)
    stop()
  }
  return (
    <>
      <Select
        label={t('tasks:createRecordModal.milestone')}
        value={ws.itemMilestoneId}
        onChange={(event) => {
          if (event.target.value === NEW_MILESTONE) setCreating(true)
          else ws.setItemMilestoneId(event.target.value)
        }}
        options={[
          { value: '', label: t('tasks:createRecordModal.noMilestone') },
          ...ws.milestones.map((milestone) => ({
            value: milestone.id,
            label: milestone.name
          })),
          { value: NEW_MILESTONE, label: t('tasks:createRecordModal.newMilestoneOption') }
        ]}
      />
      <Dialog
        open={creating}
        size="md"
        onClose={stop}
        canDismiss={!saving}
        title={t('tasks:createRecordModal.newMilestone')}
        description={t('tasks:createRecordModal.pointDeliverLinkTasks')}
        footer={
          <>
            <Button variant="ghost" onClick={stop} disabled={saving}>
              {t('tasks:createRecordModal.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!name.trim()}
              onClick={() => void add()}
            >
              {t('tasks:createRecordModal.createMilestone')}
            </Button>
          </>
        }
      >
        {/* Its own form, so Enter here never submits the task behind it. */}
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void add()
          }}
        >
          <TextField
            label={t('tasks:createRecordModal.milestoneName')}
            data-autofocus
            value={name}
            error={error ?? undefined}
            placeholder={t('tasks:createRecordModal.meaningfulDeliveryPoint')}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <TextArea
            label={t('tasks:createRecordModal.outcome')}
            rows={3}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          />
          <div className="dialog-form__row">
            <Select
              label={t('tasks:createRecordModal.goal')}
              value={goalId}
              onChange={(event) => setGoalId(event.target.value)}
              options={[
                { value: '', label: t('tasks:createRecordModal.noGoal') },
                ...ws.goals.map((goal) => ({ value: goal.id, label: goal.title }))
              ]}
            />
            <DateField
              label={t('tasks:createRecordModal.dueDate')}
              value={targetDate}
              onChange={setTargetDate}
            />
          </div>
        </form>
      </Dialog>
    </>
  )
}

/** The create dialog for goals, milestones, decisions and tasks. */
export function CreateRecordModal({
  ws,
  selectedProject,
  onPopOut,
  onReturn
}: {
  ws: PlanningWorkspace
  selectedProject: RendererProject | undefined
  /** In a main-window view: moves New task into a window of its own. */
  onPopOut?: () => void
  /** In New task's own window: hands the task back to the main window. */
  onReturn?: () => void
}) {
  const features = useFeatures()
  const people = usePeople()
  const taskTemplates = useTaskTemplates(ws.createMode === 'work-item' ? ws.projectId : null)
  const pasteDescriptionPictures = usePasteDescriptionPictures(ws.projectId ?? '', (added) =>
    ws.setItemPictures((current) => [
      ...current,
      ...added.filter((picture) => !current.some((had) => had.id === picture.id))
    ])
  )
  if (!ws.createMode) return null

  // A task template (N2.1) fills the form; the person can still edit it before Create.
  const chooseTemplate = (templateId: string) => {
    const template = taskTemplates.templates.find((entry) => entry.id === templateId)
    ws.applyTaskTemplate(
      template ? templateId : '',
      template
        ? templateFormValues(template.body, todayIsoDate(), {
            personIds: new Set(people.all.map((person) => person.id)),
            fields: ws.fields
          })
        : null
    )
  }
  // A type's template (N2.7b) fills the form when the type is chosen, unless
  // a template is chosen already; what the person entered wins.
  const chooseType = (typeId: string) => {
    ws.setItemTypeId(typeId)
    const templateId = taskTypeOf(ws.taskTypes, typeId)?.templateId
    const template = taskTemplates.templates.find((entry) => entry.id === templateId)
    if (ws.itemTemplateId || !template) return
    const split = (text: string, by: string) =>
      text
        .split(by)
        .map((part) => part.trim())
        .filter(Boolean)
    ws.applyTaskTemplate(
      template.id,
      fillFromTypeTemplate(
        {
          title: ws.itemTitle,
          description: ws.itemDescription,
          priority: ws.itemPriority,
          labels: split(ws.itemLabels, ','),
          acceptanceCriteria: split(ws.itemCriteria, '\n'),
          assigneeId: ws.itemAssigneeId,
          startDate: ws.itemStartDate || null,
          targetDate: ws.itemTargetDate || null,
          estimate: ws.itemEstimate,
          fieldValues: ws.itemFieldValues
        },
        templateFormValues(template.body, todayIsoDate(), {
          personIds: new Set(people.all.map((person) => person.id)),
          fields: ws.fields
        })
      )
    )
  }
  // The custom fields the chosen type shows (N2.7b); every field with no type.
  const typeFields = fieldsForType(ws.fields, taskTypeOf(ws.taskTypes, ws.itemTypeId))
  const copy = COPY[ws.createMode]
  if (ws.createMode === 'work-item' && ws.createMinimised) return <MinimisedTask ws={ws} />

  const decision: DecisionDraftFields = {
    title: ws.decisionTitle,
    date: ws.decisionDate,
    context: ws.decisionContext,
    decision: ws.decisionBody,
    alternativesConsidered: ws.decisionAlternatives,
    consequences: ws.decisionConsequences,
    linkedWorkItemIds: ws.decisionLinkedWorkItemIds
  }
  const changeDecision = (patch: Partial<DecisionDraftFields>) => {
    if (patch.title !== undefined) ws.setDecisionTitle(patch.title)
    if (patch.date !== undefined) ws.setDecisionDate(patch.date)
    if (patch.context !== undefined) ws.setDecisionContext(patch.context)
    if (patch.decision !== undefined) ws.setDecisionBody(patch.decision)
    if (patch.alternativesConsidered !== undefined)
      ws.setDecisionAlternatives(patch.alternativesConsidered)
    if (patch.consequences !== undefined) ws.setDecisionConsequences(patch.consequences)
    if (patch.linkedWorkItemIds !== undefined)
      ws.setDecisionLinkedWorkItemIds(patch.linkedWorkItemIds)
  }

  return (
    <Dialog
      open
      size={ws.createMode === 'decision' || ws.createMode === 'work-item' ? 'lg' : 'md'}
      onClose={ws.closeCreate}
      canDismiss={!ws.busy}
      closeOnBackdrop={false}
      title={copy.title}
      description={
        selectedProject
          ? t('tasks:createRecordModal.in', {
              description: copy.description,
              selectedProjectName: selectedProject.name
            })
          : copy.description
      }
      footer={
        <>
          {ws.createMode === 'work-item' && onReturn && (
            <Button
              variant="ghost"
              icon={AppWindow}
              className="create-task__minimise"
              disabled={ws.busy}
              onClick={onReturn}
            >
              {t('tasks:createRecordModal.backToMainWindow')}
            </Button>
          )}
          {ws.createMode === 'work-item' && onPopOut && (
            <Button variant="ghost" icon={ExternalLink} disabled={ws.busy} onClick={onPopOut}>
              {t('tasks:createRecordModal.popOut')}
            </Button>
          )}
          {ws.createMode === 'work-item' && !onReturn && (
            <Button
              variant="ghost"
              icon={Minimize2}
              className="create-task__minimise"
              disabled={ws.busy}
              onClick={() => ws.setCreateMinimised(true)}
            >
              {t('tasks:createRecordModal.minimise')}
            </Button>
          )}
          <Button onClick={ws.closeCreate} disabled={ws.busy}>
            {t('tasks:createRecordModal.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={ws.busy}>
            {copy.submit}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="dialog-form"
        onSubmit={(event) => void ws.createPlanningRecord(event)}
      >
        {ws.createMode === 'goal' && (
          <>
            <TextField
              label={t('tasks:createRecordModal.goalTitle')}
              data-autofocus
              value={ws.goalTitle}
              onChange={(event) => ws.setGoalTitle(event.target.value)}
              placeholder={t('tasks:createRecordModal.whatOutcomeAfter')}
              required
            />
            <TextArea
              label={t('tasks:createRecordModal.outcome')}
              hint={t('tasks:createRecordModal.whatSuccessChanges')}
              rows={4}
              value={ws.goalOutcome}
              onChange={(event) => ws.setGoalOutcome(event.target.value)}
            />
          </>
        )}
        {ws.createMode === 'milestone' && (
          <>
            <TextField
              label={t('tasks:createRecordModal.milestoneName')}
              data-autofocus
              value={ws.milestoneName}
              onChange={(event) => ws.setMilestoneName(event.target.value)}
              placeholder={t('tasks:createRecordModal.meaningfulDeliveryPoint')}
              required
            />
            <TextArea
              label={t('tasks:createRecordModal.outcome')}
              rows={3}
              value={ws.milestoneOutcome}
              onChange={(event) => ws.setMilestoneOutcome(event.target.value)}
            />
            <div className="dialog-form__row">
              <Select
                label={t('tasks:createRecordModal.goal')}
                value={ws.milestoneGoalId}
                onChange={(event) => ws.setMilestoneGoalId(event.target.value)}
                options={[
                  { value: '', label: t('tasks:createRecordModal.noGoal') },
                  ...ws.goals.map((goal) => ({ value: goal.id, label: goal.title }))
                ]}
              />
              <DateField
                label={t('tasks:createRecordModal.dueDate')}
                value={ws.milestoneTargetDate}
                onChange={ws.setMilestoneTargetDate}
              />
            </div>
            <SuccessCriteriaEditor
              items={ws.milestoneCriteria}
              onChange={ws.setMilestoneCriteria}
            />
          </>
        )}
        {ws.createMode === 'decision' && (
          <DecisionFields
            value={decision}
            onChange={changeDecision}
            workItems={ws.workItems}
            projectId={ws.projectId}
          />
        )}
        {ws.createMode === 'work-item' && (
          <>
            <TaskTemplateSelect
              templates={taskTemplates.templates}
              value={ws.itemTemplateId}
              onChange={chooseTemplate}
            />
            <div className="create-task__title-row">
              <TextField
                label={t('tasks:createRecordModal.title')}
                data-autofocus
                className="create-task__title"
                value={ws.itemTitle}
                onChange={(event) => ws.setItemTitle(event.target.value)}
                placeholder={t('tasks:createRecordModal.boundedPieceWork')}
                required
              />
              <TasksFromTextButton
                projectId={ws.projectId}
                visible={features.ai}
                onAdded={ws.closeCreate}
              />
            </div>
            <TextArea
              label={t('tasks:createRecordModal.description')}
              hint={t('tasks:createRecordModal.scopeContextConstraints')}
              rows={4}
              value={ws.itemDescription}
              onChange={(event) => ws.setItemDescription(event.target.value)}
              onPaste={pasteDescriptionPictures}
            />
            {ws.projectId && (
              <NewTaskPictures
                projectId={ws.projectId}
                pictures={ws.itemPictures}
                onRemove={(id) =>
                  ws.setItemPictures((current) => current.filter((picture) => picture.id !== id))
                }
              />
            )}
            <div className="dialog-form__row">
              <Select
                label={t('tasks:createRecordModal.status')}
                value={columnKey(ws.itemStatus, ws.itemColumnId)}
                onChange={(event) => {
                  const place = placeOfKey(event.target.value, ws.statusWords.columns)
                  if (place) ws.setItemColumn(place.status, place.columnId)
                }}
                options={ws.statusWords
                  .places(columnKey(ws.itemStatus, ws.itemColumnId))
                  .map((place) => ({ value: place.key, label: place.label }))}
              />
              <Select
                label={t('tasks:createRecordModal.priority')}
                value={ws.itemPriority}
                onChange={(event) => ws.setItemPriority(event.target.value as PlanningPriority)}
                options={TASK_PRIORITIES.map((priority) => ({
                  value: priority,
                  label: taskPriorityLabel(priority)
                }))}
              />
            </div>
            <NewTaskMilestoneField ws={ws} />
            <IterationField
              iterations={ws.iterations}
              value={ws.itemIterationId}
              onChange={ws.setItemIterationId}
            />
            <TaskTypeField types={ws.taskTypes} value={ws.itemTypeId} onChange={chooseType} />
            <TaskLabelsField
              labels={splitLabels(ws.itemLabels)}
              known={[...new Set(ws.workItems.flatMap((item) => item.labels))].sort()}
              frequent={frequentLabels(ws.workItems)}
              colorOf={ws.labelColor}
              onChange={(labels) => ws.setItemLabels(labels.join(', '))}
            />
            <TextArea
              label={t('tasks:createRecordModal.checklist')}
              hint={t('tasks:createRecordModal.oneThingCheckPer')}
              rows={4}
              value={ws.itemCriteria}
              onChange={(event) => ws.setItemCriteria(event.target.value)}
            />
            <MoreDetails>
              <AssigneeField
                projectId={ws.projectId}
                value={ws.itemAssigneeId}
                onChange={ws.setItemAssigneeId}
                className="create-task__assignee"
              />
              <div className="dialog-form__row">
                <TaskStartDateField
                  value={ws.itemStartDate}
                  assigneeId={ws.itemAssigneeId}
                  onChange={ws.setItemStartDate}
                />
                <TaskDueDateField
                  value={ws.itemTargetDate}
                  assigneeId={ws.itemAssigneeId}
                  startDate={ws.itemStartDate}
                  onChange={ws.setItemTargetDate}
                />
              </div>
              <TaskEstimateField
                projectId={ws.projectId}
                value={ws.itemEstimate}
                onChange={ws.setItemEstimate}
              />
              <WaitsOnField
                heading={t('tasks:taskDependencies.waits')}
                chosen={waitsOnChoices(ws, ws.itemDependencyIds)}
                options={dependencyCandidates(
                  { id: '', parentWorkItemId: null, subtaskPhaseNumber: null },
                  ws.workItems
                )
                  .filter((candidate) => !ws.itemDependencyIds.includes(candidate.id))
                  .map((candidate) => ({ value: candidate.id, label: candidate.title }))}
                onAdd={(id) => ws.setItemDependencyIds((current) => [...current, id])}
                onRemove={(id) =>
                  ws.setItemDependencyIds((current) => current.filter((other) => other !== id))
                }
                placeholder={t('tasks:taskDependencies.addTaskWaits')}
                emptyText={
                  ws.workItems.length === 0
                    ? t('tasks:taskDependencies.addAnotherTaskSet')
                    : t('tasks:taskDependencies.noMatchingTasks')
                }
              />
              {typeFields.length > 0 && (
                <fieldset className="create-task__fields">
                  <legend>{t('tasks:customFields.fields')}</legend>
                  {typeFields.map((field) => (
                    <CustomFieldInput
                      key={field.id}
                      field={field}
                      value={ws.itemFieldValues[field.id] ?? undefined}
                      onChange={(value) =>
                        ws.setItemFieldValues((current) => ({ ...current, [field.id]: value }))
                      }
                    />
                  ))}
                </fieldset>
              )}
            </MoreDetails>
            {features.agents && (
              <Checkbox
                label={t('tasks:createRecordModal.handSameAgent')}
                hint={t('tasks:createRecordModal.onceQueuedAgentFinishes')}
                checked={ws.itemAutoQueue}
                onChange={(event) => ws.setItemAutoQueue(event.target.checked)}
              />
            )}
          </>
        )}
      </form>
    </Dialog>
  )
}
