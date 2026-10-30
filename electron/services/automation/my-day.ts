import { todayIsoDate } from '@shared/dates'
import { DEFAULT_WORKING_HOURS } from '@shared/planning/time-blocks'
import { Refusal } from '@shared/refusal'
import { BlockMoveService } from '../block-move-service'
import { respondJson } from '../loopback-http'
import { MyDayService, myDayPlacement } from '../my-day-service'
import { TimeBlockService } from '../time-block-service'
import { AUTOMATION_ACTOR, planningOf } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The My day service, over the app's own planning database. */
function myDayOf({ server }: RouteCall): MyDayService {
  const planning = planningOf(server)
  return new MyDayService({ db: planning.database, planning, getProjects: server.getProjects })
}

/** The time block service, over the app's own planning database. */
function timeBlocksOf({ server }: RouteCall): TimeBlockService {
  const planning = planningOf(server)
  return new TimeBlockService({ db: planning.database, planning, getProjects: server.getProjects })
}

/**
 * Blocks that move (N3.4b): the same `BlockMoveService` as the app's Move
 * to the next free time and Fill my day, kept to this token's project.
 * Results carry block times only, never the outside events avoided.
 */
function blockMoves(call: RouteCall): { moves: BlockMoveService; dryRun: boolean } {
  const { server, query, body } = call
  const moves = new BlockMoveService({
    db: planningOf(server).database,
    timeBlocks: timeBlocksOf(call),
    myDay: myDayOf(call),
    getWorkingHours: () => server.getConfig?.().ui.workingHours ?? DEFAULT_WORKING_HOURS,
    getMe: () => server.people?.service.getMe() ?? null,
    getDaysOff: () => server.daysOff?.service.list() ?? [],
    getEvents: (from, to) => server.calendars?.service.events({ from, to }) ?? []
  })
  const dryRun =
    query.get('dryRun') === '1' || query.get('dryRun') === 'true' || body.dryRun === true
  return { moves, dryRun }
}

/** A My day or time block change, recorded in change history under `route`. */
function recorded(call: RouteCall, route: string, summary: string, value: unknown, status = 200) {
  call.server.recordMutation(call.project, route, summary)
  respondJson(call.res, status, { ok: true, value })
}

/**
 * My day (N1.4) and time blocks (N3.4a): the same services the app's Plan
 * my day, Add to My day and Calendar use, kept to this token's project.
 */
export const MY_DAY_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/my-day',
    description:
      "List this project's tasks in the person's My day for a date, in their order: the short list they picked to work on that day with Plan my day. My day is personal and spans projects; this token sees only this project's entries. Done tasks stay in the list until the day ends; archived, deleted (in the bin), Won't do and hidden (Someday, or shown from a later date) tasks are left out. date (YYYY-MM-DD, the person's local date) defaults to the computer's local date.",
    request: 'Query: date?: YYYY-MM-DD',
    response:
      '{ ok: true, value: Array<{ id, projectId, projectName, projectColor, title, status, priority, targetDate, assigneeId, linked, estimate, estimateUnit }> }',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: myDayOf(call).list(call.query.get('date') ?? todayIsoDate(), call.project.id)
      })
  },
  {
    method: 'POST',
    path: '/my-day',
    description:
      "Add a task of this project to My day for a date, as Add to My day does in the app: at the end, or before or after another of this project's tasks already in that day's list. A task is in a day's list at most once: adding it again changes nothing (already: true). To move a task already there, send beforeId or afterId with move: true. A hidden task (in Someday, or shown from a later date) is brought back first, through the same update as PATCH /work-items/:workItemId, and broughtBack says which. Moving a task in My day never changes its place in the project's manual order. date defaults to the computer's local date.",
    request:
      'JSON body: { workItemId: string, date?: "YYYY-MM-DD", beforeId?: string, afterId?: string (not both), move?: boolean }',
    response:
      '{ ok: true, value: { workItemId, date, broughtBack: "someday" | "later" | null, already: boolean } }',
    exampleBody: { workItemId: '<work-item-id>', date: '2026-10-16' },
    handler: (call) => {
      const myDay = myDayOf(call)
      const { body, project } = call
      if (typeof body.workItemId !== 'string' || !body.workItemId)
        throw new Refusal('Send workItemId')
      if (body.move !== undefined && typeof body.move !== 'boolean')
        throw new Refusal('move must be true or false')
      const placement = myDayPlacement({ ...body, date: body.date ?? todayIsoDate() })
      if (body.move === true) {
        myDay.move(body.workItemId, placement, project.id)
        return recorded(call, '/my-day', 'automation-api my day move', {
          workItemId: body.workItemId,
          date: placement.date,
          broughtBack: null,
          already: true
        })
      }
      const value = myDay.add(body.workItemId, placement, AUTOMATION_ACTOR, project.id)
      recorded(call, '/my-day', 'automation-api my day add', value)
    }
  },
  {
    method: 'DELETE',
    path: '/my-day/:workItemId',
    description:
      "Take a task of this project out of My day for a date. The task itself does not change. removed is false when it was not in that day's list. date defaults to the computer's local date.",
    request: 'Query: date?: YYYY-MM-DD',
    response: '{ ok: true, value: { removed: boolean } }',
    handler: (call) => {
      const date = call.query.get('date') ?? todayIsoDate()
      const removed = myDayOf(call).remove(call.params.workItemId!, date, call.project.id)
      recorded(call, '/my-day', 'automation-api my day remove', { removed })
    }
  },
  {
    method: 'GET',
    path: '/time-blocks',
    description:
      "List this project's time blocks from one date to another (inclusive, at most 400 days), in time order. A time block is time the person put aside for a task in the Calendar's Week: a local date, a start in minutes after local midnight and a length in minutes, so a 09:00 block stays at 09:00 across a clock change. A block is a plan, never a time entry. Blocks of tasks in the bin or archived are left out. workItemId keeps one task's blocks.",
    request: 'Query: from: YYYY-MM-DD, to: YYYY-MM-DD, workItemId?: string',
    response:
      '{ ok: true, value: Array<{ id, projectId, workItemId, date, startMinute, lengthMinutes, createdAt, title, status }> }',
    handler: (call) => {
      const { query, project } = call
      const from = query.get('from')
      const to = query.get('to')
      if (!from || !to) throw new Refusal('Send from and to (YYYY-MM-DD)')
      const workItemId = query.get('workItemId') ?? undefined
      respondJson(call.res, 200, {
        ok: true,
        value: timeBlocksOf(call).list({ from, to, projectId: project.id, workItemId })
      })
    }
  },
  {
    method: 'POST',
    path: '/time-blocks',
    description:
      "Block time for a task of this project, as dragging it onto an hour does in the app. startMinute is minutes after local midnight on a quarter hour (0 to 1425). Without lengthMinutes, the block is as long as the task's estimate in hours (an hour in a points project or with no estimate), cut at midnight. A task can have several blocks, at most 200. Blocking time never changes the task's dates and never adds it to My day.",
    request:
      'JSON body: { workItemId: string, date: "YYYY-MM-DD", startMinute: number, lengthMinutes?: number (whole quarter hours, ending by midnight) }',
    response:
      '{ ok: true, value: { id, projectId, workItemId, date, startMinute, lengthMinutes, createdAt, title, status } }',
    exampleBody: { workItemId: '<work-item-id>', date: '2026-10-20', startMinute: 540 },
    handler: (call) => {
      const { body } = call
      const value = timeBlocksOf(call).create(
        {
          workItemId: body.workItemId as string,
          date: body.date as string,
          startMinute: body.startMinute as number,
          lengthMinutes: body.lengthMinutes as number | undefined
        },
        call.project.id
      )
      recorded(call, '/time-blocks', 'automation-api time block create', value, 201)
    }
  },
  {
    method: 'GET',
    path: '/time-blocks/:blockId',
    description:
      "One time block of this project. An unknown id, or another project's, is HTTP 400.",
    response: '{ ok: true, value: TimeBlock }',
    handler: (call) =>
      respondJson(call.res, 200, {
        ok: true,
        value: timeBlocksOf(call).get(call.params.blockId!, call.project.id)
      })
  },
  {
    method: 'PATCH',
    path: '/time-blocks/:blockId',
    description:
      'Move a time block of this project or change its length. A move without lengthMinutes keeps the length, cut at midnight.',
    request: 'JSON body: { date?: "YYYY-MM-DD", startMinute?: number, lengthMinutes?: number }',
    response: '{ ok: true, value: TimeBlock }',
    exampleBody: { startMinute: 600, lengthMinutes: 90 },
    handler: (call) => {
      const { body } = call
      const value = timeBlocksOf(call).update(
        call.params.blockId!,
        {
          date: body.date as string | undefined,
          startMinute: body.startMinute as number | undefined,
          lengthMinutes: body.lengthMinutes as number | undefined
        },
        call.project.id
      )
      recorded(call, '/time-blocks', 'automation-api time block update', value)
    }
  },
  {
    method: 'DELETE',
    path: '/time-blocks/:blockId',
    description:
      'Remove a time block of this project. The task does not change. Returns the removed block.',
    response: '{ ok: true, value: TimeBlock }',
    handler: (call) =>
      recorded(
        call,
        '/time-blocks',
        'automation-api time block remove',
        timeBlocksOf(call).remove(call.params.blockId!, call.project.id)
      )
  },
  {
    method: 'POST',
    path: '/time-blocks/:blockId/move-to-free',
    description:
      "Move a time block of this project to the next free time, as the block card's Move to the next free time does in the app: the first stretch from now (rounded up to the next quarter hour), within Working hours on Me's working days and not on a day off, at most 14 days ahead, that is as long as the block and not taken by another block (any project's) or a timed event of a shown outside calendar (all-day events take no time). The block keeps its length. With ?dryRun=1 nothing moves and to is where it would go. to is null when nothing is free in 14 days (then nothing moves). The answer gives block times only, never the events avoided. Nothing ever moves a block by itself.",
    request: 'Query: dryRun?: 1',
    response:
      '{ ok: true, value: { moved: boolean, from: { date, startMinute, lengthMinutes }, to: { date, startMinute, lengthMinutes } | null, block: TimeBlock | null } }',
    handler: (call) => {
      const { moves, dryRun } = blockMoves(call)
      const plan = moves.planMoves([call.params.blockId!], call.project.id)
      const move = plan.moves[0]
      if (dryRun || !move.to) {
        return respondJson(call.res, 200, {
          ok: true,
          value: { moved: false, from: move.from, to: move.to, block: null }
        })
      }
      const applied = moves.applyMoves(plan, call.project.id)
      recorded(call, '/time-blocks/move-to-free', 'automation-api time block move', {
        moved: true,
        from: move.from,
        to: move.to,
        block: applied.blocks[0]
      })
    }
  },
  {
    method: 'POST',
    path: '/time-blocks/fill',
    description:
      "Fill my day for this project's My day entries on date (default the computer's local date), as the app's Fill my day does: the unfinished tasks in My day's order, each for its estimate in hours less what is already blocked for it that day (an hour with no hour estimate, or in a points project), placed into that day's free time from now (rounded up to the next quarter hour) or the start of Working hours. Free time is Working hours not taken by blocks (any project's) or timed events of shown outside calendars. A task that no free stretch holds whole is split into pieces of at least 30 minutes; one that cannot fit is in notPlaced. On a day off or a non-working day closed says why and nothing is placed. dryRun: true (or ?dryRun=1) returns the plan and makes nothing; otherwise the plan's blocks are made in one transaction (remove them with DELETE /time-blocks/:blockId). The answer gives block times only, never the events avoided.",
    request: 'JSON body: { date?: "YYYY-MM-DD", dryRun?: boolean }',
    response:
      "{ ok: true, value: { placed: boolean, plan: { date, now: { date, minute }, closed: { kind: 'dayOff', name } | { kind: 'notWorking' } | null, pieces: Array<{ workItemId, projectId, title, date, startMinute, lengthMinutes, part, parts }>, notPlaced: Array<{ workItemId, projectId, title, minutes }>, alreadyBlocked: string[] }, blocks: TimeBlock[] } }",
    exampleBody: { date: '2026-10-20', dryRun: true },
    handler: (call) => {
      const { moves, dryRun } = blockMoves(call)
      const date = call.body.date === undefined ? todayIsoDate() : call.body.date
      const plan = moves.planFill(date, call.project.id)
      if (dryRun)
        return respondJson(call.res, 200, { ok: true, value: { placed: false, plan, blocks: [] } })
      const applied = moves.applyFill(plan, call.project.id)
      recorded(call, '/time-blocks/fill', 'automation-api fill my day', {
        placed: applied.blocks.length > 0,
        plan,
        blocks: applied.blocks
      })
    }
  }
]
