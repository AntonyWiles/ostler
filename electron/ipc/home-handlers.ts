import type {
  AssignedTasksQuery,
  WorkloadTasksQuery,
  TeamOverviewQuery,
  InboxSnooze,
  PlanningRecurrenceInput,
  Briefing,
  BriefingWriteUp,
  WatchedProject
} from '@shared/ostler-api'
import { parseTaskFilter } from '@shared/task-filter'
import { shiftIsoDate, todayIsoDate } from '@shared/dates'
import { localInstant } from '@shared/reminder-settings'
import { reminderOptions } from '../services/planning-reminders'
import type { GettingStartedActivity } from '@shared/getting-started'
import type { HomeService } from '../services/home-service'
import type { BriefingService } from '../services/briefing-service'
import type { GettingStartedService } from '../services/getting-started-service'
import type { InboxService } from '../services/inbox-service'
import type { PlanningService } from '../services/planning-service'
import type { RescheduleService } from '../services/reschedule-service'
import { myDayPlacement, type MyDayService } from '../services/my-day-service'
import {
  dependentMoves,
  rescheduleChanges,
  rescheduleOptions,
  type RescheduleRequest
} from '../services/reschedule-service'
import { reviewSteps, type WeeklyReviewService } from '../services/weekly-review-service'
import { handleApi } from './handle-ipc'

export interface HomeHandlerDependencies {
  homeService: HomeService
  /** Since you were last here (N1.6). */
  briefingService: BriefingService
  /** Write it up: Ostler AI's paragraph, through `requireAi`. */
  writeBriefing(briefing: Briefing): Promise<BriefingWriteUp>
  gettingStartedService: GettingStartedService
  inboxService: InboxService
  planningService: PlanningService
  rescheduleService: RescheduleService
  /** My day (N1.4). */
  myDayService: MyDayService
  /** Weekly review (N1.5). */
  weeklyReviewService: WeeklyReviewService
  /** Resolves an enabled project or throws: the access check. */
  getProject(projectId: string): WatchedProject
  /** Something Home, the Inbox or the reminder timer reads changed. */
  notifyHomeChanged(): void
  /**
   * Queue it now on a scheduled occurrence's Inbox note (`queueScheduledTaskNow`
   * in scheduled-agent-tasks.ts); throws the plain reason when refused.
   */
  queueScheduledTaskNow(workItemId: string): void
}

/** A briefing's bound from the renderer: a whole number of milliseconds. */
export function briefingTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('since must be a time in milliseconds')
  return value
}

const SNOOZES: readonly InboxSnooze[] = ['hour', 'tomorrow']

/**
 * When a snooze ends: an hour from now, or tomorrow at 09:00 local time. A
 * reminder that keeps reminding (N1.7) comes back tomorrow at its own time,
 * `reminderAt`'s time of day.
 */
export function snoozeUntil(until: InboxSnooze, now: Date, reminderAt?: number): number {
  if (until === 'hour') return now.getTime() + 60 * 60 * 1000
  const time =
    reminderAt === undefined
      ? '09:00'
      : `${String(new Date(reminderAt).getHours()).padStart(2, '0')}:${String(new Date(reminderAt).getMinutes()).padStart(2, '0')}`
  return localInstant(shiftIsoDate(todayIsoDate(now), 1), time)
}

/**
 * My work's query from the renderer, checked field by field: a person id, an
 * enabled project when one is named, and a filter `parseTaskFilter` accepts.
 */
export function assignedTasksQuery(
  raw: unknown,
  getProject: (projectId: string) => WatchedProject
): AssignedTasksQuery {
  if (!raw || typeof raw !== 'object') throw new Error('Send what My work should list')
  const input = raw as Record<string, unknown>
  if (typeof input.personId !== 'string' || !input.personId || input.personId.length > 100)
    throw new Error('Choose a person')
  if (typeof input.today !== 'string') throw new Error('today must use YYYY-MM-DD')
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200))
    throw new Error('Search for at most 200 characters')
  let projectId: string | null = null
  if (input.projectId !== undefined && input.projectId !== null) {
    if (typeof input.projectId !== 'string') throw new Error('Choose a project')
    projectId = getProject(input.projectId).id
  }
  return {
    personId: input.personId,
    projectId,
    hideDone: input.hideDone === true,
    query: typeof input.query === 'string' ? input.query : undefined,
    filter: input.filter === undefined ? undefined : parseTaskFilter(input.filter),
    today: input.today
  }
}

/** Workload's query from the renderer: enabled projects when named, and a last day. */
export function workloadTasksQuery(
  raw: unknown,
  getProject: (projectId: string) => WatchedProject
): WorkloadTasksQuery {
  if (!raw || typeof raw !== 'object') throw new Error('Send which weeks Workload shows')
  const input = raw as Record<string, unknown>
  if (typeof input.through !== 'string') throw new Error('through must use YYYY-MM-DD')
  let projectIds: string[] | null = null
  if (input.projectIds !== undefined && input.projectIds !== null) {
    if (!Array.isArray(input.projectIds) || input.projectIds.length > 500)
      throw new Error('Choose projects')
    projectIds = input.projectIds.map((id) => {
      if (typeof id !== 'string') throw new Error('Choose projects')
      return getProject(id).id
    })
  }
  return { projectIds, through: input.through }
}

/** The Team view's query from the renderer: a date, optionally a team id and chosen projects. */
export function teamOverviewQuery(
  raw: unknown,
  getProject: (projectId: string) => WatchedProject
): TeamOverviewQuery {
  if (!raw || typeof raw !== 'object') throw new Error('Send which week the Team view shows')
  const input = raw as Record<string, unknown>
  if (typeof input.today !== 'string') throw new Error('today must use YYYY-MM-DD')
  const query: TeamOverviewQuery = { today: input.today }
  if (input.teamId !== undefined && input.teamId !== null) {
    if (typeof input.teamId !== 'string' || input.teamId.length > 200)
      throw new Error('Choose a team')
    query.teamId = input.teamId
  }
  if (input.projectIds !== undefined && input.projectIds !== null) {
    if (!Array.isArray(input.projectIds) || input.projectIds.length > 500)
      throw new Error('Choose projects')
    query.projectIds = input.projectIds.map((id) => {
      if (typeof id !== 'string') throw new Error('Choose projects')
      return getProject(id).id
    })
  }
  return query
}

/**
 * Reschedule's query from the renderer (N1.3): a date, a mode the service
 * checks, task ids when named, and a person when named.
 */
export function rescheduleQuery(raw: unknown): RescheduleRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Send what to reschedule')
  const input = raw as Record<string, unknown>
  if (typeof input.today !== 'string') throw new Error('today must use YYYY-MM-DD')
  if (
    input.personId !== undefined &&
    input.personId !== null &&
    (typeof input.personId !== 'string' || input.personId.length > 100)
  )
    throw new Error('Choose a person')
  if (input.workItemIds !== undefined && !Array.isArray(input.workItemIds))
    throw new Error('workItemIds must be a list')
  return {
    ...rescheduleOptions(input),
    today: input.today,
    ...(input.workItemIds !== undefined ? { workItemIds: input.workItemIds as string[] } : {}),
    ...(typeof input.personId === 'string' ? { personId: input.personId } : {})
  }
}

/**
 * Home, the Inbox, and a task's repeat and reminders (P5.6). Home and the
 * Inbox are personal and cross-project; a task's calls resolve its project
 * first, as every planning call does.
 */
export function registerHomeHandlers({
  homeService,
  briefingService,
  writeBriefing,
  gettingStartedService,
  inboxService,
  planningService,
  rescheduleService,
  myDayService,
  weeklyReviewService,
  getProject,
  notifyHomeChanged,
  queueScheduledTaskNow
}: HomeHandlerDependencies): void {
  const keys = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length > 500) throw new Error('Send a list of Inbox items')
    return value as string[]
  }
  const inboxChange = (change: () => void) => {
    change()
    notifyHomeChanged()
    return inboxService.list()
  }
  const task = (workItemId: string) => {
    const item = planningService.getWorkItem(workItemId)
    getProject(item.projectId)
    return item
  }

  handleApi('getMyWork', async (_event, today: string) => homeService.getMyWork({ today }))
  handleApi('getAssignedTasks', async (_event, raw: unknown) =>
    homeService.getAssignedTasks(assignedTasksQuery(raw, getProject))
  )
  handleApi('getAssignedChecklistItems', async (_event, raw: unknown) => {
    const { personId, projectId, today } = assignedTasksQuery(raw, getProject)
    return homeService.getAssignedChecklistItems({ personId, projectId, today })
  })
  handleApi('getWorkloadTasks', async (_event, raw: unknown) =>
    homeService.getWorkloadTasks(workloadTasksQuery(raw, getProject))
  )
  handleApi('getTeamOverview', async (_event, raw: unknown) =>
    homeService.getTeamOverview(teamOverviewQuery(raw, getProject))
  )
  handleApi('getTimelineOverview', async () => homeService.getTimelineOverview())
  const myDayChange = <T>(change: () => T): T => {
    const result = change()
    notifyHomeChanged()
    return result
  }
  handleApi('getPlanMyDay', async (_event, today: string) => homeService.getPlanMyDay({ today }))
  handleApi('addToMyDay', async (_event, workItemId: string, placement: unknown) =>
    myDayChange(() =>
      myDayService.add(task(workItemId).id, myDayPlacement(placement), planningService.humanActor())
    )
  )
  handleApi('moveInMyDay', async (_event, workItemId: string, placement: unknown) =>
    myDayChange(() => myDayService.move(task(workItemId).id, myDayPlacement(placement)))
  )
  handleApi('removeFromMyDay', async (_event, workItemId: string, date: string) =>
    myDayChange(() => myDayService.remove(workItemId, date))
  )
  handleApi('startMyDay', async (_event, date: string, workItemIds: unknown) =>
    myDayChange(() => myDayService.start(date, workItemIds, planningService.humanActor()))
  )
  handleApi('letGoMyDay', async (_event, date: string, workItemIds: unknown) =>
    myDayChange(() =>
      myDayService.release(date, workItemIds === undefined ? undefined : (workItemIds as string[]))
    )
  )
  handleApi('previewReschedule', async (_event, raw: unknown) =>
    rescheduleService.preview(rescheduleQuery(raw))
  )
  handleApi('applyReschedule', async (_event, changes: unknown) => {
    const result = rescheduleService.apply(rescheduleChanges(changes), planningService.humanActor())
    notifyHomeChanged()
    return result
  })
  handleApi('previewMoveDependents', async (_event, moves: unknown) =>
    rescheduleService.planDependents(dependentMoves(moves))
  )
  handleApi('getNeedsYou', async () => homeService.getNeedsYou())
  handleApi('getWeeklyReview', async (_event, today: string) =>
    weeklyReviewService.getReview({ today })
  )
  handleApi('finishWeeklyReview', async (_event, steps: unknown) => {
    const record = weeklyReviewService.finish(reviewSteps(steps))
    // Home's "Last review" and the reminder's Inbox entry change.
    notifyHomeChanged()
    return record
  })
  handleApi('getLastWeeklyReview', async () => weeklyReviewService.last())
  handleApi('getBriefing', async (_event, since: unknown) =>
    briefingService.build({ since: briefingTime(since), until: Date.now() })
  )
  handleApi('writeBriefing', async (_event, since: unknown, until: unknown) => {
    const end = Math.min(briefingTime(until), Date.now())
    return writeBriefing(briefingService.build({ since: briefingTime(since), until: end }))
  })
  handleApi('getGettingStarted', async () => gettingStartedService.read())
  handleApi('recordGettingStarted', async (_event, activity: unknown) =>
    gettingStartedService.record(activity as GettingStartedActivity)
  )
  handleApi('dismissGettingStarted', async () => gettingStartedService.dismiss())
  handleApi('getInbox', async () => inboxService.list())
  handleApi('setInboxRead', async (_event, list: string[], read: boolean) =>
    inboxChange(() => inboxService.setRead(keys(list), read === true))
  )
  handleApi('archiveInboxItems', async (_event, list: string[]) =>
    inboxChange(() => inboxService.archive(keys(list)))
  )
  handleApi('unarchiveInboxItems', async (_event, list: string[]) =>
    inboxChange(() => inboxService.unarchive(keys(list)))
  )
  handleApi('markAllInboxRead', async () => inboxChange(() => inboxService.markAllRead()))
  handleApi('snoozeInboxReminder', async (_event, key: string, until: InboxSnooze) => {
    if (!SNOOZES.includes(until)) throw new Error('Snooze for an hour or until tomorrow')
    const match = typeof key === 'string' ? /^reminder:(.+)$/.exec(key) : null
    const reminder = match ? planningService.reminders.get(match[1]) : null
    if (!reminder) throw new Error('Only a reminder can be snoozed')
    getProject(reminder.projectId)
    return inboxChange(() => {
      planningService.reminders.reschedule(
        reminder.id,
        snoozeUntil(until, new Date(), reminder.keepReminding ? reminder.remindAt : undefined)
      )
      // It comes back as a new, unread item.
      inboxService.forget(key)
    })
  })

  handleApi('queueScheduledTaskNow', async (_event, workItemId: string) => {
    const id = task(String(workItemId)).id
    try {
      queueScheduledTaskNow(id)
    } finally {
      // Queued or not, the note now says where it stands.
      notifyHomeChanged()
    }
    return inboxService.list()
  })
  handleApi('getPlanningRecurrence', async (_event, workItemId: string) =>
    planningService.getRecurrence(task(workItemId).id)
  )
  handleApi(
    'setPlanningRecurrence',
    async (_event, workItemId: string, input: PlanningRecurrenceInput | null) =>
      planningService.setRecurrence(
        task(workItemId).id,
        input ?? null,
        planningService.humanActor()
      )
  )
  handleApi('getPlanningReminders', async (_event, workItemId: string) =>
    planningService.listReminders(task(workItemId).id)
  )
  handleApi(
    'addPlanningReminder',
    async (_event, workItemId: string, remindAt: number, options: unknown) =>
      planningService.addReminder(task(workItemId).id, remindAt, reminderOptions(options))
  )
  handleApi('stopPlanningReminder', async (_event, workItemId: string, reminderId: string) =>
    planningService.stopReminder(task(workItemId).id, String(reminderId))
  )
  handleApi('deletePlanningReminder', async (_event, workItemId: string, reminderId: string) => {
    planningService.deleteReminder(task(workItemId).id, reminderId)
    return undefined
  })
}
