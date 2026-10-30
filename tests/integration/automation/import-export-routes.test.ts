import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts import and export routes (P6.1)', () => {
  const temp = useTempDir('ostler-automation-import-')
  const http = useAutomationServer()
  let root: string
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer
  let changed: string[]

  beforeEach(async () => {
    root = temp()
    const { ConfigStore } = await import('../../../electron/config-store')
    const { ProjectScaffoldService } =
      await import('../../../electron/services/project-scaffold-service')
    const { ProjectPackageService } =
      await import('../../../electron/services/project-package-service')
    const { ImportService } = await import('../../../electron/services/import-service')
    const store = new ConfigStore(path.join(root, 'config.json'))
    const first = store.registerProject({ name: 'Launch', folder: null })
    store.updateProject(first.id, { automationToken: 'import-token' })
    projects = store.getProjects()
    planning = new PlanningService(await createMigratedDatabase(root), () =>
      store.getProjects().map((entry) => entry.id)
    )
    const scaffold = new ProjectScaffoldService(store, () => root)
    const packages = new ProjectPackageService({
      planning,
      registerProject: (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
      projectNames: () => store.getProjects().map((entry) => entry.name),
      dataDir: root,
      appVersion: 'test'
    })
    const imports = new ImportService({
      planning,
      packages,
      getProjects: () => store.getProjects(),
      locale: () => 'en-GB',
      unpackDir: path.join(root, 'temp', 'imports')
    })
    changed = []
    server = new AutomationHttpServer(
      () => store.getProjects(),
      path.join(root, 'runtime'),
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
      { service: packages, projectCreated: () => undefined },
      { service: imports, changed: (project) => changed.push(project.id) }
    )
    await http.start(server, planning)
  })

  function call(
    method: string,
    urlPath: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ) {
    return http.request(method, `/automation/${projects[0].id}${urlPath}`, {
      body,
      token: 'import-token',
      headers: extraHeaders
    })
  }

  const csv = 'Task,State,When\nBook the venue,Doing,20/10/2026\nSend invites,Later,\n,Done,\n'
  const mapping = {
    columns: { title: 'Task', status: 'State', due: 'When' },
    statuses: { Later: 'ready' },
    dateFormat: 'dmy'
  }

  it('dry-runs a CSV import without writing, imports it, exports it, and undoes it', async () => {
    const dry = await call('POST', '/import/csv?dryRun=1', { csv, mapping })
    expect(dry.status).toBe(200)
    const preview = ((await dry.json()) as { value: Record<string, unknown> }).value
    expect(preview).toMatchObject({ importableCount: 2, errorRowCount: 1, dateFormat: 'dmy' })
    expect(planning.listWorkItems(projects[0].id)).toEqual([])
    expect(changed).toEqual([])

    const done = await call('POST', '/import/csv', { csv, mapping, fileName: 'plan.csv' })
    expect(done.status).toBe(200)
    const result = ((await done.json()) as { value: { batch: { id: string; itemCount: number } } })
      .value
    expect(result.batch.itemCount).toBe(2)
    expect(changed).toEqual([projects[0].id])
    const items = planning.listWorkItems(projects[0].id)
    expect(items.map((item) => [item.title, item.status, item.targetDate]).sort()).toEqual([
      ['Book the venue', 'active', '2026-10-20'],
      ['Send invites', 'ready', null]
    ])
    expect(items.every((item) => item.origin === 'imported')).toBe(true)

    const exported = await call('GET', '/export?format=csv&columns=title,status')
    expect(exported.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    const bytes = new Uint8Array(await exported.arrayBuffer())
    // UTF-8 with a BOM, so Excel reads accents (fetch's text() would drop it).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes)
    expect(text.startsWith('Title,Status\r\n')).toBe(true)
    expect(text).toContain('Book the venue,In progress\r\n')

    const pkg = await call('GET', '/export?format=package')
    expect(
      ((await pkg.json()) as { value: { format: string; tasks: unknown[] } }).value
    ).toMatchObject({ format: 'ostler-project-package', tasks: [{}, {}] })

    const undone = await call('DELETE', `/import/${result.batch.id}`)
    expect(undone.status).toBe(200)
    expect(
      ((await undone.json()) as { value: { movedIds: string[] } }).value.movedIds
    ).toHaveLength(2)
    expect(planning.listWorkItems(projects[0].id)).toEqual([])
    expect((await call('DELETE', `/import/${result.batch.id}`)).status).toBe(400)
    expect((await call('DELETE', '/import/not-a-batch')).status).toBe(404)
  })

  it('exports with an ID column and brings changes back by ID, with a dry run (N2.8)', async () => {
    const task = planning.createWorkItem(
      projects[0].id,
      { title: 'Book the venue' },
      planning.humanActor()
    )
    const exported = await call('GET', '/export?format=csv&columns=id,title,status')
    const text = new TextDecoder().decode(new Uint8Array(await exported.arrayBuffer()))
    expect(text).toBe(`ID,Title,Status\r\n${task.id},Book the venue,Backlog\r\n`)

    const edited = `ID,Title,Status\r\n${task.id},Book the hall,In progress\r\n,Send invites,Ready\r\nnot-an-id,Ghost,Done\r\n`
    const dry = await call('POST', '/import/csv?dryRun=1', { csv: edited, updateById: true })
    expect(dry.status).toBe(200)
    const preview = ((await dry.json()) as { value: Record<string, unknown> }).value
    expect(preview).toMatchObject({
      hasIdColumn: true,
      changed: [
        {
          taskId: task.id,
          changes: [
            { column: 'title', from: 'Book the venue', to: 'Book the hall' },
            { column: 'status', from: 'Backlog', to: 'In progress' }
          ]
        }
      ],
      newRows: [{ line: 3, title: 'Send invites' }],
      skipped: [{ line: 4, id: 'not-an-id', reason: 'unknown' }]
    })
    expect(planning.getWorkItem(task.id).title).toBe('Book the venue')
    expect(changed).toEqual([])

    const done = await call('POST', '/import/csv', { csv: edited, updateById: true })
    expect(done.status).toBe(200)
    const result = (
      (await done.json()) as {
        value: { changed: { taskId: string }[]; batch: { itemCount: number }; undo: unknown[] }
      }
    ).value
    expect(result.changed.map((entry) => entry.taskId)).toEqual([task.id])
    expect(result.batch.itemCount).toBe(1)
    expect(result.undo).toEqual([
      { id: task.id, values: { title: 'Book the venue', status: 'backlog' } }
    ])
    expect(planning.getWorkItem(task.id)).toMatchObject({
      title: 'Book the hall',
      status: 'active'
    })
    expect(planning.listWorkItems(projects[0].id)).toHaveLength(2)
    expect(changed).toEqual([projects[0].id])
  })

  it('exports the project file and imports it back as a new project, refusing a hostile one', async () => {
    planning.createWorkItem(projects[0].id, { title: 'Book the venue' }, planning.humanActor())
    const exported = await call('GET', '/export?format=file')
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toBe('application/zip')
    const file = new Uint8Array(await exported.arrayBuffer())
    expect([...file.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    // The copy written under the data folder to send is gone once it is sent.
    await vi.waitFor(() => expect(fs.readdirSync(path.join(root, 'temp', 'exports'))).toEqual([]))

    const send = (bytes: Uint8Array, query = '') =>
      fetch(`http://127.0.0.1:${http.port}/automation/${projects[0].id}/import/project${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip', Authorization: 'Bearer import-token' },
        body: bytes
      })
    const imported = await send(file, '?fileName=Launch.ostler-project')
    expect(imported.status).toBe(200)
    const result = (
      (await imported.json()) as {
        value: { projectId: string; projectName: string; batch: { fileName: string } }
      }
    ).value
    // "Launch" is taken: the new project is proposed free.
    expect(result).toMatchObject({
      projectName: 'Launch (2)',
      batch: { fileName: 'Launch.ostler-project' }
    })
    expect(planning.listWorkItems(result.projectId).map((item) => item.title)).toEqual([
      'Book the venue'
    ])

    const { zipSync } = await import('fflate')
    const hostile = zipSync({
      'project.json': new TextEncoder().encode('{}'),
      'library/../../evil.txt': new Uint8Array(1)
    })
    const refused = await send(hostile)
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toMatch(/outside the project/)
    expect(fs.readdirSync(path.join(root, 'temp', 'imports'))).toEqual([])
  })

  it('exports and imports a password-protected project file with the password in a header (N45)', async () => {
    planning.createWorkItem(projects[0].id, { title: 'Book the venue' }, planning.humanActor())
    const exported = await call('GET', '/export?format=file', undefined, {
      'Ostler-File-Password': 'correct horse'
    })
    expect(exported.status).toBe(200)
    const file = new Uint8Array(await exported.arrayBuffer())
    expect(new TextDecoder().decode(file.slice(0, 8))).toBe('OSTLRENC')
    await vi.waitFor(() => expect(fs.readdirSync(path.join(root, 'temp', 'exports'))).toEqual([]))

    const short = await call('GET', '/export?format=file', undefined, {
      'Ostler-File-Password': 'short'
    })
    expect(short.status).toBe(400)

    const send = (password?: string) =>
      fetch(`http://127.0.0.1:${http.port}/automation/${projects[0].id}/import/project`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          Authorization: 'Bearer import-token',
          ...(password ? { 'Ostler-File-Password': password } : {})
        },
        body: file
      })
    const before = planning.listWorkItems(projects[0].id).length
    const missing = await send()
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toMatch(/protected with a password/)
    const wrong = await send('wrong horse')
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { error: string }).error).toBe(
      'This password does not open the file, or the file is damaged.'
    )
    expect(fs.readdirSync(path.join(root, 'temp', 'imports'))).toEqual([])
    expect(planning.listWorkItems(projects[0].id)).toHaveLength(before)

    const imported = await send('correct horse')
    expect(imported.status).toBe(200)
    const result = ((await imported.json()) as { value: { projectId: string } }).value
    expect(planning.listWorkItems(result.projectId).map((item) => item.title)).toEqual([
      'Book the venue'
    ])
    expect(fs.readdirSync(path.join(root, 'temp', 'imports'))).toEqual([])
  })

  it('refuses a mapping that names a column the file does not have', async () => {
    const response = await call('POST', '/import/csv', {
      csv,
      mapping: { columns: { title: 'Summary' } }
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/no column "Summary"/)
  })

  // R4.2: another tool's export, by preset id or detected from the header.
  const linear = [
    'ID,Team,Title,Description,Status,Estimate,Priority,Project ID,Project,Creator,Assignee,Labels,Cycle Number,Cycle Name,Cycle Start,Cycle End,Created,Updated,Started,Triaged,Completed,Canceled,Archived,Due Date,Parent issue,Initiatives,Project Milestone ID,Project Milestone,SLA Status',
    'ENG-1,Engineering,Ship the onboarding,,In Progress,,High,,,,,,,,,,,,,,,,,,,,,,',
    'ENG-2,Engineering,Add the welcome screen,,Todo,,Urgent,,,,,,,,,,,,,,,,,,ENG-1,,,,',
    'ENG-3,Engineering,Fix the login,,Todo,,Low,,,,,,,,,,,,,,,,,,ENG-9,,,,'
  ].join('\n')

  it('detects a preset when none is given, and imports its subtasks', async () => {
    const dry = await call('POST', '/import/csv?dryRun=1', { csv: linear })
    const preview = ((await dry.json()) as { value: Record<string, unknown> }).value
    expect(preview).toMatchObject({
      preset: 'linear',
      detectedPreset: 'linear',
      importableCount: 3,
      subtaskCount: 1,
      warningRowCount: 1
    })
    const done = await call('POST', '/import/csv', { csv: linear })
    expect(done.status).toBe(200)
    const items = planning.listWorkItems(projects[0].id)
    const parent = items.find((item) => item.title === 'Ship the onboarding')!
    expect(items.find((item) => item.title === 'Add the welcome screen')).toMatchObject({
      parentWorkItemId: parent.id,
      status: 'ready',
      priority: 'critical'
    })
  })

  it('takes a preset id, or none, and refuses an unknown one', async () => {
    const none = await call('POST', '/import/csv?dryRun=1', { csv: linear, preset: 'none' })
    expect(((await none.json()) as { value: Record<string, unknown> }).value).toMatchObject({
      preset: null,
      detectedPreset: 'linear',
      subtaskCount: 0
    })
    const named = await call('POST', '/import/csv?dryRun=1', { csv, preset: 'jira', mapping })
    expect(((await named.json()) as { value: Record<string, unknown> }).value).toMatchObject({
      preset: 'jira',
      detectedPreset: null,
      importableCount: 2
    })
    const refused = await call('POST', '/import/csv?dryRun=1', { csv, preset: 'trello' })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toMatch(/preset must be one of/)
  })
})
