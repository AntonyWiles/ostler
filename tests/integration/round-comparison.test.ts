import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningMilestone,
  PlanningWorkItem,
  Result,
  RoundComparison,
  WatchedProject
} from '../../src/shared/ostler-api'
import { IPC_CHANNELS } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  }
}))

const { AutomationHttpServer } = await import('../../electron/services/automation-http-server')
const { PlanningService } = await import('../../electron/services/planning-service')
const { ReportService } = await import('../../electron/services/report-service')
const { registerReportHandlers } = await import('../../electron/ipc/report-handlers')

let PORT = 0
const PROJECT = '5b0f3c2e-8f61-4c3e-9a51-2d7c4e1b9a10'
const OTHER = '9e4a1d70-2c3b-4f8e-8b6d-0a1f2e3d4c5b'
const RULE = { every: 'month', interval: 1, monthDay: 1 }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Books' : 'Garden',
    automationToken: token
  })
}

describe('GET /milestones/:milestoneId/rounds (N5.7b)', () => {
  const root = useTempDir('ostler-round-compare-')
  let planning: InstanceType<typeof PlanningService>
  let server: InstanceType<typeof AutomationHttpServer>
  let project: WatchedProject
  let other: WatchedProject

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
    const reports = new ReportService({ planning, listPeople: () => [] })
    handlers.clear()
    registerReportHandlers({
      reportService: reports,
      getProject: (id) => {
        if (id !== project.id && id !== other.id) throw new Error('Project not found')
        return id === project.id ? project : other
      }
    })
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reports
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    const id = token === 'token-one' ? project.id : other.id
    return fetch(`http://127.0.0.1:${PORT}/automation/${id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!json.ok) throw new Error(json.error)
    return json.value
  }

  async function twoRounds() {
    const first = await value<PlanningMilestone>(
      await call('POST', '/milestones', { name: 'Accounts', targetDate: '2027-04-10' })
    )
    const receipts = await value<PlanningWorkItem>(
      await call('POST', '/work-items', {
        title: 'Gather receipts',
        milestoneId: first.id,
        startDate: '2027-04-01',
        targetDate: '2027-04-03'
      })
    )
    await call('PATCH', `/work-items/${receipts.id}`, { status: 'active' })
    await call('PATCH', `/work-items/${receipts.id}`, { status: 'done' })
    await call('PUT', `/milestones/${first.id}/repeat`, {
      rule: RULE,
      lengthDays: 10,
      nextStart: '2027-05-01'
    })
    const second = await value<PlanningMilestone>(
      await call('POST', `/milestones/${first.id}/next-round`)
    )
    const tasks = await value<PlanningWorkItem[]>(await call('GET', '/work-items'))
    const copy = tasks.find((task) => task.milestoneId === second.id)!
    // Renamed in the second round: still the same row.
    await call('PATCH', `/work-items/${copy.id}`, { title: 'Collect receipts' })
    return { first, second, receipts, copy }
  }

  it('returns the series’ rounds and each task across them, from any round', async () => {
    const { first, second, receipts, copy } = await twoRounds()
    const comparison = await value<RoundComparison>(
      await call('GET', `/milestones/${second.id}/rounds`)
    )
    expect(comparison.seriesName).toBe('Accounts')
    expect(comparison.rounds.map((round) => round.milestoneId)).toEqual([first.id, second.id])
    expect(comparison.rounds[0]).toMatchObject({ done: 1, open: 0, finished: true, wontDo: 0 })
    expect(comparison.rounds[1]).toMatchObject({
      name: 'Accounts · May 2027',
      start: '2027-05-01',
      plannedDays: 10,
      done: 0,
      open: 1,
      tookDays: null
    })
    expect(comparison.tasks).toHaveLength(1)
    expect(comparison.tasks[0].title).toBe('Collect receipts')
    expect(comparison.tasks[0].cells.map((cell) => cell?.workItemId)).toEqual([
      receipts.id,
      copy.id
    ])
    expect(comparison.tasks[0].cells[0]).toMatchObject({ outcome: 'done' })
    expect(comparison.tasks[0].cells[0]!.cycleTimeMs).not.toBeNull()
    expect(comparison.hasTimeTracked).toBe(false)

    // The same numbers from the first round, and through the app's IPC.
    const fromFirst = await value<RoundComparison>(
      await call('GET', `/milestones/${first.id}/rounds`)
    )
    expect(fromFirst.rounds).toEqual(comparison.rounds.map((round) => ({ ...round })))
    const viaIpc = (await handlers.get(IPC_CHANNELS.GET_ROUND_COMPARISON)!(
      {},
      project.id,
      second.id
    )) as Result<RoundComparison>
    expect(viaIpc.ok && viaIpc.value.tasks).toEqual(comparison.tasks)

    // The report's cycle time for the first round is the one compared.
    const report = await value<{ keyNumbers: { cycleTimeMedianMs: number | null } }>(
      await call('GET', `/reports?range=milestone:${first.id}`)
    )
    expect(report.keyNumbers.cycleTimeMedianMs).toBe(comparison.tasks[0].cells[0]!.cycleTimeMs)
  })

  it('returns the table as CSV', async () => {
    const { second } = await twoRounds()
    const response = await call('GET', `/milestones/${second.id}/rounds?format=csv&measure=time`)
    expect(response.headers.get('content-type')).toMatch(/text\/csv/)
    const lines = (await response.text()).replace(String.fromCharCode(0xfeff), '').split('\r\n')
    expect(lines[0]).toBe(
      'Task,"Accounts (time tracked, hours)","Accounts · May 2027 (time tracked, hours)"'
    )
    expect(lines[1]).toBe('Collect receipts,0,0')
    expect(
      (await call('GET', `/milestones/${second.id}/rounds?format=csv&measure=points`)).status
    ).toBe(400)
  })

  it('refuses a milestone of another project, and is in the route list', async () => {
    const { second } = await twoRounds()
    const response = await call('GET', `/milestones/${second.id}/rounds`, undefined, 'token-two')
    expect(response.ok).toBe(false)
    const help = await (await call('GET', '/help')).text()
    expect(help).toContain('/milestones/:milestoneId/rounds')
  })
})
