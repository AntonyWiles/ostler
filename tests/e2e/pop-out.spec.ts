import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * Pop out a view (N5.8a): the Board opens in a window of its own, a card
 * moved there shows in the main window's List at once, and with Reopen at
 * start ticked the Board comes back in its own window at the next start.
 * Playwright's launch keeps every window off screen (`offScreen`).
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

const PROJECT: WatchedProject = {
  id: 'e2e-pop-out-project',
  name: 'Pop-out project',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: Date.UTC(2026, 9, 1),
  lastActivity: null
}
const BOARD_ROUTE = `/projects/${PROJECT.id}/board`

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

/** The pop-out window on `route`, once it has opened. */
async function popOutOn(started: ElectronApplication, route: string): Promise<Page> {
  let found: Page | undefined
  await expect(async () => {
    found = started.windows().find((page) => page.url().includes(`#/pop-out${route}`))
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

test('pops the Board out, a card moved there shows in the List, and it reopens at start', async () => {
  test.setTimeout(120_000)
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-pop-out-'))
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
  await main.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem(projectId, {
      title: 'Book the venue',
      status: 'ready'
    })
    if (!created.ok) throw new Error(created.error)
  }, PROJECT.id)

  // The main window shows the List, grouped by status.
  await main.getByRole('link', { name: PROJECT.name }).first().click()
  await main.getByRole('tab', { name: 'List' }).click()
  const grid = main.getByRole('grid', { name: 'Tasks' })
  await expect(grid.getByRole('row', { name: /Book the venue/ })).toBeVisible()
  await main.getByRole('button', { name: 'View options' }).click()
  await main
    .getByRole('dialog', { name: 'View options' })
    .getByLabel('Group by')
    .selectOption('status')
  await main.keyboard.press('Escape')
  const groupRows = grid.locator('[role="row"][aria-expanded]')
  await expect(groupRows.filter({ hasText: 'Ready' })).toContainText('1')

  // Open the Board in a new window, from its More menu.
  await main.getByRole('tab', { name: 'Board' }).click()
  await expect(main.getByLabel('Planning board')).toBeVisible()
  await main.getByRole('button', { name: 'More project actions' }).click()
  await main.getByRole('menuitem', { name: 'Open in new window' }).click()
  const board = await popOutOn(app, BOARD_ROUTE)
  await expect(board.getByLabel('Planning board')).toBeVisible({ timeout: 20_000 })
  // One view, without the project's tabs or the sidebar.
  await expect(board.getByRole('tab', { name: 'List' })).toHaveCount(0)
  await expect(board.getByRole('heading', { name: PROJECT.name })).toBeVisible()

  // Back to the List in the main window, then move the card in the pop-out.
  await main.getByRole('tab', { name: 'List' }).click()
  await expect(groupRows.filter({ hasText: 'Ready' })).toContainText('1')
  await board
    .getByRole('heading', { name: 'Book the venue', exact: true })
    .click({ button: 'right' })
  await board.getByRole('menuitem', { name: 'Done' }).click()
  await expect(
    board.locator('.ostler-planning-column--done').getByText('Book the venue')
  ).toBeVisible()
  // The main window's List shows it at once, without a reload.
  await expect(groupRows.filter({ hasText: 'Done' })).toContainText('1')
  await expect(groupRows.filter({ hasText: 'Ready' })).toContainText('0')

  // Reopen at start, from the pop-out's title bar menu.
  // A checkbox item: read as not checked, and saying what it does.
  await board.getByRole('button', { name: 'Window menu' }).click()
  const reopen = board.getByRole('menuitemcheckbox', { name: 'Reopen at start' })
  await expect(reopen).toHaveAttribute('aria-checked', 'false')
  await expect(reopen).toHaveAccessibleDescription(
    'Open this window again at start if it is open when you quit'
  )
  await reopen.click()
  await expect(async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as {
      popOuts: { windows: { route: string; reopenAtStart: boolean }[] }
    }
    expect(saved.popOuts.windows).toContainEqual(
      expect.objectContaining({ route: BOARD_ROUTE, reopenAtStart: true })
    )
  }).toPass({ timeout: 10_000 })

  // Quit with the pop-out open, and start again.
  await app.close()
  app = (await launchOstler({ dataDir })).app
  const reopened = await popOutOn(app, BOARD_ROUTE)
  await expect(reopened.getByLabel('Planning board')).toBeVisible({ timeout: 20_000 })
  await expect(
    reopened.locator('.ostler-planning-column--done').getByText('Book the venue')
  ).toBeVisible()
  expect(app.windows().length).toBeGreaterThanOrEqual(2)
  // Reopened, its menu reads Reopen at start as checked.
  await reopened.getByRole('button', { name: 'Window menu' }).click()
  await expect(reopened.getByRole('menuitemcheckbox', { name: 'Reopen at start' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await reopened.keyboard.press('Escape')
})
