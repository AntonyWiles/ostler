import type {
  PlanningChangeField,
  PlanningColumnSettings,
  PlanningComment,
  PlanningLinkRole,
  PlanningPriority,
  PlanningVerificationStatus,
  PlanningWorkItemStatus
} from './ostler-api'
import { parseIsoDate } from './dates'
import { formatList } from './format'
import { describeRecurrence, type RecurrenceRule } from './recurrence'
import { taskPriorityLabel, taskStatusLabel } from './task-labels'
import { currentLanguage, t } from './i18n'
import { LINK_ROLE_ORDER, linkRoleLabel } from './planning/links'
import { statusUpdateHealthLabel, type StatusUpdateHealth } from './status-updates'
import { formatMeasureValue } from './goal-measures'
import { dependencyLinkWords } from './planning/dependency-link-words'
import { normalisedDependencyLink } from './planning/dependency-links'

/** What an agent run did, as the activity feed tells it (P5.2). */
export type AgentActivityAction =
  | 'queued'
  | 'started'
  | 'question-asked'
  | 'question-answered'
  | 'report-submitted'
  | 'accepted'
  | 'discarded'
  | 'rejected'

/** One stored fact, before it is named and worded. */
export type ActivityRecord =
  | { kind: 'status'; from: PlanningWorkItemStatus | null; to: PlanningWorkItemStatus }
  | {
      kind: 'change'
      field: PlanningChangeField
      from: unknown
      to: unknown
      metadata: { draftId?: string; template?: string; playbook?: string } | null
    }
  | { kind: 'comment'; comment: PlanningComment }
  | { kind: 'agent'; action: AgentActivityAction }
  /** A status update posted on the project (N5.5). */
  | { kind: 'status-update'; health: StatusUpdateHealth }
  /** A goal's check-in (N5.6a): its goal's title and unit as they are now. */
  | { kind: 'goal-check-in'; goalTitle: string; value: number; unit: string }

/** Looks names up for the summary; every lookup falls back to something readable. */
export interface ActivitySummaryContext {
  /** The actor, already named: "Alex", "Built-in agent", "Automation API". */
  actorName: string
  personName(personId: string): string
  milestoneName(milestoneId: string): string
  /** An iteration's name (R6.1); absent where no iteration can be named. */
  iterationName?(iterationId: string): string
  /** A task type's name (N2.7a); absent where no type can be named. */
  typeName?(typeId: string): string
  workItemTitle(workItemId: string): string
  /** The project's column settings (R2.4), for its status words; standard when absent. */
  columns?: PlanningColumnSettings | null
}

const VERIFICATION_LABELS: Record<PlanningVerificationStatus, string> = {
  get unverified() {
    return t('tasks:activitySummary.notChecked')
  },
  get pending() {
    return t('tasks:activitySummary.checking')
  },
  get passed() {
    return t('tasks:activitySummary.passed')
  },
  get failed() {
    return t('tasks:activitySummary.failed')
  },
  get 'needs-rework'() {
    return t('tasks:activitySummary.needsRework')
  }
}

/** "3 Oct", in the computer's locale. */
export function formatActivityDate(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date)
}

function quoted(text: string): string {
  return `“${text}”`
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function added(from: unknown, to: unknown): string[] {
  const before = new Set(stringList(from))
  return stringList(to).filter((item) => !before.has(item))
}

function removed(from: unknown, to: unknown): string[] {
  return added(to, from)
}

/** A start or due date set, changed or removed: `field` picks the sentences. */
function dateChange(
  who: string,
  field: 'startDate' | 'dueDate' | 'showFrom',
  from: unknown,
  to: unknown
): string {
  const before = textOrNull(from)
  const after = textOrNull(to)
  if (!after) return t(`tasks:activitySummary.${field}.removed`, { who })
  if (!before)
    return t(`tasks:activitySummary.${field}.set`, { who, date: formatActivityDate(after) })
  return t(`tasks:activitySummary.${field}.changed`, {
    who,
    from: formatActivityDate(before),
    to: formatActivityDate(after)
  })
}

function listChange(
  who: string,
  addedItems: string[],
  removedItems: string[],
  one: (item: string) => { add: string; remove: string },
  many: (count: number) => { add: string; remove: string }
): string {
  const addText = addedItems.length === 1 ? one(addedItems[0]).add : many(addedItems.length).add
  const removeText =
    removedItems.length === 1 ? one(removedItems[0]).remove : many(removedItems.length).remove
  if (addedItems.length > 0 && removedItems.length > 0)
    return t('tasks:activitySummary.and', { who, addText, removeText })
  if (addedItems.length > 0) return t('tasks:activitySummary.actorDid', { who, change: addText })
  return t('tasks:activitySummary.actorDid', { who, change: removeText })
}

function changeSummary(
  record: Extract<ActivityRecord, { kind: 'change' }>,
  context: ActivitySummaryContext
): string {
  const who = context.actorName
  const { from, to } = record
  switch (record.field) {
    case 'created':
      if (record.metadata?.draftId) return t('tasks:activitySummary.createdTaskSuggestion', { who })
      if (record.metadata?.template)
        return t('tasks:activitySummary.createdTaskTemplate', {
          who,
          quoted: quoted(record.metadata.template)
        })
      if (record.metadata?.playbook)
        return t('tasks:activitySummary.createdTaskPlaybook', {
          who,
          quoted: quoted(record.metadata.playbook)
        })
      return t('tasks:activitySummary.createdTask', { who })
    case 'title':
      return t('tasks:activitySummary.renamedTask', {
        who,
        quoted: quoted(String(from ?? '')),
        quoted2: quoted(String(to ?? ''))
      })
    case 'description':
      return t('tasks:activitySummary.editedDescription', { who })
    case 'number':
      return t('tasks:activitySummary.renumbered', { from, to })
    case 'descriptionReplaced':
      return t('tasks:activitySummary.descriptionReplaced')
    case 'priority':
      return t('tasks:activitySummary.changedPriority', {
        who,
        taskPriorityLabel: taskPriorityLabel(from as PlanningPriority),
        taskPriorityLabel2: taskPriorityLabel(to as PlanningPriority)
      })
    case 'assignee': {
      const before = textOrNull(from)
      const after = textOrNull(to)
      if (!after)
        return t('tasks:activitySummary.unassigned', {
          who,
          personName: context.personName(before ?? '')
        })
      if (!before)
        return t('tasks:activitySummary.assignedTask', {
          who,
          personName: context.personName(after)
        })
      return t('tasks:activitySummary.reassignedTask', {
        who,
        personName: context.personName(before),
        personName2: context.personName(after)
      })
    }
    case 'startDate':
      return dateChange(who, 'startDate', from, to)
    case 'dueDate':
      return dateChange(who, 'dueDate', from, to)
    case 'showFrom':
      return dateChange(who, 'showFrom', from, to)
    case 'someday':
      return to === true
        ? t('tasks:activitySummary.movedToSomeday', { who })
        : t('tasks:activitySummary.broughtBackFromSomeday', { who })
    case 'triage':
      return to === true
        ? t('tasks:activitySummary.sentBackToTriage', { who })
        : t('tasks:activitySummary.acceptedFromTriage', { who })
    case 'estimate': {
      if (typeof to !== 'number') return t('tasks:activitySummary.removedEstimate', { who })
      if (typeof from !== 'number') return t('tasks:activitySummary.setEstimate', { who, to })
      return t('tasks:activitySummary.changedEstimate', { who, from, to })
    }
    case 'impact':
    case 'effort': {
      const score = t(`tasks:ideas.${record.field}`).toLowerCase()
      if (typeof to !== 'number') return t('tasks:activitySummary.removedScore', { who, score })
      if (typeof from !== 'number') return t('tasks:activitySummary.setScore', { who, score, to })
      return t('tasks:activitySummary.changedScore', { who, score, from, to })
    }
    case 'milestone': {
      const before = textOrNull(from)
      const after = textOrNull(to)
      if (!after)
        return t('tasks:activitySummary.tookTaskOut', {
          who,
          quoted: quoted(context.milestoneName(before ?? ''))
        })
      if (!before)
        return t('tasks:activitySummary.addedTask', {
          who,
          quoted: quoted(context.milestoneName(after))
        })
      return t('tasks:activitySummary.movedTask', {
        who,
        quoted: quoted(context.milestoneName(before)),
        quoted2: quoted(context.milestoneName(after))
      })
    }
    case 'iteration': {
      const name = (id: string) => quoted(context.iterationName?.(id) ?? id)
      const before = textOrNull(from)
      const after = textOrNull(to)
      if (!after)
        return t('tasks:activitySummary.tookTaskOutIteration', { who, quoted: name(before ?? '') })
      if (!before)
        return t('tasks:activitySummary.addedTaskIteration', { who, quoted: name(after) })
      return t('tasks:activitySummary.movedTaskIteration', {
        who,
        quoted: name(before),
        quoted2: name(after)
      })
    }
    case 'type': {
      const after = textOrNull(to)
      if (!after) return t('tasks:activitySummary.clearedType', { who })
      const name = (id: string) => quoted(context.typeName?.(id) ?? id)
      return t('tasks:activitySummary.setType', { who, quoted: name(after) })
    }
    case 'labels':
      return listChange(
        who,
        added(from, to),
        removed(from, to),
        (label) => ({
          add: t('tasks:activitySummary.addedLabel', { label }),
          remove: t('tasks:activitySummary.removedLabel', { label })
        }),
        (count) => ({
          add: t('tasks:activitySummary.addedLabels', { count }),
          remove: t('tasks:activitySummary.removedLabels', { count })
        })
      )
    case 'dependencies':
      return listChange(
        who,
        added(from, to),
        removed(from, to),
        (id) => ({
          add: t('tasks:activitySummary.madeTaskWait', {
            quoted: quoted(context.workItemTitle(id))
          }),
          remove: t('tasks:activitySummary.stoppedTaskWaiting', {
            quoted: quoted(context.workItemTitle(id))
          })
        }),
        (count) => ({
          add: t('tasks:activitySummary.addedDependencies', { count }),
          remove: t('tasks:activitySummary.removedDependencies', { count })
        })
      )
    case 'dependencyLink': {
      const value = (to ?? {}) as { id?: unknown }
      const link = normalisedDependencyLink({ ...value, id: String(value.id ?? '') })
      return t('tasks:activitySummary.changedWaitsOn', {
        who,
        link: dependencyLinkWords(link, quoted(context.workItemTitle(link.id)))
      })
    }
    case 'checklist':
      return listChange(
        who,
        added(from, to),
        removed(from, to),
        (text) => ({
          add: t('tasks:activitySummary.addedChecklist', { quoted: quoted(text) }),
          remove: t('tasks:activitySummary.removedChecklist', { quoted: quoted(text) })
        }),
        (count) => ({
          add: t('tasks:activitySummary.addedChecklistItems', { count }),
          remove: t('tasks:activitySummary.removedChecklistItems', { count })
        })
      )
    case 'checklistTick': {
      const value = (to ?? {}) as { text?: unknown; checked?: unknown }
      const text = quoted(String(value.text ?? ''))
      return value.checked
        ? t('tasks:activitySummary.ticked', { who, text })
        : t('tasks:activitySummary.unticked', { who, text })
    }
    case 'verification':
      return t('tasks:activitySummary.markedCheck', {
        who,
        status: VERIFICATION_LABELS[to as PlanningVerificationStatus] ?? String(to)
      })
    case 'archived':
      return t('tasks:activitySummary.archivedTask', { who })
    case 'unarchived':
      return t('tasks:activitySummary.tookTaskOutArchive', { who })
    case 'wontDo':
      return typeof to === 'string' && to
        ? t('tasks:activitySummary.closedWontDoReason', { who, reason: to })
        : t('tasks:activitySummary.closedWontDo', { who })
    case 'reopened':
      return t('tasks:activitySummary.reopenedTask', { who })
    case 'deleted':
      return t('tasks:activitySummary.movedTaskRecycleBin', { who })
    case 'restored':
      return t('tasks:activitySummary.restoredTaskRecycleBin', { who })
    case 'repeat': {
      if (!to) return t('tasks:activitySummary.stoppedTaskRepeating', { who })
      const text = describeRecurrence(to as RecurrenceRule)
      // Mid-sentence, so its first letter is lower case.
      return t('tasks:activitySummary.setTaskRepeat', {
        who,
        rule: text.charAt(0).toLocaleLowerCase(currentLanguage()) + text.slice(1)
      })
    }
    case 'repeated': {
      const next = (to ?? {}) as { title?: unknown; dueDate?: unknown; turnsKept?: unknown }
      const due = typeof next.dueDate === 'string' ? formatActivityDate(next.dueDate) : ''
      return t(
        next.turnsKept === 'everyoneArchived'
          ? 'tasks:activitySummary.repeatedDueEveryoneArchived'
          : 'tasks:activitySummary.repeatedDue',
        { quoted: quoted(String(next.title ?? '')), due }
      )
    }
    case 'takeTurns': {
      if (!Array.isArray(to) || to.length === 0)
        return t('tasks:activitySummary.stoppedTakingTurns', { who })
      return t('tasks:activitySummary.setTakingTurns', {
        who,
        people: formatList(to.map((id) => context.personName(String(id))))
      })
    }
    case 'round': {
      const round = (to ?? {}) as { name?: unknown }
      return t('tasks:activitySummary.copiedIntoRound', {
        who,
        quoted: quoted(String(round.name ?? ''))
      })
    }
    case 'aiFilled': {
      const filled = (to ?? {}) as { name?: unknown }
      return t('tasks:activitySummary.aiFilled', { who, name: String(filled.name ?? '') })
    }
    case 'linked':
    case 'unlinked': {
      const link = (to ?? from ?? {}) as { role?: unknown; title?: unknown }
      const relation = isLinkRole(link.role) ? linkRoleLabel(link.role) : ''
      return t(
        record.field === 'linked'
          ? 'tasks:activitySummary.linked'
          : 'tasks:activitySummary.unlinked',
        { who, relation, quoted: quoted(String(link.title ?? '')) }
      )
    }
  }
}

function isLinkRole(value: unknown): value is PlanningLinkRole {
  return typeof value === 'string' && LINK_ROLE_ORDER.includes(value as PlanningLinkRole)
}

function agentSummary(action: AgentActivityAction, who: string): string {
  switch (action) {
    case 'queued':
      return t('tasks:activitySummary.taskWasQueuedAgent')
    case 'started':
      return t('tasks:activitySummary.startedWork', { who })
    case 'question-asked':
      return t('tasks:activitySummary.askedQuestion', { who })
    case 'question-answered':
      return t('tasks:activitySummary.gotAnswerQuestion', { who })
    case 'report-submitted':
      return t('tasks:activitySummary.submittedReport', { who })
    case 'accepted':
      return t('tasks:activitySummary.sChangesWereAccepted', { who })
    case 'discarded':
      return t('tasks:activitySummary.sChangesWereDiscarded', { who })
    case 'rejected':
      return t('tasks:activitySummary.sWorkWasSent', { who })
  }
}

/**
 * The one place an activity entry is worded, for the drawer, Overview and the
 * automation API alike: "Alex changed the due date from 3 Oct to 10 Oct".
 */
export function summarizeActivity(record: ActivityRecord, context: ActivitySummaryContext): string {
  const who = context.actorName
  switch (record.kind) {
    case 'status':
      return record.from === null
        ? t('tasks:activitySummary.createdTask', { who })
        : t('tasks:activitySummary.movedTask2', {
            who,
            taskStatusLabel: taskStatusLabel(record.from, context.columns),
            taskStatusLabel2: taskStatusLabel(record.to, context.columns)
          })
    case 'change':
      return changeSummary(record, context)
    case 'status-update':
      return t('projects:statusUpdates.activity', {
        who,
        health: statusUpdateHealthLabel(record.health)
      })
    case 'goal-check-in':
      return t('tasks:goalMeasure.activity', {
        who,
        value: formatMeasureValue(record.value, record.unit),
        goal: record.goalTitle
      })
    case 'comment':
      return record.comment.updatedAt > record.comment.createdAt
        ? t('tasks:activitySummary.commentedEdited', { who })
        : t('tasks:activitySummary.commented', { who })
    case 'agent':
      return agentSummary(record.action, who)
  }
}
