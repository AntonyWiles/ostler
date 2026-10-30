import type { GitCommit, OstlerConfig, WatchedProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'

interface FileWatcherRuntime {
  startWatching(project: WatchedProject, ignorePatterns: string[], debounceMs: number): void
  stopWatching(projectId: string): void
}

interface GitReaderRuntime {
  startMonitoring(
    project: WatchedProject,
    pollIntervalMs: number,
    onCommits: (projectId: string, commits: GitCommit[]) => void
  ): Promise<void>
  stopMonitoring(projectId: string): void
}

interface HarnessRuntime {
  stopMonitoring(projectId: string): void
}

export interface ProjectRuntimeControllerDependencies {
  getConfig(): OstlerConfig
  fileWatcher: FileWatcherRuntime
  gitReader: GitReaderRuntime
  harnessService: HarnessRuntime
  startHarnessMonitoring(project: WatchedProject): void
  clearTrackedHarnessSessions(projectId: string): void
  handleNewGitCommits(project: WatchedProject, commits: GitCommit[]): void
  syncProjectGitHistory(project: WatchedProject): Promise<void>
  logError(message: string, error: unknown): void
}

/** Owns the enabled-project monitoring lifecycle and live configuration changes. */
export class ProjectRuntimeController {
  constructor(private readonly dependencies: ProjectRuntimeControllerDependencies) {}

  /**
   * Starts the folder services (watcher, Git polling, harness monitoring) for
   * an enabled project. A project with no folder has none to start (D4).
   */
  start(project: WatchedProject): void {
    if (!isMonitored(project)) return
    const config = this.dependencies.getConfig()
    this.startWatcher(project, config)
    this.startGit(project, config)
    if (config.harness.enabled) this.dependencies.startHarnessMonitoring(project)
  }

  stop(projectId: string): void {
    this.dependencies.fileWatcher.stopWatching(projectId)
    this.dependencies.gitReader.stopMonitoring(projectId)
    this.dependencies.harnessService.stopMonitoring(projectId)
    this.dependencies.clearTrackedHarnessSessions(projectId)
  }

  /** Applies changed monitoring settings immediately without requiring an app restart. */
  reconfigure(previous: OstlerConfig, current: OstlerConfig): void {
    const projects = current.projects

    if (JSON.stringify(previous.watcher) !== JSON.stringify(current.watcher)) {
      for (const project of projects) {
        this.dependencies.fileWatcher.stopWatching(project.id)
        if (isMonitored(project)) this.startWatcher(project, current)
      }
    }

    if (JSON.stringify(previous.git) !== JSON.stringify(current.git)) {
      for (const project of projects) {
        this.dependencies.gitReader.stopMonitoring(project.id)
        if (isMonitored(project)) this.startGit(project, current)
      }
    }

    if (JSON.stringify(previous.harness) !== JSON.stringify(current.harness)) {
      for (const project of projects) {
        this.dependencies.harnessService.stopMonitoring(project.id)
        this.dependencies.clearTrackedHarnessSessions(project.id)
        if (current.harness.enabled && isMonitored(project)) {
          this.dependencies.startHarnessMonitoring(project)
        }
      }
    }
  }

  private startWatcher(project: WatchedProject, config: OstlerConfig): void {
    this.dependencies.fileWatcher.startWatching(
      project,
      config.watcher.ignorePatterns,
      config.watcher.debounceMs
    )
  }

  private startGit(project: WatchedProject, config: OstlerConfig): void {
    if (!config.git.enabled) return
    void this.dependencies.gitReader
      .startMonitoring(project, config.git.pollIntervalMs, (_projectId, commits) =>
        this.dependencies.handleNewGitCommits(project, commits)
      )
      .then(() => this.dependencies.syncProjectGitHistory(project))
      .catch((error) =>
        this.dependencies.logError(`Git monitoring error for ${project.name}:`, error)
      )
  }
}

/** Enabled and with a folder: the projects whose folder services run. */
function isMonitored(project: WatchedProject): boolean {
  return project.enabled && projectFolder(project) !== null
}
