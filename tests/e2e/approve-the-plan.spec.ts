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

/**
 * Approve the plan (N9.3b): a plan-first task's agent sends a plan, the person
 * approves it from Home's Needs you, and the run carries on. The agent here is
 * a connected one over the harness API; a built-in run needs a model, and
 * takes the same harness path.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-plan-project-'))
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

test('a plan-first run sends a plan, the person approves it from Needs you, and the run carries on', async () => {
  test.setTimeout(90_000)
  projectDir = makeGitProject()
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-'))
  const project: WatchedProject = {
    id: 'e2e-plan-project',
    name: 'E2E plan project',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
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

  // A Ready task that plans first, queued as the person queues it.
  const taskId = await window.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const item = await api.createPlanningWorkItem(projectId, {
      title: 'Change the greeting',
      status: 'ready',
      planFirst: 'yes'
    })
    if (!item.ok) throw new Error(item.error)
    const queued = await api.queuePlanningWorkItem(projectId, item.value.id)
    if (!queued.ok) throw new Error(queued.error)
    return queued.value.task.id
  }, project.id)

  // A connected agent starts it once its copy is ready.
  const sessionId = await window.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (let tries = 0; ; tries++) {
        const state = await api.getHarnessState(projectId)
        if (!state.ok) throw new Error(state.error)
        const task = state.value.taskQueue.find((entry) => entry.id === taskId)
        if (!task?.planFirst) throw new Error('The queued task does not plan first')
        if (task.copy?.state === 'ready') break
        if (task.copy?.state === 'failed') throw new Error(task.copy.failure ?? 'The copy failed')
        if (tries > 300) throw new Error('The copy never became ready')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const session = await api.startHarnessTaskSession(projectId, taskId)
      if (!session.ok) throw new Error(session.error)
      const copied = await api.copyHarnessSessionPrompt(projectId, session.value.id)
      if (!copied.ok) throw new Error(copied.error)
      return session.value.id
    },
    { projectId: project.id, taskId }
  )
  const prompt = await copiedText(app)
  const token = /Bearer (\S+)/.exec(prompt)?.[1]
  expect(token).toBeTruthy()
  const harness = (method: string, urlPath: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}/harness/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  const sent = await harness('POST', `/session/${sessionId}/plan`, {
    steps: ['Read README.md', 'Change the greeting'],
    files: ['README.md'],
    risks: 'None known.'
  })
  expect(sent.ok).toBe(true)

  // Home's Needs you shows the plan; opening it shows the Plan dialog.
  const row = window.getByRole('list', { name: 'Needs you' }).getByRole('button', {
    name: /Change the greeting/
  })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText('Plan to approve')
  await row.click()
  const dialog = window.getByRole('dialog', { name: 'Plan' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Change the greeting').first()).toBeVisible()
  await expect(dialog.getByText('README.md').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toBeHidden({ timeout: 20_000 })

  // The run carries on: the agent reads the decision and may now change files.
  const session = (await (await harness('GET', `/session/${sessionId}`)).json()) as {
    ok: boolean
    value: { plan?: { status: string } }
  }
  expect(session.value.plan?.status).toBe('approved')
  const running = await window.evaluate(async (sessionId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const state = await api.getHarnessState('e2e-plan-project')
    if (!state.ok) throw new Error(state.error)
    return state.value.activeSessions.find((entry) => entry.id === sessionId)?.status
  }, sessionId)
  expect(running).toBe('active')

  // The approved plan is kept with the task.
  const kept = await window.evaluate(async (taskId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const state = await api.getHarnessState('e2e-plan-project')
    if (!state.ok) throw new Error(state.error)
    const workItemId = state.value.taskQueue.find((task) => task.id === taskId)?.planningWorkItemId
    const plans = await api.listWorkItemPlans(workItemId!)
    return plans.ok ? plans.value.map((plan) => plan.status) : []
  }, taskId)
  expect(kept).toEqual(['approved'])
})
