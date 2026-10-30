import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { TimeEntry, WatchedProject } from '../../src/shared/ostler-api'
import type {
  Billing,
  BillingSettings,
  TimeReport,
  UnmarkedBilling
} from '../../src/shared/time/billing'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d'
const OTHER = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Studio' : 'Garden',
    automationToken: token
  })
}

describe('billable time over the automation API (N6.4)', () => {
  const root = useTempDir('ostler-billing-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject
  let taskId: string

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    taskId = planning.createWorkItem(PROJECT, { title: 'Design' }, { kind: 'human' }).id
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
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
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(body.error)
    return body.value
  }

  async function error(response: Response): Promise<string> {
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    return body.error
  }

  const logTime = (startedAt: string, duration: string, extra: Record<string, unknown> = {}) =>
    call('POST', '/time-entries', { workItemId: taskId, startedAt, duration, ...extra }).then(
      (response) => value<TimeEntry>(response)
    )

  it('describes the routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string }[] }>(
      await call('GET', '/help')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    for (const route of [
      'GET /billing-settings',
      'PUT /billing-settings',
      'GET /time-report',
      'GET /billings',
      'POST /billings',
      'DELETE /billings/:billingId',
      'POST /billings/restore'
    ])
      expect(routes).toContain(route)
  })

  it('sets the rate and default, and new entries carry billable', async () => {
    await call('PUT', '/budget', { currency: 'GBP' })
    const settings = await value<BillingSettings>(
      await call('PUT', '/billing-settings', { hourlyRate: 6000, newTimeBillable: true })
    )
    expect(settings).toEqual({
      projectId: PROJECT,
      hourlyRate: 6000,
      newTimeBillable: true,
      currency: 'GBP'
    })
    expect((await call('PUT', '/billing-settings', { hourlyRate: -1 })).status).toBe(400)
    const entry = await logTime('2026-10-02T09:00', '1h')
    expect(entry).toMatchObject({ billable: true, billingId: null })
    const off = await logTime('2026-10-03T09:00', '1h', { billable: false })
    expect(off.billable).toBe(false)
    const changed = await value<TimeEntry>(
      await call('PATCH', `/time-entries/${off.id}`, { billable: true })
    )
    expect(changed.billable).toBe(true)
    // Another project's settings are its own.
    expect(
      (await value<BillingSettings>(await call('GET', '/billing-settings', undefined, 'token-two')))
        .hourlyRate
    ).toBeNull()
  })

  it('reports a range, as JSON and CSV', async () => {
    await call('PUT', '/budget', { currency: 'GBP' })
    await call('PUT', '/billing-settings', { hourlyRate: 6000, newTimeBillable: true })
    await logTime('2026-10-02T09:00', '1h 30m', { note: 'Sketches' })
    await logTime('2026-10-05T09:00', '30m', { billable: false })
    await logTime('2026-11-01T09:00', '1h')
    const report = await value<TimeReport>(
      await call('GET', '/time-report?from=2026-10-01&to=2026-10-31')
    )
    expect(report.totals).toEqual({ seconds: 7200, billableSeconds: 5400, amount: 9000 })
    expect(report.unbilled.tasks).toHaveLength(1)
    expect(report.unbilled.tasks[0]).toMatchObject({ title: 'Design', amount: 9000 })
    expect(report.unbilled.tasks[0].entries).toHaveLength(2)

    const csv = await call('GET', '/time-report?from=2026-10-01&to=2026-10-31&format=csv')
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/)
    const lines = (await csv.text()).replace(String.fromCharCode(0xfeff), '').split('\r\n')
    expect(lines[0]).toBe('Date,Task,Person,Note,Hours,Billable,Amount,Billed')
    expect(lines[1]).toBe('2026-10-02,Design,,Sketches,1.5,yes,90.00,')
    expect(lines[2]).toBe('2026-10-05,Design,,,0.5,no,,')

    expect((await call('GET', '/time-report?from=2026-10-31&to=2026-10-01')).status).toBe(400)
    expect((await call('GET', '/time-report')).status).toBe(400)
  })

  it('marks a range billed, refuses changes to its entries, and unmarks it with undo', async () => {
    await call('PUT', '/budget', { currency: 'GBP' })
    await call('PUT', '/billing-settings', { hourlyRate: 6000, newTimeBillable: true })
    const entry = await logTime('2026-10-02T09:00', '2h')
    const billing = await value<Billing>(
      await call('POST', '/billings', { from: '2026-10-01', to: '2026-10-31' })
    )
    expect(billing).toMatchObject({ entryCount: 1, billableSeconds: 7200, amount: 12_000 })
    expect((await value<TimeEntry>(await call('GET', `/time-entries/${entry.id}`))).billingId).toBe(
      billing.id
    )
    expect(await value<Billing[]>(await call('GET', '/billings'))).toEqual([billing])

    const patch = await call('PATCH', `/time-entries/${entry.id}`, { note: 'changed' })
    expect(patch.status).toBe(400)
    expect(await error(patch)).toMatch(
      /^This time was billed on .+; unmark the billing to change it$/
    )
    const remove = await call('DELETE', `/time-entries/${entry.id}`)
    expect(remove.status).toBe(400)
    expect(await error(remove)).toMatch(/billed on/)
    expect((await call('POST', '/billings', { from: '2026-10-01', to: '2026-10-31' })).status).toBe(
      400
    )

    // The rate changes; the billing keeps its amount.
    await call('PUT', '/billing-settings', { hourlyRate: 9000 })
    const report = await value<TimeReport>(
      await call('GET', '/time-report?from=2026-10-01&to=2026-10-31')
    )
    expect(report.billed.amount).toBe(12_000)
    expect(report.billings).toEqual([billing])

    const unmarked = await value<UnmarkedBilling>(await call('DELETE', `/billings/${billing.id}`))
    expect(unmarked.entryIds).toEqual([entry.id])
    expect(await value<Billing[]>(await call('GET', '/billings'))).toEqual([])
    expect(
      (await value<TimeEntry>(await call('PATCH', `/time-entries/${entry.id}`, { note: 'ok' })))
        .note
    ).toBe('ok')
    const restored = await value<Billing>(await call('POST', '/billings/restore', unmarked))
    expect(restored).toEqual(billing)
    expect((await call('DELETE', `/time-entries/${entry.id}`)).status).toBe(400)
    // Another project cannot see or unmark it.
    expect((await call('DELETE', `/billings/${billing.id}`, undefined, 'token-two')).status).toBe(
      400
    )
  })
})
