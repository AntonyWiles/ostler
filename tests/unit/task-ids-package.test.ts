import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { validateProjectPackage } from '../../src/shared/project-package'
import { allTaskCsvColumns, tasksToCsv } from '../../src/shared/export/task-csv'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** Task IDs (N9.8a) in and out: the project file keeps them, templates start afresh, CSV has them. */

const tempDir = useTempDir('ostler-task-ids-')
let store: ConfigStore
let planning: PlanningService
let service: ProjectPackageService

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(
    databasePath,
    () => store.getProjects().map((p) => p.id),
    undefined,
    (id) => store.getProjects().find((p) => p.id === id)?.taskPrefix ?? null
  )
  const scaffold = new ProjectScaffoldService(store, () => tempDir())
  service = new ProjectPackageService({
    planning,
    registerProject: (request, fixed) => scaffold.createProject(request, fixed),
    getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
    projectNames: () => store.getProjects().map((p) => p.name),
    dataDir: tempDir(),
    appVersion: 'test'
  })
})

afterEach(() => {
  planning.close()
})

/** A project "Shop" with prefix SHOP and tasks 1, 3 and 4 (2 deleted for good). */
function shop(): string {
  const id = store.registerProject({ name: 'Shop', folder: null }).id
  store.updateProject(id, { taskPrefix: 'SHOP' })
  const actor = planning.humanActor()
  planning.createWorkItem(id, { title: 'Fix the login' }, actor)
  const gone = planning.createWorkItem(id, { title: 'Gone' }, actor)
  planning.moveWorkItemToBin(gone.id, actor)
  planning.deleteWorkItem(gone.id, actor)
  planning.createWorkItem(id, { title: 'Write the copy' }, actor)
  const parent = planning.listWorkItems(id)[0]
  planning.createWorkItem(id, { title: 'Check the form', parentWorkItemId: parent.id }, actor)
  return id
}

describe('task IDs in the project file', () => {
  it('carries the prefix and each task number', () => {
    const pkg = service.exportProjectAsPackage(shop(), { kind: 'export', relativeDates: false })
    expect(pkg.project.taskPrefix).toBe('SHOP')
    expect(pkg.tasks.map((task) => [task.title, task.number])).toEqual([
      ['Fix the login', 1],
      ['Write the copy', 3],
      ['Check the form', 4]
    ])
    const checked = validateProjectPackage(JSON.parse(JSON.stringify(pkg)))
    expect(checked.ok && checked.value.tasks.map((task) => task.number)).toEqual([1, 3, 4])
  })

  it('keeps them when imported as a new project, and the counter continues after the highest', async () => {
    const source = shop()
    const pkg = service.exportProjectAsPackage(source, { kind: 'export', relativeDates: false })
    // On another computer: the prefix is free there.
    store.removeProject(source)
    const { project } = await service.createProjectFromPackage(pkg, { name: 'Shop again' })
    expect(project.taskPrefix).toBe('SHOP')
    const keys = planning.listWorkItems(project.id).map((item) => [item.title, item.key])
    expect(keys).toEqual([
      ['Fix the login', 'SHOP-1'],
      ['Write the copy', 'SHOP-3'],
      ['Check the form', 'SHOP-4']
    ])
    const next = planning.createWorkItem(project.id, { title: 'Next' }, planning.humanActor())
    expect(next.key).toBe('SHOP-5')
  })

  it('gives the new project a prefix of its own when the file’s is taken', async () => {
    const pkg = service.exportProjectAsPackage(shop(), { kind: 'export', relativeDates: false })
    const { project } = await service.createProjectFromPackage(pkg, { name: 'Shop again' })
    expect(project.taskPrefix).not.toBe('SHOP')
    expect(planning.listWorkItems(project.id).map((item) => item.number)).toEqual([1, 3, 4])
  })

  it('starts numbering afresh in a project template', async () => {
    const source = shop()
    const template = service.exportProjectAsPackage(source, {
      kind: 'template',
      relativeDates: true
    })
    expect(template.project.taskPrefix).toBeUndefined()
    expect(template.tasks.every((task) => task.number === undefined)).toBe(true)
    // Even a file that carries numbers starts afresh when used as a template.
    const exported = service.exportProjectAsPackage(source, {
      kind: 'export',
      relativeDates: false
    })
    const { project } = await service.createProjectFromPackage(exported, {
      name: 'From template',
      templateName: 'Shop'
    })
    expect(project.taskPrefix).toBe('FT')
    expect(planning.listWorkItems(project.id).map((item) => item.number)).toEqual([1, 2, 3])
  })
})

describe('task IDs in CSV', () => {
  it('adds a Task ID column first to Export all tasks; the id column stays its own', () => {
    const id = shop()
    const items = planning.listWorkItems(id)
    const text = tasksToCsv(items, ['id', ...allTaskCsvColumns([])], {
      personName: () => null,
      milestoneName: () => null,
      commentCount: () => 0,
      estimateUnit: 'points'
    })
    const [header, first] = text.slice(1).split('\r\n')
    expect(header.startsWith('ID,Task ID,Title,')).toBe(true)
    expect(first.startsWith(`${items[0].id},SHOP-1,Fix the login,`)).toBe(true)
  })
})
