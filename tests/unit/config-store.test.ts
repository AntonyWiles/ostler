import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ConfigStore } from '../../electron/config-store'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import { isEncryptionAvailable } from '../../electron/safe-storage'

describe('config-store.ts', () => {
  let tempDir: string
  let configFilePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-test-config-'))
    configFilePath = path.join(tempDir, 'config.json')
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  it('creates default config file when path does not exist', () => {
    const store = new ConfigStore(configFilePath)
    const config = store.get()

    expect(fs.existsSync(configFilePath)).toBe(true)
    expect(config.watcher.debounceMs).toBe(DEFAULT_CONFIG.watcher.debounceMs)
    expect(config.projects).toEqual([])
  })

  it('updates configuration and persists to disk', () => {
    const store = new ConfigStore(configFilePath)
    store.update({
      ui: {
        theme: 'light',
        sidebarWidth: 300,
        refreshIntervalMs: 1000,
        timelineMaxEvents: 5000
      }
    })

    const updated = store.get()
    expect(updated.ui.theme).toBe('light')
    expect(updated.ui.sidebarWidth).toBe(300)

    // Verify reloaded from disk
    const reloadedStore = new ConfigStore(configFilePath)
    expect(reloadedStore.get().ui.theme).toBe('light')
  })

  it('merges nested updates without replacing unrelated AI settings', () => {
    const store = new ConfigStore(configFilePath)

    store.update({ ai: { baseUrl: 'https://example.test/v1' } })

    expect(store.get().ai.baseUrl).toBe('https://example.test/v1')
    expect(store.get().ai.model).toBe(DEFAULT_CONFIG.ai.model)
    expect(store.get().ai.apiKey).toBe(DEFAULT_CONFIG.ai.apiKey)
  })

  it('adds, retrieves, updates, and removes watched projects', () => {
    const store = new ConfigStore(configFilePath)
    const testProjectPath = path.join(tempDir, 'my-project')
    fs.mkdirSync(testProjectPath)

    // Add project
    const project = store.registerProject({ folder: testProjectPath, name: 'My Project' })
    expect(project.id).toBeDefined()
    expect(project.name).toBe('My Project')
    expect(project.path).toBe(testProjectPath)
    expect(store.getProjects().length).toBe(1)

    // Update project
    store.updateProject(project.id, { notes: 'Updated notes', enabled: false })
    const updatedProject = store.getProjects().find((p) => p.id === project.id)
    expect(updatedProject?.notes).toBe('Updated notes')
    expect(updatedProject?.enabled).toBe(false)

    // Remove project
    store.removeProject(project.id)
    expect(store.getProjects().length).toBe(0)
  })

  it('throws error when adding non-existent project path', () => {
    const store = new ConfigStore(configFilePath)
    const invalidPath = path.join(tempDir, 'does-not-exist')

    expect(() => store.registerProject({ folder: invalidPath, name: 'Invalid' })).toThrow(
      /Project path does not exist/
    )
  })

  it('normalizes a project path before storing it', () => {
    const store = new ConfigStore(configFilePath)
    const testProjectPath = path.join(tempDir, 'tidy-project')
    fs.mkdirSync(testProjectPath)

    const project = store.registerProject({
      folder: path.join(testProjectPath, 'src', '..', '.'),
      name: 'Tidy'
    })

    // Path validation elsewhere compares against this stored string, so it
    // has to be the resolved form rather than whatever shape came in.
    expect(project.path).toBe(path.resolve(testProjectPath))
  })

  it('rejects a file as a project path', () => {
    const store = new ConfigStore(configFilePath)
    const filePath = path.join(tempDir, 'a-file.txt')
    fs.writeFileSync(filePath, 'not a project')

    expect(() => store.registerProject({ folder: filePath, name: 'File' })).toThrow(
      /not a directory/
    )
  })

  it('rejects the same folder twice', () => {
    const store = new ConfigStore(configFilePath)
    const testProjectPath = path.join(tempDir, 'my-project')
    fs.mkdirSync(testProjectPath)
    store.registerProject({ folder: testProjectPath, name: 'My Project' })

    expect(() =>
      store.registerProject({ folder: testProjectPath, name: 'My Project Again' })
    ).toThrow(/already a project: "My Project"/)
    expect(store.getProjects()).toHaveLength(1)
  })

  it('rejects a folder nested inside an existing project', () => {
    const store = new ConfigStore(configFilePath)
    const parentPath = path.join(tempDir, 'parent')
    const childPath = path.join(parentPath, 'packages', 'child')
    fs.mkdirSync(childPath, { recursive: true })
    store.registerProject({ folder: parentPath, name: 'Parent' })

    expect(() => store.registerProject({ folder: childPath, name: 'Child' })).toThrow(
      /is inside "Parent"/
    )
    expect(store.getProjects()).toHaveLength(1)
  })

  it('rejects a folder that contains an existing project', () => {
    const store = new ConfigStore(configFilePath)
    const parentPath = path.join(tempDir, 'parent')
    const childPath = path.join(parentPath, 'packages', 'child')
    fs.mkdirSync(childPath, { recursive: true })
    store.registerProject({ folder: childPath, name: 'Child' })

    expect(() => store.registerProject({ folder: parentPath, name: 'Parent' })).toThrow(
      /contains "Child"/
    )
    expect(store.getProjects()).toHaveLength(1)
  })

  it('allows sibling folders that merely share a name prefix', () => {
    const store = new ConfigStore(configFilePath)
    const first = path.join(tempDir, 'app')
    const second = path.join(tempDir, 'app-tools')
    fs.mkdirSync(first)
    fs.mkdirSync(second)

    store.registerProject({ folder: first, name: 'App' })
    store.registerProject({ folder: second, name: 'App Tools' })

    expect(store.getProjects()).toHaveLength(2)
  })

  it('throws error when updating non-existent project id', () => {
    const store = new ConfigStore(configFilePath)
    expect(() => store.updateProject('unknown-id', { notes: 'test' })).toThrow(
      /Project with ID unknown-id not found/
    )
  })

  it('keeps the API key and GitHub token across a restart when secure storage is unavailable', () => {
    if (isEncryptionAvailable()) return
    const store = new ConfigStore(configFilePath)
    store.update({ ai: { ...store.get().ai, apiKey: 'sk-test-secret-key-12345' } })
    store.update({ github: { token: 'ghp_test' } })

    const reloaded = new ConfigStore(configFilePath).get()
    expect(reloaded.ai.apiKey).toBe('sk-test-secret-key-12345')
    expect(reloaded.github.token).toBe('ghp_test')
  })

  it('registers a project in the stage given, Active without one, and refuses any other', () => {
    const store = new ConfigStore(configFilePath)
    expect(store.registerProject({ folder: null, name: 'Plan', stage: 'planning' }).stage).toBe(
      'planning'
    )
    expect(store.registerProject({ folder: null, name: 'Work' }).stage).toBe('active')
    expect(() =>
      store.registerProject({ folder: null, name: 'Odd', stage: 'someday' as never })
    ).toThrow()
    expect(store.getProjects().map((project) => project.name)).toEqual(['Plan', 'Work'])
  })

  it('keeps project tokens working across a restart when secure storage is unavailable', () => {
    if (isEncryptionAvailable()) return
    const store = new ConfigStore(configFilePath)
    const project = store.registerProject({ folder: null, name: 'Project' })
    const { automationToken } = store.generateAutomationToken(project.id)
    expect(automationToken).toBeTruthy()

    const reloaded = new ConfigStore(configFilePath).getProjects()[0]
    expect(reloaded.automationToken).toBe(automationToken)
  })

  it('drops a stored project token it cannot decrypt, as it does an API key', () => {
    if (isEncryptionAvailable()) return
    fs.writeFileSync(
      configFilePath,
      JSON.stringify({
        projects: [
          {
            id: 'p1',
            name: 'Project',
            path: null,
            automationToken: 'ostler-secure:v1:BBBB'
          }
        ]
      })
    )
    const project = new ConfigStore(configFilePath).getProjects()[0]
    expect(project.automationToken).toBeUndefined()
  })

  it('tells its listener about every change to the project list or a project', () => {
    const store = new ConfigStore(configFilePath)
    const changed: string[] = []
    store.setProjectsChangedListener((projectId) => changed.push(projectId))
    fs.mkdirSync(path.join(tempDir, 'project'))
    const project = store.registerProject({
      folder: path.join(tempDir, 'project'),
      name: 'Project'
    })
    store.updateProject(project.id, { enabled: false })
    store.updateProjectAutoDispatchConfig(project.id, { enabled: true })
    store.generateAutomationToken(project.id)
    store.revokeAutomationToken(project.id)
    store.update({ ui: { ...store.get().ui, theme: 'light' } })
    store.removeProject(project.id)
    store.removeProject('not-a-project')
    expect(changed).toEqual(Array(6).fill(project.id))
  })

  it('reorders projects, keeping the places of projects left out', () => {
    const store = new ConfigStore(configFilePath)
    for (const name of ['a', 'b', 'c', 'd']) store.registerProject({ folder: null, name })
    const [a, b, c, d] = store.getProjects().map((project) => project.id)
    const changed: string[] = []
    store.setProjectsChangedListener((projectId) => changed.push(projectId))

    store.reorderProjects([c, a, b, d])
    expect(store.getProjects().map((project) => project.id)).toEqual([c, a, b, d])
    // A subset (the sidebar lists enabled projects only) reorders among the
    // places those projects hold; b stays where it is.
    store.reorderProjects([d, c])
    expect(store.getProjects().map((project) => project.id)).toEqual([d, a, b, c])
    expect(changed).toHaveLength(2)
    // Saved: a fresh store reads the same order.
    expect(new ConfigStore(configFilePath).getProjects().map((project) => project.id)).toEqual([
      d,
      a,
      b,
      c
    ])
    // The same order again saves nothing.
    store.reorderProjects([d, a, b, c])
    expect(changed).toHaveLength(2)
  })

  it('refuses an order with unknown or repeated projects', () => {
    const store = new ConfigStore(configFilePath)
    const a = store.registerProject({ folder: null, name: 'a' }).id
    expect(() => store.reorderProjects([a, 'nope'])).toThrow(/not found/)
    expect(() => store.reorderProjects([a, a])).toThrow(/twice/)
    expect(() => store.reorderProjects('a' as unknown as string[])).toThrow(/list/)
  })

  it('tells its config listener about settings changes only', () => {
    const store = new ConfigStore(configFilePath)
    let calls = 0
    store.setConfigChangedListener(() => (calls += 1))
    store.registerProject({ folder: null, name: 'Project' })
    expect(calls).toBe(0)
    store.update({ harness: { ...store.get().harness, enabled: false } })
    expect(calls).toBe(1)
  })
})
