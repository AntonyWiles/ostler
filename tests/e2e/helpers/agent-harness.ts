import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'node:child_process'
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import type { OstlerAPI } from '../../../src/shared/ostler-api'
import { copiedText } from '../copied-text'

/** Waits until no queued task's copy is getting ready: only then can it be reordered or started. */
export async function waitForCopies(window: Page, projectId: string): Promise<void> {
  await expect
    .poll(
      () =>
        window.evaluate(async (projectId) => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const state = await api.getHarnessState(projectId)
          return state.ok && state.value.taskQueue.every((task) => task.copy?.state !== 'preparing')
        }, projectId),
      { timeout: 30_000 }
    )
    .toBe(true)
}

/** A Git repository with one commit: each queued task's copy is a worktree of it. */
export function makeGitProject(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# Scratch\n')
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.invalid')
  git('config', 'user.name', 'E2E')
  git('add', 'README.md')
  git('commit', '-m', 'Initial commit')
  return dir
}

/**
 * Starts a queued task with an external agent, as the person does: once its
 * copy is ready, start it and copy its prompt. Every session has its own
 * token, which reaches the agent only through that prompt, so it is read from
 * Ostler's own clipboard here (off screen it never writes the Windows one).
 */
export async function startExternalSession(
  app: ElectronApplication,
  window: Page,
  projectId: string,
  taskId: string
): Promise<{ id: string; token: string }> {
  const id = await window.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (let tries = 0; ; tries++) {
        const state = await api.getHarnessState(projectId)
        if (!state.ok) throw new Error(state.error)
        const copy = state.value.taskQueue.find((task) => task.id === taskId)?.copy
        if (copy?.state === 'ready') break
        if (copy?.state === 'failed') throw new Error(copy.failure ?? 'The copy failed')
        if (tries > 300) throw new Error('The copy never became ready')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const session = await api.startHarnessTaskSession(projectId, taskId)
      if (!session.ok) throw new Error(session.error)
      const copied = await api.copyHarnessSessionPrompt(projectId, session.value.id)
      if (!copied.ok) throw new Error(copied.error)
      return session.value.id
    },
    { projectId, taskId }
  )
  const prompt = await copiedText(app)
  const token = /Bearer (\S+)/.exec(prompt)?.[1]
  if (!token) throw new Error('The copied prompt carries no token')
  return { id, token }
}
