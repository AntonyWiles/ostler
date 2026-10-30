import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { execFileSync } from 'node:child_process'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * Scheduled agent tasks (N9.7): a weekly task that goes to agents, marked
 * done, makes its next occurrence, which is queued for agents when its start
 * date comes. The main process's clock is set forward a week in the test,
 * and the check runs as it does on waking from sleep. Nothing starts an
 * agent (auto-dispatch is off), and notifications are off.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-scheduled-project-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# Scratch\n')
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.invalid')
  git('config', 'user.name', 'E2E')
  git('add', 'README.md')
  git('commit', '-m', 'Initial commit')
  return dir
}

/** This PC's local day, `YYYY-MM-DD`, `days` from today. */
function localDay(days = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

test.afterEach(async () => {
  await app?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(projectDir, { recursive: true, force: true })
})

test('a weekly task that goes to agents queues its next occurrence when its start date comes', async () => {
  test.setTimeout(90_000)
  projectDir = makeGitProject()
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-'))
  const project: WatchedProject = {
    id: 'e2e-scheduled-project',
    name: 'E2E scheduled project',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      projects: [project],
      ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
      notifications: { ...DEFAULT_CONFIG.notifications, enabled: false, weeklyReviewDay: null },
      harness: { ...DEFAULT_CONFIG.harness, enabled: true, port: await reservePort() },
      automationApi: {
        ...DEFAULT_CONFIG.automationApi,
        enabled: false,
        port: await reservePort()
      }
    })
  )
  ;({ app, window } = await launchOstler({ dataDir }))
  await expect(window.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: 20_000 })

  // A weekly task starting and due today, that goes to agents, done by hand.
  const nextId = await window.evaluate(
    async ({ projectId, day }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const item = await api.createPlanningWorkItem(projectId, {
        title: 'Update the dependencies',
        status: 'ready',
        startDate: day,
        targetDate: day
      })
      if (!item.ok) throw new Error(item.error)
      const repeat = await api.setPlanningRecurrence(item.value.id, {
        rule: { every: 'week', interval: 1 },
        goToAgents: true
      })
      if (!repeat.ok) throw new Error(repeat.error)
      const done = await api.updatePlanningWorkItem(item.value.id, { status: 'done' })
      if (!done.ok) throw new Error(done.error)
      if (!done.value.repeatedAs) throw new Error('No next occurrence was made')
      return done.value.repeatedAs
    },
    { projectId: project.id, day: localDay(0) }
  )

  const read = () =>
    window.evaluate(
      async ({ projectId, workItemId }) => {
        const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
        const items = await api.getPlanningWorkItems(projectId)
        if (!items.ok) throw new Error(items.error)
        const state = await api.getHarnessState(projectId)
        if (!state.ok) throw new Error(state.error)
        const repeat = await api.getPlanningRecurrence(workItemId)
        if (!repeat.ok) throw new Error(repeat.error)
        return {
          item: items.value.find((entry) => entry.id === workItemId)!,
          tasks: state.value.taskQueue.map((task) => ({
            workItemId: task.planningWorkItemId,
            scheduled: task.scheduled === true,
            status: task.status
          })),
          goToAgents: repeat.value?.goToAgents
        }
      },
      { projectId: project.id, workItemId: nextId }
    )

  // The next occurrence starts in a week; nothing is queued yet.
  const before = await read()
  expect(before.item).toMatchObject({ status: 'backlog', startDate: localDay(7) })
  expect(before.goToAgents).toBe(true)
  expect(before.tasks).toEqual([])

  // A week on: the main process's clock moves forward, and the check runs as on waking.
  await app.evaluate(({ powerMonitor }) => {
    const RealDate = Date
    const offset = 7 * 24 * 60 * 60 * 1000
    class ForwardDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + offset)
        else super(...(args as [number]))
      }
      static now(): number {
        return RealDate.now() + offset
      }
    }
    ;(globalThis as { Date: DateConstructor }).Date = ForwardDate as DateConstructor
    powerMonitor.emit('resume')
  })

  await expect
    .poll(async () => (await read()).tasks, { timeout: 20_000 })
    .toEqual([{ workItemId: nextId, scheduled: true, status: 'pending' }])
  const after = await read()
  expect(after.item).toMatchObject({ status: 'ready', scheduledQueue: { outcome: 'queued' } })

  // The Inbox notes it, linking to the task.
  const inbox = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const list = await api.getInbox()
    if (!list.ok) throw new Error(list.error)
    return list.value.items.filter((item) => item.kind === 'scheduled')
  })
  expect(inbox).toEqual([
    expect.objectContaining({
      title: 'Queued for agents: Update the dependencies',
      taskId: nextId
    })
  ])
})
