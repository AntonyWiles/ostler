import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * The Board stays put: starting or clearing a selection, and pointing at a
 * card, move nothing on the page. Selecting a whole column used to bring in
 * a bulk bar two rows tall that pushed every column down, and a card's box
 * appearing on hover pushed its title sideways. Measured in a real window,
 * narrow enough that the bulk bar has more actions than fit. Playwright's
 * launch keeps every window off screen (`offScreen`).
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

const PROJECT: WatchedProject = {
  id: 'e2e-board-stays-put',
  name: 'Steady board',
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

/** Where an element is on the page, to the pixel. */
async function place(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Not on the page')
  return { x: Math.round(box.x), y: Math.round(box.y) }
}

/** Waits a frame or two, so a change has laid out before it is measured. */
const settle = (window: Page) =>
  window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))

test.afterEach(async () => {
  await app?.close()
  app = null
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('the Board does not move when a selection starts or ends, or a card is pointed at', async () => {
  test.setTimeout(120_000)
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-board-stays-put-'))
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
  const window = launched.window
  await expect(window.getByRole('heading', { name: /^Good / })).toBeVisible({ timeout: 20_000 })
  // Narrow, so the bulk bar has more actions than one row holds.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 800))
  await window.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    for (const title of ['Book the venue', 'Send the invitations', 'Order the food']) {
      const created = await api.createPlanningWorkItem(projectId, { title, status: 'ready' })
      if (!created.ok) throw new Error(created.error)
    }
  }, PROJECT.id)

  await window.getByRole('link', { name: PROJECT.name }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(window.getByLabel('Planning board')).toBeVisible()
  const ready = window.locator('.ostler-planning-column--ready')
  const title = ready.getByRole('heading', { name: 'Book the venue' })
  await expect(title).toBeVisible()
  await settle(window)
  const columnAtRest = await place(ready)
  const titleAtRest = await place(title)

  // Pointing at a card shows nothing that moves its title.
  await title.hover()
  await settle(window)
  expect(await place(title)).toEqual(titleAtRest)

  // Select all in the column: the bulk bar comes, and the columns stay where they were.
  await ready.getByRole('button', { name: /^Select all in / }).click()
  const bulkBar = window.getByRole('toolbar', { name: 'Bulk actions' })
  await expect(bulkBar.getByText('3 selected')).toBeVisible()
  await settle(window)
  expect(await place(ready)).toEqual(columnAtRest)

  // And again once it is cleared.
  await bulkBar.getByRole('button', { name: 'Clear selection' }).click()
  await expect(bulkBar).toHaveCount(0)
  await settle(window)
  expect(await place(ready)).toEqual(columnAtRest)
  expect(await place(title)).toEqual(titleAtRest)
})
