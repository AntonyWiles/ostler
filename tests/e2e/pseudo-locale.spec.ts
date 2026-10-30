import { expect, test, type Page } from '@playwright/test'
import type { OstlerAPI } from '../../src/shared/ostler-api'
import { BRAND } from '../../src/shared/brand'
import {
  closeAudit,
  launchForAudit,
  openPath,
  openSettingsGroup,
  openSettingsGroups,
  registeredIds,
  type A11yApp
} from './a11y-app'

/**
 * The pseudo-locale walk (P11.1, docs/translating.md): switch Settings ›
 * General › Language to en-XA, which wraps every translated string in
 * brackets, then walk Home, the Board, the task drawer and Settings. A visible
 * text node without the markers is text that skipped the English resources.
 *
 * What may show unmarked: what people typed (this test names its project and
 * task with brackets, so they pass too), the product name, numbers and
 * punctuation, keycaps and code, and the month and weekday names Intl writes.
 */

let target: A11yApp | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
})

/**
 * Text nodes on screen that do not carry the pseudo-locale's markers. It runs
 * in the page, so it is written as page code (this suite has no DOM types).
 */
const UNMARKED_TEXT = String.raw`(allowed) => {
  const intlWords = new Set()
  for (const locale of [undefined, document.documentElement.lang]) {
    for (let month = 0; month < 12; month++) {
      const date = new Date(2026, month, 1)
      for (const style of ['long', 'short'])
        intlWords.add(new Intl.DateTimeFormat(locale, { month: style }).format(date))
    }
    // Units Intl writes for sizes and durations: "kB", "min", "days".
    for (const unit of ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'second', 'minute', 'hour', 'day', 'week'])
      for (const unitDisplay of ['narrow', 'short', 'long'])
        for (const value of [1, 2])
          for (const part of new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay }).formatToParts(value))
            if (part.type === 'unit') intlWords.add(part.value)
    // In either case: the app formats with Windows' region (en-NZ writes "pm"),
    // which need not match this page's default locale ("PM").
    for (const hour of [9, 21])
      for (const part of new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).formatToParts(new Date(2026, 9, 9, hour)))
        if (part.type === 'dayPeriod')
          for (const variant of [part.value, part.value.toLowerCase(), part.value.toUpperCase()])
            intlWords.add(variant)
    for (let day = 0; day < 7; day++) {
      const date = new Date(2026, 9, 4 + day)
      for (const style of ['long', 'short'])
        intlWords.add(new Intl.DateTimeFormat(locale, { weekday: style }).format(date))
    }
  }
  const marked = (text) => /[\[\]~]/.test(text)
  const onlyIntl = (text) =>
    !/\p{L}/u.test(
      text
        .split(/[\s,./:–-]+/)
        .filter((word) => !intlWords.has(word) && !intlWords.has(word.replace(/\.$/, '')))
        .join(' ')
    )
  const problems = []
  let markedCount = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || '').trim()
    if (!/\p{L}/u.test(text)) continue
    const element = node.parentElement
    if (!element) continue
    if (element.closest('kbd, code, pre, option, textarea, script, style, svg, .ui-avatar')) continue
    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
    if (marked(text)) {
      markedCount++
      continue
    }
    if (allowed.includes(text) || onlyIntl(text)) continue
    // Part of a marked message that holds markup: <strong>{{title}}</strong> inside [...].
    const block = element.closest('p, li, h1, h2, h3, h4, button, label, dd, dt, td, th')
    if (block && marked(block.textContent || '')) continue
    problems.push(text)
  }
  return { problems: [...new Set(problems)], markedCount }
}`

async function unmarkedText(page: Page): Promise<{ problems: string[]; markedCount: number }> {
  return page.evaluate(`(${UNMARKED_TEXT})(${JSON.stringify(ALLOWED)})`) as Promise<{
    problems: string[]
    markedCount: number
  }>
}

/** What may show unmarked: the product's own name. */
const ALLOWED = [BRAND.name, BRAND.fullName, BRAND.aiName]

test('en-XA marks every string on Home, the Board, the task drawer and Settings', async () => {
  test.setTimeout(120_000)
  target = await launchForAudit({ theme: 'light' })
  const page = target.page

  const { projectId, taskId } = await page.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createProject({
      name: '[Pseudo project]',
      color: '',
      tags: [],
      notes: '',
      folder: null
    })
    if (!created.ok) throw new Error(created.error)
    const id = created.value.project.id
    const task = await api.createPlanningWorkItem(id, {
      title: '[Pseudo task]',
      status: 'ready',
      priority: 'high',
      description: '[A description]',
      acceptanceCriteria: ['[A checklist item]']
    })
    if (!task.ok) throw new Error(task.error)
    return { projectId: id, taskId: task.value.id }
  })

  // The setting switches the language at once, without a restart.
  await openPath(page, '/settings/general')
  // The Language group opens in place, and stays open from then on.
  await openSettingsGroup(page, 'Language')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('en-XA')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA')
  await expect(page.getByRole('heading', { name: /^\[.*\]$/ }).first()).toBeVisible()

  const screens: [string, string][] = [
    ['Settings › General', '/settings/general'],
    ['Settings › Notifications', '/settings/notifications'],
    ['Settings › Data', '/settings/data'],
    ['Home', '/home'],
    ['Board', `/projects/${projectId}/board`],
    ['Task drawer', `/projects/${projectId}/tasks/${taskId}`]
  ]
  const found: string[] = []
  for (const [name, route] of screens) {
    await openPath(page, route)
    await openSettingsGroups(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA')
    const { problems, markedCount } = await unmarkedText(page)
    // The screen is really there, in the pseudo-locale.
    expect(markedCount, name).toBeGreaterThan(5)
    for (const text of problems) found.push(`${name}: ${text}`)
  }
  expect(found).toEqual([])

  // And back: English again, without the markers.
  await openPath(page, '/settings/general')
  await page.getByRole('combobox', { name: /^\[.*\]$/ }).selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeVisible()
})

test('en-XA marks every string on every registered view and settings section', async () => {
  test.setTimeout(240_000)
  target = await launchForAudit({ theme: 'light', agents: true })
  const page = target.page
  const projectId = await page.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createProject({
      name: '[Pseudo project]',
      color: '',
      tags: [],
      notes: '',
      folder: null
    })
    if (!created.ok) throw new Error(created.error)
    const id = created.value.project.id
    for (const [title, status] of [
      ['[Pseudo task]', 'ready'],
      ['[Another task]', 'done']
    ] as const) {
      const task = await api.createPlanningWorkItem(id, { title, status, targetDate: null })
      if (!task.ok) throw new Error(task.error)
    }
    return id
  })
  await openPath(page, '/settings/general')
  // The Language group opens in place, and stays open from then on.
  await openSettingsGroup(page, 'Language')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('en-XA')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA')

  const ids = registeredIds()
  const routes = [
    // The user guide is written in English only (translating it is not in P11.1).
    ...ids.global.filter((id) => id !== 'agents' && id !== 'help').map((id) => [id, `/${id}`]),
    ...ids.project
      .filter((id) => id !== 'files' && id !== 'agents')
      .map((id) => [`project ${id}`, `/projects/${projectId}/${id}`]),
    ...ids.settings.map((id) => [`settings ${id}`, `/settings/${id}`])
  ]
  const found: string[] = []
  for (const [name, route] of routes) {
    await openPath(page, route)
    await openSettingsGroups(page)
    const { problems } = await unmarkedText(page)
    for (const text of problems) found.push(`${name}: ${text}`)
  }
  expect(found).toEqual([])
})

test('en-XA marks every string in the welcome and the main dialogs', async () => {
  test.setTimeout(180_000)
  target = await launchForAudit({ theme: 'light', fresh: true })
  const page = target.page
  // The setting is saved before the welcome is shown again.
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const saved = await api.updateConfig({ ui: { language: 'en-XA' } })
    if (!saved.ok) throw new Error(saved.error)
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA')
  await page.waitForTimeout(500)
  const found: string[] = []
  const check = async (name: string) => {
    const { problems, markedCount } = await unmarkedText(page)
    expect(markedCount, name).toBeGreaterThan(3)
    for (const text of problems) found.push(`${name}: ${text}`)
  }
  await check('Welcome')

  // Past the welcome: the dialogs anyone opens.
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    // What's new is the changelog, written in English only: seen already.
    const version = await api.getAppVersion()
    if (!version.ok) throw new Error(version.error)
    await api.updateConfig({ ui: { firstRunCompleted: true, lastSeenVersion: version.value } })
    const created = await api.createProject({
      name: '[Pseudo project]',
      color: '',
      tags: [],
      notes: '',
      folder: null
    })
    if (!created.ok) throw new Error(created.error)
  })
  await openPath(page, '/home')
  const dialogs: [string, () => Promise<void>][] = [
    ['Command palette', () => page.keyboard.press('Control+K')],
    ['Quick add', () => page.keyboard.press('Control+Shift+N')],
    [
      'Keyboard shortcuts',
      async () => {
        await page
          .locator(':focus')
          .evaluateAll((nodes) =>
            nodes.forEach((node) => (node as unknown as { blur(): void }).blur())
          )
        await page.keyboard.press('?')
      }
    ]
  ]
  for (const [name, open] of dialogs) {
    await open()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.waitForTimeout(300)
    await check(name)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect(found).toEqual([])
})
