import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { MyDayService } from '../../electron/services/my-day-service'
import type { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import { PlanningService } from '../../electron/services/planning-service'
import type { CalendarOccurrence, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
// 1 March 2027 is a Monday, in the future, so Fill my day starts at 09:00.
const DAY = '2027-03-01'
const human = { kind: 'human' as const }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, automationToken: token, estimateUnit: 'hours' })
}

/** A meeting on whatever day is asked for, 10:00 to 11:00. */
function meetingsOn(from: string): CalendarOccurrence[] {
  return [
    {
      id: 'm',
      eventId: 'm',
      calendarId: 'c',
      title: 'Private dentist',
      location: 'Somewhere private',
      description: '',
      allDay: false,
      startDate: from,
      endDate: from,
      startTime: '10:00',
      endTime: '11:00',
      start: 0,
      end: 0
    }
  ]
}

describe('blocks that move routes (N3.4b)', () => {
  const root = useTempDir('ostler-block-moves-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  const project = watched('moves-project', 'token-one')
  const other = watched('other-project', 'token-two')

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    server.calendars = {
      service: {
        events: ({ from }: { from: string }) => meetingsOn(from)
      } as unknown as OutsideCalendarService,
      notify: () => {}
    }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    return fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  // The answers are read loosely here; the routes' shapes are in HELP_ROUTES.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function read(response: Response): Promise<{ text: string; value: any }> {
    const text = await response.text()
    const body = JSON.parse(text) as { ok: boolean; value: unknown; error?: string }
    if (!body.ok) throw new Error(body.error)
    return { text, value: body.value }
  }

  it('describes the routes in help', async () => {
    const { value } = await read(await call('GET', '/help'))
    const routes = (value.routes as { method: string; path: string }[]).map(
      (route) => `${route.method} ${route.path}`
    )
    expect(routes).toEqual(
      expect.arrayContaining(['POST /time-blocks/:blockId/move-to-free', 'POST /time-blocks/fill'])
    )
  })

  it('moves a block to the next free time, or only says where with dryRun, never naming events', async () => {
    const task = planning.createWorkItem(project.id, { title: 'Write' }, human)
    const created = await read(
      await call('POST', '/time-blocks', {
        workItemId: task.id,
        date: '2026-01-05',
        startMinute: 540,
        lengthMinutes: 45
      })
    )
    const id = created.value.id as string

    const dry = await read(await call('POST', `/time-blocks/${id}/move-to-free?dryRun=1`))
    expect(dry.value.moved).toBe(false)
    expect(dry.value.to.lengthMinutes).toBe(45)
    expect(dry.text).not.toContain('dentist')
    expect(dry.text).not.toContain('Somewhere')
    const still = await read(await call('GET', `/time-blocks/${id}`))
    expect(still.value.date).toBe('2026-01-05')

    const moved = await read(await call('POST', `/time-blocks/${id}/move-to-free`))
    expect(moved.value.moved).toBe(true)
    expect(moved.value.to).toEqual(dry.value.to)
    expect(moved.value.block.date).toBe(dry.value.to.date)
    expect(moved.text).not.toContain('dentist')
    // Never into the meeting.
    const start = moved.value.to.startMinute as number
    expect(start + 45 <= 600 || start >= 660).toBe(true)

    // Another project's token cannot move it.
    const refused = await call('POST', `/time-blocks/${id}/move-to-free`, undefined, 'token-two')
    expect(refused.status).not.toBe(200)
  })

  it("fills the token's project's My day around meetings, with and without dryRun", async () => {
    const myDay = new MyDayService({
      db: planning.database,
      planning,
      getProjects: () => [project, other]
    })
    const first = planning.createWorkItem(project.id, { title: 'First', estimate: 1.5 }, human)
    const theirs = planning.createWorkItem(other.id, { title: 'Theirs' }, human)
    myDay.add(first.id, { date: DAY, beforeId: null, afterId: null }, human)
    myDay.add(theirs.id, { date: DAY, beforeId: null, afterId: null }, human)

    const dry = await read(await call('POST', '/time-blocks/fill', { date: DAY, dryRun: true }))
    expect(dry.value.placed).toBe(false)
    expect(dry.value.blocks).toEqual([])
    expect(
      dry.value.plan.pieces.map((piece: { title: string; startMinute: number }) => [
        piece.title,
        piece.startMinute
      ])
    ).toEqual([['First', 660]])
    expect(dry.text).not.toContain('dentist')
    const none = await read(await call('GET', `/time-blocks?from=${DAY}&to=${DAY}`))
    expect(none.value).toEqual([])

    const placed = await read(await call('POST', '/time-blocks/fill', { date: DAY }))
    expect(placed.value.placed).toBe(true)
    expect(placed.value.blocks).toHaveLength(1)
    expect(placed.value.blocks[0]).toMatchObject({ startMinute: 660, lengthMinutes: 90 })
    expect(placed.text).not.toContain('dentist')
    expect(placed.text).not.toContain('Theirs')
  })
})
