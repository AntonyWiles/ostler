import type { CreatePlanningGoalInput, UpdatePlanningGoalInput } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { splitGoal } from '../goal-split'
import { respondJson } from '../loopback-http'
import { AUTOMATION_ACTOR, planningChanged, planningOf } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The planning service, after checking `:goalId` is a goal of this project. */
function ourGoal(call: RouteCall) {
  const planning = planningOf(call.server)
  if (planning.getGoal(call.params.goalId!).projectId !== call.project.id)
    throw new Refusal('Planning goal belongs to another project')
  return planning
}

/** A change to a goal of one's own, recorded in change history (nothing on the Board changes). */
function personalGoalChanged(call: RouteCall, value: unknown): void {
  call.server.recordMutation(call.project, call.path, `${call.req.method} personal goal`)
  respondJson(call.res, 200, { ok: true, value })
}

/** The goals of one's own service. */
function personalGoals(call: RouteCall) {
  return planningOf(call.server).personalGoals
}

/**
 * Goals and their check-ins (N5.6a), recorded as the automation API; and
 * goals of one's own (N5.6b): global, like contacts, so any project's token
 * may manage them, through the service the app uses.
 */
export const GOALS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/goals',
    description: 'List goals for the project.',
    response: '{ ok: true, value: PlanningGoal[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).listGoals(project.id) })
  },
  {
    method: 'POST',
    path: '/goals',
    description:
      'Create a goal. Goals describe an outcome; target dates and success criteria belong to milestones.',
    request:
      'JSON body: { title: string, outcome?: string, measure?: GoalMeasure }. GoalMeasure gives the goal a number: { unit?: string (at most 20 characters, such as "members", "£" or "km"), startValue: number, targetValue: number, startDate: "YYYY-MM-DD", targetDate: "YYYY-MM-DD" (after startDate), direction?: "up" | "down" }. direction says whether higher or lower is better; it defaults to the way the target lies from the start, and one that disagrees with it is refused.',
    response:
      '{ ok: true, value: PlanningGoal } (PlanningGoal: { id, projectId, title, outcome, status, measure: GoalMeasure | null, createdAt, updatedAt })',
    exampleBody: {
      title: 'Launch the fishing-boat beta',
      outcome: 'A user can complete the first trip workflow.'
    },
    handler: (call) =>
      planningChanged(
        call,
        'POST planning goals',
        planningOf(call.server).createGoal(
          call.project.id,
          call.body as unknown as CreatePlanningGoalInput
        )
      )
  },
  {
    method: 'PATCH',
    path: '/goals/:goalId',
    description:
      "Update a goal title/outcome, lifecycle status or measure. Reaching a measure's target never changes the status: set status achieved yourself.",
    request:
      'JSON body with any of { title, outcome, status: "active" | "achieved" | "archived", measure: GoalMeasure | null } (GoalMeasure as for POST /goals; null takes the measure away and keeps its check-ins).',
    response: '{ ok: true, value: PlanningGoal }',
    exampleBody: { status: 'achieved' },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH planning goals',
        ourGoal(call).updateGoal(call.params.goalId!, call.body as UpdatePlanningGoalInput)
      )
  },
  {
    method: 'DELETE',
    path: '/goals/:goalId',
    description:
      'Permanently delete a goal. Refused while any milestone still belongs to it; delete or reassign those first. To keep the record, PATCH status to "archived" instead.',
    response: '{ ok: true, value: { id, deleted: true } }',
    handler: (call) => {
      const id = call.params.goalId!
      // Refuses while milestones still point at it.
      ourGoal(call).deleteGoal(id)
      planningChanged(call, 'DELETE planning goals', { id, deleted: true })
    }
  },
  {
    method: 'GET',
    path: '/goals/:goalId/check-ins',
    description:
      "List a goal's check-ins, oldest first: the readings of its measure, one per day at most. The app works out progress from these and the measure: the latest value (the start value without check-ins), and whether it is ahead of, behind or within 5% of the straight line from start to target.",
    response:
      '{ ok: true, value: GoalCheckIn[] } (GoalCheckIn: { goalId, projectId, date: "YYYY-MM-DD", value: number, note, recordedAt })',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: ourGoal(call).goalCheckIns.list(call.params.goalId!)
      })
  },
  {
    method: 'POST',
    path: '/goals/:goalId/check-ins',
    description:
      'Record a check-in, as Check in does in the app; it is recorded by the automation API and shows in the project activity. A goal has one check-in a day: a second for the same date replaces the first, and replaced returns the one it replaced. The goal need not have a measure yet. The note is trimmed, at most 500 characters.',
    request: 'JSON body: { date: "YYYY-MM-DD", value: number, note?: string }',
    response: '{ ok: true, value: { checkIn: GoalCheckIn, replaced: GoalCheckIn | null } }',
    exampleBody: { date: '2026-10-17', value: 142, note: 'After the open day' },
    handler: (call) =>
      planningChanged(
        call,
        'POST goal check-in',
        ourGoal(call).goalCheckIns.record(call.params.goalId!, call.body, AUTOMATION_ACTOR)
      )
  },
  {
    method: 'DELETE',
    path: '/goals/:goalId/check-ins/:date',
    description: "Remove a goal's check-in for that date (YYYY-MM-DD); returns it as it was.",
    response: '{ ok: true, value: GoalCheckIn }',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE goal check-in',
        ourGoal(call).goalCheckIns.delete(call.params.goalId!, call.params.date!)
      )
  },
  {
    method: 'PUT',
    path: '/goals/:goalId/counts-towards',
    description:
      "Make one of this project's goals count towards a goal of your own (see GET /personal-goals), or towards none with null. A goal counts towards at most one; sending another moves it. Both goals need a measure with the same unit (case aside) and the same direction, or it is refused in words. The goal of your own then takes its value as the sum of the latest values of the goals that count towards it. Neither goal's check-ins change, and the link never goes in a project file.",
    request: 'JSON body: { personalGoalId: string | null }',
    response:
      '{ ok: true, value: { goalId, personalGoalId: string | null, previous: string | null } }',
    exampleBody: { personalGoalId: '00000000-0000-4000-8000-000000000000' },
    handler: (call) => {
      const planning = ourGoal(call)
      if (call.body.personalGoalId === undefined)
        throw new Refusal('Send personalGoalId: the id of a goal of your own, or null')
      const value = planning.personalGoals.setCountsTowards(
        call.params.goalId!,
        call.body.personalGoalId
      )
      call.server.recordMutation(call.project, call.path, 'PUT goal counts towards')
      respondJson(call.res, 200, { ok: true, value })
    }
  },
  {
    method: 'GET',
    path: '/personal-goals',
    description:
      'List goals of your own: goals outside any project, such as "Save £5,000", shared by every project\'s token, as people are. Active first, then achieved, then dropped. Each has the same optional measure as a project goal, its own check-ins, and links: the project goals that count towards it, with their projectId, measure, latest value and mismatch (null while it counts; "unit", "direction" or "no-measure" when its measure changed since and it no longer counts). With links that count, fromLinks is true and readings are the summed latest values of the linked goals on each day any was checked in; without, readings are its own check-ins. progress is { latest, latestDate, share, expected, gap, pace: "ahead" | "on-pace" | "behind" | "reached" }, as for a project goal, or null without a measure. They never go in a project file.',
    response:
      '{ ok: true, value: Array<{ id, title, outcome, status: "active" | "achieved" | "dropped", measure: GoalMeasure | null, checkIns: PersonalGoalCheckIn[], links: Array<{ goalId, projectId, title, measure, latest, mismatch, createdAt }>, fromLinks: boolean, readings: Array<{ date, value }>, progress: GoalProgress | null, createdAt, updatedAt }> }',
    handler: (call) => respondJson(call.res, 200, { ok: true, value: personalGoals(call).list() })
  },
  {
    method: 'GET',
    path: '/personal-goals/:personalGoalId',
    description: 'One goal of your own, as GET /personal-goals lists it.',
    response: '{ ok: true, value: PersonalGoalView }',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: personalGoals(call).get(call.params.personalGoalId!)
      })
  },
  {
    method: 'POST',
    path: '/personal-goals',
    description: 'Add a goal of your own. It starts active.',
    request:
      'JSON body: { title: string (up to 160 characters), outcome?: string (up to 4,000), measure?: GoalMeasure } (GoalMeasure as for POST /goals).',
    response: '{ ok: true, value: PersonalGoalView }',
    exampleBody: {
      title: 'Save £5,000',
      measure: {
        unit: '£',
        startValue: 0,
        targetValue: 5000,
        startDate: '2026-01-01',
        targetDate: '2026-12-31'
      }
    },
    handler: (call) => personalGoalChanged(call, personalGoals(call).create(call.body))
  },
  {
    method: 'PATCH',
    path: '/personal-goals/:personalGoalId',
    description:
      'Change a goal of your own: its title, outcome, status or measure. null takes the measure away and keeps its check-ins. Reaching the target never changes the status: set achieved yourself.',
    request:
      'JSON body with any of { title, outcome, status: "active" | "achieved" | "dropped", measure: GoalMeasure | null }.',
    response: '{ ok: true, value: PersonalGoalView }',
    exampleBody: { status: 'achieved' },
    handler: (call) =>
      personalGoalChanged(call, personalGoals(call).update(call.params.personalGoalId!, call.body))
  },
  {
    method: 'DELETE',
    path: '/personal-goals/:personalGoalId',
    description:
      'Delete a goal of your own with its check-ins and links. The project goals that counted towards it, and their check-ins, stay as they are.',
    response: '{ ok: true, value: { id, deleted: true } }',
    handler: (call) => {
      const id = call.params.personalGoalId!
      personalGoals(call).delete(id)
      personalGoalChanged(call, { id, deleted: true })
    }
  },
  {
    method: 'GET',
    path: '/personal-goals/:personalGoalId/check-ins',
    description:
      "A goal of your own's check-ins, oldest first, one a day at most. They count only while no project goal counts towards it.",
    response:
      '{ ok: true, value: PersonalGoalCheckIn[] } (PersonalGoalCheckIn: { personalGoalId, date: "YYYY-MM-DD", value: number, note, recordedAt })',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: personalGoals(call).listCheckIns(call.params.personalGoalId!)
      })
  },
  {
    method: 'POST',
    path: '/personal-goals/:personalGoalId/check-ins',
    description:
      'Check in on a goal of your own. A second check-in for the same date replaces the first, and replaced returns the one it replaced. The note is trimmed, at most 500 characters.',
    request: 'JSON body: { date: "YYYY-MM-DD", value: number, note?: string }',
    response:
      '{ ok: true, value: { checkIn: PersonalGoalCheckIn, replaced: PersonalGoalCheckIn | null } }',
    exampleBody: { date: '2026-10-17', value: 6, note: 'Finished Middlemarch' },
    handler: (call) =>
      personalGoalChanged(
        call,
        personalGoals(call).recordCheckIn(call.params.personalGoalId!, call.body, AUTOMATION_ACTOR)
      )
  },
  {
    method: 'DELETE',
    path: '/personal-goals/:personalGoalId/check-ins/:date',
    description:
      "Remove a goal of your own's check-in for that date (YYYY-MM-DD); returns it as it was.",
    response: '{ ok: true, value: PersonalGoalCheckIn }',
    handler: (call) =>
      personalGoalChanged(
        call,
        personalGoals(call).deleteCheckIn(call.params.personalGoalId!, call.params.date!)
      )
  },
  {
    method: 'POST',
    path: '/goals/:goalId/split',
    description:
      'Create milestones and work items linked to a goal; returns one result per input item. Without refs each item succeeds or fails on its own. With refs the batch is one transaction: any error answers 400 and creates nothing.',
    request:
      'JSON body: { items: Array<{ type: "milestone" | "work-item", ref?, ...definition }> }. Work items link to a milestone with milestoneId, or to a milestone in the same batch with milestoneRef. A work item may also name parentRef (its parent work item in the batch) and dependencyRefs (work items in the batch it depends on). Refs are letters, digits, - or _, unique in the batch; unknown refs and dependency or subtask loops are refused.',
    response:
      '{ ok: true, value: Array<{ index, ok: true, value } | { index, ok: false, error }> }',
    exampleBody: {
      items: [
        {
          type: 'milestone',
          ref: 'hull',
          name: 'Prepare the hull',
          outcome: 'The boat is ready for sea trials.',
          targetDate: '2026-09-15',
          successCriteria: ['Inspection checklist passes']
        },
        {
          type: 'work-item',
          ref: 'inspect',
          milestoneRef: 'hull',
          title: 'Inspect the hull',
          status: 'ready',
          priority: 'high',
          labels: ['boat'],
          acceptanceCriteria: ['All inspection results are recorded']
        },
        {
          type: 'work-item',
          ref: 'patch',
          title: 'Patch the hull',
          milestoneRef: 'hull',
          dependencyRefs: ['inspect']
        }
      ]
    },
    handler: (call) =>
      planningChanged(
        call,
        'POST planning goals',
        splitGoal(
          planningOf(call.server),
          call.project.id,
          call.params.goalId!,
          call.body,
          AUTOMATION_ACTOR
        )
      )
  }
]
