import { watch, type FSWatcher } from 'chokidar'
import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import type { WatchEvent, WatcherStatus, FileChangeType, WatchedProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { classifyFile, getExtension } from './file-classifier'

/**
 * Chokidar 4 no longer supports glob paths itself. Match the configured relative
 * patterns here, including the directory represented by a trailing `/**`, so
 * excluded trees are never traversed or registered with fs.watch.
 */
function matchesGlob(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`, 'i').test(value)
}

export function matchesIgnorePattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalizedPattern) return false

  if (normalizedPattern.endsWith('/**')) {
    const directoryPattern = normalizedPattern.slice(0, -3)
    return (
      matchesGlob(relativePath, directoryPattern) ||
      matchesGlob(relativePath, `${directoryPattern}/**`)
    )
  }

  return (
    matchesGlob(relativePath, normalizedPattern) ||
    (!normalizedPattern.includes('/') &&
      matchesGlob(path.posix.basename(relativePath), normalizedPattern))
  )
}

/**
 * Watches project folders. Emits `watch-event` per file change, `watcher-error`
 * on a watcher failure, and `status-changed` (with the project id) whenever
 * what `getStatus()` reports changes for any reason other than a new event.
 */
export class FileWatcherService extends EventEmitter {
  private watchers: Map<string, FSWatcher>
  private eventCounts: Map<string, number>
  private lastEventTimestamps: Map<string, number>
  private errors: Map<string, string>
  private pausedProjects: Set<string>

  constructor() {
    super()
    this.watchers = new Map()
    this.eventCounts = new Map()
    this.lastEventTimestamps = new Map()
    this.errors = new Map()
    this.pausedProjects = new Set()
  }

  /**
   * Start watching a project for file changes.
   */
  public startWatching(
    project: WatchedProject,
    globalIgnorePatterns: string[],
    debounceMs: number
  ): void {
    if (this.watchers.has(project.id)) {
      this.stopWatching(project.id)
    }
    // A project with no folder has nothing to watch.
    const folder = projectFolder(project)
    if (folder === null) return

    const customIgnores = project.customIgnorePatterns || []
    const ignorePatterns = [
      ...globalIgnorePatterns,
      ...customIgnores,
      '.git/**',
      '**/.git/**',
      'node_modules/**',
      '**/node_modules/**'
    ]
    const ignored = (filePath: string) => {
      const relativePath = path.relative(folder, filePath).replace(/\\/g, '/')
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        if (relativePath.split('/').some((segment) => segment.startsWith('.'))) return true
        return ignorePatterns.some((pattern) => matchesIgnorePattern(relativePath, pattern))
      }
      return false
    }

    const watcher = watch(folder, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs,
        pollInterval: 100
      }
    })

    this.watchers.set(project.id, watcher)
    this.eventCounts.set(project.id, this.eventCounts.get(project.id) || 0)
    this.pausedProjects.delete(project.id)
    this.errors.delete(project.id)
    this.emit('status-changed', project.id)

    const handleEvent = (type: FileChangeType, filePath: string) => {
      if (this.pausedProjects.has(project.id)) {
        return
      }

      const relativePath = path.relative(folder, filePath).replace(/\\/g, '/')
      const extension = getExtension(relativePath)
      const category = classifyFile(relativePath)

      let sizeBytes: number | null = null
      if (type !== 'unlink' && type !== 'unlinkDir') {
        try {
          const stats = fs.statSync(filePath)
          sizeBytes = stats.size
        } catch {
          // Ignore stat errors for deleted/locked files
          sizeBytes = null
        }
      }

      const now = Date.now()
      const watchEvent: WatchEvent = {
        id: uuidv4(),
        projectId: project.id,
        timestamp: now,
        type,
        relativePath,
        extension,
        sizeBytes,
        category
      }

      const count = (this.eventCounts.get(project.id) || 0) + 1
      this.eventCounts.set(project.id, count)
      this.lastEventTimestamps.set(project.id, now)

      this.emit('watch-event', watchEvent)
    }

    watcher
      .on('add', (filePath: string) => handleEvent('add', filePath))
      .on('change', (filePath: string) => handleEvent('change', filePath))
      .on('unlink', (filePath: string) => handleEvent('unlink', filePath))
      .on('addDir', (filePath: string) => handleEvent('addDir', filePath))
      .on('unlinkDir', (filePath: string) => handleEvent('unlinkDir', filePath))
      .on('error', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Watcher error for project ${project.id}:`, message)
        this.errors.set(project.id, message)
        this.emit('watcher-error', { projectId: project.id, error: message })
        this.emit('status-changed', project.id)
      })
  }

  /**
   * Stop watching a specific project.
   */
  public stopWatching(projectId: string): void {
    const watcher = this.watchers.get(projectId)
    if (watcher) {
      watcher.close().catch((err: unknown) => console.error('Error closing watcher:', err))
      this.watchers.delete(projectId)
      this.pausedProjects.delete(projectId)
      this.emit('status-changed', projectId)
    }
  }

  /**
   * Stop watching all projects.
   */
  public stopAll(): void {
    for (const projectId of this.watchers.keys()) {
      this.stopWatching(projectId)
    }
  }

  /**
   * Pause watching a project without removing it from the configuration.
   */
  public pauseProject(projectId: string): void {
    if (this.watchers.has(projectId)) {
      this.pausedProjects.add(projectId)
      this.emit('status-changed', projectId)
    }
  }

  /**
   * Resume watching a paused project.
   */
  public resumeProject(
    projectId: string,
    project: WatchedProject,
    globalIgnorePatterns: string[],
    debounceMs: number
  ): void {
    if (this.pausedProjects.has(projectId)) {
      this.pausedProjects.delete(projectId)
      this.emit('status-changed', projectId)
    } else {
      this.startWatching(project, globalIgnorePatterns, debounceMs)
    }
  }

  /**
   * Get the current status of all watched projects.
   */
  public getStatus(): WatcherStatus {
    const projects: WatcherStatus['projects'] = []
    for (const [projectId] of this.watchers.entries()) {
      projects.push({
        projectId,
        watching: !this.pausedProjects.has(projectId),
        eventCount: this.eventCounts.get(projectId) || 0,
        lastEvent: this.lastEventTimestamps.get(projectId) || null,
        error: this.errors.get(projectId) || null
      })
    }

    return {
      running: this.watchers.size > 0 && this.watchers.size > this.pausedProjects.size,
      projects
    }
  }

  /**
   * Get the total event count for a specific project.
   */
  public getEventCount(projectId: string): number {
    return this.eventCounts.get(projectId) || 0
  }
}
