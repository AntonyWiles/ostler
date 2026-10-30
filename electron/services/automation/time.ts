import type { TimeEntry } from '@shared/ostler-api'
import { isIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { dayRange } from '@shared/time/timesheet'
import { parseDuration } from '@shared/time/duration'
import { buildTimeEntriesCsv } from '../export-service'
import { respondJson } from '../loopback-http'
import { planningOf, respondCsv } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** A moment from the API: epoch milliseconds, or an ISO 8601 date and time. */
function apiMoment(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const at = Date.parse(value)
    if (Number.isFinite(at)) return at
  }
  throw new Refusal(
    'startedAt must be epoch milliseconds or an ISO date and time, such as 2026-10-14T09:30'
  )
}

/** durationSeconds, or duration as "1h 30m", "1.5h" or "90m". */
function apiDuration(body: Record<string, unknown>): number {
  if (body.durationSeconds !== undefined) return body.durationSeconds as number
  const seconds = typeof body.duration === 'string' ? parseDuration(body.duration, '.') : null
  if (seconds === null)
    throw new Refusal(
      'Send durationSeconds, or duration as "1h 30m", "1.5h" or "90m" (at most a week)'
    )
  return seconds
}

/** A time entry change, recorded in change history (the timer pushes its own change). */
function timeChanged(call: RouteCall, summary: string, value: unknown): void {
  call.server.recordMutation(call.project, call.path, summary)
  respondJson(call.res, 200, { ok: true, value })
}

/** The focus service, or an error when main has not set one up. */
function focusOf({ server }: RouteCall) {
  if (!server.focus) throw new Error('Focus unavailable')
  return server.focus
}

/**
 * Time tracking (R2.3): a project's time entries and the one timer, through
 * `planning.time`, the same rules the app uses. The timer is shared by
 * every project, so `GET /timer` may name another project's task.
 *
 * Focus (N3.5): the same `FocusService` as the app, so the timer, the tray
 * and held notifications follow. A focus is global, like the timer, so
 * `GET /focus` may name another project's task; starting one takes a task
 * of this token's project.
 */
export const TIME_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/time-entries',
    description:
      'List the project\'s time entries, in start order. An entry is { id, projectId, workItemId, workItemTitle, personId, startedAt (epoch ms), durationSeconds (null while its timer runs), note, source: "timer" | "manual", billable (whether it is charged for), billingId (the billing it was marked billed in, or null), createdAt, updatedAt }. An entry belongs to the local day it started on. ?from=YYYY-MM-DD&to=YYYY-MM-DD keeps entries that started on those local days (inclusive); ?workItemId= keeps one task\'s; ?personId= keeps one person\'s ("nobody" for entries without one). ?format=csv returns the Timesheet\'s CSV instead (Content-Type text/csv): Date, Project, Task, Person, Duration (hours) as a plain number, Note.',
    response: '{ ok: true, value: TimeEntry[] } (format=csv: text/csv)',
    handler: ({ server, res, project, query: params }) => {
      const planning = planningOf(server)
      const day = (name: string) => {
        const text = params.get(name)
        if (text === null) return null
        if (!isIsoDate(text)) throw new Refusal(`${name} must be a date, YYYY-MM-DD`)
        return text
      }
      const from = day('from')
      const to = day('to')
      const range =
        from === null && to === null
          ? { from: 0, to: Number.MAX_SAFE_INTEGER }
          : dayRange(from ?? '1970-01-01', to ?? '9999-12-31')
      const personText = params.get('personId')
      const query = {
        ...range,
        projectIds: [project.id],
        ...(personText === null ? {} : { personId: personText === 'nobody' ? null : personText })
      }
      const workItemId = params.get('workItemId')
      if (params.get('format') === 'csv')
        return respondCsv(res, buildTimeEntriesCsv(planning, [project], query).text)
      const entries = planning.time.list(query, [project.id])
      respondJson(res, 200, {
        ok: true,
        value:
          workItemId === null ? entries : entries.filter((entry) => entry.workItemId === workItemId)
      })
    }
  },
  {
    method: 'GET',
    path: '/time-entries/:entryId',
    description: 'One time entry of this project.',
    response: '{ ok: true, value: TimeEntry }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).time.getForProject(project.id, params.entryId!)
      })
  },
  {
    method: 'POST',
    path: '/time-entries',
    description:
      'Log time on a task by hand (source "manual"). The task must be in this project and not archived or in the recycle bin. personId defaults to Me (see GET /people); null logs it to nobody. billable defaults to the project\'s newTimeBillable (GET /billing-settings), as a timer\'s entry does. A duration is at most a week; a note at most 500 characters.',
    request:
      'JSON body: { workItemId: string, startedAt: epoch ms or "YYYY-MM-DDTHH:mm" (local time), durationSeconds?: number, duration?: "1h 30m" | "1.5h" | "90m", note?: string, personId?: string | null, billable?: boolean }. Send durationSeconds or duration.',
    response: '{ ok: true, value: TimeEntry }',
    exampleBody: {
      workItemId: '<work item id>',
      startedAt: '2026-10-14T09:30',
      duration: '1h 30m',
      note: 'Client call'
    },
    handler: (call) => {
      const { body } = call
      timeChanged(
        call,
        'POST time entry',
        planningOf(call.server).time.create(call.project.id, {
          workItemId: body.workItemId as string,
          startedAt: apiMoment(body.startedAt),
          durationSeconds: apiDuration(body),
          ...(body.note === undefined ? {} : { note: body.note as string }),
          ...(body.personId === undefined ? {} : { personId: body.personId as string | null }),
          ...(body.billable === undefined ? {} : { billable: body.billable as boolean })
        })
      )
    }
  },
  {
    method: 'PATCH',
    path: '/time-entries/:entryId',
    description:
      'Change an entry\'s start, duration, note, person or billable. A running timer\'s duration cannot be set: stop it first (POST /timer/stop). A billed entry (billingId set) is locked: HTTP 400 "This time was billed on 3 March; unmark the billing to change it" until DELETE /billings/:billingId unmarks it.',
    request:
      'JSON body: { startedAt?, durationSeconds?, duration?, note?, personId?, billable? }, as POST /time-entries.',
    response: '{ ok: true, value: TimeEntry }',
    handler: (call) => {
      const { body } = call
      timeChanged(
        call,
        'PATCH time entry',
        planningOf(call.server).time.update(call.project.id, call.params.entryId!, {
          ...(body.startedAt === undefined ? {} : { startedAt: apiMoment(body.startedAt) }),
          ...(body.durationSeconds === undefined && body.duration === undefined
            ? {}
            : { durationSeconds: apiDuration(body) }),
          ...(body.note === undefined ? {} : { note: body.note as string }),
          ...(body.personId === undefined ? {} : { personId: body.personId as string | null }),
          ...(body.billable === undefined ? {} : { billable: body.billable as boolean })
        })
      )
    }
  },
  {
    method: 'DELETE',
    path: '/time-entries/:entryId',
    description:
      'Delete an entry (a running timer stops with it). The response is the entry; POST it to /time-entries/restore to undo. A billed entry cannot be deleted until its billing is unmarked (HTTP 400, the same words as PATCH).',
    response: '{ ok: true, value: TimeEntry }',
    handler: (call) =>
      timeChanged(
        call,
        'DELETE time entry',
        planningOf(call.server).time.delete(call.project.id, call.params.entryId!)
      )
  },
  {
    method: 'POST',
    path: '/time-entries/restore',
    description: 'Undo an entry delete.',
    request: 'JSON body: the value DELETE /time-entries/:entryId returned.',
    response: '{ ok: true, value: TimeEntry }',
    handler: (call) =>
      timeChanged(
        call,
        'POST time entry',
        planningOf(call.server).time.restore(call.project.id, call.body as unknown as TimeEntry)
      )
  },
  {
    method: 'GET',
    path: '/timer',
    description:
      'The one timer that runs across Ostler. running is its entry (durationSeconds null; elapsed time is now minus startedAt), which may belong to another project, or null. interrupted is set when Ostler started and found a timer running from before it closed and the person has not yet chosen to keep it or stop it at closedAt.',
    response:
      '{ ok: true, value: { running: TimeEntry | null, interrupted: { entryId, closedAt } | null } }',
    handler: ({ server, res }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).time.timerState() })
  },
  {
    method: 'POST',
    path: '/timer/start',
    description:
      "Start a timer on a task of this project, for Me. A timer already running (in any project) stops now; the response's stopped is that entry, or null.",
    request: 'JSON body: { workItemId: string }',
    response: '{ ok: true, value: { started: TimeEntry, stopped: TimeEntry | null } }',
    exampleBody: { workItemId: '<work item id>' },
    handler: (call) =>
      timeChanged(
        call,
        'automation-api timer start',
        planningOf(call.server).time.startTimer(call.project.id, call.body.workItemId as string)
      )
  },
  {
    method: 'POST',
    path: '/timer/stop',
    description:
      'Stop the running timer now, whichever project it is in. Returns its entry, or null when no timer runs. A timer stopped within its first second keeps no entry.',
    response: '{ ok: true, value: TimeEntry | null }',
    handler: (call) =>
      timeChanged(call, 'automation-api timer stop', planningOf(call.server).time.stopTimer())
  },
  {
    method: 'GET',
    path: '/focus',
    description:
      "The focus: a countdown on the one timer, held in memory (closing Ostler ends it), which may be on another project's task, or null. phase is focus while it counts down (desktop notifications are held; Inbox items still arrive), ended once it reached endsAt and the person has not chosen (the timer keeps running), or break while the break counts down to breakEndsAt (the timer stopped at endsAt). Time left is endsAt minus now. Stopping the timer anywhere ends the focus.",
    response:
      "{ ok: true, value: { id, projectId, workItemId, workItemTitle, entryId, minutes, startedAt, endsAt, phase: 'focus' | 'ended' | 'break', breakEndsAt } | null }",
    handler: (call) => respondJson(call.res, 200, { ok: true, value: focusOf(call).get() })
  },
  {
    method: 'POST',
    path: '/focus',
    description:
      "Focus on a task of this project for a whole number of minutes from 5 to 180: starts the task's timer for Me (a timer already running stops now; timer.stopped is that entry) and the countdown. A focus already running ends first. The time is logged as an ordinary time entry.",
    request: 'JSON body: { workItemId: string, minutes: number }',
    response:
      '{ ok: true, value: { focus: Focus, timer: { started: TimeEntry, stopped: TimeEntry | null } } }',
    exampleBody: { workItemId: '<work item id>', minutes: 25 },
    handler: (call) => {
      const focus = focusOf(call)
      if (typeof call.body.workItemId !== 'string') throw new Refusal('workItemId is required')
      timeChanged(
        call,
        'automation-api focus start',
        focus.start(call.project.id, call.body.workItemId, call.body.minutes)
      )
    }
  },
  {
    method: 'DELETE',
    path: '/focus',
    description:
      "Stop the focus, whichever project it is in. While it counts down, or after it ended, the task's timer stops too (now, or at endsAt if that has passed); on a break, the break ends. Returns null.",
    response: '{ ok: true, value: null }',
    handler: (call) => timeChanged(call, 'automation-api focus stop', focusOf(call).stop())
  }
]
