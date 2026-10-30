import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import type { HarnessService } from '../../electron/services/harness-service'
import type { HarnessSession, WatchedProject } from '../../src/shared/ostler-api'

/**
 * Makes `folder` a Git repository with one entry, as agent copies need
 * (simplify pass §2). Existing files are kept and become that first entry.
 */
export async function initProjectRepository(folder: string): Promise<void> {
  fs.mkdirSync(folder, { recursive: true })
  if (fs.readdirSync(folder).length === 0) fs.writeFileSync(path.join(folder, 'README.md'), 'x\n')
  const git = simpleGit(folder)
  await git.init()
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'Test')
  await git.addConfig('core.autocrlf', 'false')
  await git.raw(['checkout', '-B', 'main'])
  await git.add('.')
  await git.commit('initial commit')
}

/** Queues a task and starts an agent on it, the only way a session starts. */
export async function startTaskSession(
  service: HarnessService,
  project: WatchedProject,
  title: string,
  details = '',
  provenance: 'external' | 'embedded' = 'external'
): Promise<HarnessSession> {
  const task = service.addTask(project, title, details)
  return provenance === 'embedded'
    ? service.startEmbeddedSessionForTask(project, task.id)
    : service.startSessionForTask(project, task.id)
}
