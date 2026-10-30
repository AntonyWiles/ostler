import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ConfigStore } from '../../electron/config-store'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import type { NewProjectRequest } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const tempDir = useTempDir('ostler-create-project-')
let store: ConfigStore
let service: ProjectScaffoldService

const base: Omit<NewProjectRequest, 'folder'> = {
  name: 'Wedding',
  color: '#ec4899',
  tags: ['home', ' home ', ''],
  notes: '  Plan the day  '
}

beforeEach(() => {
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  service = new ProjectScaffoldService(store, () => tempDir())
})

describe('ProjectScaffoldService.createProject', () => {
  it('creates a project with no folder, touching nothing on disk', async () => {
    const before = fs.readdirSync(tempDir())
    const result = await service.createProject({ ...base, folder: null })
    expect(result.project.path).toBeNull()
    expect(result.project).toMatchObject({
      name: 'Wedding',
      color: '#ec4899',
      notes: 'Plan the day'
    })
    expect(result.project.tags).toEqual(['home'])
    expect(result.createdFiles).toEqual([])
    expect(fs.readdirSync(tempDir())).toEqual(before)
    expect(new ConfigStore(path.join(tempDir(), 'config.json')).getProjects()[0].path).toBeNull()
  })

  it('starts the project in the stage asked for, else Active', async () => {
    const planned = await service.createProject({ ...base, folder: null, stage: 'planning' })
    const plain = await service.createProject({ ...base, name: 'Later', folder: null })
    expect(planned.project.stage).toBe('planning')
    expect(plain.project.stage).toBe('active')
  })

  it('creates a project with an existing folder and writes nothing into it', async () => {
    const folder = path.join(tempDir(), 'site')
    fs.mkdirSync(folder)
    const result = await service.createProject({
      ...base,
      folder: { kind: 'existing', path: path.join(folder, '.') }
    })
    expect(result.project.path).toBe(path.resolve(folder))
    expect(fs.readdirSync(folder)).toEqual([])
  })

  it('creates a new folder with the files asked for', async () => {
    const result = await service.createProject({
      ...base,
      folder: {
        kind: 'new',
        parentPath: tempDir(),
        folderName: 'thesis',
        initGit: false,
        addReadme: true,
        gitignore: 'general',
        initialCommit: false
      }
    })
    const folder = path.join(tempDir(), 'thesis')
    expect(result.project.path).toBe(folder)
    expect(result.createdFiles).toEqual(['README.md', '.gitignore'])
    expect(fs.readFileSync(path.join(folder, 'README.md'), 'utf8')).toBe(
      '# Wedding\n\nPlan the day\n'
    )
  })

  it('writes a .NET .gitignore that keeps build output out of Git', async () => {
    await service.createProject({
      ...base,
      folder: {
        kind: 'new',
        parentPath: tempDir(),
        folderName: 'timer',
        initGit: false,
        addReadme: false,
        gitignore: 'dotnet',
        initialCommit: false
      }
    })
    const ignored = fs.readFileSync(path.join(tempDir(), 'timer', '.gitignore'), 'utf8').split('\n')
    expect(ignored).toEqual(expect.arrayContaining(['bin/', 'obj/', '.vs/']))
  })

  it('refuses a missing name, a missing folder and a file, registering nothing', async () => {
    const file = path.join(tempDir(), 'notes.txt')
    fs.writeFileSync(file, 'x')
    await expect(service.createProject({ ...base, name: ' ', folder: null })).rejects.toThrow(
      /name is required/
    )
    await expect(
      service.createProject({
        ...base,
        folder: { kind: 'existing', path: path.join(tempDir(), 'nope') }
      })
    ).rejects.toThrow(/does not exist/)
    await expect(
      service.createProject({ ...base, folder: { kind: 'existing', path: file } })
    ).rejects.toThrow(/not a directory/)
    await expect(
      service.createProject({ ...base, folder: { kind: 'existing', path: '' } })
    ).rejects.toThrow(/Choose a folder/)
    expect(store.getProjects()).toEqual([])
  })

  it('keeps the nesting rules for folders, and ignores projects without one', async () => {
    const parent = path.join(tempDir(), 'parent')
    const child = path.join(parent, 'child')
    fs.mkdirSync(child, { recursive: true })
    await service.createProject({ ...base, name: 'Folderless', folder: null })
    await service.createProject({
      ...base,
      name: 'Parent',
      folder: { kind: 'existing', path: parent }
    })

    await expect(
      service.createProject({ ...base, folder: { kind: 'existing', path: child } })
    ).rejects.toThrow(/is inside "Parent"/)
    await expect(
      service.createProject({ ...base, folder: { kind: 'existing', path: parent } })
    ).rejects.toThrow(/already a project: "Parent"/)
    await expect(
      service.createProject({
        ...base,
        folder: {
          kind: 'new',
          parentPath: parent,
          folderName: 'inner',
          initGit: false,
          addReadme: false,
          gitignore: 'none',
          initialCommit: false
        }
      })
    ).rejects.toThrow(/is inside "Parent"/)
    expect(fs.existsSync(path.join(parent, 'inner'))).toBe(false)
    expect(store.getProjects().map((project) => project.name)).toEqual(['Folderless', 'Parent'])
  })

  it('suggests a parent folder from the last project that has one', async () => {
    const folder = path.join(tempDir(), 'projects', 'site')
    fs.mkdirSync(folder, { recursive: true })
    await service.createProject({ ...base, folder: { kind: 'existing', path: folder } })
    await service.createProject({ ...base, name: 'Later', folder: null })
    expect((await service.getDefaults()).parentPath).toBe(path.join(tempDir(), 'projects'))
  })
})

describe('ConfigStore folder rules', () => {
  it('loads an empty legacy path as no folder', () => {
    const configPath = path.join(tempDir(), 'config.json')
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    raw.projects = [makeWatchedProject({ id: 'legacy', name: 'Legacy', path: '' })]
    fs.writeFileSync(configPath, JSON.stringify(raw))
    expect(new ConfigStore(configPath).getProjects()[0].path).toBeNull()
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).projects[0].path).toBeNull()
  })

  it("lets a project keep or re-link its own folder, never another project's", () => {
    const one = path.join(tempDir(), 'one')
    const two = path.join(tempDir(), 'two')
    fs.mkdirSync(one)
    fs.mkdirSync(two)
    const first = store.registerProject({ name: 'One', folder: one })
    const second = store.registerProject({ name: 'Two', folder: null })
    expect(store.validateProjectFolder(one, first.id)).toBe(path.resolve(one))
    expect(() => store.validateProjectFolder(one, second.id)).toThrow(/already a project/)
    expect(
      store.setProjectFolder(second.id, store.validateProjectFolder(two, second.id)).path
    ).toBe(path.resolve(two))
    expect(store.setProjectFolder(second.id, null).path).toBeNull()
  })
})
