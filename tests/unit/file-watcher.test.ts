import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { FileWatcherService } from '../../electron/services/file-watcher'
import type { FSWatcher } from 'chokidar'
import type { WatchedProject, WatchEvent } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForWatchEvent(service: FileWatcherService): Promise<WatchEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      service.removeListener('watch-event', onEvent)
      reject(new Error('Timed out waiting for a watcher event'))
    }, 3_000)

    const onEvent = (event: WatchEvent) => {
      clearTimeout(timeout)
      service.removeListener('watch-event', onEvent)
      resolve(event)
    }

    service.on('watch-event', onEvent)
  })
}

describe('file-watcher.ts', () => {
  const tempDir = useTempDir('ostler-file-watcher-')
  let project: WatchedProject
  let service: FileWatcherService

  beforeEach(() => {
    fs.mkdirSync(path.join(tempDir(), 'src'), { recursive: true })
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: tempDir(),
      color: '#fff',
      addedAt: Date.now()
    })
    service = new FileWatcherService()
  })

  afterEach(async () => {
    service.stopAll()
    await delay(100)
  })

  it('emits classified events and exposes watcher state', async () => {
    service.startWatching(project, [], 10)
    await delay(250)

    const eventPromise = waitForWatchEvent(service)
    const filePath = path.join(tempDir(), 'src', 'feature.ts')
    fs.writeFileSync(filePath, 'export const feature = true\n')
    const event = await eventPromise

    expect(event.projectId).toBe(project.id)
    expect(event.type).toBe('add')
    expect(event.relativePath).toBe('src/feature.ts')
    expect(event.extension).toBe('.ts')
    expect(event.category).toBe('source')
    expect(event.sizeBytes).toBeGreaterThan(0)
    expect(service.getEventCount(project.id)).toBe(1)
    expect(service.getStatus()).toEqual({
      running: true,
      projects: [
        {
          projectId: project.id,
          watching: true,
          eventCount: 1,
          lastEvent: event.timestamp,
          error: null
        }
      ]
    })
  })

  it('does not recurse into ignored directories', async () => {
    fs.mkdirSync(path.join(tempDir(), 'node_modules', 'dependency'), { recursive: true })
    fs.mkdirSync(path.join(tempDir(), 'out', 'generated'), { recursive: true })

    service.startWatching(project, ['node_modules/**', 'out/**'], 10)
    await delay(250)

    const watcher = (service as unknown as { watchers: Map<string, FSWatcher> }).watchers.get(
      project.id
    )
    const watchedDirectories = Object.keys(watcher!.getWatched()).map((directory) =>
      directory.replace(/\\/g, '/')
    )

    expect(watchedDirectories).not.toContain(`${tempDir().replace(/\\/g, '/')}/node_modules`)
    expect(watchedDirectories).not.toContain(`${tempDir().replace(/\\/g, '/')}/out`)

    fs.writeFileSync(
      path.join(tempDir(), 'node_modules', 'dependency', 'index.js'),
      'module.exports = {}\n'
    )
    fs.writeFileSync(path.join(tempDir(), 'out', 'generated', 'bundle.js'), 'console.log(1)\n')
    await delay(150)
    expect(service.getEventCount(project.id)).toBe(0)

    const eventPromise = waitForWatchEvent(service)
    fs.writeFileSync(path.join(tempDir(), 'src', 'feature.ts'), 'export const feature = true\n')
    await expect(eventPromise).resolves.toMatchObject({ relativePath: 'src/feature.ts' })
  })

  it('pauses and resumes a project without losing its watcher state', async () => {
    service.startWatching(project, [], 10)
    await delay(250)

    const firstEventPromise = waitForWatchEvent(service)
    fs.writeFileSync(path.join(tempDir(), 'first.ts'), 'first\n')
    await firstEventPromise

    service.pauseProject(project.id)
    expect(service.getStatus().projects[0]).toMatchObject({
      projectId: project.id,
      watching: false,
      eventCount: 1
    })

    fs.writeFileSync(path.join(tempDir(), 'paused.ts'), 'paused\n')
    await delay(250)
    expect(service.getEventCount(project.id)).toBe(1)

    service.resumeProject(project.id, project, [], 10)
    const resumedEventPromise = waitForWatchEvent(service)
    fs.writeFileSync(path.join(tempDir(), 'resumed.ts'), 'resumed\n')
    const resumedEvent = await resumedEventPromise

    expect(resumedEvent.relativePath).toBe('resumed.ts')
    expect(service.getStatus().projects[0]).toMatchObject({
      projectId: project.id,
      watching: true,
      eventCount: 2
    })

    service.stopWatching(project.id)
    expect(service.getStatus()).toEqual({ running: false, projects: [] })
  })

  it('reports each status change, but not each file event, as status-changed', async () => {
    const changes: string[] = []
    service.on('status-changed', (projectId: string) => changes.push(projectId))
    service.startWatching(project, [], 10)
    await delay(250)
    const eventPromise = waitForWatchEvent(service)
    fs.writeFileSync(path.join(tempDir(), 'file.ts'), 'file\n')
    await eventPromise
    expect(changes).toEqual([project.id])

    service.pauseProject(project.id)
    service.resumeProject(project.id, project, [], 10)
    service.stopWatching(project.id)
    expect(changes).toEqual(Array(4).fill(project.id))
  })
})
