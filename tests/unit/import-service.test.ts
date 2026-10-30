import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { LibraryService } from '../../electron/services/library-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { ImportService } from '../../electron/services/import-service'
import { buildTasksCsv } from '../../electron/services/export-service'
import { importSource } from '../../electron/services/inbox-sources'
import { projectScopedTables } from '../../electron/services/project-removal-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Images decode in Electron only; here they are kept as files, without a thumbnail.
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

const tempDir = useTempDir('ostler-import-')
let databasePath: string
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let library: LibraryService
let packages: ProjectPackageService
let imports: ImportService
let registerFails = false
let project: WatchedProject

const fixtures = path.join(__dirname, 'fixtures', 'import')

function writeFile(name: string, text: string | Uint8Array): string {
  const filePath = path.join(tempDir(), name)
  fs.writeFileSync(filePath, text)
  return filePath
}

function rowCounts(): Record<string, number> {
  const db = new Database(databasePath, { readonly: true })
  try {
    const counts: Record<string, number> = {}
    for (const table of projectScopedTables(db)) {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n
    }
    counts.people = (db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n
    return counts
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 9, 10, 0))
  databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  library = new LibraryService(databasePath, tempDir())
  people.ensureMe('Me')
  const scaffold = new ProjectScaffoldService(store, () => tempDir())
  registerFails = false
  packages = new ProjectPackageService({
    planning,
    registerProject: async (request, fixed) => {
      if (registerFails) throw new Error('The disk is full')
      return scaffold.createProject(request, fixed)
    },
    getProject: (projectId) => {
      const found = store.getProjects().find((entry) => entry.id === projectId)
      if (!found) throw new Error('Project not found')
      return found
    },
    projectNames: () => store.getProjects().map((entry) => entry.name),
    dataDir: tempDir(),
    appVersion: 'test',
    libraryFilePath: (projectId, itemId) => library.originalFilePath(projectId, itemId)
  })
  imports = new ImportService({
    planning,
    packages,
    getProjects: () => store.getProjects(),
    addLibraryFile: async (projectId, filePath) =>
      (await library.importPaths(projectId, [filePath]))[0].item.id,
    updateLibraryItem: (projectId, itemId, updates) => {
      library.updateItem(projectId, itemId, updates)
    },
    locale: () => 'en-GB',
    unpackDir: path.join(tempDir(), 'unpack')
  })
  project = (
    await scaffold.createProject({ name: 'Website', color: '', notes: '', tags: [], folder: null })
  ).project
})

afterEach(() => {
  planning.close()
  people.close()
  library.close()
  vi.useRealTimers()
})

const CSV = [
  'Summary,Status,Priority,Assignee,Labels,Due Date,Sprint,Checklist',
  'Design the home page,In Progress,High,Alex Chen,"design; web",2026-10-20,Beta,"[x] Sketch\n[ ] Review"',
  'Write the copy,To Do,,alex chen,content,,Beta,',
  ',Done,,,,,,',
  'Launch,Done,Low,,,,Launch,'
].join('\r\n')

describe('CSV import', () => {
  it('fills custom fields: an existing one by header name, and a new one it creates (R2.2)', async () => {
    const size = planning.createField(project.id, {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small' }, { name: 'Large' }]
    })
    const file = imports.readFile(
      writeFile(
        'fields.csv',
        ['Summary,Size,Team,Cost', 'One,small,Web,12', 'Two,Huge,Data,x', 'Three,,Web,3'].join(
          String.fromCharCode(10)
        )
      )
    )
    const preview = imports.previewCsv(
      file.fileId,
      { fieldColumns: { '2': { create: { name: 'Team', type: 'choice' } } } },
      project.id
    )
    expect(preview.customColumns.map((column) => [column.header, column.target])).toEqual([
      ['Size', { fieldId: size.id }],
      ['Team', { create: { name: 'Team', type: 'choice' } }],
      ['Cost', null]
    ])
    expect(preview.customColumns[2].suggestedType).toBe('text')
    expect(preview.newFields).toEqual(['Team'])
    expect(preview.warningRowCount).toBe(1)

    await imports.runImport(
      file.fileId,
      {
        kind: 'csv',
        options: { fieldColumns: { '2': { create: { name: 'Team', type: 'choice' } } } }
      },
      { kind: 'project', projectId: project.id }
    )
    const team = planning.listFields(project.id).find((field) => field.name === 'Team')!
    expect(team.options.map((option) => option.name)).toEqual(['Web', 'Data'])
    const byTitle = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    expect(byTitle.get('One')!.fieldValues).toEqual({
      [size.id]: size.options[0].id,
      [team.id]: team.options[0].id
    })
    // "Huge" is not a Size, so only the team came across.
    expect(byTitle.get('Two')!.fieldValues).toEqual({ [team.id]: team.options[1].id })
  })

  it('previews, then imports through the planning write points in one batch', async () => {
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    expect(file.kind).toBe('csv')
    const preview = imports.previewCsv(file.fileId, {}, project.id)
    expect(preview.importableCount).toBe(3)
    expect(preview.errorRowCount).toBe(1)
    expect(preview.newMilestones).toEqual(['Beta', 'Launch'])
    expect(preview.newPeople).toEqual(['Alex Chen'])

    const result = await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
    expect(result).toMatchObject({ projectName: 'Website', skipped: 1 })
    expect(result.batch).toMatchObject({
      projectId: project.id,
      source: 'csv',
      fileName: 'tasks.csv',
      itemCount: 3,
      undoneAt: null
    })

    const items = planning.listWorkItems(project.id)
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.origin).toBe('imported')
      expect(item.importBatchId).toBe(result.batch.id)
    }
    const design = items.find((item) => item.title === 'Design the home page')!
    expect(design).toMatchObject({
      status: 'active',
      priority: 'high',
      labels: ['design', 'web'],
      targetDate: '2026-10-20',
      acceptanceCriteria: ['Sketch', 'Review'],
      checkedCriteria: ['Sketch']
    })
    // One Alex Chen for both spellings, and milestones created once.
    const alex = people.list().filter((person) => person.name === 'Alex Chen')
    expect(alex).toHaveLength(1)
    expect(items.find((item) => item.title === 'Write the copy')!.assigneeId).toBe(alex[0].id)
    expect(
      planning
        .listMilestones(project.id)
        .map((m) => m.name)
        .sort()
    ).toEqual(['Beta', 'Launch'])
    // Search and activity happened, as for any task.
    expect(
      planning.search.search('home page', { projectId: project.id }).map((hit) => hit.title)
    ).toContain('Design the home page')
    const activity = planning.listActivity(project.id, design.id)
    expect(activity.entries.some((entry) => entry.kind === 'change')).toBe(true)
  })

  it('imports the whole file from the dialog into a new project', async () => {
    const file = imports.readFile(path.join(fixtures, 'excel-1252.csv'))
    const result = await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'new', name: 'Café' }
    )
    expect(result.projectName).toBe('Café')
    const created = store.getProjects().find((entry) => entry.id === result.projectId)!
    expect(
      planning
        .listWorkItems(created.id)
        .map((item) => item.title)
        .sort()
    ).toEqual(['Café opening', 'Naïve plan'])
    expect(() => imports.previewCsv(file.fileId)).toThrow(/no longer open/)
  })

  it('sets off no rules, whatever the project’s rules say (R6.2, D45)', async () => {
    planning.rules.create(project.id, {
      name: 'Every new task',
      trigger: { kind: 'taskCreated' },
      actions: [
        { kind: 'addLabel', label: 'ruled' },
        { kind: 'notifyMe', message: '' }
      ]
    })
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
    const items = planning.listWorkItems(project.id)
    expect(items).toHaveLength(3)
    expect(items.some((item) => item.labels.includes('ruled'))).toBe(false)
    expect(planning.rules.list(project.id)[0].runCount).toBe(0)
    // A task typed in afterwards does set it off.
    expect(
      planning.createWorkItem(project.id, { title: 'Typed' }, planning.humanActor()).labels
    ).toEqual(['ruled'])
  })

  it('rolls back completely when a write fails part-way', async () => {
    const before = rowCounts()
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    const create = planning.createWorkItem.bind(planning)
    let calls = 0
    vi.spyOn(planning, 'createWorkItem').mockImplementation((...args) => {
      if (++calls === 3) throw new Error('The disk is full')
      return create(...args)
    })
    await expect(
      imports.runImport(
        file.fileId,
        { kind: 'csv', options: {} },
        { kind: 'project', projectId: project.id }
      )
    ).rejects.toThrow('The disk is full')
    expect(rowCounts()).toEqual(before)
  })

  it('leaves nothing behind when the new project cannot be registered', async () => {
    const before = rowCounts()
    const projectsBefore = store.getProjects().length
    registerFails = true
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    await expect(
      imports.runImport(file.fileId, { kind: 'csv', options: {} }, { kind: 'new' })
    ).rejects.toThrow('The disk is full')
    expect(rowCounts()).toEqual(before)
    expect(store.getProjects()).toHaveLength(projectsBefore)
  })

  it('refuses a file over 50 MB and a JSON file that is neither Trello nor Ostler', () => {
    const big = writeFile('big.csv', '')
    fs.truncateSync(big, 50 * 1024 * 1024 + 1)
    expect(() => imports.readFile(big)).toThrow(/larger than 50 MB/)
    expect(() => imports.readFile(writeFile('other.json', '{"hello": 1}'))).toThrow(
      /neither a Trello board/
    )
  })

  it('takes CSV text from the automation API, with a dry run that writes nothing', () => {
    const before = rowCounts()
    const preview = imports.importCsvText(project.id, CSV, {}, 'api.csv', true, {
      kind: 'automation'
    })
    expect(preview).toMatchObject({ importableCount: 3, errorRowCount: 1 })
    expect(rowCounts()).toEqual(before)
    const result = imports.importCsvText(project.id, CSV, {}, 'api.csv', false, {
      kind: 'automation'
    })
    expect(result).toMatchObject({ batch: { itemCount: 3, source: 'csv' } })
  })

  it('matches a Type column to the project’s types by name, creating the missing ones (N2.7a)', () => {
    const bug = planning.taskTypes.create(project.id, { name: 'Bug', icon: 'bug' })
    const text = 'Title,Type\nCrash,bug\nRoof,Repair\nShed,repair\nTidy,\n'
    const preview = imports.importCsvText(project.id, text, {}, 'types.csv', true, {
      kind: 'automation'
    })
    expect(preview).toMatchObject({ newTypes: ['Repair'] })
    imports.importCsvText(project.id, text, {}, 'types.csv', false, { kind: 'automation' })
    const types = planning.taskTypes.list(project.id)
    expect(types.map((type) => type.name)).toEqual(['Bug', 'Repair'])
    const byTitle = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    expect(byTitle.get('Crash')?.typeId).toBe(bug.id)
    expect(byTitle.get('Roof')?.typeId).toBe(types[1].id)
    expect(byTitle.get('Shed')?.typeId).toBe(types[1].id)
    expect(byTitle.get('Tidy')?.typeId).toBeNull()
  })

  it('writes a preset’s subtasks and Waits on, and undoes them in one step (R4.2)', async () => {
    const text = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'import', 'jira-export.csv'),
      'utf8'
    )
    const file = imports.readFile(writeFile('jira-export.csv', text))
    const result = await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
    expect(result.batch.itemCount).toBe(4)
    const byTitle = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    const build = byTitle.get('Set up the build')!
    expect(byTitle.get('Write the build script')!.parentWorkItemId).toBe(build.id)
    expect(byTitle.get('Deploy to staging')!.dependencyIds).toEqual([build.id])
    expect(build.milestoneId).not.toBeNull()
    // Nothing was changed after it was created, so undo takes everything.
    expect(imports.checkUndo(result.batch.id).changed).toEqual([])
    imports.undo(result.batch.id, false, planning.humanActor())
    expect(planning.listWorkItems(project.id)).toEqual([])
  })
})

describe('Trello import', () => {
  it('imports lists, labels, members and checklists, skipping archived cards', async () => {
    const file = imports.readFile(path.join(fixtures, 'trello-board.json'))
    expect(file.kind).toBe('trello')
    const preview = imports.previewTrello(file.fileId, {}, project.id)
    expect(preview.boardName).toBe('Summer fair')
    const result = await imports.runImport(
      file.fileId,
      { kind: 'trello', options: { listMap: { 'l-todo': 'ready' } } },
      { kind: 'project', projectId: project.id }
    )
    expect(result.batch).toMatchObject({ source: 'trello', itemCount: 4 })
    const items = planning.listWorkItems(project.id)
    expect(items.map((item) => item.title).sort()).toEqual([
      'Book the venue',
      'Plan the menu',
      'Print posters',
      'Send invites'
    ])
    const byTitle = new Map(items.map((item) => [item.title, item]))
    expect(byTitle.get('Send invites')!.status).toBe('ready')
    expect(byTitle.get('Book the venue')!.status).toBe('done')
    expect(byTitle.get('Plan the menu')!.checkedCriteria).toEqual(['Starter'])
    expect(byTitle.get('Plan the menu')!.assigneeId).toBe(
      people.list().find((person) => person.name === 'Alex Chen')!.id
    )
    const names = people.list().map((person) => person.name)
    expect(names).toEqual(expect.arrayContaining(['Alex Chen', 'Sam Lee']))
    const labels = planning.listProjectLabels(project.id)
    expect(labels.find((label) => label.name === 'Urgent')).toMatchObject({
      color: '#ef4444',
      hasColor: true
    })
  })
})

describe('undoing an import', () => {
  async function importedBatch() {
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    return imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
  }

  it('moves the tasks to the recycle bin and keeps the ones changed since', async () => {
    const { batch } = await importedBatch()
    vi.setSystemTime(new Date(2026, 9, 9, 11, 0))
    const copy = planning.listWorkItems(project.id).find((item) => item.title === 'Write the copy')!
    planning.updateWorkItem(copy.id, { priority: 'high' }, planning.humanActor())

    const check = imports.checkUndo(batch.id)
    expect(check.taskCount).toBe(3)
    expect(check.changed).toEqual([{ id: copy.id, title: 'Write the copy' }])

    const undone = imports.undo(batch.id, false, planning.humanActor())
    expect(undone.movedIds).toHaveLength(2)
    expect(undone.kept).toEqual([{ id: copy.id, title: 'Write the copy' }])
    expect(undone.batch.undoneAt).not.toBeNull()
    expect(planning.listWorkItems(project.id).map((item) => item.title)).toEqual(['Write the copy'])
    expect(planning.listWorkItems(project.id, 'deleted')).toHaveLength(2)
    expect(() => imports.undo(batch.id, false, planning.humanActor())).toThrow(/already undone/)

    // Undo of the undo brings them back, and they do not count as changed.
    const restored = imports.restore(batch.id, undone.movedIds, planning.humanActor())
    expect(restored.undoneAt).toBeNull()
    expect(planning.listWorkItems(project.id)).toHaveLength(3)
    expect(imports.checkUndo(batch.id).changed).toHaveLength(1)
  })

  it('moves changed tasks too when the person confirms', async () => {
    const { batch } = await importedBatch()
    vi.setSystemTime(new Date(2026, 9, 9, 11, 0))
    const launch = planning.listWorkItems(project.id).find((item) => item.title === 'Launch')!
    planning.addComment(launch.id, 'Moved to next week', planning.humanActor())
    const undone = imports.undo(batch.id, true, planning.humanActor())
    expect(undone.movedIds).toHaveLength(3)
    expect(undone.kept).toEqual([])
    expect(planning.listWorkItems(project.id)).toEqual([])
  })

  it('shows in the Inbox, with its count and file, until it is undone', async () => {
    const { batch } = await importedBatch()
    const source = importSource(planning.database, () => store.getProjects())
    expect(source()).toEqual([
      expect.objectContaining({
        key: 'import:' + batch.id,
        kind: 'import',
        title: 'Imported 3 tasks into Website',
        body: 'From tasks.csv',
        projectId: project.id,
        taskId: null
      })
    ])
    imports.undo(batch.id, true, planning.humanActor())
    expect(source()).toEqual([])
  })

  it('lists the history of imports, newest first', async () => {
    const first = await importedBatch()
    vi.setSystemTime(new Date(2026, 9, 9, 12, 0))
    const second = await importedBatch()
    expect(imports.listBatches().map((batch) => batch.id)).toEqual([
      second.batch.id,
      first.batch.id
    ])
  })
})

describe('project export and import', () => {
  async function richProject(): Promise<string> {
    const { project: created } = await packages.createProjectFromPackage({
      format: 'ostler-project-package',
      version: 1,
      exportedAt: null,
      app: null,
      template: null,
      project: { name: 'Party', color: '#ec4899', estimateUnit: 'hours' },
      people: [{ ref: 'p1', name: 'Sam Rivera', initials: '', color: null }],
      labels: [{ name: 'venue', color: '#8b5cf6' }],
      goals: [],
      milestones: [
        {
          ref: 'm1',
          goalRef: null,
          name: 'Booked',
          outcome: '',
          targetDate: '2026-11-01',
          successCriteria: [],
          status: 'planned'
        }
      ],
      tasks: [
        {
          ref: 't1',
          milestoneRef: 'm1',
          parentRef: null,
          title: 'Book the hall',
          description: 'Call first',
          status: 'active',
          priority: 'high',
          labels: ['venue'],
          checklist: [{ text: 'Call', checked: true }],
          assigneeRef: 'p1',
          startDate: null,
          dueDate: '2026-10-20',
          estimate: 2,
          dependsOnRefs: [],
          recurrence: null
        }
      ],
      decisions: [],
      comments: [{ taskRef: 't1', authorRef: null, body: 'Booked for Saturday' }],
      library: [
        {
          kind: 'note',
          title: 'Ideas',
          summary: '',
          body: 'Fancy dress?',
          url: null,
          aiAccess: null,
          tags: [],
          file: null
        }
      ]
    })
    await library.importPaths(created.id, [writeFile('Guest list.txt', 'Ana\nBo\n')])
    return created.id
  }

  // A 1×1 PNG and a one-page PDF: the Library's two common binary kinds.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const PDF = Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
      ''
    ].join('\n'),
    'latin1'
  )

  function exportedPackage(projectId: string) {
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    return { ...pkg, exportedAt: null }
  }

  function libraryFiles(projectId: string): Record<string, string> {
    return Object.fromEntries(
      library
        .listItems(projectId)
        .filter((item) => item.file)
        .map((item) => [
          item.title,
          fs.readFileSync(library.originalFilePath(projectId, item.id)).toString('base64')
        ])
    )
  }

  it('exports one .ostler-project file and imports it back as an equal project, Library files included', async () => {
    const projectId = await richProject()
    await library.importPaths(projectId, [writeFile('Logo.png', PNG), writeFile('Brief.pdf', PDF)])
    const target = path.join(tempDir(), 'out.ostler-project')
    const exported = packages.exportProjectFile(projectId, target)
    expect(exported).toMatchObject({ taskCount: 1, fileCount: 3 })
    expect(fs.lstatSync(target).isFile()).toBe(true)
    // Inside, exactly the export folder's layout.
    const zipped = unzipSync(new Uint8Array(fs.readFileSync(target)))
    expect(Object.keys(zipped).sort()).toEqual([
      'library/Brief.pdf',
      'library/Guest list.txt',
      'library/Logo.png',
      'project.json'
    ])
    const json = JSON.parse(new TextDecoder().decode(zipped['project.json']))
    expect(json.comments).toMatchObject([{ taskRef: 't1', body: 'Booked for Saturday' }])

    const file = imports.readFile(target)
    expect(file).toMatchObject({ kind: 'package', fileName: 'out.ostler-project' })
    expect(file.packageSummary).toMatchObject({ name: 'Party', taskCount: 1, fileCount: 3 })
    const result = await imports.runImport(file.fileId, { kind: 'package' }, { kind: 'new' })
    expect(result.warnings).toEqual([])
    expect(result.batch).toMatchObject({ source: 'package', itemCount: 1 })
    // "Party" is taken by the original: the copy is proposed free.
    expect(result.projectName).toBe('Party (2)')

    // The same project, but for its name.
    expect({ ...exportedPackage(result.projectId), project: null }).toEqual({
      ...exportedPackage(projectId),
      project: null
    })
    expect(libraryFiles(result.projectId)).toEqual(libraryFiles(projectId))
    expect(planning.listWorkItems(result.projectId)[0].origin).toBe('imported')
    // The unpacked copy is gone.
    expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
  })

  it('imports an export folder made by the current version, the same as its file', async () => {
    const fixture = path.join(fixtures, 'Party.ostler-project')
    const file = imports.readFolder(fixture)
    expect(file.packageSummary).toMatchObject({ name: 'Party', taskCount: 1, fileCount: 1 })
    const result = await imports.runImport(file.fileId, { kind: 'package' }, { kind: 'new' })
    expect(result.warnings).toEqual([])
    expect(planning.listWorkItems(result.projectId).map((item) => item.title)).toEqual([
      'Book the hall'
    ])
    const copied = library.listItems(result.projectId).find((item) => item.kind === 'document')!
    expect(fs.readFileSync(library.originalFilePath(result.projectId, copied.id), 'utf8')).toBe(
      'Ana\nBo\n'
    )
    // The folder is read, never changed.
    expect(fs.readdirSync(path.join(fixture, 'library'))).toEqual(['Guest list.txt'])
  })

  it('refuses a folder whose files are missing, before writing anything', async () => {
    const folder = path.join(tempDir(), 'Party.ostler-project')
    fs.cpSync(path.join(fixtures, 'Party.ostler-project'), folder, { recursive: true })
    fs.rmSync(path.join(folder, 'library', 'Guest list.txt'))
    const before = rowCounts()
    expect(() => imports.readFolder(folder)).toThrow(/is not in the folder/)
    expect(rowCounts()).toEqual(before)
  })

  it('lets go of an unpacked project file when the dialog closes', async () => {
    const projectId = await richProject()
    const target = path.join(tempDir(), 'Party.ostler-project')
    packages.exportProjectFile(projectId, target)
    const file = imports.readFile(target)
    expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toHaveLength(1)
    imports.forgetFile(file.fileId)
    expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
  })

  describe('protected with a password (N45)', () => {
    const exportsFolder = () => path.join(tempDir(), 'temp', 'exports')

    it('exports an encrypted file, removes the plain zip and imports it only with the password', async () => {
      const projectId = await richProject()
      const target = path.join(tempDir(), 'Locked.ostler-project')
      packages.exportProjectFile(projectId, target, { password: 'correct horse' })
      // Not a zip any more, and no plain copy left under the data folder.
      expect(() => unzipSync(new Uint8Array(fs.readFileSync(target)))).toThrow()
      expect(fs.readdirSync(exportsFolder())).toEqual([])

      const file = imports.readFile(target)
      expect(file).toMatchObject({
        kind: 'package',
        locked: true,
        fileName: 'Locked.ostler-project'
      })
      expect(file.packageSummary).toBeUndefined()
      // Nothing is read, unpacked or imported until the password is given.
      expect(fs.existsSync(path.join(tempDir(), 'unpack'))).toBe(false)
      await expect(
        imports.runImport(file.fileId, { kind: 'package' }, { kind: 'new' })
      ).rejects.toThrow(/protected with a password/)

      const before = rowCounts()
      expect(() => imports.unlockFile(file.fileId, 'wrong horse')).toThrow(
        /This password does not open the file, or the file is damaged/
      )
      expect(rowCounts()).toEqual(before)
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])

      // The file is still held: the right password opens it.
      const opened = imports.unlockFile(file.fileId, 'correct horse')
      expect(opened.locked).toBeUndefined()
      expect(opened).toMatchObject({ fileName: 'Locked.ostler-project' })
      expect(opened.packageSummary).toMatchObject({ name: 'Party', taskCount: 1 })
      // Only the unpacked folder is left; the decrypted zip is gone.
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toHaveLength(1)
      const result = await imports.runImport(opened.fileId, { kind: 'package' }, { kind: 'new' })
      expect(result.projectName).toBe('Party (2)')
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
      // The source file is read, never changed.
      expect(fs.existsSync(target)).toBe(true)
    })

    it('refuses a short password and writes nothing', async () => {
      const projectId = await richProject()
      const target = path.join(tempDir(), 'Short.ostler-project')
      expect(() => packages.exportProjectFile(projectId, target, { password: 'short' })).toThrow(
        /at least 8 characters/
      )
      expect(fs.existsSync(target)).toBe(false)
    })

    it('refuses a damaged file and removes the decrypted copy', async () => {
      const projectId = await richProject()
      const target = path.join(tempDir(), 'Damaged.ostler-project')
      packages.exportProjectFile(projectId, target, { password: 'correct horse' })
      const raw = fs.readFileSync(target)
      raw[raw.length - 100] ^= 0xff
      fs.writeFileSync(target, raw)
      const file = imports.readFile(target)
      expect(() => imports.unlockFile(file.fileId, 'correct horse')).toThrow(
        /This password does not open the file, or the file is damaged/
      )
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
    })

    it('reads a protected file sent as a stream, with and without its password', async () => {
      const projectId = await richProject()
      const target = path.join(tempDir(), 'Sent.ostler-project')
      packages.exportProjectFile(projectId, target, { password: 'correct horse' })
      const stream = () => fs.createReadStream(target)
      await expect(
        imports.readProjectFileStream(stream(), 'Sent.ostler-project', 10 ** 9)
      ).rejects.toThrow(/protected with a password/)
      await expect(
        imports.readProjectFileStream(stream(), 'Sent.ostler-project', 10 ** 9, 'nope nope nope')
      ).rejects.toThrow(/does not open the file/)
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
      const file = await imports.readProjectFileStream(
        stream(),
        'Sent.ostler-project',
        10 ** 9,
        'correct horse'
      )
      expect(file.packageSummary).toMatchObject({ name: 'Party' })
      await imports.runImport(file.fileId, { kind: 'package' }, { kind: 'new' })
      expect(fs.readdirSync(path.join(tempDir(), 'unpack'))).toEqual([])
    })

    it('leaves an ordinary project file as it was', async () => {
      const projectId = await richProject()
      const target = path.join(tempDir(), 'Plain.ostler-project')
      packages.exportProjectFile(projectId, target)
      expect(Object.keys(unzipSync(new Uint8Array(fs.readFileSync(target))))).toContain(
        'project.json'
      )
      const file = imports.readFile(target)
      expect(file.locked).toBeUndefined()
      expect(file.packageSummary).toMatchObject({ name: 'Party' })
      imports.forgetFile(file.fileId)
    })
  })

  it('imports a bare project.json, and a template file as a saved template', async () => {
    const projectId = await richProject()
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    const file = imports.readFile(writeFile('party.json', JSON.stringify(pkg)))
    expect(file.kind).toBe('package')
    const result = await imports.runImport(
      file.fileId,
      { kind: 'package' },
      { kind: 'new', name: 'Party again' }
    )
    expect(result.projectName).toBe('Party again')
    // The document's file is not beside a bare .json: it is named, not imported.
    expect(result.warnings).toEqual(['Guest list: its file was not beside the package'])

    const template = packages.importTemplate(pkg)
    expect(template).toMatchObject({ source: 'saved', name: 'Party', taskCount: 1 })
    expect(packages.getTemplatePackage(template.id).comments).toEqual([])
    expect(packages.getTemplatePackage(template.id).library.map((item) => item.kind)).toEqual([
      'note'
    ])
  })

  it('refuses an invalid package with the path of the problem', () => {
    const bad = writeFile(
      'bad.json',
      JSON.stringify({
        format: 'ostler-project-package',
        version: 1,
        project: { name: 'X' },
        tasks: [{ ref: 't1', title: 'A', milestoneRef: 'm9' }]
      })
    )
    expect(() => imports.readFile(bad)).toThrow(/tasks\[0\]\.milestoneRef 'm9'/)
  })
})

describe('CSV export', () => {
  it('writes the chosen tasks and columns, in order, with a BOM', async () => {
    const file = imports.readFile(writeFile('tasks.csv', CSV))
    await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
    const items = planning.listWorkItems(project.id)
    const launch = items.find((item) => item.title === 'Launch')!
    const design = items.find((item) => item.title === 'Design the home page')!
    const { text, taskCount } = buildTasksCsv(planning, project, {
      taskIds: [launch.id, design.id],
      columns: ['title', 'assignee', 'milestone', 'nonsense']
    })
    expect(taskCount).toBe(2)
    expect(text).toBe(
      '﻿Title,Assignee,Milestone\r\nLaunch,,Launch\r\nDesign the home page,Alex Chen,Beta\r\n'
    )
    expect(buildTasksCsv(planning, project).taskCount).toBe(3)
  })
})

describe('Iterations in CSV (R6.1)', () => {
  it('exports an Iteration column and imports it back by name, dropping unknown names', async () => {
    const one = planning.iterations.create(project.id, {
      name: 'Sprint 1',
      startDate: '2026-10-05',
      endDate: '2026-10-18'
    })
    planning.createWorkItem(project.id, { title: 'In it', iterationId: one.id }, { kind: 'human' })
    const { text } = buildTasksCsv(planning, project, { columns: ['title', 'iteration'] })
    expect(text).toBe('﻿Title,Iteration\r\nIn it,Sprint 1\r\n')

    const file = imports.readFile(
      writeFile('iterations.csv', ['Title,Iteration', 'Back,sprint 1', 'Lost,Sprint 9'].join('\n'))
    )
    const preview = imports.previewCsv(file.fileId, {}, project.id)
    expect(preview.warningRowCount).toBe(1)
    await imports.runImport(
      file.fileId,
      { kind: 'csv', options: {} },
      { kind: 'project', projectId: project.id }
    )
    const byTitle = new Map(planning.listWorkItems(project.id).map((item) => [item.title, item]))
    expect(byTitle.get('Back')!.iterationId).toBe(one.id)
    expect(byTitle.get('Lost')!.iterationId).toBeNull()
  })

  it('leaves the Iteration column out of a project without iterations', () => {
    planning.createWorkItem(project.id, { title: 'Plain' }, { kind: 'human' })
    expect(buildTasksCsv(planning, project).text).not.toContain('Iteration')
  })
})
