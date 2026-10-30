import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * Sticky task on the desktop (N5.8b): Pin to desktop from the drawer opens
 * the task in a sticky window of its own; a checklist item ticked there shows
 * ticked in the main window's drawer at once, and the task is remembered to
 * reopen at start. Playwright's launch keeps every window off screen
 * (`offScreen`), the sticky one too.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

const PROJECT: WatchedProject = {
  id: 'e2e-sticky-project',
  name: 'Sticky project',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: Date.UTC(2026, 9, 1),
  lastActivity: null
}

let app: ElectronApplication | null = null
let dataDir: string

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

/** The sticky window on a task, once it has opened. */
async function stickyOn(started: ElectronApplication, taskId: string): Promise<Page> {
  let found: Page | undefined
  await expect(async () => {
    found = started
      .windows()
      .find((page) => page.url().includes(`#/sticky/${PROJECT.id}/${taskId}`))
    expect(found).toBeDefined()
  }).toPass({ timeout: 20_000 })
  await found!.waitForLoadState('domcontentloaded')
  return found!
}

test.afterEach(async () => {
  await app?.close()
  app = null
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('pins a task to the desktop, and a tick there shows in the drawer', async () => {
  test.setTimeout(120_000)
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-sticky-'))
  const port = await reservePort()
  const automationPort = await reservePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      projects: [PROJECT],
      ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
      harness: { ...DEFAULT_CONFIG.harness, enabled: false, port },
      automationApi: { ...DEFAULT_CONFIG.automationApi, enabled: false, port: automationPort }
    })
  )

  const launched = await launchOstler({ dataDir })
  app = launched.app
  const main = launched.window
  await expect(main.getByRole('heading', { name: /^Good / })).toBeVisible({ timeout: 20_000 })
  const taskId = await main.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem(projectId, {
      title: 'Send the invitations',
      status: 'ready',
      acceptanceCriteria: ['Guest list agreed', 'Cards printed']
    })
    if (!created.ok) throw new Error(created.error)
    return created.value.id
  }, PROJECT.id)

  // Open the task's drawer on the Board, and pin it from the drawer's menu.
  await main.getByRole('link', { name: PROJECT.name }).first().click()
  await main.getByRole('tab', { name: 'Board' }).click()
  await main.locator('.task-card', { hasText: 'Send the invitations' }).click()
  const drawer = main.locator('.task-drawer')
  const drawerTick = drawer.getByRole('checkbox', { name: 'Done: Cards printed' })
  await expect(drawerTick).not.toBeChecked()
  await drawer.getByRole('button', { name: 'Task actions' }).click()
  await main.getByRole('menuitem', { name: 'Pin to desktop' }).click()

  // The sticky window shows the task and its checklist.
  const sticky = await stickyOn(app, taskId)
  await expect(sticky.getByRole('button', { name: /^Open Send the invitations in / })).toBeVisible({
    timeout: 20_000
  })
  await expect(sticky).toHaveTitle('Send the invitations')
  const stickyTick = sticky.getByRole('checkbox', { name: 'Cards printed' })
  await stickyTick.click()
  await expect(stickyTick).toBeChecked()

  // The drawer in the main window shows the tick at once, without a reload.
  await expect(drawerTick).toBeChecked()

  // Pinned tasks are remembered, to reopen at start.
  await expect(async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as {
      stickyTasks: { windows: { projectId: string; taskId: string }[] }
    }
    expect(saved.stickyTasks.windows).toContainEqual(
      expect.objectContaining({ projectId: PROJECT.id, taskId })
    )
  }).toPass({ timeout: 10_000 })
})
