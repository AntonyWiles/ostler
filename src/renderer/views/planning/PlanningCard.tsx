import {
  memo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import type { AgentPill } from '@shared/planning/queue'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../navigation/features'
import { formatTimeInColumn, isAgedInColumn } from './card-aging'
import { cardDateRangeTitle, cardDue } from './card-due'
import { usePeople } from '../../context/PeopleContext'
import { signOffBadgeOf, useProjectSignOffs } from '../../hooks/useSignOffs'
import { SignOffBadge } from './SignOffBadge'
import { useProjectEstimateUnit } from '../../context/OstlerContext'
import { PersonAvatar } from './AssigneeField'
import { taskMenuItems } from './task-menu'
import { taskAccessibleName, useTaskId, useTaskIdMenuItems } from './task-id'
import { useStickyTaskMenuItems } from '../../shell/sticky-task'
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  ContextMenu,
  IconButton,
  Menu,
  PriorityIcon,
  VisuallyHidden,
  type BadgeTone
} from '../../ui'
import {
  Ban,
  BookUser,
  CalendarDays,
  CalendarX2,
  Clock,
  Ellipsis,
  FileDiff,
  Icon,
  Link2,
  ListChecks,
  MessageSquare,
  ListTree,
  Paperclip,
  Timer,
  Undo2
} from '../../ui/icons'
import { useTimer } from '../../time/TimerProvider'
import { useFocus } from '../../time/FocusProvider'
import { timeAgainstEstimate } from '@shared/time/estimate'
import { cardPropsEqual } from './card-memo'
import { SubprojectChip } from './subproject-ui'
import { CardGithubLinks } from '../../github/CardGithubLinks'
import { TaskTypeIcon } from '../../task-types/TaskTypeIcon'
import { fieldValueText, hasFieldValue } from '@shared/planning/custom-fields'
import './PlanningCard.css'
import { t } from '@shared/i18n'
import { hiddenReason } from '@shared/planning/show-from'
import { checklistDateLabel, nextDatedChecklistItem } from '@shared/planning/checklist-details'
import { formatIsoDateShort, todayIsoDate } from '@shared/dates'
import { formatDateTime, formatList } from '@shared/format'
import { pinEntries, usePins } from '../../pins/PinsProvider'
import { TitleEditor } from './inline-editors'

const PILLS: Record<AgentPill, { word: string; tone: BadgeTone }> = {
  queued: {
    get word() {
      return t('tasks:planningCard.queued')
    },
    tone: 'neutral'
  },
  running: {
    get word() {
      return t('tasks:planningCard.running')
    },
    tone: 'info'
  },
  review: {
    get word() {
      return t('tasks:planningCard.needsReview')
    },
    tone: 'warning'
  }
}

const MAX_LABELS = 3

/** Clicks on these belong to them, not to the card's "open". */
const INTERACTIVE =
  'button, a, input, select, textarea, label, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

/**
 * A task on the Board: a two-line title, one
 * meta row, up to three labels and, while agents are on, an agent pill.
 * Nothing appears over it on hover, so the title stays readable: a card shows
 * at most one button, the contextual one when a human decision is waiting.
 * Everything else is in the right-click menu, and in the More button the
 * keyboard reaches. Its ID is in its name and its menu, not on the card.
 *
 * The whole card is the drag handle and one click opens it in the drawer;
 * fields are edited there or in the List, not on the card. Ctrl and a click
 * selects it, and the selection boxes show only while something is selected
 * or the Board's toolbar asks for them (`showBoxes`). E or F2 still renames
 * it in place from the keyboard.
 *
 * Cards render in their hundreds: no IPC and nothing heavy in here.
 */
export function PlanningCard({
  item,
  ws,
  selected = false,
  selecting = false,
  showBoxes = false,
  focused,
  dragging = false,
  subtaskCount = 0,
  onToggle
}: {
  item: PlanningWorkItem
  ws: PlanningWorkspace
  selected?: boolean
  /** This card is the one being dragged. */
  dragging?: boolean
  /** Something on the board is selected, so every card shows its box. */
  selecting?: boolean
  /** The Board's toolbar shows the selection boxes even with nothing selected. */
  showBoxes?: boolean
  /** The board's keyboard cursor is on this card. */
  focused?: boolean
  subtaskCount?: number
  onToggle?: (checked: boolean) => void
}) {
  // Agent and AI controls appear only while their feature is on (D10, D11).
  const features = useFeatures()
  const status = ws.projectedStatus(item)
  const changedAt = ws.lastStatusChangeAt.get(item.id) ?? item.createdAt
  // Shown only when the Board shows hidden tasks (N1.1a): greyed, and said in words.
  const hidden = hiddenReason(item, todayIsoDate())
  const now = Date.now()
  const aged = isAgedInColumn(changedAt, now)
  const unmet = ws.unmetDependencies(item)
  const blockerCount = ws.openBlockersByWorkItem.get(item.id) ?? 0
  // A scoped view holds one workstream, so the chip would say the same on every card.
  const showSubproject =
    !ws.subprojectScope &&
    !!item.subprojectId &&
    !!ws.subprojects?.some((s) => s.id === item.subprojectId)
  const taskType = item.typeId ? ws.taskTypeById.get(item.typeId) : undefined
  const sourceChanged = ws.changedSourceWorkItemIds.has(item.id)
  const attachedCount = ws.attachmentCounts[item.id] ?? 0
  const commentCount = ws.commentCounts?.[item.id] ?? 0
  // The task names contacts (N6.5): a small mark, the names are in the drawer.
  const contactCount = new Set((ws.taskContacts?.[item.id] ?? []).map((link) => link.contactId))
    .size
  // Time logged (R2.3): against the estimate in an hours project, alone in a points one.
  const estimateUnit = useProjectEstimateUnit(item.projectId)
  const timer = useTimer()
  const focusApi = useFocus()
  const timing = timer.running?.workItemId === item.id
  const time = timeAgainstEstimate(ws.timeTotals?.[item.id] ?? 0, item.estimate, estimateUnit)
  const due = item.targetDate ? cardDue(item.targetDate, status === 'done') : null
  const rangeTitle = cardDateRangeTitle(item.startDate, item.targetDate, status === 'done')
  const people = usePeople()
  const signOff = signOffBadgeOf(useProjectSignOffs(item.projectId), item.id) !== null
  // The custom fields the person chose for cards, in their order, that this task has (R2.2).
  const cardFields = ws.boardCardFields.flatMap((fieldId) => {
    const field = ws.fields.find((candidate) => candidate.id === fieldId)
    if (!field || !hasFieldValue(item.fieldValues, fieldId)) return []
    const text = fieldValueText(field, item.fieldValues?.[fieldId])
    return text ? [{ field, text }] : []
  })
  const assignee = item.assigneeId ? people.byId.get(item.assigneeId) : undefined
  const checklistTotal = item.acceptanceCriteria.length
  // The next dated checklist item, when it comes before the task's own due date (N2.2).
  const nextItem = nextDatedChecklistItem(item)
  const checklistDone = item.checkedCriteria.length
  // Built when a menu opens, not for each of hundreds of cards on every render (P9.1).
  const pins = usePins()
  // The task's ID (N9.8a): in the card's name, and Copy ID in its menus.
  const taskId = useTaskId(item)
  const taskIdItems = useTaskIdMenuItems(item)
  // Pin to desktop (N5.8b).
  const stickyItems = useStickyTaskMenuItems(item)
  const menuItems = () => [
    ...taskMenuItems(item, ws, features, timer, focusApi),
    ...taskIdItems(),
    ...stickyItems(),
    ...pinEntries(pins, {
      kind: 'task',
      targetId: item.id,
      projectId: item.projectId,
      title: item.title
    })
  ]

  // Agent facts, read only while agents are on.
  const pill = features.agents ? ws.agentPillOf(item) : null
  const agentSession = features.agents ? ws.sessionForWorkItem(item) : null
  const reviewSession = features.agents ? ws.reviewSessionForItem(item) : null
  const rejections = features.agents ? (ws.harnessTaskFor(item)?.rejections ?? []) : []
  const queuePosition = pill === 'queued' ? ws.queuePositionOf(item) : -1
  const queueWait = pill === 'queued' ? ws.queueWaitOf(item) : 0
  const held = features.agents && status === 'blocked' && item.linkedHarnessTaskId !== null

  // Keep the keyboard cursor on screen: columns scroll independently, so a
  // card reached with j/k can otherwise land below the fold. Focus follows
  // the cursor, so a screen reader says the card and a closed drawer gives
  // focus back to it (P9.2), unless focus is in a field or an open dialog.
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const card = cardRef.current
    if (!focused || !card) return
    card.scrollIntoView({ block: 'nearest' })
    if (shouldFollowCursor(document.activeElement)) card.focus({ preventScroll: true })
    // Again after Alt and an arrow key moved it (D31): moving a node loses its focus.
  }, [focused, item.orderKey])

  const contextual = features.agents ? contextualAction() : null

  const [renaming, setRenaming] = useState(false)
  const editable = !item.archivedAt && !item.deletedAt
  // A queued-but-unclaimed card can still be dragged: dropping it on
  // Blocked holds its queue entry and dragging it back releases it. Once
  // an agent has it, or it is finished, the move is no longer the
  // board's to make.
  const canDrag =
    !renaming &&
    !ws.busy &&
    (!item.linkedHarnessTaskId || status === 'ready' || status === 'blocked')
  const boxShown = Boolean(onToggle) && (showBoxes || selecting || selected)

  /**
   * The one button a card may show at rest: a decision only a person can
   * make. A card in review is that decision, and anything depending on it
   * waits until it is made; so is an agent that asked a question.
   */
  function contextualAction() {
    if (reviewSession) {
      const waiting = ws.dependentsWaitingOn(item)
      return {
        note:
          waiting.length > 0
            ? t('tasks:planningCard.finishedDecisionReleasesWaiting', { count: waiting.length })
            : t('tasks:planningCard.finishedWaitingAcceptDiscard'),
        label: t('tasks:planningCard.reviewChanges'),
        title:
          waiting.length > 0
            ? t('tasks:planningCard.acceptDiscardWaitingOnIt', {
                tasks: formatList(waiting.map((task) => task.title))
              })
            : t('tasks:planningCard.acceptDiscardChangesFinished'),
        run: () => ws.setReviewSessionId(reviewSession.id)
      }
    }
    if (agentSession?.blocked) {
      return {
        note: t('tasks:planningCard.agentAskedQuestion'),
        label: t('tasks:planningCard.seeWhatNeeds'),
        title: t('tasks:planningCard.openAgentRunSee'),
        run: () => ws.setTranscriptSessionId(agentSession.id)
      }
    }
    const inReview = ws.unmetDependenciesInReview(item)
    if (inReview.length > 0) {
      const first = inReview[0]
      return {
        note:
          inReview.length > 1
            ? t('tasks:planningCard.waitingOnReviewAndMore', {
                title: first.title,
                count: inReview.length - 1
              })
            : t('tasks:planningCard.waitingOnReview', { title: first.title }),
        label: t('tasks:planningCard.reviewChanges'),
        title: t('tasks:planningCard.finishedWaitingAcceptDiscard2', { firstTitle: first.title }),
        run: () => {
          const session = ws.reviewSessionForItem(first)
          if (session) ws.setReviewSessionId(session.id)
          else ws.openWorkItem(first)
        }
      }
    }
    return null
  }

  const pillTitle = (() => {
    if (!pill) return undefined
    const parts = [ws.executionLabel(item) ?? PILLS[pill].word]
    if (held) parts.push(t('tasks:planningCard.dragBackReadyRelease'))
    if (queueWait > 0) parts.push(t('tasks:planningCard.startsOwnOnceTasks', { count: queueWait }))
    if (queuePosition === 0) parts.push(t('tasks:planningCard.nextQueue'))
    if (queuePosition > 0) parts.push(t('tasks:planningCard.aheadQueue', { queuePosition }))
    if (agentSession && !agentSession.blocked) parts.push(t('tasks:planningCard.openMenuWatchRun'))
    return parts.join(' ')
  })()

  const openFromCard = (event: MouseEvent<HTMLElement>) => {
    // A click in an editor's pop-up reaches here through React, not the page.
    if (!event.currentTarget.contains(event.target as Node)) return
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return
    // Ctrl and a click adds the card to the selection, or takes it out.
    if (onToggle && (event.ctrlKey || event.metaKey)) {
      onToggle(!selected)
      return
    }
    ws.openWorkItem(item)
  }

  // The whole card is the drag source. A drag that starts on something
  // inside it (a link's own drag) is not the card's.
  const onDragStart = (event: DragEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    ws.setDraggingWorkItemId(item.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }

  const stopRenaming = () => {
    setRenaming(false)
    cardRef.current?.focus({ preventScroll: true })
  }

  // E or F2 on the card renames it in place, as in the List.
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !editable) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    if (event.key === 'F2' || event.key.toLowerCase() === 'e') {
      event.preventDefault()
      setRenaming(true)
    }
  }

  /** A fact on the card, named on hover. */
  const chip = (className: string, title: string, body: ReactNode) => (
    <span className={className} title={title}>
      {body}
    </span>
  )

  const className = [
    'task-card',
    'ostler-planning-card',
    canDrag && 'is-draggable',
    dragging && 'is-dragging',
    focused && 'ostler-planning-card--focused is-cursor',
    selected && 'is-selected',
    boxShown && 'is-selecting',
    hidden && 'is-hidden-now'
  ]
    .filter(Boolean)
    .join(' ')

  const age = formatTimeInColumn(changedAt, now)
  const ageTitle =
    age === 'now'
      ? t('tasks:planningCard.inColumnSinceNow', { changed: formatDateTime(changedAt) })
      : t('tasks:planningCard.inColumnFor', { age, changed: formatDateTime(changedAt) })

  return (
    <ContextMenu
      label={t('tasks:planningCard.actions', { itemTitle: item.title })}
      items={menuItems}
    >
      <article
        ref={cardRef}
        className={className}
        aria-label={taskAccessibleName(item.title, taskId)}
        // Focusable for the j/k cursor, not a Tab stop of its own: Tab
        // reaches its buttons.
        tabIndex={-1}
        draggable={canDrag || undefined}
        data-status={status}
        data-work-item-id={item.id}
        // Slides to its new place when the board reorders (useReorderMotion).
        data-motion-key={item.id}
        onClick={openFromCard}
        onKeyDown={onCardKeyDown}
        onDragStart={onDragStart}
        onDragEnd={() => {
          ws.setDraggingWorkItemId(null)
          ws.setDragOverStatus(null)
          ws.setDragOverLaneId(null)
        }}
      >
        {/* The keyboard moves a card with Shift or Alt and the arrow keys. */}
        <div className="task-card__top">
          {onToggle && boxShown && (
            <Checkbox
              label={null}
              aria-label={t('tasks:planningCard.select', { itemTitle: item.title })}
              className="task-card__select"
              checked={selected}
              onChange={(event) => onToggle(event.target.checked)}
            />
          )}
          {renaming ? (
            <TitleEditor
              initial={item.title}
              className="task-card__title-editor"
              onCancel={stopRenaming}
              onSave={(title) => {
                stopRenaming()
                void ws.updateWorkItemInline(item, { title })
              }}
            />
          ) : (
            <h3 className="task-card__title" title={item.title}>
              {item.title}
            </h3>
          )}
          <div className="task-card__actions">
            <Menu
              label={t('tasks:planningCard.moreActions', { itemTitle: item.title })}
              items={menuItems}
              placement="bottom-end"
              renderTrigger={(trigger) => (
                <IconButton
                  {...trigger}
                  label={t('tasks:planningCard.moreActions', { itemTitle: item.title })}
                  icon={Ellipsis}
                  size="sm"
                />
              )}
            />
          </div>
        </div>

        <div className="task-card__meta">
          {hidden && (
            <Badge className="task-card__hidden">
              {hidden.kind === 'triage'
                ? t('tasks:triage.badge')
                : hidden.kind === 'someday'
                  ? t('tasks:someday.badge')
                  : t('tasks:someday.fromDate', { date: formatIsoDateShort(hidden.showFrom) })}
            </Badge>
          )}
          {taskType && <TaskTypeIcon type={taskType} />}
          {item.priority !== 'medium' &&
            chip(
              'task-card__priority',
              t('views:listCells.priority2', { itemTitle: item.title }),
              <PriorityIcon priority={item.priority} />
            )}
          {due &&
            chip(
              `task-card__due is-${due.tone}`,
              rangeTitle ?? due.title,
              <>
                {/* Overdue has its own icon, not only its colour (P9.2, WCAG 1.4.1). */}
                <Icon icon={due.tone === 'overdue' ? CalendarX2 : CalendarDays} />
                {due.text}
                {due.tone === 'overdue' && (
                  <VisuallyHidden> {t('tasks:planningCard.overdue')}</VisuallyHidden>
                )}
              </>
            )}
          {!due && rangeTitle && (
            <span title={rangeTitle}>
              <Icon icon={CalendarDays} label={rangeTitle} />
            </span>
          )}
          {assignee &&
            chip(
              'task-card__assignee',
              t('tasks:planningCard.assigned', { assigneeName: assignee.name }),
              <PersonAvatar person={assignee} />
            )}
          {checklistTotal > 0 &&
            chip(
              `task-card__checklist${checklistDone === checklistTotal ? ' is-complete' : ''}`,
              t('tasks:planningCard.checklistDone', { checklistDone, checklistTotal }),
              <>
                <Icon icon={ListChecks} />
                {checklistDone}/{checklistTotal}
                <VisuallyHidden> {t('tasks:planningCard.checklistItemsDone')}</VisuallyHidden>
              </>
            )}
          {nextItem && (
            <span className="task-card__next-item">
              {t('tasks:planningCard.nextItem', {
                text: nextItem.text,
                date: checklistDateLabel(nextItem.dueDate)
              })}
            </span>
          )}
          {commentCount > 0 && (
            <span title={t('tasks:planningCard.comments', { count: commentCount })}>
              <Icon icon={MessageSquare} />
              {commentCount}
              <VisuallyHidden>
                {' '}
                {t('tasks:planningCard.commentsWord', { count: commentCount })}
              </VisuallyHidden>
            </span>
          )}
          {contactCount > 0 && (
            <span title={t('tasks:planningCard.contacts', { count: contactCount })}>
              <Icon icon={BookUser} />
              {contactCount}
              <VisuallyHidden>
                {' '}
                {t('tasks:planningCard.contactsWord', { count: contactCount })}
              </VisuallyHidden>
            </span>
          )}
          {(time || timing) &&
            chip(
              `task-card__time${time?.over ? ' is-over' : ''}${timing ? ' is-timing' : ''}`,
              [timing ? t('tasks:time.timerRunning') : '', time?.text ?? '']
                .filter(Boolean)
                .join(' · '),
              <>
                <Icon icon={timing ? Timer : Clock} />
                {time?.text}
                {(time?.over || timing) && (
                  <VisuallyHidden>
                    {' '}
                    {[
                      time?.over ? t('tasks:time.overEstimate') : '',
                      timing ? t('tasks:time.timerRunning') : ''
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </VisuallyHidden>
                )}
              </>
            )}
          {subtaskCount > 0 && (
            <span title={t('tasks:planningCard.subtasks', { count: subtaskCount })}>
              <Icon icon={ListTree} />
              {subtaskCount}
            </span>
          )}
          {/* Only what is still outstanding: "3 dependencies" never said
              whether any were open, which is all a board reader needs. */}
          {unmet.length > 0 && (
            <span
              className="task-card__waiting"
              title={t('tasks:planningCard.waitingOnList', {
                tasks: formatList(unmet.map((dependency) => dependency.title))
              })}
            >
              <Icon icon={Link2} />
              {t('tasks:planningCard.waiting', { unmetCount: unmet.length })}
            </span>
          )}
          {attachedCount > 0 && (
            <span title={t('tasks:planningCard.libraryItemsAttached', { count: attachedCount })}>
              <Icon icon={Paperclip} label={t('tasks:planningCard.attachments')} />
              {attachedCount}
            </span>
          )}
          {item.githubLinks && item.githubLinks.length > 0 && (
            <CardGithubLinks links={item.githubLinks} />
          )}
          {sourceChanged && (
            <span
              className="task-card__warn"
              title={t('tasks:planningCard.librarySourceChangedSince')}
            >
              <Icon icon={FileDiff} label={t('tasks:planningCard.sourceChanged')} />
            </span>
          )}
          {blockerCount > 0 && (
            <span
              className="task-card__danger"
              title={t('tasks:planningCard.openBlockersReportedAgainst', { count: blockerCount })}
            >
              <Icon icon={Ban} />
              {t('tasks:planningCard.blockers', { count: blockerCount })}
            </span>
          )}
          {rejections.length > 0 && (
            <span
              className="task-card__warn"
              title={t('tasks:planningCard.rejectedTimes', {
                count: rejections.length,
                reason: rejections[rejections.length - 1].reason
              })}
            >
              <Icon icon={Undo2} />
              {t('tasks:planningCard.rejected')}
            </span>
          )}
          <span className={`task-card__age${aged ? ' is-aged' : ''}`} title={ageTitle}>
            <Icon icon={Clock} label={ageTitle} />
            {aged && age}
          </span>
        </div>

        {(item.labels.length > 0 || pill || showSubproject || signOff) && (
          <div className="task-card__chips">
            {showSubproject && (
              <SubprojectChip
                className="task-card__subproject"
                subprojects={ws.subprojects}
                subprojectId={item.subprojectId}
              />
            )}
            {signOff && (
              <SignOffBadge
                className="task-card__sign-off"
                projectId={item.projectId}
                itemId={item.id}
              />
            )}
            {pill && (
              <Badge tone={PILLS[pill].tone} className="task-card__pill" title={pillTitle}>
                {PILLS[pill].word}
              </Badge>
            )}
            {item.labels.length > 0 &&
              chip(
                'task-card__labels',
                t('views:listCells.labels', { itemTitle: item.title }),
                <>
                  {item.labels.slice(0, MAX_LABELS).map((label) => (
                    <Chip key={label} className="task-card__label" color={ws.labelColor(label)}>
                      {label}
                    </Chip>
                  ))}
                  {item.labels.length > MAX_LABELS && (
                    <span className="task-card__more-labels">
                      +{item.labels.length - MAX_LABELS}
                    </span>
                  )}
                </>
              )}
          </div>
        )}

        {cardFields.length > 0 && (
          <dl className="task-card__fields">
            {cardFields.map(({ field, text }) => (
              <div key={field.id} className="task-card__field">
                <dt>{field.name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}

        {contextual && (
          <div className="task-card__decision">
            <p>{contextual.note}</p>
            <Button size="sm" variant="secondary" title={contextual.title} onClick={contextual.run}>
              {contextual.label}
            </Button>
          </div>
        )}
      </article>
    </ContextMenu>
  )
}

/**
 * The card as the Board renders it: skips a render unless its own props or
 * the workspace data it reads changed (`card-memo.ts`, P9.1).
 */
export const MemoPlanningCard = memo(PlanningCard, cardPropsEqual)

/** Whether the j/k cursor may take focus from what has it now. */
function shouldFollowCursor(active: Element | null): boolean {
  if (!active || active === document.body) return true
  if (active.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return false
  if (active instanceof HTMLSelectElement || (active as HTMLElement).isContentEditable) return false
  return true
}
