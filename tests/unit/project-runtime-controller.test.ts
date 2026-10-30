import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig, type WatchedProject } from '../../src/shared/ostler-api'
import { ProjectRuntimeController } from '../../electron/services/project-runtime-controller'
import { makeWatchedProject } from '../helpers/projects'

const project: WatchedProject = makeWatchedProject({
  id: 'project-one',
  name: 'Project one',
  path: 'C:\\projects\\one',
  color: '#fff',
  addedAt: Date.now()
})

function config(overrides: Partial<OstlerConfig> = {}): OstlerConfig {
  return {
    projects: [project],
    watcher: { ...DEFAULT_CONFIG.watcher, ignorePatterns: ['node_modules'], debounceMs: 100 },
    git: { enabled: true, pollIntervalMs: 1_000, maxCommitsToFetch: 50 },
    harness: { enabled: true },
    ...overrides
  } as OstlerConfig
}

describe('ProjectRuntimeController', () => {
  it('starts and stops every enabled project runtime through one path', async () => {
    const current = config()
    const fileWatcher = { startWatching: vi.fn(), stopWatching: vi.fn() }
    const gitReader = {
      startMonitoring: vi.fn().mockResolvedValue(undefined),
      stopMonitoring: vi.fn()
    }
    const harnessService = { stopMonitoring: vi.fn() }
    const startHarnessMonitoring = vi.fn()
    const clearTrackedHarnessSessions = vi.fn()
    const syncProjectGitHistory = vi.fn().mockResolvedValue(undefined)
    const controller = new ProjectRuntimeController({
      getConfig: () => current,
      fileWatcher,
      gitReader,
      harnessService,
      startHarnessMonitoring,
      clearTrackedHarnessSessions,
      handleNewGitCommits: vi.fn(),
      syncProjectGitHistory,
      logError: vi.fn()
    })

    controller.start(project)
    await vi.waitFor(() => expect(syncProjectGitHistory).toHaveBeenCalledWith(project))
    expect(fileWatcher.startWatching).toHaveBeenCalledWith(project, ['node_modules'], 100)
    expect(gitReader.startMonitoring).toHaveBeenCalledOnce()
    expect(startHarnessMonitoring).toHaveBeenCalledWith(project)

    controller.stop(project.id)
    expect(fileWatcher.stopWatching).toHaveBeenCalledWith(project.id)
    expect(gitReader.stopMonitoring).toHaveBeenCalledWith(project.id)
    expect(harnessService.stopMonitoring).toHaveBeenCalledWith(project.id)
    expect(clearTrackedHarnessSessions).toHaveBeenCalledWith(project.id)
  })

  it('applies watcher and Git setting changes to running projects immediately', () => {
    const previous = config()
    const current = config({
      watcher: { ...previous.watcher, ignorePatterns: ['dist'], debounceMs: 250 },
      git: { ...previous.git, pollIntervalMs: 5_000 }
    })
    const fileWatcher = { startWatching: vi.fn(), stopWatching: vi.fn() }
    const gitReader = {
      startMonitoring: vi.fn().mockResolvedValue(undefined),
      stopMonitoring: vi.fn()
    }
    const controller = new ProjectRuntimeController({
      getConfig: () => current,
      fileWatcher,
      gitReader,
      harnessService: { stopMonitoring: vi.fn() },
      startHarnessMonitoring: vi.fn(),
      clearTrackedHarnessSessions: vi.fn(),
      handleNewGitCommits: vi.fn(),
      syncProjectGitHistory: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn()
    })

    controller.reconfigure(previous, current)
    expect(fileWatcher.stopWatching).toHaveBeenCalledWith(project.id)
    expect(fileWatcher.startWatching).toHaveBeenCalledWith(project, ['dist'], 250)
    expect(gitReader.stopMonitoring).toHaveBeenCalledWith(project.id)
    expect(gitReader.startMonitoring).toHaveBeenCalledWith(project, 5_000, expect.any(Function))
  })

  it('starts no folder services for a project without a folder, now or on reconfigure', () => {
    const folderless: WatchedProject = { ...project, id: 'folderless', path: null }
    const previous = config({ projects: [folderless] })
    const current = config({
      projects: [folderless],
      watcher: { ...previous.watcher, debounceMs: 250 },
      git: { ...previous.git, pollIntervalMs: 5_000 },
      harness: { ...previous.harness, pollIntervalMs: 9_000 }
    })
    const fileWatcher = { startWatching: vi.fn(), stopWatching: vi.fn() }
    const gitReader = {
      startMonitoring: vi.fn().mockResolvedValue(undefined),
      stopMonitoring: vi.fn()
    }
    const startHarnessMonitoring = vi.fn()
    const controller = new ProjectRuntimeController({
      getConfig: () => current,
      fileWatcher,
      gitReader,
      harnessService: { stopMonitoring: vi.fn() },
      startHarnessMonitoring,
      clearTrackedHarnessSessions: vi.fn(),
      handleNewGitCommits: vi.fn(),
      syncProjectGitHistory: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn()
    })

    controller.start(folderless)
    controller.reconfigure(previous, current)
    expect(fileWatcher.startWatching).not.toHaveBeenCalled()
    expect(gitReader.startMonitoring).not.toHaveBeenCalled()
    expect(startHarnessMonitoring).not.toHaveBeenCalled()
  })
})
