import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectReport, Result, WatchedProject } from '../../src/shared/ostler-api'
import { IPC_CHANNELS } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { xmlProblem } from '../helpers/well-formed-xml'
import { strFromU8, unzipSync } from 'fflate'
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
const human = { kind: 'human' as const }

describe('reports: IPC and GET /reports', () => {
  const root = useTempDir('ostler-reports-')
  let project: WatchedProject
  let planning: InstanceType<typeof PlanningService>
  let reports: InstanceType<typeof ReportService>
  let server: InstanceType<typeof AutomationHttpServer>

  beforeEach(async () => {
    project = makeWatchedProject({
      id: 'report-project',
      name: 'Report project',
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    planning = new PlanningService(await createMigratedDatabase(root()), () => [project.id])
    reports = new ReportService({ planning, listPeople: () => [] })
    handlers.clear()
    registerReportHandlers({
      reportService: reports,
      getProject: (id) => {
        if (id !== project.id) throw new Error('Project not found')
        return project
      }
    })
    server = new AutomationHttpServer(
      () => [project],
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

  const viaIpc = async (range: string) =>
    (await handlers.get(IPC_CHANNELS.GET_PROJECT_REPORT)!(
      {},
      project.id,
      range
    )) as Result<ProjectReport>

  const viaHttp = async (range: string) => {
    const response = await fetch(
      `http://127.0.0.1:${PORT}/automation/${project.id}/reports?range=${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${project.automationToken}` } }
    )
    return { status: response.status, body: (await response.json()) as Result<ProjectReport> }
  }

  it('returns the same report from IPC and from GET /reports', async () => {
    const milestone = planning.createMilestone(project.id, {
      name: 'Launch',
      targetDate: '2099-01-01'
    })
    const done = planning.createWorkItem(
      project.id,
      { title: 'Ship it', milestoneId: milestone.id },
      human
    )
    planning.updateWorkItem(done.id, { status: 'active' }, human)
    planning.updateWorkItem(done.id, { status: 'done' }, human)
    planning.createWorkItem(project.id, { title: 'Write docs', milestoneId: milestone.id }, human)

    for (const range of ['30d', '90d', `milestone:${milestone.id}`]) {
      const ipc = await viaIpc(range)
      const http = await viaHttp(range)
      expect(ipc.ok).toBe(true)
      expect(http.status).toBe(200)
      expect(http.body).toEqual(ipc)
    }
    const ipc = await viaIpc('30d')
    if (!ipc.ok) throw new Error(ipc.error)
    expect(ipc.value.keyNumbers).toMatchObject({ open: 1, doneInRange: 1 })
    expect(ipc.value.burnUp[0]).toMatchObject({ milestoneId: milestone.id, name: 'Launch' })
  })

  it('leaves deleted tasks out, counts restored ones, and refreshes on every change', async () => {
    const a = planning.createWorkItem(project.id, { title: 'A' }, human)
    planning.createWorkItem(project.id, { title: 'B' }, human)
    const open = async () => {
      const result = await viaIpc('30d')
      if (!result.ok) throw new Error(result.error)
      return result.value.keyNumbers.open
    }
    expect(await open()).toBe(2)
    planning.moveWorkItemToBin(a.id, human)
    expect(await open()).toBe(1)
    planning.restoreWorkItem(a.id, human)
    expect(await open()).toBe(2)
    planning.updateWorkItem(a.id, { status: 'done' }, human)
    expect(await open()).toBe(1)
  })

  it('refuses an unknown range or another project, as both surfaces', async () => {
    expect(await viaIpc('7d')).toEqual({
      ok: false,
      error: 'Range must be 30d, 90d or milestone:<milestoneId>'
    })
    const http = await viaHttp('milestone:missing')
    expect(http.body.ok).toBe(false)
    expect(await handlers.get(IPC_CHANNELS.GET_PROJECT_REPORT)!({}, 'someone-else', '30d')).toEqual(
      { ok: false, error: 'Project not found' }
    )
  })

  const exportVia = (query: string) =>
    fetch(`http://127.0.0.1:${PORT}/automation/${project.id}/export?${query}`, {
      headers: { Authorization: `Bearer ${project.automationToken}` }
    })

  it('returns the calendar file as text/calendar, finished tasks only on request', async () => {
    planning.createWorkItem(
      project.id,
      { title: 'Book the venue', startDate: '2026-11-02', targetDate: '2026-11-04' },
      human
    )
    const done = planning.createWorkItem(
      project.id,
      { title: 'Pick a date', targetDate: '2026-10-01' },
      human
    )
    planning.updateWorkItem(done.id, { status: 'done' }, human)

    const response = await exportVia('format=ics')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    const text = await response.text()
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261105\r\n')
    expect(text).not.toContain('Pick a date')

    const all = await (await exportVia('format=ics&includeFinished=true')).text()
    expect(all).toContain('SUMMARY:Pick a date')
  })

  it('returns the Timeline as a PowerPoint file whose parts parse (N7.6)', async () => {
    planning.createWorkItem(
      project.id,
      { title: 'Book the venue & band', startDate: '2026-11-02', targetDate: '2026-11-04' },
      human
    )
    planning.createWorkItem(project.id, { title: 'Someday' }, human)
    const response = await exportVia('format=pptx&from=2026-11-01&to=2026-11-30&groupBy=none')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'ppt/presentation.xml',
        'ppt/slides/slide1.xml'
      ])
    )
    for (const [name, bytes] of Object.entries(files))
      expect(xmlProblem(strFromU8(bytes)), name).toBeNull()
    expect(strFromU8(files['ppt/slides/slide1.xml'])).toContain('Book the venue &amp; band')
    expect(strFromU8(files['ppt/notesSlides/notesSlide1.xml'])).toContain('1 task has no dates')

    expect((await exportVia('format=pptx&from=2026-11-30&to=2026-11-01')).status).toBe(400)
    expect((await exportVia('format=pptx&groupBy=status')).status).toBe(400)
    // With no range, the months the dated tasks cover.
    expect((await exportVia('format=pptx')).status).toBe(200)
  })

  it('returns the shareable report as text/html with its options', async () => {
    planning.createWorkItem(
      project.id,
      { title: '<script>alert(1)</script>', description: 'Secret **plan**' },
      human
    )
    const response = await exportVia('format=html')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('Secret')

    const withDescriptions = await (await exportVia('format=html&descriptions=true')).text()
    expect(withDescriptions).toContain('Secret <strong>plan</strong>')
    expect((await exportVia('format=html&groupBy=owner')).status).toBe(400)
    expect((await exportVia('format=pdf')).status).toBe(400)
  })
})
