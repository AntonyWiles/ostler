import { IterationField } from '../../iterations/IterationField'
import { TaskTypeField } from '../../task-types/TaskTypeField'
import { Link } from 'react-router-dom'
import type { PlanningSubproject } from '@shared/ostler-api'
import { projectAndSubprojectName } from '@shared/subproject-label'
import { subprojectPath } from '../../navigation/paths'
import { SubprojectField } from './subproject-ui'
import {
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { imagesIn, pictureMarkdown, useAttachFiles } from './useAttachFiles'
import { Markdown } from '../../ui/Markdown'
import { useItemLinkPicker } from '../../hooks/useItemLinkPicker'
import type { PlanningPriority, PlanningWorkItem } from '@shared/ostler-api'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { taskIdLabel } from '@shared/task-key'
import { useMyShareRole } from '../../hooks/useMyShareRole'
import { usePeople } from '../../context/PeopleContext'
import { capabilitiesOf } from '@shared/share-roles'
import { FollowButton } from './FollowButton'
import { SignOffSection } from './SignOffSection'
import { type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import type { DrawerField, DrawerFailure } from '../../hooks/planning/drawer-saves'
import {
  Button,
  Drawer,
  IconButton,
  InlineAlert,
  Menu,
  PriorityIcon,
  STATUS_ICONS,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
  isEditable
} from '../../ui'
import {
  AppWindow,
  Archive,
  Ban,
  ExternalLink,
  CalendarClock,
  Copy,
  Icon,
  Bot,
  LayoutTemplate,
  Lightbulb,
  Link2,
  ListPlus,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Undo2
} from '../../ui/icons'
import { SaveTaskTemplateDialog } from '../../task-templates/SaveTaskTemplateDialog'
import { canCloseAsWontDo } from '@shared/planning/wont-do'
import { ProposedAttachments } from '../../components/ProposedAttachments'
import { useFeatures } from '../../navigation/features'
import { useProjectList } from '../../context/OstlerContext'
import { projectFolder } from '@shared/project-folder'
import { useWritingHelp, WritingHelpLayout } from '../../components/WritingHelp'
import { WorkItemSourcesSection } from './WorkItemSourcesSection'
import { WorkItemAttachmentsSection } from './WorkItemAttachmentsSection'
import { WorkItemAttachedFilesSection } from './WorkItemAttachedFilesSection'
import { TaskDrawerSection } from './TaskDrawerSection'
import { TaskBlockedReason } from './TaskBlockedReason'
import { TaskChecklistEditor } from './TaskChecklistEditor'
import {
  TaskDueDateField,
  TaskEstimateField,
  TaskShowFromField,
  TaskStartDateField
} from './TaskScheduleFields'
import { TaskScoreFields } from './ideas/TaskScoreFields'
import { TaskTimeBlocks } from '../../components/time-blocks/TaskTimeBlocks'
import { TaskDependencies } from './TaskDependencies'
import { TaskLinksSection } from './TaskLinksSection'
import { LinkedFrom } from '../../components/LinkedFrom'
import { DescriptionHistory } from './DescriptionHistory'
import { TaskLabelsField } from './TaskLabelsField'
import { frequentLabels } from '@shared/planning/frequent-labels'
import { AssigneeField } from './AssigneeField'
import { useCopyTaskText, useTaskId, useTaskIdMenuItems } from './task-id'
import { useStickyTaskMenuItems } from '../../shell/sticky-task'
import { TaskSubtasksSection, phaseLabel, subtaskPhasesOf } from './TaskSubtasksSection'
import { TaskAgentRunSection } from './TaskAgentRunSection'
import { TaskVerificationSection } from './TaskVerificationSection'
import { TaskActivitySection } from './TaskActivitySection'
import { TaskRepeatSection } from './TaskRepeatSection'
import { ReminderNudgeBar } from './ReminderNudgeBar'
import { TaskTimeSection } from '../../time/TaskTimeSection'
import { TaskCostsSection } from '../../costs/TaskCostsSection'
import { TaskContactsSection } from '../../contacts/TaskContactsSection'
import { TaskGithubSection } from '../../github/TaskGithubSection'
import { TaskCommitsSection } from './TaskCommitsSection'
import { DrawerSaveStatus } from './DrawerSaveStatus'
import { FailedSaveDialog, drawerFieldName, type FailedSaveChoice } from './FailedSaveDialog'
import { TaskCustomFieldsSection } from './TaskCustomFieldsSection'
import { DescriptionPictures } from './DescriptionPictures'
import { TaskPart, TaskPartsBar, TaskPartsProvider } from './TaskParts'
import { partsProjectUses } from './task-parts'
import { TriageDrawerSuggestions } from './triage/TriageDrawerSuggestions'
import './WorkItemDrawer.css'
import { useFlushOnQuit } from '../../shell/flush-on-quit'
import { t } from '@shared/i18n'
import { formatDate } from '@shared/format'
import { pinEntries, usePins } from '../../pins/PinsProvider'

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))

const stampDate = (at: number) =>
  formatDate(new Date(at), { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * A task's board card. A card is re-created when it moves column, which can
 * happen while its drawer is open, so focus returns by the task's id.
 */
function cardOf(itemId: string | undefined): HTMLElement | null {
  if (!itemId) return null
  const cards = document.querySelectorAll<HTMLElement>('[data-work-item-id]')
  return [...cards].find((card) => card.dataset.workItemId === itemId) ?? null
}

/** The message of a save that failed on this field, until it is saved or discarded. */
function saveErrorOf(ws: PlanningWorkspace, field: DrawerField): string | undefined {
  return ws.saveFailures.find((failure) => failure.field === field)?.message
}

/**
 * The task drawer: the task as a document you can edit. The header holds its
 * status, title and save state, the fields grid the short facts, the body the
 * description, checklist, subtasks, dependencies and Library links, and, while
 * agents are on, the agent run and verification.
 *
 * Every field saves as it changes (D30): a picker, toggle or date at once, the
 * title, description and checklist text after a pause, and whatever is typed
 * when the field is left or the drawer closes. There is no Save or Cancel.
 */
export function WorkItemDrawer({
  ws,
  onBackToMain
}: {
  ws: PlanningWorkspace
  /** In a task's own window (MOP-12): Back to main window, in place of Pop out. */
  onBackToMain?: () => void
}) {
  const item = ws.selectedWorkItem
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const [question, setQuestion] = useState<{
    failures: DrawerFailure[]
    answer: (choice: FailedSaveChoice) => void
  } | null>(null)
  const asking = useRef(false)

  // Quitting Ostler saves typing still waiting for its pause (R1.5).
  useFlushOnQuit(async () => {
    ws.flushEdits()
    await ws.waitForSaves()
  })

  /**
   * Leaves the drawer once its edits are saved: typing still in progress saves
   * now, and a save in flight is waited for. A save that failed asks whether to
   * retry it or discard that change, and the drawer stays open if it still
   * fails. Then runs `then`.
   */
  const requestLeave = async (then?: () => void) => {
    if (asking.current) return
    ws.flushEdits()
    await ws.waitForSaves()
    if (ws.failedSaves().length > 0) {
      asking.current = true
      const choice = await new Promise<FailedSaveChoice>((answer) =>
        setQuestion({ failures: ws.failedSaves(), answer })
      )
      setQuestion(null)
      asking.current = false
      if (choice === 'keep') return
      if (choice === 'discard') {
        ws.discardSaves()
      } else {
        ws.retrySaves()
        await ws.waitForSaves()
        if (ws.failedSaves().length > 0) return
      }
    }
    ws.closeWorkItem()
    then?.()
  }

  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const { attachFiles } = useAttachFiles(item?.projectId ?? '', item?.id ?? '')

  /** Pop out (MOP-12): the task, saved, moves to a window of its own; the drawer here closes. */
  const popOut = async () => {
    if (!item) return
    const { projectId, id } = item
    await requestLeave(() => void window.ostlerAPI.openTaskWindow(projectId, id))
  }

  /**
   * A picture pasted anywhere in the task is attached to it; pasted into the
   * description, it is also shown there, where the caret was.
   */
  const pastePicture = (event: ClipboardEvent<HTMLElement>) => {
    if (!item) return
    const images = imagesIn(event.clipboardData.files)
    if (images.length === 0) return
    event.preventDefault()
    const text = event.target === descriptionRef.current ? descriptionRef.current : null
    const start = text?.selectionStart ?? 0
    const end = text?.selectionEnd ?? 0
    void attachFiles(images).then((attached) => {
      if (!text || attached.length === 0) return
      const pictures = pictureMarkdown(item.projectId, attached)
      ws.setEditDescription(text.value.slice(0, start) + pictures + text.value.slice(end))
    })
  }

  /**
   * Ctrl + Z in the drawer undoes its last saved change. In a text field it is
   * that field's own undo, as everywhere else (`isEditable`).
   */
  const undoWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
    if (event.key.toLowerCase() !== 'z' || isEditable(event.target)) return
    if (!ws.undoLastSave()) return
    event.preventDefault()
    // The drawer's undo: the window's toast undo must not run as well.
    event.stopPropagation()
  }

  return (
    <>
      <Drawer
        id="task"
        open={item !== null}
        onClose={() => void requestLeave()}
        canDismiss
        initialFocusRef={titleRef}
        returnFocusTo={() => cardOf(item?.id)}
        defaultWidth={560}
        className="task-drawer"
        onKeyDown={undoWithKeyboard}
        onPaste={pastePicture}
        headerStart={item ? <StatusSelect ws={ws} item={item} /> : null}
        title={
          // A one-line textarea that grows, so a long title wraps instead of
          // scrolling out of sight. Enter saves the title now.
          <textarea
            ref={titleRef}
            className="task-drawer__title-input"
            aria-label={t('tasks:workItemDrawer.title')}
            aria-invalid={saveErrorOf(ws, 'title') ? true : undefined}
            rows={1}
            required
            value={ws.editTitle}
            onFocus={() => ws.beginEdit('title')}
            onBlur={() => ws.endEdit('title')}
            onChange={(event) => ws.setEditTitle(event.target.value.replace(/\s*\n\s*/g, ' '))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              ws.flushEdits()
            }}
          />
        }
        actions={
          item ? (
            <>
              <DrawerSaveStatus status={ws.saveStatus} onRetry={ws.retrySaves} />
              <FollowButton projectId={item.projectId} taskId={item.id} />
              {onBackToMain ? (
                <IconButton
                  size="sm"
                  icon={AppWindow}
                  label={t('tasks:createRecordModal.backToMainWindow')}
                  onClick={onBackToMain}
                />
              ) : (
                <IconButton
                  size="sm"
                  icon={ExternalLink}
                  label={t('tasks:createRecordModal.popOut')}
                  onClick={() => void popOut()}
                />
              )}
              <TaskMoreMenu ws={ws} item={item} />
            </>
          ) : null
        }
        footer={item ? <DrawerFooter item={item} subprojects={ws.subprojects} /> : null}
      >
        {item && (
          <form
            id="task-drawer-form"
            className="task-drawer__form"
            onSubmit={(event) => {
              event.preventDefault()
              ws.flushEdits()
            }}
          >
            {/* Keyed by task: the next task starts with only what it holds. */}
            <DrawerParts key={item.id} ws={ws}>
              <DrawerBody
                ws={ws}
                item={item}
                requestLeave={requestLeave}
                descriptionRef={descriptionRef}
              />
            </DrawerParts>
          </form>
        )}
      </Drawer>
      {question && (
        <FailedSaveDialog
          failures={question.failures}
          onChoose={question.answer}
          customFieldName={(id) => ws.fields.find((field) => field.id === id)?.name}
        />
      )}
    </>
  )
}

/** The status, as a Select that reads like a StatusBadge. A queued task moves through the queue. */
function StatusSelect({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  // A queued task nobody has started moves out of the queue; a run's status is its own.
  const linked = item.linkedHarnessTaskId !== null && ws.harnessTaskFor(item)?.status !== 'pending'
  return (
    <div className={`task-drawer__status ui-status-badge--${ws.editStatus}`}>
      <Icon icon={STATUS_ICONS[ws.editStatus]} className="task-drawer__status-icon" />
      <Select
        label={t('tasks:workItemDrawer.status')}
        hideLabel
        size="sm"
        value={ws.editColumn}
        disabled={linked}
        title={linked ? t('tasks:workItemDrawer.queuedAgentStatusFollows') : undefined}
        onChange={(event) => ws.setEditColumn(event.target.value)}
        options={ws.statusWords
          .places(ws.editColumn)
          .map((place) => ({ value: place.key, label: place.label }))}
      />
    </div>
  )
}

function TaskMoreMenu({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  const blocker = ws.deletionBlocker(item)
  const [savingTemplate, setSavingTemplate] = useState<'template' | 'playbook' | null>(null)
  const features = useFeatures()
  const pins = usePins()
  const taskIdItems = useTaskIdMenuItems(item)
  const stickyItems = useStickyTaskMenuItems(item)
  return (
    <>
      <Menu
        label={t('tasks:workItemDrawer.taskActions')}
        placement="bottom-end"
        items={[
          // Task templates (N2.1): the task and its subtasks, to make again.
          {
            label: t('tasks:taskTemplates.saveAs'),
            icon: LayoutTemplate,
            disabled: ws.busy,
            onSelect: () => setSavingTemplate('template')
          },
          // Playbooks (N9.6b): a task template for agents, while agents are on.
          ...(features.agents
            ? [
                {
                  label: t('agents:playbooks.saveAs'),
                  icon: Bot,
                  hint: t('agents:playbooks.saveAsHint'),
                  disabled: ws.busy,
                  onSelect: () => setSavingTemplate('playbook')
                }
              ]
            : []),
          // Copy task (N2.4): a new task in Backlog with a link back.
          ...(!item.deletedAt
            ? [
                {
                  label: t('tasks:taskLinks.copy'),
                  icon: Copy,
                  disabled: ws.busy,
                  hint: t('tasks:taskLinks.copyHint'),
                  onSelect: () => void ws.copyWorkItem(item)
                }
              ]
            : []),
          // My day (N1.4): picked for today, with undo in its toast.
          ...(!item.archivedAt && !item.deletedAt
            ? [
                {
                  label: t('views:myDay.add'),
                  icon: ListPlus,
                  hint: t('views:myDay.addHint'),
                  onSelect: () => void ws.addToMyDay(item)
                },
                // Time blocks (N3.4a).
                {
                  label: t('views:timeBlocks.menu'),
                  icon: CalendarClock,
                  hint: t('views:timeBlocks.menuHint'),
                  onSelect: () => ws.setBlockTimeTarget(item)
                }
              ]
            : []),
          // Someday (N1.1a); Bring back is also in the banner above the fields.
          item.someday
            ? {
                label: t('tasks:someday.bringBack'),
                icon: Undo2,
                disabled: ws.busy,
                onSelect: () => void ws.setSomeday([item], false)
              }
            : {
                label: t('tasks:someday.moveTo'),
                icon: Lightbulb,
                disabled: ws.busy,
                hint: t('tasks:someday.moveToHint'),
                onSelect: () => void ws.setSomeday([item], true)
              },
          ...(canCloseAsWontDo(item, ws.projectedStatus(item))
            ? [
                {
                  label: t('tasks:wontDo.menu'),
                  icon: Ban,
                  disabled: ws.busy || ws.wontDoBlocker(item) !== null,
                  hint: ws.wontDoBlocker(item) ?? t('tasks:wontDo.menuHint'),
                  onSelect: () => ws.openWontDo([item])
                }
              ]
            : []),
          // Mark as duplicate (N2.4): Won't do with a link to the original.
          ...(canCloseAsWontDo(item, ws.projectedStatus(item))
            ? [
                {
                  label: t('tasks:taskLinks.markDuplicate'),
                  icon: Link2,
                  disabled: ws.busy || ws.wontDoBlocker(item) !== null,
                  hint: ws.wontDoBlocker(item) ?? t('tasks:taskLinks.markDuplicateHint'),
                  onSelect: () => ws.setDuplicateTarget(item)
                }
              ]
            : []),
          {
            label: t('tasks:workItemDrawer.archive'),
            icon: Archive,
            disabled: ws.busy || blocker !== null,
            hint:
              blocker?.replace('deleted', 'archived') ??
              t('tasks:workItemDrawer.moveTaskProjectArchive'),
            onSelect: () => void ws.archiveWorkItem(item)
          },
          {
            label: t('tasks:workItemDrawer.moveRecycleBin'),
            icon: Trash2,
            tone: 'danger',
            disabled: ws.busy || blocker !== null,
            hint: blocker ?? t('tasks:workItemDrawer.restorable30Days'),
            onSelect: () => void ws.deleteWorkItem(item)
          },
          // Copy ID and Copy branch name (N9.8a), as on the card.
          ...taskIdItems(),
          // Pin to desktop (N5.8b): the task in a small window on top.
          ...stickyItems(),
          // Pins (N5.2a).
          ...(!item.deletedAt
            ? pinEntries(pins, {
                kind: 'task',
                targetId: item.id,
                projectId: item.projectId,
                title: item.title
              })
            : [])
        ]}
      />
      {savingTemplate && (
        <SaveTaskTemplateDialog
          item={item}
          playbook={savingTemplate === 'playbook'}
          onClose={() => setSavingTemplate(null)}
        />
      )}
    </>
  )
}

/**
 * What this task's project usually holds (`partsProjectUses`), worked out once
 * per task opened, so parts don't come and go while the task is edited.
 */
function DrawerParts({ ws, children }: { ws: PlanningWorkspace; children: ReactNode }) {
  const [projectUses] = useState(() => partsProjectUses(ws.workItems))
  return (
    <TaskPartsProvider projectUses={projectUses} items={ws.workItems}>
      {children}
    </TaskPartsProvider>
  )
}

function DrawerFooter({
  item,
  subprojects
}: {
  item: PlanningWorkItem
  subprojects: readonly PlanningSubproject[]
}) {
  const id = useTaskId(item)
  const copy = useCopyTaskText()
  const project = useProjectList().find((candidate) => candidate.id === item.projectId)
  const subproject = item.subprojectId
    ? subprojects.find((candidate) => candidate.id === item.subprojectId)
    : undefined
  return (
    <div className="task-drawer__footer">
      <div className="task-drawer__stamps">
        {project && subproject && (
          <div className="task-drawer__place">
            <Link to={subprojectPath(project.id, subproject.id)}>
              {projectAndSubprojectName(project.name, subproject.name)}
            </Link>
          </div>
        )}
        <span className="task-drawer__stamp-line">
          {id && (
            <>
              <span className="tabular-nums">{taskIdLabel(id)}</span>
              <IconButton
                icon={Copy}
                size="sm"
                label={t('tasks:taskId.copyId')}
                onClick={() => void copy(id)}
              />
              <span aria-hidden="true">·</span>
            </>
          )}
          {item.updatedAt && item.updatedAt !== item.createdAt
            ? t('tasks:workItemDrawer.createdUpdated', {
                created: stampDate(item.createdAt),
                updated: stampDate(item.updatedAt)
              })
            : t('tasks:workItemDrawer.created', { date: stampDate(item.createdAt) })}
        </span>
      </div>
    </div>
  )
}

function DrawerBody({
  ws,
  item,
  requestLeave,
  descriptionRef
}: {
  ws: PlanningWorkspace
  item: PlanningWorkItem
  requestLeave: (then?: () => void) => Promise<void>
  /** The description, where a pasted picture is also shown. */
  descriptionRef: RefObject<HTMLTextAreaElement | null>
}) {
  // Agent and AI controls appear only while their feature is on (D10, D11).
  const { pickFiles } = useAttachFiles(item.projectId, item.id)
  const features = useFeatures()
  const project = useProjectList().find((candidate) => candidate.id === item.projectId)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const writingHelp = useWritingHelp({
    projectId: item.projectId,
    target: { kind: 'task', workItemId: item.id },
    value: ws.editDescription,
    onChange: ws.setEditDescription,
    textRef: descriptionRef
  })
  const descriptionLinks = useItemLinkPicker({
    projectId: item.projectId,
    value: ws.editDescription,
    onChange: ws.setEditDescription,
    textRef: descriptionRef
  })
  const knownLabels = useMemo(
    () => [...new Set(ws.workItems.flatMap((candidate) => candidate.labels))].sort(),
    [ws.workItems]
  )
  const usualLabels = useMemo(() => frequentLabels(ws.workItems), [ws.workItems])
  const openTask = (target: PlanningWorkItem) => void requestLeave(() => ws.openWorkItem(target))
  const linkedDecisions = ws.decisions.filter((decision) =>
    decision.linkedWorkItemIds.includes(item.id)
  )
  const role = useMyShareRole(item.projectId)
  const myPersonId = usePeople().me?.id ?? null
  const rights = capabilitiesOf(role)
  // The database refuses the rest; this just stops people starting an edit it would refuse.
  const readOnly =
    !rights.editAnyTask && !(rights.editOwnTasks && !!myPersonId && item.assigneeId === myPersonId)
  return (
    <>
      <ReminderNudgeBar item={item} onDone={() => ws.setEditStatus('done')} />
      {ws.error && <InlineAlert tone="danger">{ws.error}</InlineAlert>}
      {ws.saveFailures.length > 0 && (
        <InlineAlert tone="danger">
          {ws.saveFailures.map((failure) => (
            <p key={failure.field}>
              {t('tasks:workItemDrawer.couldntSaveField', {
                field: drawerFieldName(
                  failure.field,
                  (id) => ws.fields.find((field) => field.id === id)?.name
                ),
                message: failure.message
              })}
            </p>
          ))}
          <Button size="sm" variant="secondary" onClick={ws.retrySaves}>
            {t('tasks:workItemDrawer.retry')}
          </Button>
        </InlineAlert>
      )}
      {item.resolution === 'wont-do' && (
        <InlineAlert
          tone="info"
          title={t('tasks:wontDo.mark')}
          action={{ label: t('tasks:wontDo.reopen'), onClick: () => void ws.reopenWorkItem(item) }}
        >
          {item.resolutionReason || t('tasks:wontDo.noReason')}
        </InlineAlert>
      )}
      {item.someday && (
        <InlineAlert
          tone="info"
          title={t('tasks:someday.badge')}
          action={{
            label: t('tasks:someday.bringBack'),
            onClick: () => void ws.setSomeday([item], false)
          }}
        >
          {t('tasks:someday.inSomeday')}
        </InlineAlert>
      )}
      {item.inTriage && features.ai && (
        <TriageDrawerSuggestions item={item} workItems={ws.workItems} openWorkItem={openTask} />
      )}
      <ImprovementDraft ws={ws} item={item} />

      {/*
       * Every task shows who, how urgent and when it is due. The rest shows
       * when the task holds it or its project usually does (task-parts.ts);
       * "Add to this task" offers everything else. A wide drawer shows them
       * in a column beside the task's content (WorkItemDrawer.css).
       */}
      {readOnly && <InlineAlert tone="info">{t('tasks:workItemDrawer.readOnlyTask')}</InlineAlert>}
      <fieldset className="task-drawer__properties task-drawer__lock" disabled={readOnly}>
        <div className="task-drawer__fields">
          <AssigneeField
            className="task-drawer__field-wide"
            projectId={item.projectId}
            value={ws.editAssigneeId}
            onChange={ws.setEditAssigneeId}
          />
          <Select
            label={t('tasks:workItemDrawer.priority')}
            size="sm"
            value={ws.editPriority}
            error={saveErrorOf(ws, 'priority')}
            onChange={(event) => ws.setEditPriority(event.target.value as PlanningPriority)}
            options={PRIORITY_OPTIONS}
          />
          <TaskDueDateField
            value={ws.editTargetDate}
            assigneeId={ws.editAssigneeId}
            startDate={ws.editStartDate}
            done={ws.editStatus === 'done'}
            onChange={ws.setEditTargetDate}
            saveError={saveErrorOf(ws, 'targetDate')}
            onFocus={() => ws.beginEdit('targetDate')}
            onBlur={() => ws.endEdit('targetDate')}
          />
          <TaskPart part="startDate" inUse={!!ws.editStartDate}>
            <TaskStartDateField
              value={ws.editStartDate}
              assigneeId={ws.editAssigneeId}
              onChange={ws.setEditStartDate}
              saveError={saveErrorOf(ws, 'startDate')}
              onFocus={() => ws.beginEdit('startDate')}
              onBlur={() => ws.endEdit('startDate')}
            />
          </TaskPart>
          {ws.taskTypes.length > 0 && (
            <TaskPart part="type" inUse={!!ws.editTypeId}>
              <TaskTypeField
                size="sm"
                types={ws.taskTypes}
                value={ws.editTypeId}
                error={saveErrorOf(ws, 'typeId')}
                onChange={ws.setEditTypeId}
              />
            </TaskPart>
          )}
          {(ws.milestones.length > 0 || !!ws.editMilestoneId) && (
            <TaskPart part="milestone" inUse={!!ws.editMilestoneId}>
              <Select
                label={t('tasks:workItemDrawer.milestone')}
                size="sm"
                value={ws.editMilestoneId}
                error={saveErrorOf(ws, 'milestoneId')}
                onChange={(event) => ws.setEditMilestoneId(event.target.value)}
                options={[
                  { value: '', label: t('tasks:workItemDrawer.noMilestone') },
                  ...ws.milestones.map((milestone) => ({
                    value: milestone.id,
                    label: milestone.name
                  }))
                ]}
              />
            </TaskPart>
          )}
          <SubprojectField
            subprojects={ws.subprojects}
            value={ws.editSubprojectId}
            error={saveErrorOf(ws, 'subprojectId')}
            onChange={ws.setEditSubprojectId}
          />
          {(ws.iterations.length > 0 || !!ws.editIterationId) && (
            <TaskPart part="iteration" inUse={!!ws.editIterationId}>
              <IterationField
                size="sm"
                iterations={ws.iterations}
                value={ws.editIterationId}
                error={saveErrorOf(ws, 'iterationId')}
                onChange={ws.setEditIterationId}
              />
            </TaskPart>
          )}
          <TaskPart part="estimate" inUse={ws.editEstimate !== null}>
            <TaskEstimateField
              projectId={item.projectId}
              value={ws.editEstimate}
              onChange={ws.setEditEstimate}
              saveError={saveErrorOf(ws, 'estimate')}
              onFocus={() => ws.beginEdit('estimate')}
              onBlur={() => ws.endEdit('estimate')}
            />
          </TaskPart>
          <TaskPart part="showFrom" inUse={!!ws.editShowFrom}>
            <TaskShowFromField
              value={ws.editShowFrom}
              onChange={ws.setEditShowFrom}
              saveError={saveErrorOf(ws, 'showFrom')}
              onFocus={() => ws.beginEdit('showFrom')}
              onBlur={() => ws.endEdit('showFrom')}
            />
          </TaskPart>
          <TaskPart part="scores" inUse={item.impact != null || item.effort != null}>
            <TaskScoreFields
              item={item}
              onSave={(patch) => void ws.updateWorkItemInline(item, patch)}
            />
          </TaskPart>
          <TaskTimeBlocks item={item} onBlockTime={() => ws.setBlockTimeTarget(item)} />
          <TaskPart part="labels" inUse={ws.editLabels.length > 0}>
            <div className="task-drawer__field-wide">
              <TaskLabelsField
                labels={ws.editLabels}
                known={knownLabels}
                frequent={usualLabels}
                onChange={ws.setEditLabels}
                colorOf={ws.labelColor}
              />
            </div>
          </TaskPart>
          {item.parentWorkItemId && <PhaseFields ws={ws} item={item} />}
        </div>

        <TaskPartsBar />

        <TaskCustomFieldsSection ws={ws} />
      </fieldset>

      <div className="task-drawer__main">
        <fieldset className="task-drawer__lock" disabled={readOnly}>
          <TaskBlockedReason ws={ws} item={item} />
          <TaskDrawerSection
            title={t('tasks:workItemDrawer.description')}
            actions={
              <>
                {features.ai && (
                  <Button
                    size="sm"
                    variant="ai"
                    icon={Sparkles}
                    loading={ws.aiImproveBusy}
                    title={t('tasks:workItemDrawer.draftClearerScopeChecklist')}
                    onClick={() => void ws.improveWorkItem()}
                  >
                    {ws.aiImproveBusy
                      ? t('tasks:workItemDrawer.improving')
                      : t('tasks:workItemDrawer.improveScope')}
                  </Button>
                )}
                {mode === 'write' && writingHelp.button}
                <IconButton
                  size="sm"
                  icon={Paperclip}
                  label={t('tasks:attachFiles.attachFiles')}
                  onClick={() => void pickFiles()}
                />
                <DescriptionHistory
                  workItemId={item.id}
                  current={ws.editDescription}
                  updatedAt={item.updatedAt}
                  onRestore={ws.restoreDescriptionVersion}
                />
                <SegmentedControl
                  label={t('tasks:workItemDrawer.descriptionView')}
                  size="sm"
                  value={mode}
                  onChange={(next) => {
                    // Leaving the editor saves what was typed in it.
                    if (next !== mode) ws.endEdit('description')
                    setMode(next)
                  }}
                  options={[
                    { value: 'write', label: t('tasks:workItemDrawer.write') },
                    { value: 'preview', label: t('tasks:workItemDrawer.preview') }
                  ]}
                />
              </>
            }
          >
            {mode === 'write' ? (
              <WritingHelpLayout suggestion={writingHelp.suggestion}>
                <TextArea
                  ref={descriptionRef}
                  label={t('tasks:workItemDrawer.description')}
                  hideLabel
                  autoGrow
                  maxRows={20}
                  rows={4}
                  placeholder={t('tasks:workItemDrawer.whatTaskWhatDone')}
                  value={ws.editDescription}
                  error={saveErrorOf(ws, 'description')}
                  onFocus={() => ws.beginEdit('description')}
                  onBlur={() => ws.endEdit('description')}
                  onChange={(event) => ws.setEditDescription(event.target.value)}
                  {...descriptionLinks.inputProps}
                />
                {descriptionLinks.picker}
                <DescriptionPictures projectId={item.projectId} description={ws.editDescription} />
              </WritingHelpLayout>
            ) : (
              <div className="task-drawer__markdown">
                {ws.editDescription.trim() ? (
                  <Markdown refreshKey={ws.workItems} projectId={item.projectId}>
                    {ws.editDescription}
                  </Markdown>
                ) : (
                  <p className="task-drawer__muted">{t('tasks:workItemDrawer.noDescriptionYet')}</p>
                )}
              </div>
            )}
          </TaskDrawerSection>

          <TaskDrawerSection title={t('tasks:workItemDrawer.checklist')}>
            <TaskChecklistEditor
              items={ws.editCriteria}
              onChange={ws.setEditCriteria}
              saved={item.acceptanceCriteria}
              checked={item.checkedCriteria}
              onCheck={(text, checked) => void ws.setChecklistItemChecked(text, checked)}
              details={item.checklistDetails}
              onDetails={(text, input) => void ws.setChecklistItemDetails(text, input)}
              projectId={item.projectId}
              onTextFocus={() => ws.beginEdit('acceptanceCriteria')}
              onTextBlur={() => ws.endEdit('acceptanceCriteria')}
            />
          </TaskDrawerSection>

          <TaskSubtasksSection ws={ws} item={item} openTask={openTask} />

          <TaskDrawerSection
            title={t('tasks:workItemDrawer.dependencies')}
            part={{ id: 'waitsOn', inUse: item.dependencyIds.length > 0 }}
            description={
              item.parentWorkItemId
                ? t('tasks:workItemDrawer.tasksPhaseMustDone')
                : t('tasks:workItemDrawer.tasksMustDoneBefore')
            }
          >
            <TaskDependencies ws={ws} item={item} openTask={openTask} />
          </TaskDrawerSection>

          <TaskLinksSection ws={ws} item={item} openTask={openTask} />
        </fieldset>

        <TaskDrawerSection title={t('tasks:signOff.heading')}>
          <SignOffSection projectId={item.projectId} item={{ kind: 'task', id: item.id }} />
        </TaskDrawerSection>

        <LinkedFrom
          kind="task"
          id={item.id}
          refreshKey={ws.workItems}
          className="task-drawer__section"
        />

        <TaskRepeatSection
          item={item}
          canGoToAgents={features.agents && !!project && projectFolder(project) !== null}
        />

        <TaskTimeSection item={item} />

        <TaskCostsSection item={item} milestones={ws.milestones} />

        <TaskContactsSection item={item} />

        <TaskGithubSection key={item.id} item={item} />

        <TaskCommitsSection item={item} />

        <TaskDrawerSection
          title={t('tasks:workItemDrawer.decisions')}
          part={{
            id: 'decisions',
            inUse: linkedDecisions.length > 0,
            start: ws.busy ? undefined : () => ws.openDecisionCreate(item.id)
          }}
          actions={
            <>
              {features.ai && (
                <Button
                  size="sm"
                  variant="ai"
                  icon={Sparkles}
                  disabled={ws.busy}
                  onClick={() => void ws.draftAIDecision(item.id)}
                >
                  {t('tasks:workItemDrawer.draftAi')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={Plus}
                disabled={ws.busy}
                onClick={() => ws.openDecisionCreate(item.id)}
              >
                {t('tasks:workItemDrawer.record')}
              </Button>
            </>
          }
        >
          {linkedDecisions.length > 0 ? (
            <ul className="task-library-list">
              {linkedDecisions.map((decision) => (
                <li key={decision.id} className="task-library-list__row">
                  <button
                    type="button"
                    className="task-library-list__open"
                    title={t('tasks:workItemDrawer.openDecision')}
                    onClick={() =>
                      void requestLeave(() => {
                        ws.setWorkspaceView('decisions')
                        ws.openDecisionEdit(decision)
                      })
                    }
                  >
                    <span className="task-library-list__kind">{decision.date}</span>
                    <span className="task-library-list__title">{decision.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="task-drawer__muted">{t('tasks:workItemDrawer.noDecisionsLinkedTask')}</p>
          )}
        </TaskDrawerSection>

        <WorkItemSourcesSection ws={ws} workItem={item} requestLeave={requestLeave} />
        {features.agents ? (
          <WorkItemAttachmentsSection workItem={item} />
        ) : (
          <WorkItemAttachedFilesSection workItem={item} />
        )}
        {features.agents && <TaskAgentRunSection ws={ws} item={item} />}
        {features.agents && <TaskVerificationSection ws={ws} item={item} />}
        <TaskActivitySection item={item} />
      </div>
    </>
  )
}

/** A subtask's phase: which one it is in, and the phase's name. */
function PhaseFields({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  const parentId = item.parentWorkItemId as string
  const phases = subtaskPhasesOf(ws.workItems, parentId)
  const nextPhaseNumber =
    phases.length > 0 ? Math.max(...phases.map((phase) => phase.number)) + 1 : 1
  const siblingCount = ws.workItems.filter(
    (candidate) =>
      candidate.parentWorkItemId === parentId &&
      candidate.subtaskPhaseNumber === ws.editSubtaskPhaseNumber &&
      candidate.id !== item.id
  ).length
  const phaseError = saveErrorOf(ws, 'subtaskPhase')
  return (
    <>
      <Select
        label={t('tasks:workItemDrawer.phase')}
        size="sm"
        value={String(ws.editSubtaskPhaseNumber ?? '')}
        error={phaseError}
        onChange={(event) => {
          const number = Number(event.target.value)
          const phase = phases.find((candidate) => candidate.number === number)
          ws.setEditSubtaskPhase(number, phase?.name ?? '')
        }}
        options={[
          ...phases.map((phase) => ({
            value: String(phase.number),
            label: phaseLabel(phase)
          })),
          ...(phases.some((phase) => phase.number === ws.editSubtaskPhaseNumber)
            ? []
            : [
                {
                  value: String(nextPhaseNumber),
                  label: t('tasks:workItemDrawer.phaseNew', { nextPhaseNumber })
                }
              ])
        ]}
      />
      <TextField
        label={t('tasks:workItemDrawer.phaseName')}
        value={ws.editSubtaskPhaseName}
        disabled={siblingCount > 0}
        error={phaseError}
        hint={siblingCount > 0 ? t('tasks:workItemDrawer.sharedOtherTasksPhase') : undefined}
        placeholder={t('tasks:workItemDrawer.exampleBackend')}
        onFocus={() => ws.beginEdit('subtaskPhase')}
        onBlur={() => ws.endEdit('subtaskPhase')}
        onChange={(event) => ws.setEditSubtaskPhaseName(event.target.value)}
      />
    </>
  )
}

/** An AI re-draft of this task, to apply to the editor or dismiss. */
function ImprovementDraft({ ws, item }: { ws: PlanningWorkspace; item: PlanningWorkItem }) {
  const draft = ws.aiWorkItemDraft
  // The draft's proposed attachments the person left ticked, per draft.
  const [picked, setPicked] = useState<{ key: string; ids: string[] } | null>(null)
  if (!draft) return null
  const attachments = picked?.key === draft.generatedAt ? picked.ids : (draft.attachments ?? [])
  return (
    <section
      className="task-drawer__panel task-drawer__draft"
      aria-label={t('tasks:workItemDrawer.aiImprovementDraft')}
    >
      <div className="task-drawer__draft-head">
        <div>
          <p className="task-drawer__muted">{t('tasks:workItemDrawer.reviewBeforeApplying')}</p>
          <h3>{draft.title}</h3>
        </div>
        <PriorityIcon priority={draft.priority} showLabel />
      </div>
      <p className="task-drawer__text">{draft.description}</p>
      {draft.acceptanceCriteria.length > 0 && (
        <ul className="task-drawer__bullets">
          {draft.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      )}
      <p className="task-drawer__muted">{draft.rationale}</p>
      {[...draft.assumptions, ...draft.warnings].map((caveat) => (
        <p key={caveat} className="task-drawer__muted">
          {caveat}
        </p>
      ))}
      <ProposedAttachments
        projectId={item.projectId}
        proposed={draft.attachments}
        selected={attachments}
        onChange={(ids) => setPicked({ key: draft.generatedAt, ids })}
      />
      <div className="task-drawer__row-actions">
        <Button size="sm" variant="ghost" onClick={() => ws.setAiWorkItemDraft(null)}>
          {t('tasks:workItemDrawer.dismiss')}
        </Button>
        {/* Applying saves the draft's fields and its ticked attachments (recorded as Ostler AI's) at once. */}
        <Button
          size="sm"
          variant="primary"
          onClick={() => ws.applyWorkItemImprovement(attachments)}
        >
          {t('tasks:workItemDrawer.applyEditor')}
        </Button>
      </div>
    </section>
  )
}
