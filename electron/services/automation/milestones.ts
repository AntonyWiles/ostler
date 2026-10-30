import type {
  CreatePlanningIterationInput,
  CreatePlanningMilestoneInput,
  PlanningIterationCarryOver,
  UpdatePlanningIterationInput,
  UpdatePlanningMilestoneInput
} from '@shared/ostler-api'
import { isRoundMeasure, roundComparisonCsv } from '@shared/export/rounds-csv'
import { Refusal } from '@shared/refusal'
import { DEFAULT_RELEASE_NOTES_OPTIONS } from '@shared/release-notes'
import { respondJson } from '../loopback-http'
import { checkReleaseNotesOptions, releaseNotesFor } from '../release-notes-service'
import { AUTOMATION_ACTOR, planningChanged, planningOf, queryFlag, respondCsv } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The planning service, after checking `:milestoneId` is a milestone of this project. */
function ourMilestone(call: RouteCall) {
  const planning = planningOf(call.server)
  const id = call.params.milestoneId!
  if (!planning.listMilestones(call.project.id).some((milestone) => milestone.id === id))
    throw new Refusal('Planning milestone not found')
  return planning
}

/** The iterations service, after checking `:iterationId` is an iteration of this project. */
function ourIteration(call: RouteCall) {
  const iterations = planningOf(call.server).iterations
  iterations.requireInProject(call.params.iterationId!, call.project.id)
  return iterations
}

/**
 * Release notes (N9.9): the same draft the app's Write release notes dialog
 * builds, from the milestone's or iteration's finished tasks, archived ones
 * included. Saving it is the ordinary Library routes.
 */
function releaseNotes(call: RouteCall, kind: 'milestone' | 'iteration', id: string): void {
  const { query } = call
  const options = checkReleaseNotesOptions({
    groupBy: query.get('groupBy') ?? DEFAULT_RELEASE_NOTES_OPTIONS.groupBy,
    descriptions: queryFlag(query, 'descriptions', DEFAULT_RELEASE_NOTES_OPTIONS.descriptions),
    subtasks: queryFlag(query, 'subtasks', DEFAULT_RELEASE_NOTES_OPTIONS.subtasks)
  })
  respondJson(call.res, 200, {
    ok: true,
    value: releaseNotesFor(planningOf(call.server), call.project.id, { kind, id }, options)
  })
}

/**
 * Milestones, with their repeating rounds (N5.7a: the schedule, and Start
 * next round now), and iterations (R6.1), through the same rules as the app.
 */
export const MILESTONES_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/milestones',
    description:
      'List milestones for the project. A repeating milestone has repeat: { rule, lengthDays, nextStart, on } and roundStart; a round made from an earlier one has previousRoundId (both left out otherwise). ?include=linkedFrom adds linkedFrom to each: the texts of this project that link to it, as in GET /links.',
    response:
      '{ ok: true, value: PlanningMilestone[] }; with ?include=linkedFrom, each also has linkedFrom: LinkedFromEntry[]',
    handler: ({ server, res, project, query }) =>
      respondJson(res, 200, {
        ok: true,
        value: server.withLinkedFrom(
          project,
          'milestone',
          query,
          planningOf(server).listMilestones(project.id)
        )
      })
  },
  {
    method: 'POST',
    path: '/milestones',
    description: 'Create a milestone, optionally linked to a goal.',
    request:
      'JSON body: { name: string, outcome?: string, goalId?: string | null, subprojectId?: string | null (one of this project’s workstreams, see GET /subprojects; one of another project is refused), targetDate?: "YYYY-MM-DD" | null, successCriteria?: string[] }.',
    response: '{ ok: true, value: PlanningMilestone }',
    exampleBody: {
      name: 'Sea trials',
      goalId: '<goal-id>',
      targetDate: '2026-09-30',
      successCriteria: ['The first trial completes without critical findings']
    },
    handler: (call) =>
      planningChanged(
        call,
        'POST planning milestones',
        planningOf(call.server).createMilestone(
          call.project.id,
          call.body as unknown as CreatePlanningMilestoneInput
        )
      )
  },
  {
    method: 'PATCH',
    path: '/milestones/:milestoneId',
    description: 'Update milestone fields or lifecycle status.',
    request:
      'JSON body with any of { name, outcome, goalId, subprojectId, targetDate, successCriteria, status: "planned" | "active" | "complete" | "archived" }.',
    response: '{ ok: true, value: PlanningMilestone }',
    exampleBody: { status: 'complete' },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH planning milestones',
        ourMilestone(call).updateMilestone(
          call.params.milestoneId!,
          call.body as UpdatePlanningMilestoneInput
        )
      )
  },
  {
    method: 'DELETE',
    path: '/milestones/:milestoneId',
    description:
      'Permanently delete a milestone. Refused while any work item still belongs to it; delete or reassign those first. To keep the record, PATCH status to "archived" instead.',
    response: '{ ok: true, value: { id, deleted: true } }',
    handler: (call) => {
      const id = call.params.milestoneId!
      // Refuses while work items still point at it.
      ourMilestone(call).deleteMilestone(id)
      planningChanged(call, 'DELETE planning milestones', { id, deleted: true })
    }
  },
  {
    method: 'PUT',
    path: '/milestones/:milestoneId/repeat',
    description:
      "Repeat this round, as the app's Repeat this round does: the milestone becomes a round of work that comes round again. rule is a repeat rule as a task's repeat takes it ({ every: day | week | month | year, interval?: 1-99, weekdays?: [0-6] for weekly rules, monthDay?: 1-31 for monthly and yearly rules }), anchored on the rounds' start days; lengthDays (1-366) is how many days a round lasts, its first and last day included; nextStart (YYYY-MM-DD) is when the next round starts, after this round started. On that day (checked when Ostler starts and every hour while it runs), or at once with POST /milestones/:milestoneId/next-round, Ostler makes the next round in one step: a milestone named after the series and the round (Accounts · May 2027: the month, Q2 2027 for every 3 months, the year, or the date for daily and weekly rounds) with the same outcome, success criteria and goal, its targetDate the round's last day, and a fresh copy of every task of the round that is not in the recycle bin and does not repeat by itself: in Backlog, checklists clear, dates moved on (by whole months for monthly and yearly rounds, the 31st landing on a shorter month's last day; by days otherwise), subtasks under their copied parents and waits-on links between the copies, each with roundSourceId naming the task it came from. Comments, time entries and the earlier tasks stay with the earlier round. The schedule then moves to the new round. If Ostler was closed through several start dates, only the latest round is made. Refused on a milestone that already has a later round. Setting it again changes the schedule and turns it on.",
    request:
      'JSON body: { rule: { every, interval?, weekdays?, monthDay? }, lengthDays: number, nextStart: "YYYY-MM-DD" }',
    response:
      '{ ok: true, value: PlanningMilestone } with repeat: { rule, lengthDays, nextStart, on: true } and roundStart (the first day of this round)',
    exampleBody: {
      rule: { every: 'month', interval: 1, monthDay: 1 },
      lengthDays: 10,
      nextStart: '2027-05-01'
    },
    handler: (call) =>
      planningChanged(
        call,
        'PUT milestone repeat',
        ourMilestone(call).rounds.setRepeat(call.params.milestoneId!, call.body)
      )
  },
  {
    method: 'DELETE',
    path: '/milestones/:milestoneId/repeat',
    description:
      'Stop repeating: the schedule turns off (repeat.on false) and stays; every earlier round stays as it is.',
    response: '{ ok: true, value: PlanningMilestone }',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE milestone repeat',
        ourMilestone(call).rounds.stopRepeating(call.params.milestoneId!)
      )
  },
  {
    method: 'POST',
    path: '/milestones/:milestoneId/next-round',
    description:
      'Start next round now: makes the next round at once, starting on repeat.nextStart even when that is still to come, exactly as the scheduled check does (see PUT /milestones/:milestoneId/repeat), and moves the schedule to it. Refused when the milestone does not repeat. The new round has previousRoundId set to this milestone; GET /milestones lists every round, so a series can be followed through previousRoundId.',
    response: '{ ok: true, value: PlanningMilestone } (the new round)',
    handler: (call) =>
      planningChanged(
        call,
        'POST milestone next-round',
        ourMilestone(call).rounds.startNextRound(call.params.milestoneId!, AUTOMATION_ACTOR)
      )
  },
  {
    method: 'GET',
    path: '/milestones/:milestoneId/rounds',
    description:
      "Compare rounds, as the app's Compare rounds shows it: the series of rounds this milestone belongs to (followed through previousRoundId; a milestone that is no round is a series of one), counted exactly as GET /reports?range=milestone:<id> counts each round. rounds, oldest first, each { milestoneId, name, start (YYYY-MM-DD, the round's first day), targetDate, plannedDays (start to targetDate, both included; null without a target date), firstStartedAt (epoch ms: the first move of any of its tasks into active, else ready, else its first finish), lastFinishedAt (its last finish, once nothing is open), tookDays (local days from the first start to the last finish, both included; to today while tasks are open; null while nothing started), finished, done, wontDo, open, timeTrackedSeconds, summary }. tasks: one row per task followed across rounds through each copy's roundSourceId, so a task renamed between rounds is one row; a copy whose source is missing starts a row of its own. Each row is { title (its latest), cells, slowestCycleRound, slowestTimeRound }: cells line up with rounds, null where the task is not in that round, else { workItemId, title, outcome: done | wont-do | open, cycleTimeMs (as the reports count it: first active, else ready, to its last move into done; null unless done), timeTrackedSeconds }; slowestCycleRound and slowestTimeRound are the index of the round with the longest cycle time or the most time tracked, when two or more rounds have one (else null). hasTimeTracked says whether any task of the series has time entries. ?format=csv returns the CSV the app's Export CSV writes (Content-Type text/csv): Task, then a column per round, oldest first, with ?measure=cycle (the default: days, one decimal) or ?measure=time (hours); a cell without a number says why (not in this round, won’t do, open, not started). Read only.",
    response: '{ ok: true, value: RoundComparison } (format=csv: text/csv)',
    handler: (call) => {
      const { server, res, project, query } = call
      if (!server.reports)
        return respondJson(res, 503, { ok: false, error: 'Reports are unavailable' })
      ourMilestone(call)
      const comparison = server.reports.getRoundComparison(project, call.params.milestoneId!)
      if (query.get('format') === 'csv') {
        const measure = query.get('measure') ?? 'cycle'
        if (!isRoundMeasure(measure)) throw new Refusal('measure must be cycle or time')
        return respondCsv(res, roundComparisonCsv(comparison, measure))
      }
      respondJson(res, 200, { ok: true, value: comparison })
    }
  },
  {
    method: 'GET',
    path: '/milestones/:milestoneId/release-notes',
    description:
      "A draft of release notes for the milestone, as the app's Write release notes writes it: a Markdown title (\"Release notes: <name>\"), the day the milestone was completed (or today), a count of finished tasks, then a bullet per finished task. Done tasks count, archived ones included; open, won't-do and recycle-bin tasks do not. ?groupBy=type (the default: sections per task type in the project's order, then Other), label (by each task's first label, then Other) or none. ?descriptions=true adds each task's first sentence after its title. ?subtasks=true lists finished subtasks under their parent (left out by default). Characters that mean something in Markdown are escaped in titles. Nothing is saved: to keep the draft, POST /library with kind note, the title, the markdown as body and tags [\"release-notes\"].",
    response: '{ ok: true, value: { title, markdown, taskTitles: string[] } }',
    handler: (call) => releaseNotes(call, 'milestone', call.params.milestoneId!)
  },
  {
    method: 'GET',
    path: '/iterations',
    description:
      "List the project's iterations (sprints or cycles), oldest first. Each has a name, startDate and endDate (YYYY-MM-DD, local days, the end day included), an optional goal sentence and a status: planned, active or finished. A finished one keeps its summary: doneCount and doneEstimate, carriedCount and carriedEstimate, carryOver and carriedToIterationId. A project's iterations never overlap and at most one is active. Tasks name theirs in iterationId; filter them with ?filter= on GET /work-items (field iteration). The active iteration's burn-down is iterationBurndown in GET /reports.",
    response: '{ ok: true, value: PlanningIteration[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).iterations.list(project.id) })
  },
  {
    method: 'POST',
    path: '/iterations',
    description:
      'Create an iteration, planned. Refused when its dates overlap another iteration of the project, or it ends before it starts.',
    request:
      'JSON body: { name: string (up to 80 characters), startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", goal?: string (up to 300) }',
    response: '{ ok: true, value: PlanningIteration }',
    exampleBody: { name: 'Sprint 1', startDate: '2026-10-19', endDate: '2026-11-01' },
    handler: (call) =>
      planningChanged(
        call,
        'POST planning iterations',
        planningOf(call.server).iterations.create(
          call.project.id,
          call.body as unknown as CreatePlanningIterationInput
        )
      )
  },
  {
    method: 'PATCH',
    path: '/iterations/:iterationId',
    description: 'Rename an iteration, change its dates or its goal. Overlaps are refused.',
    request: 'JSON body with any of { name, startDate, endDate, goal }.',
    response: '{ ok: true, value: PlanningIteration }',
    exampleBody: { endDate: '2026-11-03' },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH planning iterations',
        ourIteration(call).update(
          call.params.iterationId!,
          call.body as UpdatePlanningIterationInput
        )
      )
  },
  {
    method: 'POST',
    path: '/iterations/:iterationId/start',
    description:
      'Make a planned iteration the active one. Refused while another iteration is active, or when it is finished.',
    response: '{ ok: true, value: PlanningIteration }',
    handler: (call) =>
      planningChanged(
        call,
        'POST planning iterations',
        ourIteration(call).start(call.params.iterationId!)
      )
  },
  {
    method: 'POST',
    path: '/iterations/:iterationId/finish',
    description:
      'Finish the active iteration. Its unfinished tasks (live and not Done) move to the next planned iteration (carryOver "next": the earliest that starts after this one ends; refused when there is none) or out of any iteration (carryOver "none"). Done and archived tasks stay in it. The iteration keeps its summary.',
    request: 'JSON body: { carryOver: "next" | "none" }',
    response: '{ ok: true, value: { iteration: PlanningIteration, movedTaskIds: string[] } }',
    exampleBody: { carryOver: 'next' },
    handler: (call) =>
      planningChanged(
        call,
        'POST planning iterations',
        ourIteration(call).finish(
          call.params.iterationId!,
          call.body.carryOver as PlanningIterationCarryOver,
          AUTOMATION_ACTOR
        )
      )
  },
  {
    method: 'DELETE',
    path: '/iterations/:iterationId',
    description:
      "Delete an iteration. Its tasks keep everything but the iteration. The answer holds what was deleted and the tasks that were in it, as the app's Undo uses.",
    response: '{ ok: true, value: { iteration: PlanningIteration, taskIds: string[] } }',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE planning iterations',
        ourIteration(call).delete(call.params.iterationId!)
      )
  },
  {
    method: 'GET',
    path: '/iterations/:iterationId/release-notes',
    description:
      'A draft of release notes for the iteration, built from its finished tasks exactly as GET /milestones/:milestoneId/release-notes builds them (the same ?groupBy=type|label|none, ?descriptions= and ?subtasks=). The day is when the iteration was finished, or today.',
    response: '{ ok: true, value: { title, markdown, taskTitles: string[] } }',
    handler: (call) => releaseNotes(call, 'iteration', call.params.iterationId!)
  }
]
