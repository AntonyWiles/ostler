import { expect, test, type Locator, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { OstlerAPI, WatchedProject } from '../../src/shared/ostler-api'
import {
  closeAudit,
  createSampleProject,
  launchForAudit,
  openPath,
  startApp,
  type A11yApp
} from './a11y-app'

/**
 * The keyboard walkthroughs (P9.2, docs/accessibility.md): each flow done
 * with the keyboard alone. Nothing here clicks or fills: focus moves with
 * Tab, Shift+Tab, arrows and the app's shortcuts, every stop is checked for
 * a visible focus indicator, and Tab never gets stuck.
 */

let target: A11yApp | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
})

type Api = OstlerAPI
async function api<T>(page: Page, call: (api: Api) => Promise<T>): Promise<T> {
  return page.evaluate((source) => {
    const ostler = (globalThis as unknown as { ostlerAPI: Api }).ostlerAPI
    return (0, eval)(source)(ostler)
  }, `(${call.toString()})`) as Promise<T>
}

/**
 * Whether the focused element shows a focus indicator: an outline or ring on
 * it, or on the part that draws it (a custom checkbox's box beside its hidden
 * input, a text field's frame around its input).
 */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    type Node = { nextElementSibling: Node | null; parentElement: Node | null }
    const win = globalThis as unknown as {
      document: { activeElement: Node | null }
      getComputedStyle(node: Node): {
        outlineStyle: string
        outlineWidth: string
        boxShadow: string
      }
    }
    const el = win.document.activeElement
    if (!el) return false
    const candidates = [
      el,
      el.nextElementSibling,
      el.parentElement,
      el.parentElement?.parentElement
    ]
    return candidates.some((node) => {
      if (!node) return false
      const style = win.getComputedStyle(node)
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      return outline || style.boxShadow !== 'none'
    })
  })
}

/**
 * Presses Tab (or Shift+Tab) until `locator` has focus, checking that every
 * stop on the way shows focus. Fails if it is not reached: unreachable, or
 * focus is trapped somewhere else.
 */
/**
 * Adds a part to the open task from "Add to this task", by keyboard: its own
 * button when the bar shows one, else from the bar's "more" menu.
 */
async function addPart(page: Page, drawer: Locator, name: string): Promise<void> {
  const bar = drawer.getByRole('group', { name: 'Add to this task' })
  const chip = bar.getByRole('button', { name, exact: true })
  if ((await chip.count()) > 0) {
    await tabTo(page, chip)
    await page.keyboard.press('Enter')
    return
  }
  await tabTo(page, bar.getByRole('button', { name: /more$/ }))
  await page.keyboard.press('Enter')
  const item = page.getByRole('menuitem', { name })
  await expect(async () => {
    await page.keyboard.press('ArrowDown')
    await expect(item).toBeFocused({ timeout: 200 })
  }).toPass()
  await page.keyboard.press('Enter')
}

async function tabTo(page: Page, locator: Locator, options: { back?: boolean; max?: number } = {}) {
  const max = options.max ?? 120
  for (let presses = 0; presses <= max; presses++) {
    if (
      await locator.evaluate(
        (node) =>
          node ===
          (node as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement
      )
    ) {
      expect(await focusIsVisible(page), 'focus is visible on the target').toBe(true)
      return
    }
    await page.keyboard.press(options.back ? 'Shift+Tab' : 'Tab')
    const focused = await page.evaluate(() => {
      const el = (
        globalThis as unknown as {
          document: {
            activeElement: {
              tagName: string
              className: string
              getAttribute(name: string): string | null
            } | null
          }
        }
      ).document.activeElement
      return el
        ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.getAttribute('aria-label') ?? ''}"`
        : 'nothing'
    })
    if (focused.startsWith('body')) continue
    expect(await focusIsVisible(page), `focus is visible on ${focused}`).toBe(true)
  }
  throw new Error(`Not reached with ${options.back ? 'Shift+Tab' : 'Tab'}: ${locator}`)
}

/**
 * Types an ISO date into a native date field, in the segment order Windows'
 * regional format gives it. Elsewhere Chromium orders it by the UI locale.
 */
async function typeDate(page: Page, iso: string) {
  const [year, month, day] = iso.split('-')
  const locale = await target!.app.evaluate(({ app }) =>
    process.platform === 'win32' ? app.getSystemLocale() : app.getLocale()
  )
  const order = new Intl.DateTimeFormat(locale)
    .formatToParts(new Date(2026, 10, 2))
    .map((part) => part.type)
    .filter((type) => type === 'year' || type === 'month' || type === 'day')
  const parts: Record<string, string> = { year, month, day }
  await page.keyboard.type(order.map((type) => parts[type]).join(''))
}

async function start(options: { agents?: boolean } = {}) {
  target = await launchForAudit({ theme: 'light', agents: options.agents })
  await target.page.locator('main').first().waitFor()
  return target.page
}

test('creates a project, adds a task and edits every field in the drawer, by keyboard', async () => {
  test.setTimeout(120_000)
  const page = await start()

  // Skip to content is the first stop.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()

  // A new project, through the wizard.
  await tabTo(page, page.getByRole('button', { name: 'New project', exact: true }))
  await page.keyboard.press('Enter')
  const wizard = page.getByRole('dialog', { name: 'New project' })
  await expect(wizard).toBeVisible()
  await tabTo(page, wizard.getByRole('button', { name: 'Next' }))
  await page.keyboard.press('Enter')
  await tabTo(page, wizard.getByRole('button', { name: 'Next' }))
  await page.keyboard.press('Enter')
  await tabTo(page, wizard.getByRole('textbox', { name: 'Project name' }), { back: true })
  await page.keyboard.type('Keyboard project')
  await tabTo(page, wizard.getByRole('button', { name: 'Create project' }))
  await page.keyboard.press('Enter')
  const done = page.getByRole('dialog', { name: 'Keyboard project' })
  await tabTo(page, done.getByRole('button', { name: 'Open project' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Keyboard project', level: 1 })).toBeVisible()
  // After the page change, focus is on the new page's heading.
  await expect(page.getByRole('heading', { name: 'Keyboard project', level: 1 })).toBeFocused()

  // A task, from the header's New task button. (Ctrl+N opens Quick add,
  // which adds the task but leaves an open Board stale: see the P9.2 notes.)
  await tabTo(page, page.getByRole('button', { name: 'New task' }).first())
  await page.keyboard.press('Enter')
  const newTask = page.getByRole('dialog', { name: 'New task' })
  await expect(newTask.getByRole('textbox', { name: 'Title' })).toBeFocused()
  await page.keyboard.type('Keyboard task')
  await tabTo(page, newTask.getByRole('button', { name: 'Create' }))
  await page.keyboard.press('Enter')
  await expect(newTask).toBeHidden()

  // Open it from the Board: j moves to the first card, Enter opens it.
  await page.keyboard.press('Control+2')
  await expect(page.getByRole('tab', { name: 'Board', selected: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Keyboard task' })).toBeVisible()
  // The Board takes keys once its tasks have loaded; j again if it was early.
  await expect(async () => {
    await page.keyboard.press('j')
    await expect(page.getByRole('article', { name: 'Keyboard task' })).toBeFocused({
      timeout: 1000
    })
  }).toPass()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: 'Keyboard task' })
  await expect(drawer).toBeVisible()

  // Every field, in order.
  await tabTo(page, drawer.getByRole('combobox', { name: 'Status' }), { back: true })
  await page.keyboard.press('ArrowDown') // Ready
  await tabTo(page, drawer.getByRole('textbox', { name: 'Title' }))
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  await tabTo(page, drawer.getByRole('button', { name: 'Assign to me' }))
  await page.keyboard.press('Enter')
  await tabTo(page, drawer.getByRole('combobox', { name: 'Priority' }))
  await page.keyboard.press('ArrowDown') // High
  await tabTo(page, drawer.getByRole('textbox', { name: 'Due date' }))
  await typeDate(page, '2026-11-06')
  // The rest come from "Add to this task", each taking focus once added.
  await addPart(page, drawer, 'Start date')
  await expect(drawer.getByRole('textbox', { name: 'Start date' })).toBeFocused()
  await typeDate(page, '2026-11-02')
  await addPart(page, drawer, 'Estimate')
  await expect(drawer.getByRole('spinbutton', { name: 'Estimate' })).toBeFocused()
  await page.keyboard.type('3')
  await addPart(page, drawer, 'Labels')
  await expect(drawer.getByRole('combobox', { name: 'Add a label' })).toBeFocused()
  await page.keyboard.type('keys')
  await page.keyboard.press('Enter')
  await tabTo(page, drawer.getByRole('textbox', { name: 'Description' }))
  await page.keyboard.type('Done by keyboard.')
  await tabTo(page, drawer.getByRole('button', { name: 'Add item' }))
  await page.keyboard.press('Enter')
  // The new item takes focus once it has rendered: keys typed before then went
  // to the button, and the item's text began part-way through.
  await expect(drawer.getByRole('textbox', { name: 'Checklist item 1' })).toBeFocused()
  await page.keyboard.type('Checked by keyboard')
  await page.keyboard.press('Enter')
  // Escape closes the drawer, and closing saves whatever is still typed (D30).
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  // Focus goes back to the card the drawer was opened from.
  await expect(page.getByRole('article', { name: 'Keyboard task edited' })).toBeFocused()

  const saved = await api(page, async (ostler) => {
    const projects = await ostler.getConfig()
    if (!projects.ok) return null
    const project = projects.value.projects.find((entry) => entry.name === 'Keyboard project')!
    const items = await ostler.getPlanningWorkItems(project.id)
    return items.ok ? items.value[0] : null
  })
  expect(saved).toMatchObject({
    title: 'Keyboard task edited',
    status: 'ready',
    priority: 'high',
    assigneeId: expect.any(String),
    startDate: '2026-11-02',
    targetDate: '2026-11-06',
    estimate: 3,
    labels: ['keys'],
    description: 'Done by keyboard.'
  })
  expect(saved?.acceptanceCriteria).toContain('Checked by keyboard')
})

/** Presses `key` until the focused menu item's name matches `name`. */
async function arrowToMenuItem(page: Page, name: RegExp, key = 'ArrowDown') {
  for (let presses = 0; presses < 40; presses++) {
    const focused = page.locator('[role="menuitem"]:focus')
    if ((await focused.count()) > 0 && name.test((await focused.innerText()).trim())) return
    await page.keyboard.press(key)
  }
  throw new Error(`No menu item matches ${name}`)
}

test('moves a card to another column from its menu, by keyboard', async () => {
  test.setTimeout(120_000)
  const page = await start()
  const { projectId } = await createSampleProject(page)
  await openPath(page, `/projects/${projectId}/board`)
  await tabTo(page, page.getByRole('tab', { name: 'Board' }))
  await page.keyboard.press('j')
  const card = page.locator('.task-card.is-cursor')
  await expect(card).toBeFocused()
  const title = (await card.getAttribute('aria-label'))!

  // Shift+F10 opens the card's menu; Move to › In progress.
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await arrowToMenuItem(page, /^In progress/)
  await page.keyboard.press('Enter')
  const column = page.getByRole('region', { name: 'In progress' })
  await expect(column.getByRole('article', { name: title })).toBeVisible()
  // Focus stays with the card, in its new column.
  await expect(column.getByRole('article', { name: title })).toBeFocused()
})

/** The sample project's task with this title, as stored. */
async function storedTask(page: Page, projectId: string, title: string) {
  return api(
    page,
    new Function(
      'ostler',
      `return ostler.getPlanningWorkItems(${JSON.stringify(projectId)}).then((r) => r.ok ? r.value.find((i) => i.title === ${JSON.stringify(title)}) : null)`
    ) as (
      ostler: Api
    ) => Promise<{ title: string; targetDate: string | null; startDate: string | null } | null>
  )
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test('edits in place in List, reschedules in Calendar and moves a bar in Timeline, by keyboard', async () => {
  test.setTimeout(120_000)
  const page = await start()
  const { projectId } = await createSampleProject(page)

  // List: Tab into the grid, down to a task, E edits its title in place.
  await openPath(page, `/projects/${projectId}/list`)
  await tabTo(page, page.locator('[role="grid"] [tabindex="0"]').first())
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  const titleCell = page.locator('[role="gridcell"]:focus')
  await expect(titleCell).toBeFocused()
  const before = (await titleCell.innerText()).trim()
  await page.keyboard.press('e')
  const editor = page.getByRole('textbox', { name: /title/i })
  await expect(editor).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.type(' (list)')
  await page.keyboard.press('Enter')
  await expect.poll(() => storedTask(page, projectId, `${before} (list)`)).not.toBeNull()

  // Calendar: Tab into the month, arrow to a day with a task, Tab to the
  // task, and Alt+Right moves it a day later.
  await openPath(page, `/projects/${projectId}/calendar`)
  await tabTo(page, page.locator('[role="gridcell"][tabindex="0"]'))
  const chip = page.locator('.calendar-chip[tabindex="0"]').first()
  for (let day = 0; day < 40 && (await chip.count()) === 0; day++) {
    await page.keyboard.press('ArrowRight')
  }
  await tabTo(page, chip)
  const chipName = (await chip.getAttribute('aria-label'))!
  const chipTitle = chipName.split(',')[0]
  const chipBefore = (await storedTask(page, projectId, chipTitle))!.targetDate!
  await page.keyboard.press('Alt+ArrowRight')
  await expect
    .poll(async () => (await storedTask(page, projectId, chipTitle))?.targetDate)
    .toBe(shiftIso(chipBefore, 1))

  // Timeline: Tab to a bar, Alt+Right moves it a day later.
  await openPath(page, `/projects/${projectId}/timeline`)
  const bar = page
    .locator('.ui-timeline [role="button"][aria-label]:not([aria-label^="Milestone"])')
    .first()
  await tabTo(page, bar)
  const barTitle = (await bar.getAttribute('aria-label'))!.split(',')[0]
  const barBefore = (await storedTask(page, projectId, barTitle))!.targetDate!
  await page.keyboard.press('Alt+ArrowRight')
  await expect
    .poll(async () => (await storedTask(page, projectId, barTitle))?.targetDate)
    .toBe(shiftIso(barBefore, 1))
})

test('searches and opens a result, and saves a view, by keyboard', async () => {
  test.setTimeout(120_000)
  const page = await start()
  const { projectId } = await createSampleProject(page)
  await openPath(page, `/projects/${projectId}/board`)

  // Ctrl+K, type, Enter opens the task.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('Buy the picnic food')
  await expect(palette.getByRole('option', { name: /Buy the picnic food/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: 'Buy the picnic food' })
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // Search the Board, then Views › Save view… names and saves it.
  await tabTo(page, page.getByRole('searchbox', { name: 'Search tasks' }))
  await page.keyboard.type('party')
  await tabTo(page, page.getByRole('button', { name: /^Views:/ }), { back: true })
  await page.keyboard.press('Enter')
  await arrowToMenuItem(page, /^Save view/)
  await page.keyboard.press('Enter')
  const save = page.getByRole('dialog', { name: 'Save view' })
  await expect(save.getByRole('textbox', { name: 'Name' })).toBeFocused()
  await page.keyboard.type('Party tasks')
  await page.keyboard.press('Enter')
  await expect(save).toBeHidden()
  await expect(page.getByRole('button', { name: 'Views: Party tasks' })).toBeVisible()
})

test('changes a setting, backs up and restores, by keyboard', async () => {
  test.setTimeout(120_000)
  let page = await start()

  // Ctrl+, opens Settings › General; Enter opens Appearance in place, and
  // the theme radios take the arrow keys.
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('heading', { name: 'General', level: 2 })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Appearance' }))
  await page.keyboard.press('Enter')
  await tabTo(page, page.getByRole('radio', { name: 'Light' }))
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // Settings › Data: Back up now.
  await tabTo(page, page.getByRole('link', { name: 'Data' }), { back: true })
  await page.keyboard.press('Enter')
  const restore = page.getByRole('button', { name: /^Restore backup from/ }).first()
  await tabTo(page, page.getByRole('button', { name: 'Back up now' }))
  await page.keyboard.press('Enter')
  await expect(restore).toBeVisible()

  // Something made after the backup, which the restore takes away.
  await api(page, (ostler) =>
    ostler.createProject({ name: 'After the backup', color: '', tags: [], notes: '', folder: null })
  )

  // Restore it: the confirmation, then Ostler restarts. The test starts it
  // again itself, on the same data folder, where the restore is applied.
  await target!.app.evaluate(({ app }) => {
    app.relaunch = () => {}
  })
  await tabTo(page, restore)
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('alertdialog', { name: /Restore the backup/ })
  await expect(confirm).toBeVisible()
  await tabTo(page, confirm.getByRole('button', { name: 'Restore backup' }))
  const closed = new Promise<void>((resolve) => target!.app.once('close', () => resolve()))
  await page.keyboard.press('Enter')
  await closed

  target = await startApp(target!.dataDir)
  page = target.page
  await page.locator('main').first().waitFor()
  const names = await api(page, async (ostler) => {
    const config = await ostler.getConfig()
    return config.ok ? config.value.projects.map((project) => project.name) : null
  })
  expect(names).not.toContain('After the backup')
  // The setting changed before the backup came back with it.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('builds a whiteboard by keyboard', async () => {
  test.setTimeout(120_000)
  const page = await start()
  const { projectId } = await createSampleProject(page)
  await openPath(page, `/projects/${projectId}/plan`)

  // Plan › Whiteboards › New whiteboard › Blank › Create.
  const pane = page.getByRole('button', { name: /^Whiteboards/ })
  await tabTo(page, pane)
  await page.keyboard.press('Enter')
  await expect(pane).toBeFocused()
  await tabTo(page, page.getByRole('button', { name: 'New whiteboard' }))
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'New whiteboard' })
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused()
  await tabTo(page, dialog.getByRole('radio', { name: 'Blank' }))
  await expect(dialog.getByRole('radio', { name: 'Blank' })).toBeChecked()
  await tabTo(page, dialog.getByRole('button', { name: 'Create' }))
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  // The board opens with focus on its title, where a new page puts it.
  await expect(page.getByRole('heading', { name: 'Whiteboard 1' })).toBeFocused()

  // The empty board is one Tab stop; N, Enter places a note and opens its words.
  const board = page.getByRole('group', { name: 'Whiteboard: Whiteboard 1' })
  const object = (name: string | RegExp) =>
    board.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name })
  await tabTo(page, board)
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused()
  await page.keyboard.type('Call the venue')
  await page.keyboard.press('Control+Enter')
  const note = object('Note: Call the venue')
  await expect(note).toBeFocused()

  // S, Enter: a rectangle, moved aside with Shift and the arrows.
  await page.keyboard.press('s')
  await page.keyboard.press('Enter')
  const shape = object('Rectangle')
  await expect(shape).toBeFocused()
  for (let step = 0; step < 30; step++) await page.keyboard.press('Shift+ArrowRight')
  await expect(shape).toBeFocused()

  // Connect to…: from the rectangle to the note.
  await page.keyboard.press('c')
  const connect = page.getByRole('dialog', { name: 'Connect to another object' })
  await expect(connect.getByRole('textbox', { name: 'Filter' })).toBeFocused()
  await page.keyboard.type('venue')
  await tabTo(page, connect.getByRole('radio', { name: 'Note: Call the venue' }))
  await page.keyboard.press('Space')
  await expect(connect.getByRole('radio', { name: 'Note: Call the venue' })).toBeChecked()
  await tabTo(page, connect.getByRole('button', { name: 'Connect' }))
  await page.keyboard.press('Enter')
  await expect(connect).toBeHidden()
  await expect(shape).toBeFocused()
  await expect(object('Arrow from Rectangle to Call the venue')).toHaveCount(1)

  // A mind map: B, Enter, a central idea, Tab for a child, Enter for the next idea.
  await page.keyboard.press('b')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Idea text' })).toBeFocused()
  await page.keyboard.type('Launch')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Idea text' })).toBeFocused()
  await page.keyboard.type('Venue')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Idea text' })).toBeFocused()
  await page.keyboard.type('Band')
  await page.keyboard.press('Escape')
  const band = object(/^Idea: Band, level 1, 2 of 2/)
  await expect(band).toBeFocused()

  // Along the map with the arrows.
  await page.keyboard.press('ArrowUp')
  await expect(object(/^Idea: Venue, level 1, 1 of 2/)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(object('Central idea: Launch, 2 branches')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(object(/^Idea: Venue, level 1, 1 of 2/)).toBeFocused()

  // K on the note: Make tasks. The note comes before the map in reading order.
  await tabTo(page, note, { back: true })
  await page.keyboard.press('k')
  const make = page.getByRole('dialog', { name: 'Make tasks' })
  await expect(make).toBeVisible()
  await tabTo(page, make.getByRole('button', { name: 'Make 1 task' }))
  await page.keyboard.press('Enter')
  await expect(make).toBeHidden()
  const linked = object(/^Note: Call the venue, linked to task Call the venue/)
  await expect(linked).toBeFocused()

  // Back to the plan: the Whiteboards pane, with the new board in it.
  await tabTo(page, page.getByRole('button', { name: 'Back to the plan' }), { back: true })
  await page.keyboard.press('Enter')
  const open = page.getByRole('button', { name: 'Open Whiteboard 1' })
  await expect(open).toBeVisible()
  await expect(open).toBeFocused()
})

test('reviews and accepts an agent run, by keyboard', async () => {
  test.setTimeout(120_000)
  // A scratch Git project for the agent to work in.
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-keyboard-agent-'))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# Scratch\n')
  git(projectDir, 'init', '-b', 'main')
  git(projectDir, 'config', 'user.email', 'keyboard@example.invalid')
  git(projectDir, 'config', 'user.name', 'Keyboard walkthrough')
  git(projectDir, 'add', 'README.md')
  git(projectDir, 'commit', '-m', 'Initial commit')
  const project: WatchedProject = {
    id: 'keyboard-agent-project',
    name: 'Agent project',
    path: projectDir,
    color: '#8b5cf6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  try {
    target = await launchForAudit({ theme: 'light', agents: true, projects: [project] })
    const page = target.page
    await page.locator('main').first().waitFor()

    // An agent run that changed a file and finished: what the harness records
    // when a real agent does the work.
    const run = await api(
      page,
      new Function(
        'ostler',
        `return (async () => {
          const task = await ostler.addHarnessTask('keyboard-agent-project', 'Add a changelog', 'Write CHANGELOG.md', 'medium')
          if (!task.ok) return task.error
          // Only a task whose copy is ready can start (simplify pass §2.1).
          for (let tries = 0; ; tries++) {
            const state = await ostler.getHarnessState('keyboard-agent-project')
            if (!state.ok) return state.error
            const copy = state.value.taskQueue.find((t) => t.id === task.value.id)?.copy
            if (copy?.state === 'ready') break
            if (copy?.state === 'failed') return copy.failure ?? 'The copy failed'
            if (tries > 200) return 'The copy never became ready'
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const session = await ostler.startHarnessTaskSession('keyboard-agent-project', task.value.id)
          if (!session.ok) return session.error
          return { taskId: task.value.id, sessionId: session.value.id, worktree: session.value.workspace.worktreePath }
        })()`
      ) as (
        ostler: Api
      ) => Promise<{ taskId: string; sessionId: string; worktree: string } | string>
    )
    if (typeof run === 'string') throw new Error(run)
    fs.writeFileSync(path.join(run.worktree, 'CHANGELOG.md'), '# Changelog\n')
    git(run.worktree, 'add', 'CHANGELOG.md')
    git(
      run.worktree,
      '-c',
      'user.email=agent@example.invalid',
      '-c',
      'user.name=Agent',
      'commit',
      '-m',
      'Add a changelog'
    )
    const finished = await api(
      page,
      new Function(
        'ostler',
        `return (async () => {
          const task = await ostler.updateHarnessTask('keyboard-agent-project', ${JSON.stringify(run.taskId)}, 'complete', ${JSON.stringify(run.sessionId)})
          if (!task.ok) return task.error
          const session = await ostler.updateHarnessSession('keyboard-agent-project', ${JSON.stringify(run.sessionId)}, 'Added CHANGELOG.md', true)
          return session.ok || session.error
        })()`
      ) as (ostler: Api) => Promise<true | string>
    )
    expect(finished).toBe(true)

    // The project's Agents view: Review…, then Apply.
    await openPath(page, `/projects/${project.id}/agents`)
    const review = page.getByRole('button', { name: 'Review…' }).first()
    await tabTo(page, review)
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: /Add a changelog/ })
    await expect(dialog).toBeVisible()
    const accept = dialog.getByRole('button', { name: 'Apply', exact: true })
    await expect(accept).toBeEnabled()
    await tabTo(page, accept)
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    // Applied: nothing is left to review. (The work goes into the project folder
    // as one History entry, which can be undone.)
    await expect(page.getByRole('button', { name: 'Review…' })).toHaveCount(0)
    await expect(page.getByText('Nothing to review right now.', { exact: false })).toBeVisible()
  } finally {
    if (target) await closeAudit(target)
    target = null
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})
