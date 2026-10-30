import { isIsoDate, todayIsoDate } from '@shared/dates'
import {
  MATRIX_BOXES,
  URGENT_WITHIN_DAYS,
  matrixCandidates,
  sortIntoMatrix
} from '@shared/planning/matrix'
import { planChanges } from '@shared/planning/reschedule'
import { Refusal } from '@shared/refusal'
import {
  FindReplaceService,
  MAX_FIND_REPLACE_MATCHES,
  findReplaceQuery
} from '../find-replace-service'
import { respondJson } from '../loopback-http'
import { rescheduleOptions } from '../reschedule-service'
import { lastWeeklyReview } from '../weekly-review-service'
import { AUTOMATION_ACTOR, planningChanged, planningOf } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The reschedule plan for this project, from the body's options. */
function reschedulePlan({ server, project, body }: RouteCall) {
  const reschedule = server.rescheduleService()
  if (body.today !== undefined && !isIsoDate(body.today))
    throw new Refusal('today must use YYYY-MM-DD')
  if (body.workItemIds !== undefined && !Array.isArray(body.workItemIds))
    throw new Refusal('workItemIds must be a list of task ids')
  const plan = reschedule.preview({
    ...rescheduleOptions(body),
    today: (body.today as string | undefined) ?? todayIsoDate(),
    projectId: project.id,
    ...(body.workItemIds !== undefined ? { workItemIds: body.workItemIds as string[] } : {})
  })
  return { reschedule, plan }
}

/** Find and replace (N2.5): the same service as the app's, for this token's project only. */
function findReplace({ server, project, body }: RouteCall) {
  const service = new FindReplaceService(planningOf(server))
  return { service, query: findReplaceQuery(project.id, body) }
}

/**
 * Whole-project tools: reschedule, find and replace, the priority matrix
 * (N7.5, the same rule as the app's Matrix view) and the last weekly review.
 */
export const PROJECT_TOOLS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'POST',
    path: '/reschedule/preview',
    description: `Plan new due dates for overdue tasks without changing anything, as the app's Reschedule… does. By default the plan covers this project's overdue tasks assigned to Me or to nobody (as Home's Today counts them); workItemIds names live, unfinished tasks with a due date instead. mode "today", "tomorrow" or "date" (with date) puts every due date on that day; "spread" fills the next working days from tomorrow (days, 1 to 30, default 5), highest priority first, then the oldest due date, each day up to Me's daily hours (weekly capacity over working days, from GET /people) counting the work already due that day; a task with no hour estimate, or in a points project, counts as one hour; without a capacity a day takes three tasks; what does not fit goes on the last day. A start date moves with its due date, keeping the gap. Each entry lists warnings: a task that would now start before something it waits on is due (the other task is not moved). A repeating task's occurrence moves; its repeat rule does not change. today (YYYY-MM-DD) defaults to the computer's local date.`,
    request:
      'JSON body: { mode: "today" | "tomorrow" | "date" | "spread", date?: "YYYY-MM-DD", days?: number, workItemIds?: string[], today?: "YYYY-MM-DD" }',
    response:
      '{ ok: true, value: { mode, days: string[] (the days spread over), entries: Array<{ id, projectId, title, fromDue, toDue, fromStart, toStart, recurring, warnings: Array<{ taskId, taskTitle, dependencyId, dependencyTitle, start, dependencyDue }> }> } }',
    exampleBody: { mode: 'spread', days: 5 },
    handler: (call) => respondJson(call.res, 200, { ok: true, value: reschedulePlan(call).plan })
  },
  {
    method: 'POST',
    path: '/reschedule/apply',
    description:
      'Plan as POST /reschedule/preview does with the same body, and apply the plan in one transaction, each task through the same update as PATCH /work-items/:workItemId (activity, reminders, search, repeats and rules see every change). A task whose dates changed while the plan was made is skipped and reported, never overwritten. To undo, PATCH each changed task back to its fromDue and fromStart.',
    request: 'JSON body: the same as POST /reschedule/preview.',
    response:
      '{ ok: true, value: { changed: Array<{ id, fromDue, toDue, fromStart, toStart }>, skipped: Array<{ id, title, reason: "changed" | "missing" }> } }',
    exampleBody: { mode: 'tomorrow' },
    handler: (call) => {
      const { reschedule, plan } = reschedulePlan(call)
      const value = reschedule.apply(planChanges(plan.entries), AUTOMATION_ACTOR, call.project.id)
      planningChanged(call, `automation-api reschedule ${value.changed.length} tasks`, value)
    }
  },
  {
    method: 'GET',
    path: '/reviews/last',
    description:
      "When the person last finished a weekly review, and what each step showed and changed, or null when there has been none. A weekly review is personal and spans every project, so this is the same for every project's token. The review's lists are task filters on GET /work-items (see the weekly review section of the automation API docs); there are no separate list routes.",
    response:
      '{ ok: true, value: null | { id, finishedAt (ms), steps: { [step in "inbox" | "overdue" | "blocked" | "stale" | "someday" | "upcoming" | "milestones"]?: { shown, changed } } } }',
    handler: ({ server, res }) =>
      respondJson(res, 200, { ok: true, value: lastWeeklyReview(planningOf(server).database) })
  },
  {
    method: 'GET',
    path: '/matrix',
    description:
      "The project's priority matrix, as the app's Matrix view sorts it: the open tasks the Board shows (live, not done or Won't do, not in Someday or shown from a later date) in four boxes. Important is priority high or critical; urgent is overdue or due within three days of date (today plus three), and a task with no due date is never urgent. Each box lists task ids in the view's order: due date (undated last), then priority, then title. To move a task between the important and the other boxes, change its priority with PATCH /work-items/:workItemId (the app sets high when a card goes up and medium when it goes down); to move it between urgent and not urgent, change its due date (targetDate). date (YYYY-MM-DD, the person's local date) defaults to the computer's local date.",
    request: 'Query: date?: YYYY-MM-DD',
    response:
      '{ ok: true, value: { date, urgentWithinDays: 3, boxes: { urgentImportant: string[], important: string[], urgent: string[], neither: string[] } } }',
    handler: ({ server, res, project, query }) => {
      planningOf(server)
      const date = query.get('date') ?? todayIsoDate()
      if (!isIsoDate(date)) throw new Refusal('date must be a calendar date, YYYY-MM-DD')
      const boxes = sortIntoMatrix(matrixCandidates(server.projectedWorkItems(project), date), date)
      respondJson(res, 200, {
        ok: true,
        value: {
          date,
          urgentWithinDays: URGENT_WITHIN_DAYS,
          boxes: Object.fromEntries(
            MATRIX_BOXES.map((box) => [box, boxes[box].map((item) => item.id)])
          )
        }
      })
    }
  },
  {
    method: 'POST',
    path: '/find-replace/preview',
    description:
      "Find a plain text (never a pattern) in this project's task titles, descriptions and checklist items without changing anything, as the app's Find and replace does. Comments, the Library, decisions, milestones and goals are never searched. matchCase and wholeWords default to false; includeArchived adds archived tasks. Each match has an id for POST /find-replace/apply, the field it is in (title, description or checklist, with itemIndex), where it starts, the text it matched and the text around it. A match whose replacement would break a rule has a problem (titleEmpty, titleTooLong, descriptionTooLong, checklistEmpty, checklistTooLong, or checklistDuplicate: two checklist items alike would merge, as ticks are keyed by an item's text) and cannot be applied. At most 5000 matches come back; truncated says there were more.",
    request:
      'JSON body: { find: string, replace: string, matchCase?: boolean, wholeWords?: boolean, includeArchived?: boolean }',
    response:
      '{ ok: true, value: { matches: Array<{ id, taskId, taskTitle, archived, field: "title" | "description" | "checklist", itemIndex: number | null, start, text, before, after, cutBefore, cutAfter, problem: string | null }>, taskCount, truncated } }',
    exampleBody: { find: 'Acme', replace: 'Apex', wholeWords: true },
    handler: (call) => {
      const { service, query } = findReplace(call)
      respondJson(call.res, 200, { ok: true, value: service.preview(query) })
    }
  },
  {
    method: 'POST',
    path: '/find-replace/apply',
    description:
      "Find as POST /find-replace/preview does with the same body, and replace the matches matchIds names in one transaction, each task through the same update as PATCH /work-items/:workItemId (activity, search, reminders and rules see every change). A renamed checklist item keeps its tick. A match id no longer found (the task changed since the preview), or a task whose new text would break a rule, is skipped and reported, never overwritten. To undo, PATCH each changed task's title, description and acceptanceCriteria back to its from values.",
    request: 'JSON body: the same as POST /find-replace/preview, plus matchIds: string[].',
    response:
      '{ ok: true, value: { changed: Array<{ id, from: { title, description, acceptanceCriteria }, to: { title, description, acceptanceCriteria }, renamed: Array<[string, string]> }>, skipped: Array<{ id, title, reason: "changed" | "missing" | "invalid" }> } }',
    exampleBody: { find: 'Acme', replace: 'Apex', wholeWords: true, matchIds: ['<match-id>'] },
    handler: (call) => {
      const { service, query } = findReplace(call)
      const ids = call.body.matchIds
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > MAX_FIND_REPLACE_MATCHES ||
        !ids.every((matchId) => typeof matchId === 'string' && matchId.length <= 300)
      )
        throw new Refusal(`matchIds must list 1 to ${MAX_FIND_REPLACE_MATCHES} match ids`)
      const value = service.applyIds(query, ids as string[], AUTOMATION_ACTOR)
      planningChanged(
        call,
        `automation-api find and replace in ${value.changed.length} tasks`,
        value
      )
    }
  }
]
