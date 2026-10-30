import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { execFileSync } from 'node:child_process'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'
import { copiedText } from './copied-text'
import { audit, describeFindings } from './a11y-app'

/**
 * Reviewer notes in Review changes (N9.5b): with Review agent work before me
 * on, a finished run starts a review, the reviewer reports a finding, and the
 * person sends it back as their own from Review changes. Both agents here are
 * connected ones over the harness API; a built-in run needs a model, and
 * takes the same harness path.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version
const PROJECT_ID = 'e2e-review-project'

let app: ElectronApplication
let window: Page
let dataDir: string
let projectDir: string

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Failed to reserve an E2E port'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

function makeGitProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-review-project-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# Scratch\n')
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.invalid')
  git('config', 'user.name', 'E2E')
  git('add', 'README.md')
  git('commit', '-m', 'Initial commit')
  return dir
}

test.afterEach(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(projectDir, { recursive: true, force: true })
})

/** Starts a connected agent on a queued task once its copy is ready; its id, copy and token. */
async function startAgent(taskId: string) {
  const started = await window.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (let tries = 0; ; tries++) {
        const state = await api.getHarnessState(projectId)
        if (!state.ok) throw new Error(state.error)
        const task = state.value.taskQueue.find((entry) => entry.id === taskId)
        if (task?.copy?.state === 'ready') break
        if (task?.copy?.state === 'failed') throw new Error(task.copy.failure ?? 'The copy failed')
        if (tries > 300) throw new Error('The copy never became ready')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const session = await api.startHarnessTaskSession(projectId, taskId)
      if (!session.ok) throw new Error(session.error)
      const copied = await api.copyHarnessSessionPrompt(projectId, session.value.id)
      if (!copied.ok) throw new Error(copied.error)
      return { id: session.value.id, worktree: session.value.workspace!.worktreePath }
    },
    { projectId: PROJECT_ID, taskId }
  )
  const prompt = await copiedText(app)
  const token = /Bearer (\S+)/.exec(prompt)?.[1]
  expect(token).toBeTruthy()
  return { ...started, token: token! }
}

test('a finished run is reviewed first, and the person sends a finding back as their own', async () => {
  test.setTimeout(120_000)
  projectDir = makeGitProject()
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-'))
  const project: WatchedProject = {
    id: PROJECT_ID,
    name: 'E2E review project',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    autoDispatch: {
      projectId: PROJECT_ID,
      enabled: false,
      maxConcurrentEmbeddedSessions: 0,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0,
      agentsPlanFirst: false,
      reviewBeforeMe: true
    }
  }
  const port = await reservePort()
  const automationPort = await reservePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      projects: [project],
      ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
      harness: { ...DEFAULT_CONFIG.harness, enabled: true, port },
      automationApi: { ...DEFAULT_CONFIG.automationApi, enabled: false, port: automationPort }
    })
  )
  ;({ app, window } = await launchOstler({ dataDir, viewport: { width: 1600, height: 1200 } }))
  await expect(window.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: 20_000 })

  const harness = (token: string, method: string, urlPath: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}/harness/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  // The first agent changes README.md and finishes.
  const taskId = await window.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const queued = await api.addHarnessTask(projectId, 'Greet readers', 'Add a greeting.')
    if (!queued.ok) throw new Error(queued.error)
    return queued.value.id
  }, project.id)
  const worker = await startAgent(taskId)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: worker.worktree, stdio: 'pipe' })
  fs.writeFileSync(path.join(worker.worktree, 'README.md'), '# Scratch\nHello, reader.\n')
  git('add', 'README.md')
  git('-c', 'user.email=e2e@example.invalid', '-c', 'user.name=E2E', 'commit', '-m', 'Greet')
  const finished = await harness(worker.token, 'POST', `/session/${worker.id}/update`, {
    note: 'Done',
    done: true,
    completedTaskId: taskId,
    report: { filesChanged: ['README.md'], summary: 'Added a greeting.' }
  })
  expect(finished.ok).toBe(true)

  // A review starts by itself; the reviewer reports one must-fix finding.
  const reviewTaskId = await window.evaluate(
    async ({ projectId, sessionId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (let tries = 0; tries < 300; tries++) {
        const state = await api.getHarnessState(projectId)
        if (!state.ok) throw new Error(state.error)
        const review = state.value.taskQueue.find((task) => task.reviewOf?.sessionId === sessionId)
        if (review) return review.id
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('No review started')
    },
    { projectId: project.id, sessionId: worker.id }
  )
  const reviewer = await startAgent(reviewTaskId)
  const reported = await harness(reviewer.token, 'POST', `/session/${reviewer.id}/update`, {
    note: 'Reviewed',
    done: true,
    completedTaskId: reviewTaskId,
    report: {
      filesChanged: [],
      summary: 'One problem.',
      findings: [
        {
          file: 'README.md',
          firstLine: 2,
          comment: 'Say who the readers are',
          severity: 'must-fix'
        }
      ]
    }
  })
  expect(reported.ok).toBe(true)

  // Home's Needs you lists the reviewed work; Review changes shows the finding.
  const row = window.getByRole('list', { name: 'Needs you' }).getByRole('link', {
    name: /Greet readers/
  })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText('Reviewed')
  await row.click()
  await window.getByRole('button', { name: 'Review…' }).first().click()
  const dialog = window.getByRole('dialog', { name: 'Greet readers' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Reviewer: 1 must-fix, 0 should-fix, 0 nit')).toBeVisible()
  await dialog.getByRole('button', { name: 'View changes' }).click()
  await dialog
    .getByRole('region', { name: "Reviewer's findings" })
    .getByRole('button', { name: 'Send back the finding on README.md, line 2 as my comment' })
    .click()
  await expect(
    dialog.getByRole('region', { name: 'Comments' }).getByText('Say who the readers are')
  ).toBeVisible()

  // The person's own draft now holds it; the finding itself stays the reviewer's.
  const drafts = await window.evaluate(
    async ({ projectId, sessionId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const state = await api.getHarnessState(projectId)
      if (!state.ok) throw new Error(state.error)
      return state.value.reviewSessions.find((entry) => entry.id === sessionId)?.reviewDrafts ?? []
    },
    { projectId: project.id, sessionId: worker.id }
  )
  expect(drafts).toEqual([
    expect.objectContaining({ file: 'README.md', firstLine: 2, comment: 'Say who the readers are' })
  ])

  // Sent back, the toast offers Remember this for next time; its dialog passes
  // axe (docs/accessibility.md), and Escape closes it without saving.
  await dialog.getByRole('button', { name: 'Send back…', exact: true }).click()
  await dialog
    .getByRole('textbox', { name: /Why are you sending it back/ })
    .fill('Name the readers.')
  await dialog.getByRole('button', { name: /^(Send back|Run again)$/ }).click()
  await expect(dialog).toBeHidden()
  await window.getByRole('button', { name: 'Remember this for next time' }).click()
  const lesson = window.getByRole('dialog', { name: 'Remember this for next time' })
  await expect(lesson).toBeVisible()
  await window.waitForTimeout(300)
  const findings = await audit(window, 'remember this for next time')
  expect(findings, describeFindings(findings)).toEqual([])
  await window.keyboard.press('Escape')
  await expect(lesson).toBeHidden()
})
