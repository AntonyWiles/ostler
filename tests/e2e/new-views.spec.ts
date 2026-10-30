import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import { DEFAULT_CONFIG, type OstlerAPI, type WatchedProject } from '../../src/shared/ostler-api'
import { launchOstler } from './helpers/launch'
import { openProjectView } from './project-views'

/**
 * The newer views, each driven end to end the way a person meets them: To
 * triage, Goals, countdowns, the Shopping list and the weekly review. Ostler
 * runs off screen on a scratch data folder.
 */

const root = path.resolve(__dirname, '../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

let app: ElectronApplication | null = null
let window: Page
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

function project(id: string, name: string, extra: Partial<WatchedProject> = {}): WatchedProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    ...extra
  }
}

/** Starts Ostler off screen on a scratch data folder, past the welcome. */
async function launch(projects: WatchedProject[]): Promise<void> {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-views-'))
  const port = await reservePort()
  const automationPort = await reservePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        projects,
        ui: {
          ...DEFAULT_CONFIG.ui,
          firstRunCompleted: true,
          lastSeenVersion: APP_VERSION
        },
        harness: { ...DEFAULT_CONFIG.harness, enabled: false, port },
        automationApi: { ...DEFAULT_CONFIG.automationApi, enabled: false, port: automationPort }
      },
      null,
      2
    )
  )
  ;({ app, window } = await launchOstler({ dataDir, viewport: { width: 1600, height: 1200 } }))
  await expect(window.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/,
    { timeout: 20_000 }
  )
}

/** The titles of a project's planned tasks, or of those waiting in its To triage. */
function taskTitles(projectId: string, scope: 'planned' | 'triage' = 'planned'): Promise<string[]> {
  return window.evaluate(
    async ({ id, scope }) => {
      const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const items = await ostler.getPlanningWorkItems(id, scope === 'triage' ? 'triage' : undefined)
      if (!items.ok) throw new Error(items.error)
      return items.value.map((item) => item.title)
    },
    { id: projectId, scope }
  )
}

/** The local date `days` from today, as `YYYY-MM-DD`. */
function isoDay(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The toast stack: a toast's words are also in the live region, so look here. */
const notifications = () => window.getByRole('region', { name: 'Notifications' })

/** The toast that says `words`. */
const toast = (words: string | RegExp) =>
  notifications().getByRole('listitem').filter({ hasText: words })

/** Opens a project from the sidebar. */
async function openProject(name: string): Promise<void> {
  await window.getByRole('link', { name }).first().click()
  await expect(window.getByRole('tab', { name: 'Overview' })).toBeVisible()
}

test.afterEach(async () => {
  await app?.close()
  app = null
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('To triage: two quick captures, one accepted by keyboard, one moved and moved back', async () => {
  test.setTimeout(90_000)
  await launch([project('triage-house', 'House'), project('triage-garden', 'Garden')])

  // Triage new captures, in House's Project settings.
  await openProject('House')
  await window.getByRole('button', { name: 'More project actions' }).click()
  await window.getByRole('menuitem', { name: 'Project settings…' }).click()
  const settings = window.getByRole('dialog', { name: 'House settings' })
  // It saves at once, then shows on.
  await settings.getByRole('switch', { name: 'Triage new captures' }).click()
  await expect(settings.getByRole('switch', { name: 'Triage new captures' })).toBeChecked()
  await window.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  // Two quick captures into House wait in its To triage.
  for (const title of ['Fix the gate', 'Order the tiles']) {
    await window.keyboard.press('Control+Shift+N')
    const quickAdd = window.getByRole('dialog', { name: 'Quick add' })
    await quickAdd.getByLabel('Project').selectOption({ label: 'House' })
    const field = quickAdd.getByRole('textbox', { name: 'Quick add a task' })
    await field.fill(title)
    await field.press('Enter')
    await expect(quickAdd).toHaveCount(0)
    await expect(toast(`Added to To triage in House`).last()).toBeVisible()
  }
  await openProjectView(window, 'To triage')
  const list = window.getByRole('list', { name: 'To triage' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(window.getByText('2 tasks to triage')).toBeVisible()

  // A accepts the row in focus into the board; focus moves on to the next.
  const gate = list.getByRole('listitem', { name: /^Fix the gate, / })
  await gate.focus()
  await window.keyboard.press('a')
  await expect(toast('Accepted “Fix the gate”')).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  const tiles = list.getByRole('listitem', { name: /^Order the tiles, / })
  await expect(tiles).toBeFocused()

  // M moves it to Garden, which doesn't triage: it goes into Garden's Backlog.
  await window.keyboard.press('m')
  const move = window.getByRole('dialog', { name: 'Move “Order the tiles” to another project' })
  await move.getByLabel('Project').selectOption({ label: 'Garden' })
  await expect(
    move.getByText('That project doesn’t triage new captures, so it goes into its Backlog')
  ).toBeVisible()
  await move.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(move).toHaveCount(0)
  const moved = toast('Moved “Order the tiles” to Garden’s Backlog')
  await expect(moved).toBeVisible()
  await expect(window.getByText('Nothing to triage')).toBeVisible()
  await expect.poll(() => taskTitles('triage-garden')).toEqual(['Order the tiles'])

  // Undo brings it back to House's To triage, and Garden is empty again.
  await moved.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => taskTitles('triage-garden')).toEqual([])
  await expect.poll(() => taskTitles('triage-house', 'triage')).toEqual(['Order the tiles'])
  await expect(list.getByRole('listitem', { name: /^Order the tiles, / })).toBeVisible()

  // The accepted one is on House's board, in the Backlog; the other still waits.
  const planned = await window.evaluate(async (id) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await ostler.getPlanningWorkItems(id)
    if (!items.ok) throw new Error(items.error)
    return items.value.map((item) => ({ title: item.title, status: item.status }))
  }, 'triage-house')
  expect(planned).toEqual([{ title: 'Fix the gate', status: 'backlog' }])
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(window.locator('.task-card', { hasText: 'Fix the gate' })).toBeVisible()
  await expect(window.locator('.task-card', { hasText: 'Order the tiles' })).toHaveCount(0)
})

test('Goals: a goal of my own with a unit, summing the project goals that count towards it', async () => {
  test.setTimeout(90_000)
  await launch([project('goals-choir', 'Choir'), project('goals-band', 'Band')])
  // Two project goals in members, each with a check-in.
  await window.evaluate(
    async ({ start, target, today }) => {
      const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (const [projectId, title, goal, value] of [
        ['goals-choir', 'Grow the choir', 40, 12],
        ['goals-band', 'Grow the band', 20, 5]
      ] as const) {
        const made = await ostler.createPlanningGoal(projectId, {
          title,
          measure: {
            unit: 'members',
            startValue: 0,
            targetValue: goal,
            startDate: start,
            targetDate: target,
            direction: 'up'
          }
        })
        if (!made.ok) throw new Error(made.error)
        const checked = await ostler.recordGoalCheckIn(made.value.id, { date: today, value })
        if (!checked.ok) throw new Error(checked.error)
      }
    },
    { start: isoDay(-30), target: isoDay(60), today: isoDay(0) }
  )

  // Goals, from the command palette.
  await window.keyboard.press('Control+K')
  await window.getByRole('combobox', { name: 'Command palette search' }).fill('Goals')
  await window
    .getByRole('option', { name: /^Goals/ })
    .first()
    .click()
  await expect(window.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible()

  // A new goal, then its measure in members.
  await window.getByRole('button', { name: 'New goal' }).first().click()
  const newGoal = window.getByRole('dialog', { name: 'New goal' })
  await newGoal.getByRole('textbox', { name: 'Title' }).fill('Grow my music groups')
  await newGoal.getByRole('button', { name: 'Add goal' }).click()
  await expect(newGoal).toHaveCount(0)
  const card = window.getByRole('article', { name: 'Grow my music groups' })
  await card.getByRole('button', { name: 'Add a measure' }).click()
  const measure = window.getByRole('dialog', { name: 'Measure for Grow my music groups' })
  await measure.getByRole('textbox', { name: 'Unit' }).fill('members')
  await measure.getByRole('textbox', { name: 'Target', exact: true }).fill('100')
  await measure.getByRole('button', { name: 'Save measure' }).click()
  await expect(measure).toHaveCount(0)
  await expect(card).toContainText('0 of 100 members')
  await expect(card).toContainText('No project goals count towards it.')

  // Link the choir's goal: the number is its latest value.
  await card.getByRole('button', { name: 'Actions for Grow my music groups' }).click()
  await window.getByRole('menuitem', { name: 'Add a project goal' }).click()
  let pick = window.getByRole('dialog', { name: 'Add a project goal to Grow my music groups' })
  await pick.getByLabel('Project goal').selectOption({ label: 'Grow the choir · Choir' })
  await pick.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(pick).toHaveCount(0)
  await expect(toast('Grow the choir now counts towards Grow my music groups')).toBeVisible()
  await expect(card).toContainText('12 of 100 members')
  await expect(card).toContainText('The number is the sum of 1 project goal’s latest value.')

  // And the band's: the number is the sum of both.
  await card.getByRole('button', { name: 'Actions for Grow my music groups' }).click()
  await window.getByRole('menuitem', { name: 'Add a project goal' }).click()
  pick = window.getByRole('dialog', { name: 'Add a project goal to Grow my music groups' })
  await pick.getByLabel('Project goal').selectOption({ label: 'Grow the band · Band' })
  await pick.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(pick).toHaveCount(0)
  await expect(card).toContainText('17 of 100 members')
  await expect(card).toContainText('The number is the sum of 2 project goals’ latest values.')
  const links = card.getByRole('region', { name: 'Project goals that count towards it' })
  await expect(links.getByRole('listitem')).toHaveCount(2)
  await expect(links).toContainText('Grow the choir')
  await expect(links).toContainText('12 members now')
  await expect(links).toContainText('Grow the band')
  await expect(links).toContainText('5 members now')
})

test('Countdowns: a pinned task with a due date counts down on Home', async () => {
  test.setTimeout(90_000)
  await launch([project('countdown-kitchen', 'Kitchen')])
  await window.evaluate(async (due) => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const made = await ostler.createPlanningWorkItem('countdown-kitchen', {
      title: 'Fit the worktop',
      status: 'ready',
      targetDate: due
    })
    if (!made.ok) throw new Error(made.error)
  }, isoDay(3))

  // Pin it to the sidebar from its drawer.
  await openProject('Kitchen')
  await window.getByRole('tab', { name: 'Board' }).click()
  await window.locator('.task-card', { hasText: 'Fit the worktop' }).click()
  const drawer = window.locator('.task-drawer')
  await drawer.getByRole('button', { name: 'Task actions' }).click()
  await window.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
  await expect(toast('Pinned Fit the worktop to the sidebar')).toBeVisible()
  await expect(
    window.getByRole('complementary', { name: 'Sidebar' }).getByText('Fit the worktop')
  ).toBeVisible()

  // Pinned and dated, its menu offers the countdown.
  await drawer.getByRole('button', { name: 'Task actions' }).click()
  await window.getByRole('menuitem', { name: 'Show as countdown' }).click()
  await expect(toast('Fit the worktop shows as a countdown')).toBeVisible()

  // Home counts down to it in words.
  await window.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await window.getByRole('link', { name: 'Home' }).click()
  const countdowns = window.getByRole('region', { name: 'Countdowns' })
  await expect(countdowns).toBeVisible()
  await expect(countdowns.getByText('3 days to Fit the worktop', { exact: true })).toBeVisible()
  const open = countdowns.getByRole('button', {
    name: /^Open Fit the worktop, 3 days to Fit the worktop, /
  })
  await expect(open).toBeVisible()

  // It opens the task.
  await open.click()
  await expect(window.getByRole('textbox', { name: 'Title' })).toHaveValue('Fit the worktop')
})

test('Shopping list: two items with prices, one bought, and the Budget card follows', async () => {
  test.setTimeout(90_000)
  await launch([project('shopping-bathroom', 'Bathroom')])
  // A budget of £200, in pounds.
  await window.evaluate(async () => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const set = await ostler.setBudget('shopping-bathroom', { amount: 20000, currency: 'GBP' })
    if (!set.ok) throw new Error(set.error)
  })
  await openProject('Bathroom')

  /** The Overview's Budget card: each number by its term, and the still-to-buy line. */
  const budget = () => window.locator('.budget-card')
  const number = (term: string) =>
    budget()
      .locator('dl > div')
      .filter({ has: window.getByRole('term').filter({ hasText: term }) })
      .getByRole('definition')
  await expect(number('Paid')).toHaveText('£0.00')
  await expect(number('Left')).toHaveText('£200.00')

  // Two items, each read from one line with its price.
  await openProjectView(window, 'Shopping list')
  const shopping = window.getByRole('region', { name: 'Shopping list' })
  const add = shopping.getByRole('textbox', { name: 'Add item' })
  for (const line of ['2 tins paint £18', 'wall plugs £4.50']) {
    await add.fill(line)
    await add.press('Enter')
    await expect(add).toHaveValue('')
  }
  await expect(shopping.getByRole('listitem', { name: '2 tins paint, £18.00' })).toBeVisible()
  await expect(shopping.getByRole('listitem', { name: '1 wall plugs, £4.50' })).toBeVisible()
  await expect(shopping.getByText('Still to buy: £22.50 (estimated)')).toBeVisible()

  // The Budget card says what is still to buy, apart from what is paid.
  await window.getByRole('tab', { name: 'Overview' }).click()
  await expect(budget().getByText('Still to buy: £22.50 (estimated)')).toBeVisible()
  await expect(number('Paid')).toHaveText('£0.00')

  // Tick the wall plugs as bought, at their estimate.
  await openProjectView(window, 'Shopping list')
  await shopping.getByRole('checkbox', { name: 'Bought wall plugs' }).click()
  const buy = window.getByRole('dialog', { name: 'Bought wall plugs' })
  await expect(buy.getByRole('textbox', { name: 'Price paid (GBP)' })).toHaveValue('4.50')
  await buy.getByRole('button', { name: 'Tick as bought' }).click()
  await expect(buy).toHaveCount(0)
  await expect(toast('Bought: wall plugs')).toBeVisible()
  await expect(shopping.getByText('Still to buy: £18.00 (estimated)')).toBeVisible()
  await expect(shopping.getByRole('button', { name: 'Bought (1)' })).toBeVisible()

  // The Budget card's lines change: paid, left and still to buy.
  await window.getByRole('tab', { name: 'Overview' }).click()
  await expect(budget().getByText('Still to buy: £18.00 (estimated)')).toBeVisible()
  await expect(number('Paid')).toHaveText('£4.50')
  await expect(number('Left')).toHaveText('£195.50')
})

test('Weekly review: opened from Home, stepped through and finished', async () => {
  test.setTimeout(90_000)
  await launch([project('review-studio', 'Studio')])
  await window.evaluate(
    async ({ overdue, soon }) => {
      const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      for (const [title, targetDate] of [
        ['Send the invoice', overdue],
        ['Book the van', soon]
      ]) {
        const made = await ostler.createPlanningWorkItem('review-studio', {
          title,
          status: 'ready',
          targetDate
        })
        if (!made.ok) throw new Error(made.error)
      }
    },
    { overdue: isoDay(-2), soon: isoDay(2) }
  )

  // Home offers the review, with none done yet.
  await window.getByRole('link', { name: 'Home' }).click()
  await expect(window.getByText('No review yet')).toBeVisible()
  await window.getByRole('button', { name: 'Weekly review' }).click()
  await expect(window.getByRole('heading', { level: 1, name: 'Weekly review' })).toBeVisible()
  const steps = window.getByRole('list', { name: 'Steps' })
  const step = window.getByRole('main').getByRole('heading', { level: 2 })
  const next = window.getByRole('button', { name: 'Next' })

  // 1 Inbox.
  await expect(window.getByText('Step 1 of 7')).toBeVisible()
  await expect(steps.locator('[aria-current="step"]')).toHaveText('Inbox')
  await next.click()

  // 2 Overdue: the invoice, parked in Someday.
  await expect(window.getByText('Step 2 of 7')).toBeVisible()
  await expect(step).toHaveText('Overdue (1)')
  await window
    .getByRole('group', { name: 'Actions for Send the invoice' })
    .getByRole('button', { name: 'Someday' })
    .click()
  await expect(toast('Moved “Send the invoice” to Someday')).toBeVisible()
  await expect(step).toHaveText('Overdue (0)')
  await expect(window.getByText('Nothing here')).toBeVisible()
  await next.click()

  // 3 Blocked: skipped.
  await expect(step).toHaveText('Blocked for more than three days (0)')
  await window.getByRole('button', { name: 'Skip' }).click()

  // 4 Nothing changed in 14 days.
  await expect(window.getByText('Step 4 of 7')).toBeVisible()
  await next.click()

  // 5 Someday: the invoice is there now; keep it.
  await expect(step).toHaveText('Someday (1)')
  await window
    .getByRole('group', { name: 'Actions for Send the invoice' })
    .getByRole('button', { name: 'Keep' })
    .click()
  await expect(toast('Kept “Send the invoice” in Someday')).toBeVisible()
  await expect(step).toHaveText('Someday (0)')
  await next.click()

  // 6 The next two weeks: the van.
  await expect(step).toHaveText('The next two weeks (1)')
  await expect(window.getByText('Book the van')).toBeVisible()
  await next.click()

  // 7 Milestones at risk, the last: Finish review.
  await expect(window.getByText('Step 7 of 7')).toBeVisible()
  await expect(next).toHaveCount(0)
  await window.getByRole('button', { name: 'Finish review' }).click()
  await expect(toast('Review finished')).toBeVisible()
  await expect(window.getByText(/^Last review: /)).toBeVisible()

  // The record holds what each step showed and changed; the skipped step is left out.
  const record = await window.evaluate(async () => {
    const ostler = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const last = await ostler.getLastWeeklyReview()
    if (!last.ok) throw new Error(last.error)
    return last.value
  })
  expect(record?.steps).toMatchObject({
    overdue: { shown: 1, changed: 1 },
    stale: { shown: 0, changed: 0 },
    someday: { shown: 1, changed: 0 },
    upcoming: { shown: 1, changed: 0 },
    milestones: { shown: 0, changed: 0 }
  })
  expect(record?.steps.blocked).toBeUndefined()
})
