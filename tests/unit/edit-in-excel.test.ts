import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { ImportService } from '../../electron/services/import-service'
import { buildTasksCsv } from '../../electron/services/export-service'
import { csvCellText, tasksToCsv } from '../../src/shared/export/task-csv'
import type { CsvUpdatePreview, CsvUpdateResult, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

const tempDir = useTempDir('ostler-excel-')
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let imports: ImportService
let project: WatchedProject
let other: WatchedProject
let scaffold: ProjectScaffoldService

const human = () => planning.humanActor()

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 9, 10, 0))
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  people.ensureMe('Me')
  scaffold = new ProjectScaffoldService(store, () => tempDir())
  const packages = new ProjectPackageService({
    planning,
    registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
    getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
    projectNames: () => store.getProjects().map((entry) => entry.name),
    dataDir: tempDir(),
    appVersion: 'test',
    libraryFilePath: () => ''
  })
  imports = new ImportService({
    planning,
    packages,
    getProjects: () => store.getProjects(),
    locale: () => 'en-GB'
  })
  project = (
    await scaffold.createProject({ name: 'Website', color: '', notes: '', tags: [], folder: null })
  ).project
  other = (
    await scaffold.createProject({ name: 'Other', color: '', notes: '', tags: [], folder: null })
  ).project
})

afterEach(() => {
  planning.close()
  people.close()
  vi.useRealTimers()
})

function writeFile(name: string, bytes: string | Uint8Array): string {
  const filePath = path.join(tempDir(), name)
  fs.writeFileSync(filePath, bytes)
  return filePath
}

function preview(text: string): CsvUpdatePreview {
  return imports.updateCsvText(project.id, text, 'tasks.csv', {}, true, human()) as CsvUpdatePreview
}

function apply(text: string, request = {}): CsvUpdateResult {
  return imports.updateCsvText(
    project.id,
    text,
    'tasks.csv',
    request,
    false,
    human()
  ) as CsvUpdateResult
}

/** The file Edit in Excel writes, as rows of cells (BOM and quoting undone). */
function exported(columns?: string[]): string[][] {
  const { text } = buildTasksCsv(planning, project, { withIds: true, columns })
  return text
    .replace(/^\ufeff/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => line.split(','))
}

const csv = (rows: string[][], delimiter = ',') =>
  rows.map((row) => row.join(delimiter)).join('\r\n') + '\r\n'

describe('the ID column', () => {
  it('is written first by Edit in Excel, and only when asked', () => {
    const task = planning.createWorkItem(project.id, { title: 'Book the venue' }, human())
    const rows = exported(['title', 'status'])
    expect(rows[0]).toEqual(['ID', 'Title', 'Status'])
    expect(rows[1]).toEqual([task.id, 'Book the venue', 'Backlog'])
    const plain = buildTasksCsv(planning, project, {}).text
    expect(plain).not.toContain(task.id)
    // Asked for in the columns, as GET /export?columns=id,title does.
    const asked = buildTasksCsv(planning, project, { columns: ['id', 'title'] }).text
    expect(asked.split('\r\n')[0]).toBe('\ufeffID,Title')
  })

  it('undoes the apostrophe the writer puts before text a spreadsheet would run', () => {
    const task = planning.createWorkItem(project.id, { title: '-1 day' }, human())
    const text = tasksToCsv([task], ['title'], {
      personName: () => null,
      milestoneName: () => null,
      commentCount: () => 0,
      estimateUnit: 'points'
    })
    expect(text).toContain("'-1 day")
    expect(csvCellText("'-1 day")).toBe('-1 day')
    expect(preview(buildTasksCsv(planning, project, { withIds: true }).text).changed).toEqual([])
  })
})

describe('bringing changes back', () => {
  it('reads a file Excel saved with semicolons, in Windows-1252, without a BOM, with local dates', () => {
    const task = planning.createWorkItem(
      project.id,
      { title: 'Cafe menu', targetDate: '2026-10-20' },
      human()
    )
    const rows = exported(['title', 'due'])
    expect(rows[1]).toEqual([task.id, 'Cafe menu', '2026-10-20'])
    // Excel in Europe: day-first dates, semicolons, the Windows code page.
    const text = csv(
      [
        ['ID', 'Title', 'Due'],
        [task.id, 'Café menu', '21/10/2026']
      ],
      ';'
    )
    const bytes = Buffer.from(text, 'latin1')
    expect(bytes.includes(0xe9)).toBe(true)
    const file = imports.readEditFile(writeFile('tasks.csv', bytes))
    const result = imports.previewCsvUpdate(file.fileId, project.id)
    expect(result).toMatchObject({ encoding: 'windows-1252', delimiter: ';', dateFormat: 'dmy' })
    expect(result.changed).toEqual([
      {
        line: 2,
        taskId: task.id,
        title: 'Cafe menu',
        problems: [],
        changes: [
          { column: 'title', label: 'Title', from: 'Cafe menu', to: 'Café menu' },
          { column: 'due', label: 'Due', from: '2026-10-20', to: '2026-10-21' }
        ]
      }
    ])
  })

  it('lists changed fields only, new rows, and skips unknown, archived, foreign and repeated ids', () => {
    const alex = people.create({ name: 'Alex Chen' })
    const same = planning.createWorkItem(project.id, { title: 'Same' }, human())
    const edited = planning.createWorkItem(
      project.id,
      { title: 'Edited', priority: 'low' },
      human()
    )
    const untouched = planning.createWorkItem(project.id, { title: 'Not in the sheet' }, human())
    const archived = planning.createWorkItem(project.id, { title: 'Old' }, human())
    planning.archiveWorkItem(archived.id, human())
    const elsewhere = planning.createWorkItem(other.id, { title: 'Elsewhere' }, human())
    const text = csv([
      ['ID', 'Title', 'Status', 'Priority', 'Assignee'],
      [same.id, 'Same', 'Backlog', 'Medium', ''],
      [edited.id, 'Edited', 'In progress', 'High', 'alex chen'],
      ['', 'Brand new', 'Ready', 'Low', 'Sam New'],
      ['1.23457E+35', 'Mangled', 'Backlog', 'Medium', ''],
      [archived.id, 'Old', 'Backlog', 'Medium', ''],
      [elsewhere.id, 'Elsewhere', 'Backlog', 'Medium', ''],
      [edited.id, 'Edited again', 'Done', 'Low', '']
    ])
    const result = preview(text)
    expect(result.hasIdColumn).toBe(true)
    expect(result.unchangedCount).toBe(1)
    expect(result.changed).toHaveLength(1)
    expect(
      result.changed[0].changes.map((change) => [change.column, change.from, change.to])
    ).toEqual([
      ['status', 'Backlog', 'In progress'],
      ['priority', 'Low', 'High'],
      ['assignee', '', 'Alex Chen']
    ])
    expect(result.newRows).toEqual([{ line: 4, title: 'Brand new', errors: [], warnings: [] }])
    expect(result.newPeople).toEqual(['Sam New'])
    expect(result.skipped.map((row) => [row.line, row.reason])).toEqual([
      [5, 'unknown'],
      [6, 'archived'],
      [7, 'otherProject'],
      [8, 'duplicate']
    ])
    // A preview writes nothing; no task is ever deleted.
    expect(planning.getWorkItem(edited.id).priority).toBe('low')
    expect(planning.getWorkItem(untouched.id).deletedAt ?? null).toBeNull()
    expect(alex.name).toBe('Alex Chen')
  })

  it('shows a cell it cannot read and leaves that field as it is', () => {
    const task = planning.createWorkItem(
      project.id,
      { title: 'Plan', targetDate: '2026-10-20', estimate: 3 },
      human()
    )
    const text = csv([
      ['ID', 'Title', 'Due', 'Assignee', 'Status', 'Estimate'],
      [task.id, 'Plan it', 'someday soon', 'Nobody Known', 'Wibble', 'lots']
    ])
    const [row] = preview(text).changed
    expect(row.changes.map((change) => change.column)).toEqual(['title'])
    expect(row.problems.map((problem) => problem.column)).toEqual([
      'due',
      'assignee',
      'status',
      'estimate'
    ])
    const result = apply(text)
    expect(result.changed).toEqual([{ taskId: task.id, title: 'Plan', columns: ['title'] }])
    const after = planning.getWorkItem(task.id)
    expect(after).toMatchObject({ title: 'Plan it', targetDate: '2026-10-20', estimate: 3 })
    // A changed row never adds a person.
    expect(
      people.list({ includeArchived: true }).some((person) => person.name === 'Nobody Known')
    ).toBe(false)
  })
})

describe('applying', () => {
  it('changes tasks through the one update, with activity, and one undo puts every old value back', () => {
    const one = planning.createWorkItem(
      project.id,
      { title: 'One', labels: ['web'], startDate: '2026-10-01' },
      human()
    )
    const two = planning.createWorkItem(project.id, { title: 'Two', status: 'ready' }, human())
    const text = csv([
      ['ID', 'Title', 'Status', 'Labels', 'Start'],
      [one.id, 'One', 'Backlog', 'web; design', ''],
      [two.id, 'Two (renamed)', 'Done', '', '']
    ])
    const result = apply(text)
    expect(result.batch).toBeNull()
    expect(result.changed.map((entry) => entry.columns)).toEqual([
      ['labels', 'start'],
      ['title', 'status']
    ])
    expect(planning.getWorkItem(one.id)).toMatchObject({
      labels: ['web', 'design'],
      startDate: null
    })
    expect(planning.getWorkItem(two.id)).toMatchObject({ title: 'Two (renamed)', status: 'done' })
    const activity = planning.listActivity(project.id, two.id).entries
    expect(activity.length).toBeGreaterThan(0)

    expect(imports.restoreTaskValues(project.id, result.undo, human())).toBe(2)
    expect(planning.getWorkItem(one.id)).toMatchObject({
      labels: ['web'],
      startDate: '2026-10-01'
    })
    expect(planning.getWorkItem(two.id)).toMatchObject({ title: 'Two', status: 'ready' })
  })

  it('applies only the ticked tasks and rows, in one transaction', () => {
    const one = planning.createWorkItem(project.id, { title: 'One' }, human())
    const two = planning.createWorkItem(project.id, { title: 'Two' }, human())
    const text = csv([
      ['ID', 'Title'],
      [one.id, 'One!'],
      [two.id, 'Two!'],
      ['', 'Three'],
      ['', 'Four']
    ])
    const result = apply(text, { taskIds: [two.id], newLines: [5] })
    expect(planning.getWorkItem(one.id).title).toBe('One')
    expect(planning.getWorkItem(two.id).title).toBe('Two!')
    const titles = planning.listWorkItems(project.id).map((task) => task.title)
    expect(titles).toContain('Four')
    expect(titles).not.toContain('Three')
    expect(result.batch).toMatchObject({ source: 'csv', itemCount: 1 })
  })

  it('brings new rows in as an import batch that Undo import removes', () => {
    const kept = planning.createWorkItem(project.id, { title: 'Kept' }, human())
    const result = apply(
      csv([
        ['ID', 'Title', 'Assignee', 'Milestone'],
        [kept.id, 'Kept', '', ''],
        ['', 'New one', 'Sam New', 'Beta']
      ])
    )
    expect(result.changed).toEqual([])
    expect(result.batch).not.toBeNull()
    // New rows create missing people and milestones, as an ordinary import does.
    expect(planning.listMilestones(project.id).map((milestone) => milestone.name)).toEqual(['Beta'])
    imports.undo(result.batch!.id, true, human())
    expect(planning.listWorkItems(project.id).map((task) => task.title)).toEqual(['Kept'])
  })

  it('refuses a file with nothing to bring back, and keeps the tasks’ order', () => {
    const a = planning.createWorkItem(project.id, { title: 'A' }, human())
    const b = planning.createWorkItem(project.id, { title: 'B' }, human())
    const text = csv([
      ['ID', 'Title'],
      [b.id, 'B'],
      [a.id, 'A']
    ])
    expect(() => apply(text)).toThrow(/Nothing to bring back/)
    expect(planning.listWorkItems(project.id).map((task) => task.id)).toEqual([a.id, b.id])
  })

  it('tells the person to close the file when Excel holds it', () => {
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    })
    const filePath = writeFile('locked.csv', 'ID,Title\r\n')
    expect(() => imports.readEditFile(filePath)).toThrow('Close the file in Excel, then try again')
    spy.mockRestore()
  })
})
