import { expect, test, type Locator, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import type { OstlerAPI, WatchedProject } from '../../src/shared/ostler-api'
import {
  audit,
  closeAudit,
  createSampleProject,
  describeFindings,
  launchForAudit,
  openPath,
  openSettingsGroups,
  registeredIds,
  startApp,
  type A11yApp,
  type Finding
} from './a11y-app'

/**
 * The accessibility audit (P9.2, docs/accessibility.md): axe-core over every
 * registered view, every settings section, the main dialogs and the welcome,
 * on the sample project, in light, dark and Windows forced colours. A serious
 * or critical WCAG 2.2 A/AA violation fails the run.
 *
 * The views come from the navigation registry, so a new view is audited
 * without touching this file.
 */

/** Light, dark and forced colours, plus Compact, where targets are smallest (WCAG 2.5.8). */
type Mode = 'light' | 'dark' | 'forced' | 'compact'
const MODES: Mode[] = ['light', 'dark', 'forced', 'compact']

/**
 * Light runs in a full-HD window, the others in the usual 1280 × 800: a box
 * that scrolls by a little while a big window has room to show all of it
 * (audit's needless-scroll) only shows in a big window.
 */
const BIG_WINDOW = { width: 1920, height: 1080 }

let target: A11yApp | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
})

async function start(mode: Mode, options: { fresh?: boolean; agents?: boolean } = {}) {
  target = await launchForAudit({
    theme: mode === 'dark' ? 'dark' : 'light',
    density: mode === 'compact' ? 'compact' : 'comfortable',
    ...(mode === 'light' ? { viewport: BIG_WINDOW } : {}),
    ...options
  })
  if (mode === 'forced') await target.page.emulateMedia({ forcedColors: 'active' })
  return target.page
}

/** Opens a dialog with `open`, audits it, then closes it with Escape. */
async function auditDialog(
  page: Page,
  name: string | RegExp,
  where: string,
  open: () => Promise<void>,
  role: 'dialog' | 'alertdialog' = 'dialog',
  sections?: string
): Promise<Finding[]> {
  await open()
  const dialog = page.getByRole(role, { name })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(300)
  const findings = await audit(page, where)
  // A dialog in sections shows one at a time: each is audited in turn.
  if (sections) {
    const tabs = dialog.getByRole('tablist', { name: sections }).getByRole('tab')
    for (let index = 1; index < (await tabs.count()); index++) {
      const tab = tabs.nth(index)
      await tab.click()
      await page.waitForTimeout(300)
      findings.push(...(await audit(page, `${where} › ${await tab.textContent()}`)))
    }
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return findings
}

/**
 * auditDialog for a dialog opened from `opener`, a button or the button of
 * the menu it is in: Escape closes it and focus is back on `opener`.
 */
async function auditDialogFrom(
  page: Page,
  opener: Locator,
  name: string | RegExp,
  where: string,
  open: () => Promise<void>,
  sections?: string
): Promise<Finding[]> {
  const findings = await auditDialog(page, name, where, open, 'dialog', sections)
  await expect(opener, `focus back after ${where}`).toBeFocused()
  return findings
}

for (const mode of MODES) {
  test(`every view, settings section and main dialog passes axe (${mode})`, async () => {
    test.setTimeout(300_000)
    const page = await start(mode, { agents: true })
    await page.locator('main').first().waitFor()
    const { projectId, taskId } = await createSampleProject(page)
    const findings: Finding[] = []

    const views = registeredIds()
    expect(views.project.length).toBeGreaterThan(10)
    expect(views.settings.length).toBeGreaterThan(5)
    for (const id of views.global) {
      if (id === 'agents') continue // A sidebar entry for a project's Agents view.
      await openPath(page, `/${id}`)
      findings.push(...(await audit(page, id)))
    }
    for (const id of views.project) {
      await openPath(page, `/projects/${projectId}/${id}`)
      findings.push(...(await audit(page, `project › ${id}`)))
    }
    // The Calendar's Year and Agenda (N3.1a), beside its default Month.
    await openPath(page, `/projects/${projectId}/calendar`)
    for (const period of ['Year', 'Agenda', 'Month']) {
      await page.getByRole('radio', { name: period }).click()
      if (period !== 'Month')
        findings.push(...(await audit(page, `project › calendar › ${period}`)))
    }
    for (const id of views.settings) {
      await openPath(page, `/settings/${id}`)
      await openSettingsGroups(page)
      findings.push(...(await audit(page, `settings › ${id}`)))
    }

    // The task drawer, from its own route.
    await openPath(page, `/projects/${projectId}/tasks/${taskId}`)
    await expect(page.getByRole('dialog').first()).toBeVisible()
    findings.push(...(await audit(page, 'task drawer')))

    await openPath(page, `/projects/${projectId}/board`)
    findings.push(
      ...(await auditDialog(page, 'New task', 'new task', async () => {
        await page.getByRole('button', { name: 'New task' }).first().click()
      }))
    )
    findings.push(
      ...(await auditDialog(page, /Quick add/, 'quick add', async () => {
        await page.keyboard.press('Control+Shift+N')
      }))
    )
    findings.push(
      ...(await auditDialog(page, 'Keyboard shortcuts', 'shortcut overlay', async () => {
        await page
          .locator(':focus')
          .evaluateAll((nodes) =>
            nodes.forEach((node) => (node as unknown as { blur(): void }).blur())
          )
        await page.keyboard.press('?')
      }))
    )
    findings.push(
      ...(await auditDialog(page, /Import/, 'import', async () => {
        await page.getByRole('button', { name: 'More project actions' }).click()
        await page.getByRole('menuitem', { name: 'Import tasks…' }).click()
      }))
    )

    await openPath(page, '/settings/data')
    findings.push(
      ...(await auditDialog(
        page,
        /Delete activity older/,
        'confirm',
        async () => {
          await page.getByRole('button', { name: 'Delete old activity…' }).click()
        },
        'alertdialog'
      ))
    )
    await openPath(page, '/settings/ai')
    findings.push(
      ...(await auditDialog(page, 'Set up Ostler AI', 'AI setup', async () => {
        await page.getByRole('button', { name: 'Set up AI' }).click()
      }))
    )
    // The New project wizard's last step, with the icon grid.
    findings.push(
      ...(await auditDialog(page, 'New project', 'new project › name and colour', async () => {
        await page.getByRole('button', { name: 'New project', exact: true }).click()
        const wizard = page.getByRole('dialog', { name: 'New project' })
        await wizard.getByRole('radio', { name: /^Blank/ }).check()
        await wizard.getByRole('button', { name: 'Next' }).click()
        await wizard.getByRole('radio', { name: /^Just in/ }).check()
        await wizard.getByRole('button', { name: 'Next' }).click()
        await expect(wizard.getByRole('textbox', { name: 'Project name' })).toBeVisible()
      }))
    )

    expect(findings, describeFindings(findings)).toEqual([])
  })

  test(`the welcome and agent setup pass axe (${mode})`, async () => {
    test.setTimeout(120_000)
    const page = await start(mode, { fresh: true })
    const findings: Finding[] = []
    await expect(page.getByRole('heading', { name: 'Welcome to Ostler' })).toBeVisible()
    findings.push(...(await audit(page, 'welcome › about you')))
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'How do you want to start?' })).toBeVisible()
    findings.push(...(await audit(page, 'welcome › start')))
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { name: 'Choose a template' })).toBeVisible()
    findings.push(...(await audit(page, 'welcome › template')))
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('heading', { name: 'A few optional extras' })).toBeVisible()
    findings.push(...(await audit(page, 'welcome › extras')))
    await page.getByRole('button', { name: 'Open the project' }).click()
    await expect(page.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible()

    await openPath(page, '/settings/agents')
    findings.push(
      ...(await auditDialog(page, 'Turn on AI agents', 'agent setup', async () => {
        await page.getByRole('switch', { name: 'Use AI agents for software projects' }).click()
      }))
    )
    expect(findings, describeFindings(findings)).toEqual([])
  })

  test(`the screens and dialogs added since, with something in them, pass axe (${mode})`, async () => {
    test.setTimeout(300_000)
    const token = randomBytes(24).toString('hex')
    target = await launchForAudit({
      theme: mode === 'dark' ? 'dark' : 'light',
      density: mode === 'compact' ? 'compact' : 'comfortable',
      agents: true,
      projects: [tokenProject(token)],
      ui: { showProgress: true },
      ...(mode === 'light' ? { viewport: BIG_WINDOW } : {})
    })
    if (mode === 'forced') await target.page.emulateMedia({ forcedColors: 'active' })
    const page = target.page
    await page.locator('main').first().waitFor()
    const { projectId } = await createSampleProject(page)
    const seeded = await seedNextPass(page, projectId)
    await addOutsideEvent(target.dataDir, token, seeded.today)
    const findings: Finding[] = []
    const visit = async (route: string, where: string) => {
      await openPath(page, route)
      findings.push(...(await audit(page, where)))
    }

    // Home with My day, a passed block, progress and a countdown.
    await visit('/home', 'home with my day')
    await expect(page.getByRole('region', { name: 'My day' })).toBeVisible()
    const button = (name: string) => page.getByRole('button', { name, exact: true }).first()
    for (const [opener, name, where] of [
      ['Change my day', 'Plan my day', 'plan my day'],
      ['Fill my day', 'Fill my day', 'fill my day'],
      ['Move them', 'Move passed blocks', 'move them']
    ] as const) {
      findings.push(
        ...(await auditDialogFrom(page, button(opener), name, where, () => button(opener).click()))
      )
    }

    // Global views with something in them.
    await visit('/weekly-review', 'weekly review')
    await visit('/goals', 'goals')
    await expect(page.getByText('Run ten kilometres').first()).toBeVisible()
    await visit('/contacts', 'contacts')
    await expect(page.getByText('Sam Builder').first()).toBeVisible()

    // A project's newer views, each holding what was made for it.
    const holding: Record<string, string> = {
      triage: 'Call the plumber',
      someday: 'A garden shed',
      matrix: seeded.taskTitle,
      costs: 'Paint',
      shopping: 'Brushes'
    }
    for (const [view, text] of Object.entries(holding)) {
      await openPath(page, `/projects/${projectId}/${view}`)
      await expect(page.getByText(text).first(), view).toBeVisible()
      findings.push(...(await audit(page, `project › ${view}`)))
    }

    // The Timeline with links between bars, compared with a baseline.
    await visit(`/projects/${projectId}/timeline`, 'timeline with links')
    await page.getByRole('combobox', { name: 'Compare with' }).selectOption({ label: 'Plan A' })
    await page.waitForTimeout(300)
    findings.push(...(await audit(page, 'timeline compared with a baseline')))

    // The Calendar's Week with blocks, an outside event and a day off; Year and Agenda.
    await openPath(page, `/projects/${projectId}/calendar`)
    for (const period of ['Week', 'Year', 'Agenda']) {
      await page.getByRole('radio', { name: period }).click()
      await page.waitForTimeout(300)
      if (period === 'Week') await expect(page.getByText('Team meeting').first()).toBeVisible()
      findings.push(...(await audit(page, `calendar › ${period} with blocks and days off`)))
    }
    await page.getByRole('radio', { name: 'Month' }).click()

    // Milestones: Repeat this round, Write release notes and Compare rounds.
    await openPath(page, `/projects/${projectId}/milestones`)
    findings.push(...(await audit(page, 'milestones with rounds')))
    const milestoneMenu = page
      .getByRole('button', { name: `More actions for ${seeded.milestoneName}` })
      .first()
    const fromMenu = (menu: Locator, item: string | RegExp) => async () => {
      await menu.click()
      await page.getByRole('menuitem', { name: item }).click()
    }
    findings.push(
      ...(await auditDialogFrom(
        page,
        milestoneMenu,
        'Repeat this round',
        'repeat this round',
        fromMenu(milestoneMenu, /Repeat this round|Change how it repeats/)
      )),
      ...(await auditDialogFrom(
        page,
        milestoneMenu,
        'Write release notes',
        'write release notes',
        fromMenu(milestoneMenu, 'Write release notes')
      ))
    )
    const compare = page.getByRole('button', {
      name: `Compare rounds of ${seeded.milestoneName}`
    })
    findings.push(
      ...(await auditDialogFrom(page, compare, /^Compare rounds/, 'compare rounds', () =>
        compare.click()
      ))
    )

    // The task drawer's newer dialogs.
    await openPath(page, `/projects/${projectId}/tasks/${seeded.taskId}`)
    await expect(page.getByRole('dialog').first()).toBeVisible()
    findings.push(...(await audit(page, 'task drawer with links, blocks and a type')))
    const taskMenu = page.getByRole('button', { name: 'Task actions' })
    findings.push(
      ...(await auditDialogFrom(
        page,
        taskMenu,
        /^Block time for/,
        'block time',
        fromMenu(taskMenu, 'Block time…')
      )),
      ...(await auditDialogFrom(
        page,
        taskMenu,
        /as a duplicate$/,
        'mark as duplicate',
        fromMenu(taskMenu, 'Mark as duplicate…')
      ))
    )
    await fromMenu(taskMenu, 'Save as playbook…')()
    const savePlaybook = page.getByRole('dialog', { name: 'Save as playbook' })
    await expect(savePlaybook).toBeVisible()
    await page.waitForTimeout(300)
    findings.push(...(await audit(page, 'save as playbook')))
    await savePlaybook.getByRole('button', { name: 'Save playbook' }).click()
    await expect(savePlaybook).toBeHidden()

    // Run playbook and Project settings (a task type, the task IDs), from the More menu.
    await openPath(page, `/projects/${projectId}/board`)
    const projectMenu = page.getByRole('button', { name: 'More project actions' })
    findings.push(
      ...(await auditDialogFrom(
        page,
        projectMenu,
        'Run playbook',
        'run playbook',
        fromMenu(projectMenu, 'Run playbook…')
      )),
      ...(await auditDialogFrom(
        page,
        projectMenu,
        'Sample project settings',
        'project settings',
        fromMenu(projectMenu, 'Project settings…'),
        'Settings sections'
      ))
    )

    // Insert a live list, from a note's editor in the Library.
    await openPath(page, `/projects/${projectId}/library`)
    await page.getByText(seeded.noteTitle).first().click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const insert = page.getByRole('button', { name: 'Insert a live list' })
    findings.push(
      ...(await auditDialogFrom(page, insert, 'Insert a live list', 'insert a live list', () =>
        insert.click()
      ))
    )

    expect(findings, describeFindings(findings)).toEqual([])
  })

  test(`whiteboards, with something on them, pass axe (${mode})`, async () => {
    test.setTimeout(180_000)
    target = await launchForAudit({
      theme: mode === 'dark' ? 'dark' : 'light',
      density: mode === 'compact' ? 'compact' : 'comfortable',
      // The sample project's tour invitation would fade in over the board mid-audit.
      ui: { tips: { enabled: false, dismissed: [] } },
      ...(mode === 'light' ? { viewport: BIG_WINDOW } : {})
    })
    if (mode === 'forced') await target.page.emulateMedia({ forcedColors: 'active' })
    const page = target.page
    await page.locator('main').first().waitFor()
    const { projectId, taskId } = await createSampleProject(page)
    const { boardId } = await seedWhiteboards(page, projectId, taskId)
    const findings: Finding[] = []

    // The Plan's Whiteboards pane with two boards.
    await openPath(page, `/projects/${projectId}/plan`)
    await page.getByRole('button', { name: /^Whiteboards/ }).click()
    await expect(page.getByRole('button', { name: 'Open Launch board' })).toBeVisible()
    findings.push(...(await audit(page, 'plan › whiteboards')))
    const newBoard = page.getByRole('button', { name: 'New whiteboard' })
    findings.push(
      ...(await auditDialogFrom(page, newBoard, 'New whiteboard', 'new whiteboard', () =>
        newBoard.click()
      ))
    )

    // A board with a note, a shape, an arrow, a picture, a card and a mind map.
    await openPath(page, `/projects/${projectId}/plan?whiteboard=${boardId}`)
    const board = page.getByRole('group', { name: 'Whiteboard: Launch board' })
    await expect(board.locator('[data-object-id]')).toHaveCount(8)
    findings.push(...(await audit(page, 'whiteboard')))
    // The note selected: the style bar shows.
    const note = board.getByRole('button', { name: 'Note: Call the venue', exact: true })
    await note.click()
    await expect(page.getByRole('button', { name: 'Make tasks' })).toBeVisible()
    findings.push(...(await audit(page, 'whiteboard › note selected')))
    findings.push(
      ...(await auditDialogFrom(page, note, 'Link to an item or web page', 'link', () =>
        page.keyboard.press('l')
      )),
      ...(await auditDialogFrom(page, note, 'Make tasks', 'make tasks', () =>
        page.keyboard.press('k')
      ))
    )

    // The Library with the board selected: its preview.
    await openPath(page, `/projects/${projectId}/library`)
    await page.getByRole('option', { name: /Launch board/ }).click()
    await expect(page.getByRole('img', { name: 'Preview of Launch board' })).toBeVisible()
    findings.push(...(await audit(page, 'library › whiteboard')))

    expect(findings, describeFindings(findings)).toEqual([])
  })
}

/**
 * Two whiteboards: "Launch board" with a note, a shape, an arrow between
 * them, a picture, a card for a task and a mind map of three ideas, and an
 * empty "Ideas".
 */
async function seedWhiteboards(page: Page, projectId: string, taskId: string) {
  return page.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      // A real 1x1 PNG, imported into the Library.
      const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
      const imported = await api.importLibraryFiles(projectId, [
        { fileName: 'Site photo.png', mimeType: 'image/png', bytes }
      ])
      if (!imported.ok) throw new Error(imported.error)
      const box = (x: number, y: number, width: number, height: number) => ({
        x,
        y,
        width,
        height
      })
      const objects = [
        { id: 'note', kind: 'note', ...box(0, 0, 200, 200), z: 0, text: 'Call the venue' },
        { id: 'shape', kind: 'shape', ...box(320, 40, 160, 120), z: 1, text: 'Stage' },
        {
          id: 'arrow',
          kind: 'connector',
          ...box(200, 100, 120, 0),
          z: 2,
          data: {
            from: { objectId: 'note', x: 200, y: 100 },
            to: { objectId: 'shape', x: 320, y: 100 }
          }
        },
        {
          id: 'picture',
          kind: 'image',
          ...box(0, 260, 120, 120),
          z: 3,
          data: { imageItemId: imported.value[0].item.id }
        },
        {
          id: 'card',
          kind: 'card',
          ...box(200, 280, 280, 72),
          z: 4,
          link: `ostler://task/${projectId}/${taskId}`
        },
        {
          id: 'root',
          kind: 'mindmap',
          ...box(600, 120, 160, 60),
          z: 5,
          text: 'Launch',
          data: { parentId: null, order: 0 }
        },
        {
          id: 'venue',
          kind: 'mindmap',
          ...box(820, 60, 120, 40),
          z: 6,
          text: 'Venue',
          data: { parentId: 'root', order: 0 }
        },
        {
          id: 'band',
          kind: 'mindmap',
          ...box(820, 200, 120, 40),
          z: 7,
          text: 'Band',
          data: { parentId: 'root', order: 1 }
        }
      ]
      const board = await api.createWhiteboard(projectId, {
        title: 'Launch board',
        objects: objects as never
      })
      if (!board.ok) throw new Error(board.error)
      const empty = await api.createWhiteboard(projectId, { title: 'Ideas' })
      if (!empty.ok) throw new Error(empty.error)
      return { boardId: board.value.item.id }
    },
    { projectId, taskId }
  )
}

/** A project that lives only in Ostler, with an automation token the suite knows. */
function tokenProject(token: string): WatchedProject {
  return {
    id: 'a11y-token-project',
    name: 'Errands',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    automationToken: token
  }
}

/**
 * Puts something in each screen the sweep opens: a capture waiting in To
 * triage, an idea in Someday, a cost, a shopping item, a contact, a goal of
 * one's own, a task type, links and dates for the Timeline with a baseline,
 * a milestone with two rounds and a countdown, My day with a block today and
 * one passed, a day off, and a note in the Library.
 */
async function seedNextPass(page: Page, projectId: string) {
  return page.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const must = async <T>(
      result: Promise<{ ok: true; value: T } | { ok: false; error: string }>
    ) => {
      const settled = await result
      if (!settled.ok) throw new Error(settled.error)
      return settled.value
    }
    const local = (offset: number) => {
      const date = new Date()
      date.setDate(date.getDate() + offset)
      const pad = (value: number) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }
    const today = local(0)
    await must(api.updateProject(projectId, { triageCaptures: true }))
    await must(
      api.createPlanningWorkItem(projectId, { title: 'Call the plumber', capture: 'quick-add' })
    )
    await must(
      api.createPlanningWorkItem(projectId, {
        title: 'A garden shed',
        someday: true,
        impact: 4,
        effort: 2
      })
    )
    await must(
      api.createCost(projectId, {
        date: today,
        amount: 1250,
        description: 'Paint',
        category: 'Materials',
        state: 'paid'
      })
    )
    await must(api.createShoppingItem(projectId, { name: 'Brushes', quantity: 2, estimate: 800 }))
    await must(
      api.createContact({
        name: 'Sam Builder',
        organisation: 'Builders',
        emails: ['sam@example.invalid']
      })
    )
    await must(api.createPersonalGoal({ title: 'Run ten kilometres', outcome: 'By the spring' }))
    const type = await must(api.createPlanningTaskType(projectId, { name: 'Bug' }))

    const tasks = (await must(api.getPlanningWorkItems(projectId))).filter(
      (item) => !item.parentWorkItemId && !item.someday
    )
    const [first, second, third] = tasks
    await must(
      api.updatePlanningWorkItem(first.id, {
        startDate: local(0),
        targetDate: local(2),
        typeId: type.id
      })
    )
    await must(
      api.updatePlanningWorkItem(second.id, {
        startDate: local(3),
        targetDate: local(5),
        dependencyIds: [first.id]
      })
    )
    await must(api.addPlanningWorkItemLink(first.id, third.id, 'relates'))
    await must(api.createBaseline(projectId, { name: 'Plan A' }))

    const milestone = await must(
      api.createPlanningMilestone(projectId, { name: 'Sprint', targetDate: local(9) })
    )
    await must(api.updatePlanningWorkItem(first.id, { milestoneId: milestone.id }))
    await must(
      api.setMilestoneRepeat(milestone.id, {
        rule: { every: 'week', interval: 2 },
        lengthDays: 10,
        nextStart: local(14)
      })
    )
    await must(api.startNextMilestoneRound(milestone.id))
    const pin = await must(
      api.createPin({ place: 'sidebar', kind: 'milestone', targetId: milestone.id, projectId })
    )
    await must(api.setPinCountdown(pin.id, { countdown: true }))

    await must(api.addToMyDay(first.id, { date: today }))
    await must(api.addToMyDay(third.id, { date: today }))
    await must(
      api.createTimeBlock({
        workItemId: first.id,
        date: today,
        startMinute: 600,
        lengthMinutes: 60
      })
    )
    await must(
      api.createTimeBlock({
        workItemId: third.id,
        date: local(-1),
        startMinute: 600,
        lengthMinutes: 60
      })
    )
    await must(api.createDayOff({ firstDate: local(1), name: 'Bank holiday' }))
    const note = await must(
      api.createLibraryItem(projectId, { kind: 'note', title: 'Meeting notes', body: 'Agenda' })
    )
    return {
      today,
      taskId: first.id,
      taskTitle: first.title,
      milestoneName: milestone.name,
      noteTitle: note.title
    }
  }, projectId)
}

/** An outside calendar with a meeting today, through the automation API (the app needs a file). */
async function addOutsideEvent(dataDir: string, token: string, today: string): Promise<void> {
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as {
    automationApi: { port: number }
  }
  const day = today.replace(/-/g, '')
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:a11y-meeting',
    'SUMMARY:Team meeting',
    `DTSTART:${day}T130000`,
    `DTEND:${day}T140000`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const response = await fetch(
    `http://127.0.0.1:${config.automationApi.port}/automation/a11y-token-project/calendars`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Work', text })
    }
  )
  expect(response.ok, await response.text()).toBe(true)
}

/** The page zoom main has applied, in percent. */
async function zoomPercent(): Promise<number> {
  const level = await target!.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()
  )
  return Math.round(100 * 1.2 ** level)
}

/** Clicks a visible View › zoom item, as the key would. */
async function clickZoom(label: string): Promise<void> {
  await target!.app.evaluate(({ Menu }, wanted) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === '&View')
    const item = view?.submenu?.items.find((entry) => entry.label === wanted && entry.visible)
    if (!item) throw new Error(`No View item "${wanted}"`)
    item.click()
  }, label)
}

test('zooms to 200%, keeps the zoom after a restart, and still fits the smallest window', async () => {
  test.setTimeout(120_000)
  const small = { width: 900, height: 600 }
  target = await launchForAudit({ theme: 'light', viewport: small })
  let page = target.page
  await page.locator('main').first().waitFor()
  const { projectId } = await createSampleProject(page)
  for (let step = 0; step < 5; step++) await clickZoom('Zoom in')
  expect(await zoomPercent()).toBe(200)
  const saved = JSON.parse(fs.readFileSync(path.join(target!.dataDir, 'config.json'), 'utf8'))
  expect(Math.round(100 * 1.2 ** saved.ui.zoom)).toBe(200)

  await target!.app.close()
  target = await startApp(target!.dataDir, small)
  page = target.page
  await page.locator('main').first().waitFor()
  expect(await zoomPercent()).toBe(200)

  // At 200% in a 900 × 600 window, every page still fits across, its heading
  // shows, and Skip to content is the first Tab stop.
  for (const route of ['/home', `/projects/${projectId}/board`, '/settings/general']) {
    await openPath(page, route)
    const overflow = await page.evaluate(() => {
      const doc = (
        globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number } }
        }
      ).document
      return doc.documentElement.scrollWidth - doc.documentElement.clientWidth
    })
    expect(overflow, route).toBeLessThanOrEqual(0)
    await expect(page.getByRole('heading', { level: 1 }).first(), route).toBeInViewport()
  }
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()

  await clickZoom('Reset zoom')
  expect(await zoomPercent()).toBe(100)
})

/*
 * ARIA snapshots (P9.2): the roles and names of Home, the Board, the task
 * drawer and Settings › General, so a change to them shows up in review.
 * The templates leave out what changes by the day (greetings, dates, counts):
 * a template matches when the page has at least what it lists, in order.
 * `npx playwright test a11y --update-snapshots` rewrites them; prune the
 * day-to-day parts again before committing.
 */
test('Home, the Board, the task drawer and Settings › General keep their roles and names', async () => {
  test.setTimeout(120_000)
  const page = await start('light')
  await page.locator('main').first().waitFor()
  const { projectId, taskId } = await createSampleProject(page)

  await openPath(page, '/home')
  // The page language comes from the app language (src/shared/app-language.ts).
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('#main-content')).toMatchAriaSnapshot({ name: 'home.aria.yml' })
  await openPath(page, `/projects/${projectId}/board`)
  await expect(page.locator('#main-content')).toMatchAriaSnapshot({ name: 'board.aria.yml' })
  await openPath(page, `/projects/${projectId}/tasks/${taskId}`)
  await expect(page.getByRole('dialog').first()).toMatchAriaSnapshot({
    name: 'task-drawer.aria.yml'
  })
  await openPath(page, '/settings/general')
  await openSettingsGroups(page)
  await expect(page.locator('#main-content')).toMatchAriaSnapshot({
    name: 'settings-general.aria.yml'
  })
})
