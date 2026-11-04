import type Database from 'better-sqlite3'
import { waitingForReviewer } from '@shared/reviewer-runs'
import type {
  AgentUsageStatus,
  HarnessSession,
  InboxItem,
  NeedsYouReviewer,
  PlanningScheduledQueueOutcome,
  WatchedProject
} from '@shared/ostler-api'
import { describeRecurrence, normalizeRule } from '@shared/recurrence'
import { shiftIsoDate, toIsoDate } from '@shared/dates'
import type { AgentAttention } from './home-service'
import type { InboxSource } from './inbox-service'
import { reminderMissed } from './planning-reminders'
import { t } from '@shared/i18n'
import { isProjectInPlay } from '@shared/project-stages'
import { agentRunStateLabel } from '@shared/agent-run-state'
import { agentLimitMessage, limitPeriods, reachedLimit } from '@shared/agent-run-history'
import { taskKey } from '@shared/task-key'
import { BRAND } from '@shared/brand'
import { mentionsIn } from '@shared/mentions'
import type { CommitLinkService } from './commit-link-service'

/**
 * The Inbox's sources in this package (P5.6). Each reads only enabled
 * projects, so a disabled project's items leave the Inbox with it.
 */

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ')
}

/** "Due today · Website", "Due tomorrow · Website", "Reminder · Website". */
export function reminderText(dueDate: string | null, firedAt: number, projectName: string): string {
  const day = toIsoDate(new Date(firedAt))
  if (dueDate === day) return t('desktop:inboxSources.dueToday', { projectName })
  if (dueDate === shiftIsoDate(day, 1))
    return t('desktop:inboxSources.dueTomorrow', { projectName })
  if (dueDate !== null && dueDate < day) return t('desktop:inboxSources.overdue', { projectName })
  return t('desktop:inboxSources.reminder', { projectName })
}

export function reminderSource(
  db: Database.Database,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT reminder.id, reminder.project_id, reminder.work_item_id, reminder.delivered_at,
                reminder.keep_reminding, reminder.stopped_at, item.title, item.target_date
         FROM reminders reminder
         JOIN planning_work_items item ON item.id = reminder.work_item_id
         WHERE reminder.delivered_at IS NOT NULL AND reminder.dismissed_at IS NULL
           AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND reminder.project_id IN (${placeholders(projects)})`
      )
      .all(...projects.map((project) => project.id)) as {
      id: string
      project_id: string
      work_item_id: string
      delivered_at: number
      keep_reminding: number
      stopped_at: number | null
      title: string
      target_date: string | null
    }[]
    return rows.map((row): InboxItem => {
      const projectName = names.get(row.project_id) ?? ''
      const keep = row.keep_reminding === 1
      const nudging = keep && row.stopped_at === null
      const missed = reminderMissed({
        keepReminding: keep,
        deliveredAt: row.delivered_at,
        stoppedAt: row.stopped_at
      })
      return {
        key: `reminder:${row.id}`,
        kind: 'reminder',
        title: row.title,
        body: missed
          ? t('desktop:inboxSources.missed', { projectName })
          : nudging
            ? t('desktop:inboxSources.keepsReminding', { projectName })
            : reminderText(row.target_date, row.delivered_at, projectName),
        projectId: row.project_id,
        taskId: row.work_item_id,
        createdAt: row.delivered_at,
        ...(nudging ? { nudging: true } : {})
      }
    })
  }
}

/** How far back a mention stays in the Inbox until it is read. */
const MENTION_DAYS = 30

/**
 * Mentions (prompt 14): comments that mention Me, written by someone else, in
 * enabled projects, newest first, within the last 30 days. They stay until
 * the item is marked read (the Inbox's own read state); each is keyed by its
 * comment. Their desktop notice comes from the sync path, not from here.
 */
export function mentionSource(
  db: Database.Database,
  getProjects: () => WatchedProject[],
  now: () => number = Date.now
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const me = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
      { id: string } | undefined
    if (!me) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT comment.id, comment.project_id, comment.work_item_id, comment.body,
                comment.created_at, author.name AS author_name, item.title
         FROM planning_comments comment
         JOIN planning_work_items item ON item.id = comment.work_item_id
         LEFT JOIN people author ON author.id = comment.author_person_id
         WHERE comment.deleted_at IS NULL AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND comment.created_at >= ?
           AND comment.body LIKE ?
           AND COALESCE(comment.author_person_id, '') <> ?
           AND comment.project_id IN (${placeholders(projects)})
         ORDER BY comment.created_at DESC, comment.id
         LIMIT 200`
      )
      .all(
        now() - MENTION_DAYS * 24 * 60 * 60 * 1000,
        `%://person/${me.id}%`,
        me.id,
        ...projects.map((project) => project.id)
      ) as {
      id: string
      project_id: string
      work_item_id: string
      body: string
      created_at: number
      author_name: string | null
      title: string
    }[]
    return rows
      .filter((row) => mentionsIn(row.body, BRAND.urlScheme).includes(me.id))
      .map((row): InboxItem => {
        const projectName = names.get(row.project_id) ?? ''
        return {
          key: `mention:${row.id}`,
          kind: 'mention',
          title: row.title,
          body: row.author_name
            ? t('desktop:inboxSources.mentionedBy', { name: row.author_name, projectName })
            : t('desktop:inboxSources.mentioned', { projectName }),
          projectId: row.project_id,
          taskId: row.work_item_id,
          createdAt: row.created_at
        }
      })
  }
}

/**
 * Sign-offs asked of Me (prompt 17): every request still waiting on Me in an enabled project, for a
 * task, a decision or a milestone. Each is keyed by the request, so it goes when it is answered or
 * cancelled. Their desktop notice comes from the sync path, not from here.
 */
export function signOffSource(
  db: Database.Database,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const me = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
      { id: string } | undefined
    if (!me) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT so.id, so.project_id, so.item_kind, so.item_id, so.requested_at,
                requester.name AS requester_name,
                COALESCE(task.title, decision.title, milestone.name) AS title
         FROM planning_sign_offs so
         LEFT JOIN people requester ON requester.id = so.requested_by_person_id
         LEFT JOIN planning_work_items task
           ON so.item_kind = 'task' AND task.id = so.item_id AND task.deleted_at IS NULL
         LEFT JOIN planning_decisions decision
           ON so.item_kind = 'decision' AND decision.id = so.item_id
         LEFT JOIN planning_milestones milestone
           ON so.item_kind = 'milestone' AND milestone.id = so.item_id
         WHERE so.state = 'waiting' AND so.approver_person_id = ?
           AND so.project_id IN (${placeholders(projects)})
         ORDER BY so.requested_at DESC, so.id
         LIMIT 200`
      )
      .all(me.id, ...projects.map((project) => project.id)) as {
      id: string
      project_id: string
      item_kind: 'task' | 'decision' | 'milestone'
      item_id: string
      requested_at: number
      requester_name: string | null
      title: string | null
    }[]
    return rows
      .filter((row) => row.title !== null)
      .map((row): InboxItem => {
        const projectName = names.get(row.project_id) ?? ''
        return {
          key: `signoff:${row.id}`,
          kind: 'signOff',
          title: row.title ?? '',
          body: row.requester_name
            ? t('desktop:inboxSources.signOffAskedBy', { name: row.requester_name, projectName })
            : t('desktop:inboxSources.signOffAsked', { projectName }),
          projectId: row.project_id,
          taskId: row.item_kind === 'task' ? row.item_id : null,
          ...(row.item_kind === 'milestone' ? { milestoneId: row.item_id } : {}),
          ...(row.item_kind === 'decision' ? { decisionId: row.item_id } : {}),
          createdAt: row.requested_at
        }
      })
  }
}

/**
 * To triage (N4.3a): one item per enabled project with tasks waiting, "4 to
 * triage · Website", which opens its To triage view. Keyed by the newest
 * capture, so a new one makes the item unread again; it brings no desktop
 * notification (the person usually captured it just now).
 */
export function triageSource(
  db: Database.Database,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const rows = db
      .prepare(
        `SELECT project_id, COUNT(*) AS count, MAX(created_at) AS newest
         FROM planning_work_items
         WHERE in_triage = 1 AND archived_at IS NULL AND deleted_at IS NULL
           AND project_id IN (${placeholders(projects)})
         GROUP BY project_id`
      )
      .all(...projects.map((project) => project.id)) as {
      project_id: string
      count: number
      newest: number
    }[]
    const names = new Map(projects.map((project) => [project.id, project.name]))
    return rows.map((row): InboxItem => ({
      key: `triage:${row.project_id}:${row.newest}`,
      kind: 'triage',
      title: t('desktop:inboxSources.toTriage', {
        count: row.count,
        projectName: names.get(row.project_id) ?? ''
      }),
      body: t('desktop:inboxSources.toTriageBody'),
      projectId: row.project_id,
      taskId: null,
      createdAt: row.newest
    }))
  }
}

export function blockerSource(
  db: Database.Database,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    // A nudge, so On hold and Done projects stay quiet (N5.3, N38).
    const projects = getProjects().filter(isProjectInPlay)
    if (projects.length === 0) return []
    const rows = db
      .prepare(
        `SELECT blocker.id, blocker.description, blocker.reported_at, item.id AS work_item_id,
                item.project_id, item.title
         FROM planning_blockers blocker
         JOIN planning_work_items item ON item.id = blocker.work_item_id
         WHERE blocker.status = 'open' AND item.status <> 'done'
           AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND item.project_id IN (${placeholders(projects)})`
      )
      .all(...projects.map((project) => project.id)) as {
      id: string
      description: string
      reported_at: number
      work_item_id: string
      project_id: string
      title: string
    }[]
    return rows.map((row): InboxItem => ({
      key: `blocker:${row.id}`,
      kind: 'blocker',
      title: row.title,
      body: row.description,
      projectId: row.project_id,
      taskId: row.work_item_id,
      createdAt: row.reported_at
    }))
  }
}

/**
 * The sessions in review that need the person (Needs you and the Inbox): a
 * session waits for its reviewer, up to 30 minutes, before it does (N9.5b),
 * and says where its reviewer got to.
 */
export function reviewsNeedingYou(
  reviewSessions: readonly HarnessSession[],
  taskOf: (sessionId: string) => string | null
): AgentAttention['reviews'] {
  return reviewSessions
    .filter((session) => !waitingForReviewer(session))
    .map((session) => ({
      id: session.id,
      title: session.title,
      at: Date.parse(session.lastUpdate) || 0,
      taskId: taskOf(session.id),
      ...(session.review ? { reviewer: session.review.status } : {})
    }))
}

/** What the Inbox says of a reviewed session (N9.5b): whether its reviewer finished. */
export function reviewerLine(reviewer: NeedsYouReviewer, projectName: string): string {
  switch (reviewer) {
    case 'reported':
      return t('desktop:inboxSources.reviewerReported', { projectName })
    case 'failed':
      return t('desktop:inboxSources.reviewerFailed', { projectName })
    default:
      return t('desktop:inboxSources.reviewerOverdue', { projectName })
  }
}

/** Agent questions and sessions waiting for review: only while agents are on. */
export function agentSources(
  getProjects: () => WatchedProject[],
  agentsOn: () => boolean,
  attention: (project: WatchedProject) => AgentAttention | null
): { questions: InboxSource; reviews: InboxSource; plans: InboxSource } {
  const each = (map: (project: WatchedProject, found: AgentAttention) => InboxItem[]) => () => {
    if (!agentsOn()) return []
    return getProjects()
      .filter((project) => project.enabled)
      .flatMap((project) => {
        const found = attention(project)
        return found ? map(project, found) : []
      })
  }
  return {
    questions: each((project, found) =>
      found.questions.map((question) => ({
        key: `question:${project.id}:${question.id}`,
        kind: 'question',
        title: t('desktop:inboxSources.agentHasQuestion', { projectName: project.name }),
        body: question.text,
        projectId: project.id,
        taskId: question.taskId,
        createdAt: question.at
      }))
    ),
    // A new version is a new item, so it notifies again (N9.3b).
    plans: each((project, found) =>
      (found.plans ?? []).map((plan) => ({
        key: `plan:${project.id}:${plan.id}:${plan.version}`,
        kind: 'plan',
        title: t('desktop:inboxSources.planWaiting', { projectName: project.name }),
        body: plan.title,
        projectId: project.id,
        taskId: plan.taskId,
        sessionId: plan.id,
        createdAt: plan.at
      }))
    ),
    reviews: each((project, found) =>
      found.reviews.map((review) => ({
        key: `review:${project.id}:${review.id}`,
        kind: 'review',
        title: review.title,
        body: review.reviewer
          ? reviewerLine(review.reviewer, project.name)
          : t('desktop:inboxSources.runState', {
              state: agentRunStateLabel('inReview'),
              projectName: project.name
            }),
        projectId: project.id,
        taskId: review.taskId,
        createdAt: review.at
      }))
    )
  }
}

/**
 * A project whose built-in agent reached a token limit (R5.3, D43): which
 * limit, and when it resets. One item per period, so the next day's or
 * month's limit is a new item; it leaves the Inbox when the period resets.
 */
export function agentLimitSource(
  getProjects: () => WatchedProject[],
  agentsOn: () => boolean,
  usage: (project: WatchedProject) => AgentUsageStatus | null,
  now: () => number = Date.now
): InboxSource {
  return () => {
    if (!agentsOn()) return []
    return getProjects()
      .filter(
        (project) =>
          project.enabled &&
          (project.agentLimits?.tokensPerDay != null || project.agentLimits?.tokensPerMonth != null)
      )
      .flatMap((project): InboxItem[] => {
        const status = usage(project)
        const reached = status ? reachedLimit(status) : null
        if (!reached) return []
        const periods = limitPeriods(now())
        return [
          {
            key: `agentlimit:${project.id}:${reached.period}:${reached.resetsAt}`,
            kind: 'agentLimit',
            title: t('desktop:inboxSources.agentLimitReached', { projectName: project.name }),
            body: agentLimitMessage(reached),
            projectId: project.id,
            taskId: null,
            createdAt: reached.period === 'day' ? periods.dayStart : periods.monthStart
          }
        ]
      })
  }
}

/** How long an import offers its undo in the Inbox (Settings › Data keeps it for good). */
const IMPORT_INBOX_DAYS = 30

/**
 * Imports (P6.1): "Imported 214 tasks into Website relaunch", with Undo
 * import, until it is undone or a month old.
 */
export function importSource(
  db: Database.Database,
  getProjects: () => WatchedProject[],
  now: () => number = Date.now
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT id, project_id, file_name, created_at, item_count FROM import_batches
         WHERE undone_at IS NULL AND item_count > 0 AND created_at >= ?
           AND project_id IN (${placeholders(projects)})`
      )
      .all(
        now() - IMPORT_INBOX_DAYS * 24 * 60 * 60 * 1000,
        ...projects.map((project) => project.id)
      ) as {
      id: string
      project_id: string
      file_name: string
      created_at: number
      item_count: number
    }[]
    return rows.map((row): InboxItem => ({
      key: `import:${row.id}`,
      kind: 'import',
      title: t('desktop:inboxSources.imported', {
        count: row.item_count,
        project: names.get(row.project_id) ?? ''
      }),
      body: t('desktop:inboxSources.from', { file_name: row.file_name }),
      projectId: row.project_id,
      taskId: null,
      createdAt: row.created_at
    }))
  }
}

/** How long a round started on schedule stays in the Inbox. */
const ROUND_INBOX_DAYS = 30

/**
 * Repeating rounds (N5.7a): "Accounts · May 2027 was started" when the
 * schedule made a round (never Start next round now, which the person saw),
 * opening the new round, until archived or a month old.
 */
export function roundSource(
  db: Database.Database,
  getProjects: () => WatchedProject[],
  now: () => number = Date.now
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT id, project_id, name, round_started_by_schedule_at FROM planning_milestones
         WHERE round_started_by_schedule_at IS NOT NULL AND round_started_by_schedule_at >= ?
           AND project_id IN (${placeholders(projects)})`
      )
      .all(
        now() - ROUND_INBOX_DAYS * 24 * 60 * 60 * 1000,
        ...projects.map((project) => project.id)
      ) as { id: string; project_id: string; name: string; round_started_by_schedule_at: number }[]
    return rows.map((row): InboxItem => ({
      key: `round:${row.id}`,
      kind: 'round',
      title: t('desktop:inboxSources.roundStarted', { name: row.name }),
      body: names.get(row.project_id) ?? '',
      projectId: row.project_id,
      taskId: null,
      milestoneId: row.id,
      createdAt: row.round_started_by_schedule_at
    }))
  }
}

/** How long a scheduled queuing's note stays in the Inbox. */
const SCHEDULED_INBOX_DAYS = 30

/** Why an occurrence's schedule did not queue it (N9.7), as the Inbox says it. */
export function scheduledQueueText(
  outcome: PlanningScheduledQueueOutcome,
  note: string | null
): string {
  switch (outcome) {
    case 'agentsOff':
      return t('desktop:inboxSources.scheduledAgentsOff')
    case 'noFolder':
      return t('desktop:inboxSources.scheduledNoFolder')
    case 'alreadyQueued':
      return t('desktop:inboxSources.scheduledAlreadyQueued')
    case 'refused':
      return t('desktop:inboxSources.scheduledRefused', { reason: note ?? '' })
    case 'queued':
      return ''
  }
}

/**
 * Scheduled agent tasks (N9.7): one note per occurrence its repeat's schedule
 * acted on, "Queued for agents: Update the dependencies" with how it repeats,
 * or "Not queued for agents: …" with why, opening the task, until archived or
 * a month old. A note that was not queued offers Queue it now while its task
 * is not done. Review follows as for any run.
 */
export function scheduledQueueSource(
  db: Database.Database,
  getProjects: () => WatchedProject[],
  now: () => number = Date.now
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT item.id, item.project_id, item.title, item.status, item.scheduled_queue,
                item.scheduled_queue_at, item.scheduled_queue_note, recurrence.rule
         FROM planning_work_items item
         LEFT JOIN planning_recurrences recurrence ON recurrence.work_item_id = item.id
         WHERE item.scheduled_queue IS NOT NULL AND item.scheduled_queue_at >= ?
           AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND item.project_id IN (${placeholders(projects)})`
      )
      .all(
        now() - SCHEDULED_INBOX_DAYS * 24 * 60 * 60 * 1000,
        ...projects.map((project) => project.id)
      ) as {
      id: string
      project_id: string
      title: string
      status: string
      scheduled_queue: PlanningScheduledQueueOutcome
      scheduled_queue_at: number
      scheduled_queue_note: string | null
      rule: string | null
    }[]
    return rows.map((row): InboxItem => {
      const projectName = names.get(row.project_id) ?? ''
      const queued = row.scheduled_queue === 'queued'
      let repeat = ''
      try {
        repeat = row.rule ? describeRecurrence(normalizeRule(JSON.parse(row.rule) as unknown)) : ''
      } catch {
        repeat = ''
      }
      const why = queued
        ? repeat
        : scheduledQueueText(row.scheduled_queue, row.scheduled_queue_note)
      return {
        key: `scheduled:${row.id}`,
        kind: 'scheduled',
        title: queued
          ? t('desktop:inboxSources.scheduledQueued', { title: row.title })
          : t('desktop:inboxSources.scheduledNotQueued', { title: row.title }),
        body: why ? t('desktop:inboxSources.scheduledBody', { why, projectName }) : projectName,
        projectId: row.project_id,
        taskId: row.id,
        createdAt: row.scheduled_queue_at,
        ...(!queued && row.status !== 'done' ? { queueNow: true } : {})
      }
    })
  }
}

/** "Rule “Escalate” · Website", with the rule's message first when it has one. */
export function ruleNoticeText(message: string, ruleName: string, projectName: string): string {
  return message
    ? t('desktop:inboxSources.ruleNoticeMessage', { message, name: ruleName, projectName })
    : t('desktop:inboxSources.ruleNotice', { name: ruleName, projectName })
}

/** A rule's "Notify me" (R6.2): one item per notice, about its task, until archived. */
export function ruleNoticeSource(
  db: Database.Database,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const rows = db
      .prepare(
        `SELECT notice.id, notice.project_id, notice.work_item_id, notice.rule_name, notice.message,
                notice.created_at, item.title, item.archived_at
         FROM planning_rule_notices notice
         JOIN planning_work_items item ON item.id = notice.work_item_id
         WHERE item.deleted_at IS NULL AND notice.project_id IN (${placeholders(projects)})`
      )
      .all(...projects.map((project) => project.id)) as {
      id: string
      project_id: string
      work_item_id: string
      rule_name: string
      message: string
      created_at: number
      title: string
      archived_at: number | null
    }[]
    return rows.map((row): InboxItem => ({
      key: `rule:${row.id}`,
      kind: 'rule',
      title: row.title,
      body: ruleNoticeText(row.message, row.rule_name, names.get(row.project_id) ?? ''),
      projectId: row.project_id,
      // A rule may archive the task it reports on; an archived task has no
      // drawer to open, so the notice opens its project instead.
      taskId: row.archived_at === null ? row.work_item_id : null,
      createdAt: row.created_at
    }))
  }
}

/**
 * Smart commits (N9.8b): "Commit a1b2c3 says it fixes SHOP-12: Fix the login",
 * one per task and commit, offering Mark as done while the task is open. Only
 * new commits are offered (`CommitLinkService.link` with `offer`), so the first
 * history import never floods the Inbox. Dismiss archives it.
 */
export function commitFixSource(
  commitLinks: CommitLinkService,
  getProjects: () => WatchedProject[]
): InboxSource {
  return () => {
    const projects = getProjects().filter((project) => project.enabled)
    if (projects.length === 0) return []
    const byId = new Map(projects.map((project) => [project.id, project]))
    return commitLinks.openOffers(projects.map((project) => project.id)).map((offer): InboxItem => {
      const project = byId.get(offer.projectId)
      const id = taskKey(project?.taskPrefix, offer.taskNumber) ?? String(offer.taskNumber)
      return {
        key: `commit:${offer.linkId}`,
        kind: 'commit',
        title: t('desktop:inboxSources.commitFixes', {
          hash: offer.abbreviatedHash,
          id,
          title: offer.taskTitle
        }),
        body: project?.name ?? '',
        projectId: offer.projectId,
        taskId: offer.workItemId,
        fromStatus: offer.status,
        createdAt: offer.offeredAt
      }
    })
  }
}
