import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * Customise board: a change in the panel shows on the Board behind it at once,
 * a view saved for all projects and the default for all projects reach a
 * second project, and Settings › Projects › Board for all projects resets
 * that default. Playwright's launch keeps every window off screen (`offScreen`).
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

const project = (id: string, name: string): WatchedProject => ({
  id,
  name,
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: Date.UTC(2026, 9, 1),
  lastActivity: null
})
const FIRST = project('e2e-board-first', 'First board')
const SECOND = project('e2e-board-second', 'Second board')

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

test.afterEach(async () => {
  await app?.close()
  app = null
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('customises the board live, shares a view and default, and resets it from Settings', async () => {
  test.setTimeout(120_000)
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-customise-board-'))
  const port = await reservePort()
  const automationPort = await reservePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      projects: [FIRST, SECOND],
      ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
      harness: { ...DEFAULT_CONFIG.harness, enabled: false, port },
      automationApi: { ...DEFAULT_CONFIG.automationApi, enabled: false, port: automationPort }
    })
  )

  const launched = await launchOstler({ dataDir })
  app = launched.app
  const window = launched.window
  await expect(window.getByRole('heading', { name: /^Good / })).toBeVisible({ timeout: 20_000 })
  await window.evaluate(
    async (ids) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (const projectId of ids) {
        const created = await api.createPlanningWorkItem(projectId, {
          title: 'Book the venue',
          status: 'ready'
        })
        if (!created.ok) throw new Error(created.error)
      }
    },
    [FIRST.id, SECOND.id]
  )

  // The first project's Board, and Customise board beside it.
  await window.getByRole('link', { name: FIRST.name }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(window.getByLabel('Planning board')).toBeVisible()
  await window.getByRole('button', { name: 'View options' }).click()
  await window.getByRole('button', { name: 'Customise board…' }).click()
  const panel = window.getByRole('dialog', { name: 'Customise board' })
  await expect(panel.getByRole('searchbox', { name: 'Search tasks' })).toBeVisible()

  // A change shows on the Board behind at once.
  await panel.getByRole('tab', { name: 'View options' }).click()
  await panel.getByLabel('Group by').selectOption('origin')
  await expect(window.getByLabel('Planning swimlanes')).toBeVisible()
  await expect(window.getByRole('region', { name: 'Swimlane: Human-authored' })).toBeVisible()

  // Save it as a view for all projects, and make it the default for all projects.
  await panel.getByRole('tab', { name: 'Views' }).click()
  await expect(panel.getByText('Customised for this project')).toBeVisible()
  await panel.getByRole('button', { name: 'Save view…' }).click()
  const naming = window.getByRole('dialog', { name: 'Save view' })
  await naming.getByLabel('Name').fill('Lanes')
  await naming.getByLabel('All projects').check()
  await naming.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status').getByText('Lanes')).toBeVisible()
  await panel.getByRole('button', { name: 'Set as default for all projects' }).click()
  await expect(panel.getByText('Customised', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Done' }).click()

  // The second project follows the default for all projects, and offers the view.
  await window.getByRole('link', { name: SECOND.name }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(window.getByLabel('Planning swimlanes')).toBeVisible()
  await window.getByRole('button', { name: 'Views: Default view' }).click()
  await expect(window.getByRole('menuitemradio', { name: 'Lanes' })).toBeVisible()
  await window.keyboard.press('Escape')
  await window.getByRole('button', { name: 'View options' }).click()
  await window.getByRole('button', { name: 'Customise board…' }).click()
  await expect(panel.getByText('Follows all projects')).toBeVisible()

  // Settings for all projects: reset the default to the standard board.
  await panel.getByRole('button', { name: 'Settings for all projects' }).click()
  const group = window.getByRole('region', { name: 'Board for all projects' })
  await expect(group.getByText('Lanes')).toBeVisible()
  await group.getByRole('button', { name: 'Reset to standard' }).click()
  await window.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(group.getByRole('button', { name: 'Reset to standard' })).toHaveCount(0)

  // Back on the second project's Board: the standard board again.
  await group.getByRole('button', { name: /^Customise board in / }).click()
  await expect(window.getByRole('dialog', { name: 'Customise board' })).toBeVisible()
  await expect(panel.getByText('Standard', { exact: true }).first()).toBeVisible()
  await panel.getByRole('button', { name: 'Done' }).click()
  await expect(window.getByLabel('Planning board')).toBeVisible()
})
