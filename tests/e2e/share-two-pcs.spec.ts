import { expect, test, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'

/**
 * Sharing a project between two PCs, in two real Ostlers (MOP-3): one shares
 * a project into its OneDrive folder and copies the invite; the other joins
 * with the invite message, choosing the same folder, and each one's changes
 * reach the other. The two share one folder, as a network share or a synced
 * folder that has caught up would. Every window stays off screen
 * (`offScreen`); the folder dialog answers with the shared folder, so the
 * join never searches the person's own synced folders.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

const apps: ElectronApplication[] = []
let scratch: string

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() =>
        address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('port'))
      )
    })
  })
}

/** One PC: its own data, and the OneDrive folder both PCs see. */
async function startPc(
  name: string,
  oneDrive: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const dataDir = path.join(scratch, name, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
      harness: { ...DEFAULT_CONFIG.harness, enabled: false, port: await freePort() },
      automationApi: { ...DEFAULT_CONFIG.automationApi, enabled: false, port: await freePort() }
    })
  )
  // This PC's OneDrive is the folder given, whatever the machine running the test has.
  const { app, window: page } = await launchOstler({
    dataDir,
    env: { OneDrive: oneDrive, OneDriveConsumer: undefined, OneDriveCommercial: undefined }
  })
  apps.push(app)
  await expect(page.getByRole('heading', { name: /^Good / })).toBeVisible({ timeout: 20_000 })
  return { app, page }
}

/** What Ostler last copied: off screen it keeps its own clipboard, and the paste key reads it. */
async function copiedText(page: Page): Promise<string> {
  await page.evaluate(() => {
    const doc = (
      globalThis as unknown as {
        document: {
          createElement(tag: 'textarea'): { id: string; focus(): void }
          body: { append(node: unknown): void }
        }
      }
    ).document
    const area = doc.createElement('textarea')
    area.id = 'e2e-paste'
    doc.body.append(area)
    area.focus()
  })
  await page.keyboard.press('Control+V')
  const area = page.locator('#e2e-paste')
  await expect(area).not.toHaveValue('')
  const text = await area.inputValue()
  await area.evaluate((node) => (node as unknown as { remove(): void }).remove())
  return text
}

const titlesOn = (page: Page, projectId: string) =>
  page.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await ostler.getPlanningWorkItems(id)
    if (!items.ok) throw new Error(items.error)
    return items.value.map((item) => item.title).sort()
  }, projectId)

/** Syncs a PC's copy of the project now, as Sync now in Sharing does. */
const syncNow = (page: Page, projectId: string) =>
  page.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const state = await ostler.syncShareNow(id)
    if (!state.ok) throw new Error(state.error)
  }, projectId)

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
  fs.rmSync(scratch, { recursive: true, force: true })
})

test('shares a project to a second PC with the invite, and keeps both in step', async () => {
  test.setTimeout(180_000)
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-share-'))
  const oneDrive = path.join(scratch, 'OneDrive')
  fs.mkdirSync(oneDrive)

  // Ann's PC: a project with a task, shared into OneDrive.
  const { page: ann } = await startPc('ann', oneDrive)
  const projectId = await ann.evaluate(async () => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await ostler.createProject({
      name: 'Garden',
      color: '',
      tags: [],
      notes: '',
      folder: null
    })
    if (!created.ok) throw new Error(created.error)
    const id = created.value.project.id
    const task = await ostler.createPlanningWorkItem(id, { title: 'Dig the beds', status: 'ready' })
    if (!task.ok) throw new Error(task.error)
    return id
  })
  const shareState = await ann.evaluate(
    async ([id, folder]) => {
      const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await ostler.shareProject(id, folder)
      if (!result.ok) throw new Error(result.error)
      return result.value
    },
    [projectId, oneDrive] as const
  )
  expect(shareState?.folder.toLowerCase()).toContain(oneDrive.toLowerCase())
  expect(fs.readdirSync(oneDrive).length).toBe(1)

  // Sharing copies the invite message, as Copy invite does.
  const message = await copiedText(ann)
  expect(message).toContain('Join "Garden"')

  // Ben's PC joins with the whole message, choosing the shared folder when asked.
  const { app: benApp, page: ben } = await startPc('ben', oneDrive)
  await benApp.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, shareState!.folder)
  const joined = await ben.evaluate(async (text) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const result = await ostler.joinShareChooseFolder(text)
    if (!result.ok) throw new Error(result.error)
    return result.value
  }, message)
  expect(joined).toMatchObject({ name: 'Garden' })
  const benProjectId = (joined as { projectId: string }).projectId
  await expect.poll(() => titlesOn(ben, benProjectId)).toEqual(['Dig the beds'])

  // Ben adds a task; once Ann syncs, she has it, and the members list shows them both.
  await ben.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const task = await ostler.createPlanningWorkItem(id, { title: 'Buy seeds', status: 'ready' })
    if (!task.ok) throw new Error(task.error)
  }, benProjectId)
  await syncNow(ben, benProjectId)
  await expect
    .poll(
      async () => {
        await syncNow(ann, projectId)
        return titlesOn(ann, projectId)
      },
      { timeout: 30_000 }
    )
    .toEqual(['Buy seeds', 'Dig the beds'])
  const members = await ann.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const state = await ostler.getShareState(id)
    return state.ok ? (state.value?.members.length ?? 0) : 0
  }, projectId)
  expect(members).toBe(2)

  // And Ann's rename reaches Ben.
  await ann.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await ostler.getPlanningWorkItems(id)
    if (!items.ok) throw new Error(items.error)
    const dig = items.value.find((item) => item.title === 'Dig the beds')!
    const renamed = await ostler.updatePlanningWorkItem(dig.id, {
      title: 'Dig the raised beds'
    })
    if (!renamed.ok) throw new Error(renamed.error)
  }, projectId)
  await syncNow(ann, projectId)
  await expect
    .poll(
      async () => {
        await syncNow(ben, benProjectId)
        return titlesOn(ben, benProjectId)
      },
      { timeout: 30_000 }
    )
    .toEqual(['Buy seeds', 'Dig the raised beds'])
})
