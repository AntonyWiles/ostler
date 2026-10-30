import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { ImportService } from '../../electron/services/import-service'
import { BRAND } from '../../src/shared/brand'
import { itemLinkTarget, itemLinkUrl } from '../../src/shared/item-links'
import {
  templateWhiteboard,
  validateProjectPackage,
  type PackageWhiteboard
} from '../../src/shared/project-package'
import type { WhiteboardObject, WhiteboardObjectInput } from '../../src/shared/whiteboard/model'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** Whiteboards in project files and templates (whiteboards plan, prompt 18a, D21). */

// Images decode in Electron only; here they are kept as files, without a thumbnail.
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

// --- The format ---------------------------------------------------------------

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'note',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  z: 1,
  text: id,
  ...extra
})
const image = (id: string) => ({ id, kind: 'image', x: 300, y: 0, width: 100, height: 100, z: 2 })
const connector = (id: string, from: string, to: string) => ({
  id,
  kind: 'connector',
  x: 0,
  y: 0,
  width: 300,
  height: 10,
  z: 3,
  data: { from: { objectId: from, x: 0, y: 0 }, to: { objectId: to, x: 300, y: 0 } }
})

function base(library: unknown[]): Record<string, unknown> {
  return {
    format: 'ostler-project-package',
    version: 1,
    project: { name: 'Party' },
    tasks: [{ ref: 't1', title: 'Book the hall' }],
    library
  }
}

const board = (whiteboard: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'whiteboard',
  title: 'Plan',
  whiteboard,
  ...extra
})
const picture = { kind: 'image', title: 'Logo', file: 'library/Logo.png' }

function refusal(json: unknown): string {
  const result = validateProjectPackage(json)
  if (result.ok) throw new Error('Expected the package to be refused')
  return result.error
}

describe('whiteboards in the project file format', () => {
  it('accepts a file with a whiteboard, its pictures named by their place in the library', () => {
    const result = validateProjectPackage(
      base([
        picture,
        board(
          {
            objects: [note('a'), { ...image('b'), data: { imageItemId: 'stale-id' } }],
            pictures: [{ objectId: 'b', libraryIndex: 0 }]
          },
          { body: 'ignored' }
        ),
        { kind: 'note', title: 'Ideas', body: 'Fancy dress?' }
      ])
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [logo, plan, ideas] = result.value.library
    expect(logo.whiteboard).toBeUndefined()
    expect(ideas.whiteboard).toBeUndefined()
    expect(plan).toMatchObject({ kind: 'whiteboard', body: '', file: null })
    expect(plan.whiteboard!.objects.map((object) => object.id)).toEqual(['a', 'b'])
    // A file names its pictures only through `pictures`.
    expect(plan.whiteboard!.objects[1]).toMatchObject({ data: { imageItemId: null } })
    expect(plan.whiteboard!.pictures).toEqual([{ objectId: 'b', libraryIndex: 0 }])
  })

  it('refuses a whiteboard field on a note, and a whiteboard without one', () => {
    expect(refusal(base([{ kind: 'note', title: 'Ideas', whiteboard: { objects: [] } }]))).toBe(
      'library[0].whiteboard is only for whiteboards'
    )
    expect(refusal(base([{ kind: 'whiteboard', title: 'Plan' }]))).toBe(
      'library[0].whiteboard is missing: a whiteboard needs one'
    )
  })

  it('refuses a bad object and an id given twice', () => {
    expect(
      refusal(base([board({ objects: [note('a'), { ...note('b'), kind: 'blob' }] })]))
    ).toMatch(
      /^library\[0\]\.whiteboard\.objects\[1\] is not a whiteboard object: Whiteboard object b: kind must be one of/
    )
    expect(refusal(base([board({ objects: [note('a'), note('a')] })]))).toBe(
      'library[0].whiteboard.objects has the id a more than once'
    )
  })

  it('refuses a picture on an object that is not an image, or from an entry that is not one', () => {
    expect(
      refusal(
        base([
          picture,
          board({ objects: [note('a')], pictures: [{ objectId: 'a', libraryIndex: 0 }] })
        ])
      )
    ).toBe("library[1].whiteboard.pictures[0].objectId 'a' is not a picture on this whiteboard")
    expect(
      refusal(
        base([
          { kind: 'note', title: 'Ideas' },
          board({ objects: [image('b')], pictures: [{ objectId: 'b', libraryIndex: 0 }] })
        ])
      )
    ).toBe(
      "library[1].whiteboard.pictures[0].libraryIndex 0 is not an image in this file's library"
    )
    expect(
      refusal(
        base([board({ objects: [image('b')], pictures: [{ objectId: 'b', libraryIndex: 7 }] })])
      )
    ).toBe(
      "library[0].whiteboard.pictures[0].libraryIndex 7 is not an image in this file's library"
    )
    expect(
      refusal(
        base([
          picture,
          board({ objects: [image('b')], pictures: [{ objectId: 'b', libraryIndex: -1 }] })
        ])
      )
    ).toBe('library[1].whiteboard.pictures[0].libraryIndex -1 must be a whole number, 0 or more')
  })

  it('makes a template copy: the picture goes and the connector stuck to it comes loose', () => {
    const result = validateProjectPackage(
      base([
        picture,
        board({
          objects: [note('a'), image('b'), connector('c', 'a', 'b')],
          pictures: [{ objectId: 'b', libraryIndex: 0 }]
        })
      ])
    )
    if (!result.ok) throw new Error(result.error)
    const copy = templateWhiteboard(result.value.library[1].whiteboard!)
    expect(copy.pictures).toEqual([])
    expect(copy.objects.map((object) => object.id)).toEqual(['a', 'c'])
    expect(copy.objects[1]).toMatchObject({
      data: { from: { objectId: 'a' }, to: { objectId: null, x: 300, y: 0 } }
    })
  })
})

// --- Export and import ----------------------------------------------------------

const tempDir = useTempDir('ostler-whiteboard-package-')
let store: ConfigStore
let planning: PlanningService
let library: LibraryService
let packages: ProjectPackageService
let imports: ImportService

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  library = new LibraryService(databasePath, tempDir())
  const scaffold = new ProjectScaffoldService(store, () => tempDir())
  packages = new ProjectPackageService({
    planning,
    registerProject: (request, fixed) => scaffold.createProject(request, fixed),
    getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
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
    setWhiteboardPictures: (projectId, whiteboardId, pictures) => {
      library.whiteboards.setPictures(projectId, whiteboardId, pictures)
    },
    locale: () => 'en-GB',
    unpackDir: path.join(tempDir(), 'unpack')
  })
})

afterEach(() => {
  planning.close()
  library.close()
})

const link = (kind: 'task' | 'library', projectId: string, id: string) =>
  itemLinkUrl({ kind, projectId, id }, BRAND.urlScheme)

/**
 * A project "Party" with a task and a whiteboard: a note linked to the task, a connector between
 * two notes, and a mind map of a central idea with one branch.
 */
function party(): { projectId: string; taskId: string; boardId: string } {
  const projectId = store.registerProject({ name: 'Party', folder: null }).id
  const task = planning.createWorkItem(projectId, { title: 'Book the hall' }, planning.humanActor())
  const objects = [
    note('n1', { link: link('task', projectId, task.id) }),
    note('n2', { x: 400 }),
    connector('c1', 'n1', 'n2'),
    { id: 'm1', kind: 'mindmap', x: 0, y: 400, width: 160, height: 60, z: 4, text: 'Party' },
    {
      id: 'm2',
      kind: 'mindmap',
      x: 200,
      y: 400,
      width: 160,
      height: 60,
      z: 5,
      text: 'Food',
      data: { parentId: 'm1', order: 0 }
    }
  ] as unknown as WhiteboardObjectInput[]
  const { item } = library.whiteboards.create(projectId, { title: 'Plan', objects })
  return { projectId, taskId: task.id, boardId: item.id }
}

function boardOf(projectId: string): { id: string; objects: WhiteboardObject[] } {
  const item = library.listItems(projectId).find((entry) => entry.kind === 'whiteboard')!
  return { id: item.id, objects: library.whiteboards.listObjects(projectId, item.id) }
}

const byText = (objects: WhiteboardObject[], text: string) =>
  objects.find((object) => object.text === text)!

describe('whiteboards in exported projects', () => {
  it('imports as a new whiteboard with new ids, its connector stuck, its map and links remapped', async () => {
    const { projectId, taskId } = party()
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    const entry = pkg.library.find((item) => item.kind === 'whiteboard')!
    expect(entry).toMatchObject({ title: 'Plan', body: '', file: null })
    expect(pkg.linkIds).toBeDefined()

    const { project } = await packages.createProjectFromPackage(JSON.parse(JSON.stringify(pkg)), {
      name: 'Party again'
    })
    const { objects } = boardOf(project.id)
    const old = boardOf(projectId).objects
    expect(objects).toHaveLength(5)
    const oldIds = new Set(old.map((object) => object.id))
    expect(objects.every((object) => !oldIds.has(object.id))).toBe(true)

    const n1 = byText(objects, 'n1')
    const n2 = byText(objects, 'n2')
    const c1 = objects.find((object) => object.kind === 'connector')!
    expect(c1).toMatchObject({ data: { from: { objectId: n1.id }, to: { objectId: n2.id } } })
    expect(byText(objects, 'Food')).toMatchObject({
      data: { parentId: byText(objects, 'Party').id }
    })

    const newTask = planning.listWorkItems(project.id)[0]
    expect(newTask.id).not.toBe(taskId)
    expect(itemLinkTarget(n1.link!, BRAND.urlScheme)).toEqual({
      kind: 'task',
      projectId: project.id,
      id: newTask.id
    })
  })

  it('imports the same file twice without an id clash', async () => {
    const { projectId } = party()
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    const first = await packages.createProjectFromPackage(pkg, { name: 'One' })
    const second = await packages.createProjectFromPackage(pkg, { name: 'Two' })
    const a = boardOf(first.project.id).objects.map((object) => object.id)
    const b = boardOf(second.project.id).objects.map((object) => object.id)
    expect(a).toHaveLength(5)
    expect(b).toHaveLength(5)
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })

  it('points a text link to the whiteboard at the imported one', async () => {
    const { projectId, boardId } = party()
    library.createItem(projectId, {
      kind: 'note',
      title: 'See',
      body: `[the plan](${link('library', projectId, boardId)})`
    })
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    const { project } = await packages.createProjectFromPackage(pkg, { name: 'Copy' })
    const see = library.listItems(project.id).find((item) => item.title === 'See')!
    expect(library.getItem(project.id, see.id).body).toBe(
      `[the plan](${link('library', project.id, boardOf(project.id).id)})`
    )
  })

  it('puts the whiteboard in a template, without its pictures', async () => {
    const { projectId, boardId } = party()
    const [logo] = await library.importPaths(projectId, [path.join(writePng(), 'Logo.png')])
    library.whiteboards.save(projectId, boardId, {
      upserts: [{ ...image('p1'), data: { imageItemId: logo.item.id } }],
      deletes: []
    })
    const pkg = packages.exportProjectAsPackage(projectId, {
      kind: 'template',
      relativeDates: true
    })
    expect(pkg.library.map((item) => item.kind)).toEqual(['whiteboard'])
    const whiteboard = pkg.library[0].whiteboard as PackageWhiteboard
    expect(whiteboard.pictures).toEqual([])
    expect(whiteboard.objects.some((object) => object.kind === 'image')).toBe(false)

    // A template file brought in keeps its whiteboard, and still no pictures.
    const full = packages.exportProjectAsPackage(projectId, {
      kind: 'export',
      relativeDates: false
    })
    const saved = packages.importTemplate(JSON.parse(JSON.stringify({ ...full, template: null })))
    const project = await packages.createProjectFromTemplate(saved.id, { name: 'From template' })
    const objects = boardOf(project.project.id).objects
    expect(objects).toHaveLength(5)
    expect(objects.some((object) => object.kind === 'image')).toBe(false)
  })

  it('carries a picture in a full export and shows the new image after import', async () => {
    const { projectId, boardId } = party()
    const [logo] = await library.importPaths(projectId, [path.join(writePng(), 'Logo.png')])
    library.whiteboards.save(projectId, boardId, {
      upserts: [
        { ...image('p1'), data: { imageItemId: logo.item.id } },
        { ...image('p2'), data: { imageItemId: null } }
      ] as unknown as WhiteboardObjectInput[],
      deletes: []
    })
    const pkg = packages.exportProjectAsPackage(projectId, { kind: 'export', relativeDates: false })
    const logoIndex = pkg.library.findIndex((item) => item.kind === 'image')
    const whiteboard = pkg.library.find((item) => item.kind === 'whiteboard')!.whiteboard!
    expect(whiteboard.pictures).toEqual([{ objectId: 'p1', libraryIndex: logoIndex }])
    expect(
      whiteboard.objects.filter((object) => object.kind === 'image').map((object) => object.data)
    ).toEqual([{ imageItemId: null }, { imageItemId: null }])

    const target = path.join(tempDir(), 'out.ostler-project')
    packages.exportProjectFile(projectId, target)
    const file = imports.readFile(target)
    const result = await imports.runImport(file.fileId, { kind: 'package' }, { kind: 'new' })
    expect(result.warnings).toEqual([])

    const newLogo = library.listItems(result.projectId).find((item) => item.kind === 'image')!
    expect(newLogo.id).not.toBe(logo.item.id)
    const images = boardOf(result.projectId).objects.filter((object) => object.kind === 'image')
    expect(
      images
        .map((object) => object.data)
        .sort((a, b) => (a.imageItemId ? -1 : b.imageItemId ? 1 : 0))
    ).toEqual([{ imageItemId: newLogo.id }, { imageItemId: null }])
  })
})

/** A folder holding `Logo.png`. */
function writePng(): string {
  const folder = fs.mkdtempSync(path.join(tempDir(), 'files-'))
  fs.writeFileSync(path.join(folder, 'Logo.png'), PNG)
  return folder
}
