import type { ElectronApplication, Page } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import {
  DEFAULT_CONFIG,
  SAMPLE_TEMPLATE_ID,
  type OstlerAPI,
  type OstlerConfig,
  type DensitySetting,
  type ThemeSetting,
  type WatchedProject
} from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'
import { readNeedlessScroll } from '../helpers/needless-scroll'
import { readSqueezedText } from '../helpers/squeezed-text'

/**
 * Launching Ostler for the accessibility suite (P9.2): a throwaway data folder,
 * both servers off their default ports, the welcome either finished or still
 * to come, and the sample project as the thing to look at.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

export interface A11yApp {
  app: ElectronApplication
  page: Page
  dataDir: string
  /** The OneDrive folder this PC has, when launched with `oneDrive`: a place to share projects. */
  oneDrive?: string
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Could not reserve a port'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

export async function launchForAudit(options: {
  theme: ThemeSetting
  density?: DensitySetting
  /** A new install: the welcome fills the window. */
  fresh?: boolean
  agents?: boolean
  /** Projects already registered, such as a scratch Git repository. */
  projects?: WatchedProject[]
  viewport?: { width: number; height: number }
  /** Settings beside the theme and density, such as Show my progress. */
  ui?: Partial<OstlerConfig['ui']>
  /** Settings › General › Windows, such as background mode. */
  desktop?: Partial<OstlerConfig['desktop']>
  /** Windows' languages and regional format, pinned so money and dates read the same everywhere. */
  locale?: string
  /** Gives this PC a OneDrive folder of its own, so a project can be shared into it. */
  oneDrive?: boolean
}): Promise<A11yApp> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-a11y-'))
  const harnessPort = await freePort()
  const automationPort = await freePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        projects: options.projects ?? [],
        ui: {
          ...DEFAULT_CONFIG.ui,
          theme: options.theme,
          density: options.density ?? 'comfortable',
          firstRunCompleted: !options.fresh,
          lastSeenVersion: options.fresh ? '' : APP_VERSION,
          ...options.ui
        },
        desktop: { ...DEFAULT_CONFIG.desktop, ...options.desktop },
        harness: { ...DEFAULT_CONFIG.harness, enabled: options.agents ?? false, port: harnessPort },
        automationApi: {
          ...DEFAULT_CONFIG.automationApi,
          enabled: options.agents ?? false,
          port: automationPort
        }
      },
      null,
      2
    )
  )
  // Outside the data folder: a project's shared folder may not sit inside it.
  const oneDrive = options.oneDrive
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-a11y-onedrive-'))
    : undefined
  return startApp(dataDir, options.viewport, options.locale, oneDrive)
}

/** Starts Ostler on `dataDir`: a launch, or a restart after `app.close()`. */
export async function startApp(
  dataDir: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
  locale?: string,
  oneDrive?: string
): Promise<A11yApp> {
  const env = {
    ...(locale ? { OSTLER_SYSTEM_LOCALE: locale } : {}),
    ...(oneDrive
      ? { OneDrive: oneDrive, OneDriveConsumer: undefined, OneDriveCommercial: undefined }
      : {})
  }
  const { app, window: page } = await launchOstler({
    dataDir,
    viewport,
    env: Object.keys(env).length > 0 ? env : undefined
  })
  return { app, page, dataDir, oneDrive }
}

export async function closeAudit(target: A11yApp): Promise<void> {
  await target.app.close()
  fs.rmSync(target.dataDir, { recursive: true, force: true })
  if (target.oneDrive) fs.rmSync(target.oneDrive, { recursive: true, force: true })
}

/** Creates the sample project from its built-in package; returns its id and a task's. */
export async function createSampleProject(
  page: Page
): Promise<{ projectId: string; taskId: string }> {
  return page.evaluate(async (templateId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createProject({
      name: 'Sample project',
      color: '',
      tags: [],
      notes: '',
      folder: null,
      templateId
    })
    if (!created.ok) throw new Error(created.error)
    const projectId = created.value.project.id
    const items = await api.getPlanningWorkItems(projectId)
    if (!items.ok || items.value.length === 0) throw new Error('The sample project has no tasks')
    // The template's last task, which has a label, a milestone and a dependency for the
    // drawer's snapshot. Tasks list in the template's own order (manual order, D31).
    return { projectId, taskId: items.value[items.value.length - 1].id }
  }, SAMPLE_TEMPLATE_ID)
}

/** Opens an internal path the way a deep link does: a fresh render at that route. */
export async function openPath(page: Page, route: string): Promise<void> {
  await page.evaluate((hash) => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = hash
  }, route)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('main').first().waitFor()
  // Lazy views and their data settle; spinners are gone.
  await page
    .locator('.ui-spinner')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {})
  await page.waitForTimeout(400)
}

/**
 * Opens every folding group on a settings page (they show one line each until
 * opened), so an audit sees the settings in them too.
 */
export async function openSettingsGroups(page: Page): Promise<void> {
  const closed = page.locator('.ostler-settings-fold__toggle[aria-expanded="false"]')
  while ((await closed.count()) > 0) await closed.first().click()
}

/** Opens one folding settings group by its title, if it is not open already. */
export async function openSettingsGroup(page: Page, title: string): Promise<void> {
  const toggle = page.locator('.ostler-settings-fold__toggle', {
    has: page.getByText(title, { exact: true })
  })
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
}

export interface Finding {
  where: string
  id: string
  impact: string
  help: string
  targets: string[]
}

/**
 * Serious and critical axe violations on the page as it is now (WCAG 2.2 A and
 * AA), any box that scrolls by a little while the window has room to show
 * all of it (tests/helpers/needless-scroll.ts), and any text squeezed into a
 * column a word or two wide (tests/helpers/squeezed-text.ts).
 */
export async function audit(page: Page, where: string): Promise<Finding[]> {
  const needless = (await page.evaluate(readNeedlessScroll)).map((entry) => ({
    where,
    id: 'needless-scroll',
    impact: 'layout',
    help: 'A box scrolls although the window has room to show all of it',
    targets: [`${entry.element} -- hides ${entry.hidden}px, room for ${entry.room}px`]
  }))
  const squeezed = (await page.evaluate(readSqueezedText)).map((entry) => ({
    where,
    id: 'squeezed-text',
    impact: 'layout',
    help: 'Text is squeezed into a column a word or two wide, so it reads down the page',
    targets: [`${entry.element} -- ${entry.lines} lines, ${entry.width}px wide`]
  }))
  return [...needless, ...squeezed, ...(await axeFindings(page, where))]
}

async function axeFindings(page: Page, where: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page })
    // Electron cannot open the blank page axe's default mode uses for iframes.
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      where,
      id: violation.id,
      impact: violation.impact ?? '',
      help: violation.help,
      // Each node's selector, and axe's first reason for it.
      targets: violation.nodes
        .slice(0, 5)
        .map((node) => `${node.target.join(' ')} -- ${firstReason(node.failureSummary)}`)
    }))
}

function firstReason(summary: string | undefined): string {
  return (summary ?? '').split('\n')[1]?.trim() ?? ''
}

export function describeFindings(findings: Finding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.where}: [${finding.impact}] ${finding.id}: ${finding.help}\n    ${finding.targets.join('\n    ')}`
    )
    .join('\n')
}

/**
 * The view and settings section ids in the navigation registry, read from its
 * source (the settings sections are in settings-registry.ts). The registry imports React and the views, which this Node-side suite
 * cannot load, but its ids are plain literals: a view added there is audited
 * here without touching this suite.
 */
export function registeredIds(): { global: string[]; project: string[]; settings: string[] } {
  const read = (file: string) =>
    fs.readFileSync(path.join(root, 'src/renderer/navigation', file), 'utf8')
  const block = (start: string, source = read('registry.ts')) => {
    const from = source.indexOf(start)
    if (from === -1) throw new Error(`The registry has no ${start}`)
    return source.slice(from, source.indexOf('] as const', from))
  }
  const ids = (text: string, pattern: RegExp) =>
    [...text.matchAll(pattern)].map((match) => match[1])
  return {
    global: ids(block('export const GLOBAL_VIEWS'), /^\s{4}id: '([a-z-]+)'/gm),
    project: ids(block('export const PROJECT_VIEWS'), /^\s{4}id: '([a-z-]+)'/gm),
    settings: ids(
      block('export const SETTINGS_SECTIONS', read('settings-registry.ts')),
      /section\('([a-z-]+)'/g
    )
  }
}
