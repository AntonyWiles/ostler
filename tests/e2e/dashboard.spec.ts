import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type * as http from 'node:http'
import type { OstlerAPI, WatchedProject } from '../../src/shared/ostler-api'
import {
  makeDashboardDataDir,
  notifications,
  startDashboard,
  type DashboardDataOptions
} from './helpers/dashboard-app'
import { makeGitProject, startExternalSession, waitForCopies } from './helpers/agent-harness'
import { startFakeAiProvider } from './helpers/fake-ai-provider'
import { copiedText } from './copied-text'
import { addTaskPart, openProjectView } from './project-views'

// Every test launches its own Ostler on its own data folder and closes it
// after; nothing carries from one test to the next. The variables below are
// the running test's app, reset by each launch.
let app: ElectronApplication
let window: Page
let dataDir: string
let launchEnvironment: Record<string, string> | undefined
let projectDir: string | null = null
let aiProviderServer: http.Server | null = null

async function launchApp(
  project?: WatchedProject,
  options?: DashboardDataOptions & { environment?: Record<string, string> }
) {
  dataDir = await makeDashboardDataDir(project, options)
  launchEnvironment = options?.environment
  ;({ app, window } = await startDashboard(dataDir, launchEnvironment))
}

/** Closes Ostler and starts it again on the same data folder: a restart. */
async function relaunchApp() {
  await app.close()
  ;({ app, window } = await startDashboard(dataDir, launchEnvironment))
}

test.afterEach(async () => {
  await app.close()
  if (aiProviderServer) {
    await new Promise<void>((resolve) => aiProviderServer!.close(() => resolve()))
    aiProviderServer = null
  }
  fs.rmSync(dataDir, { recursive: true, force: true })
  if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true })
  projectDir = null
})

test('opens on Home and navigates to AI settings', async () => {
  await launchApp()
  // Home is the start page; with no project yet it asks for one.
  await expect(
    window.getByRole('heading', { name: /^Good (morning|afternoon|evening)(, .+)?$/ })
  ).toBeVisible()
  await expect(window.getByRole('heading', { name: 'Add a project to begin' })).toBeVisible()

  await window.getByRole('link', { name: 'Settings' }).click()
  await expect(window.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await window.getByRole('link', { name: 'AI', exact: true }).click()
  await expect(window.getByRole('heading', { name: 'AI', exact: true })).toBeVisible()
})

test('welcomes a new install by keyboard and lands on the sample project Overview', async () => {
  await launchApp(undefined, { fresh: true })
  const started = Date.now()
  await expect(window.getByRole('heading', { name: 'Welcome to Ostler' })).toBeVisible()
  const name = window.getByRole('textbox', { name: 'What should we call you?' })
  await expect(name).toBeFocused()
  await name.fill('Robin')
  // Theme: Tab to the radios and choose Light with the arrow keys; it applies at once.
  await window.getByRole('radio', { name: /System/ }).focus()
  await window.keyboard.press('ArrowDown')
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light')
  await window.getByRole('button', { name: 'Continue' }).focus()
  await window.keyboard.press('Enter')

  // The demos sit below the divider and skip the rest of the welcome.
  await expect(window.getByRole('heading', { name: 'How do you want to start?' })).toBeVisible()
  await window.getByRole('button', { name: 'Next' }).focus()
  await window.keyboard.press('Tab')
  await expect(window.getByRole('button', { name: 'Start with the demo projects' })).toBeFocused()
  await window.keyboard.press('Enter')

  await expect(
    window.getByRole('heading', { name: 'Welcome to Ostler (Demo Project)', level: 1 })
  ).toBeVisible()
  await expect(window.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible()
  // The whole path, from first window to a working project, is well under a minute.
  expect(Date.now() - started).toBeLessThan(60_000)

  // Home greets the new name and shows the getting-started checklist.
  await window.getByRole('link', { name: 'Home' }).click()
  await expect(window.getByRole('heading', { name: /, Robin$/ })).toBeVisible()
  await expect(window.getByRole('heading', { name: 'Getting started' })).toBeVisible()

  // A restart opens the app, not the welcome again.
  await relaunchApp()
  await expect(
    window.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })
  ).toBeVisible()
  await expect(window.getByRole('heading', { name: 'How do you want to start?' })).toHaveCount(0)
})

test("opens the user guide, the shortcut overlay and What's new from Help", async () => {
  await launchApp()
  await window.getByRole('button', { name: 'Help' }).click()
  await window.getByRole('menuitem', { name: 'User guide' }).click()
  await expect(
    window.getByRole('heading', { name: 'Getting started', level: 2, exact: true })
  ).toBeVisible()
  await window
    .getByLabel('User guide pages')
    .getByRole('link', { name: 'Keyboard shortcuts' })
    .click()
  await expect(window.getByRole('heading', { name: 'Keyboard shortcuts', level: 2 })).toBeVisible()

  await window.getByRole('heading', { name: 'Keyboard shortcuts', level: 2 }).click()
  await window.keyboard.press('?')
  const overlay = window.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(overlay).toBeVisible()
  await expect(overlay.getByText('Command palette and search')).toBeVisible()
  await window.keyboard.press('Escape')

  await window.getByRole('button', { name: 'Help' }).click()
  await window.getByRole('menuitem', { name: "What's new" }).click()
  await expect(window.getByRole('dialog', { name: "What's new in Ostler" })).toBeVisible()
})

test('guides AI setup from a provider to a model, keeping the key write-only', async () => {
  await launchApp()
  await window.getByRole('link', { name: 'Settings' }).click()
  await window.getByRole('link', { name: 'AI', exact: true }).click()
  // AI is optional and starts unset; the guided setup opens from Set up AI.
  await window.getByRole('button', { name: 'Set up AI' }).click()
  const dialog = window.getByRole('dialog', { name: 'Set up Ostler AI' })
  await dialog.getByRole('radio', { name: 'OpenAI', exact: true }).check()
  await dialog.getByRole('button', { name: 'Next' }).click()
  const key = dialog.getByLabel('API key')
  await expect(key).toHaveAttribute('type', 'password')
  await key.fill('temporary-test-key')
  await dialog.getByRole('button', { name: 'Next' }).click()
  // Offline the provider cannot list its models; the built-in list stands in,
  // with the model already chosen.
  await expect(dialog.getByRole('combobox', { name: 'Model' })).toHaveValue('GPT-4o')
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeEnabled()
  // Nothing is saved before Done.
  const hasKey = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const result = await api.getConfig()
    return result.ok ? result.value.ai.hasApiKey : null
  })
  expect(hasKey).toBe(false)
})

test('turns agents on through the guided setup, which checks what they need', async () => {
  await launchApp()
  await window.getByRole('link', { name: 'Settings' }).click()
  await window.getByRole('link', { name: 'Agents', exact: true }).click()
  await window.getByRole('switch', { name: 'Use AI agents for software projects' }).click()
  const dialog = window.getByRole('dialog', { name: 'Turn on AI agents' })
  await expect(dialog.getByText(/works on its own copy of the project/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  // Real checks against this machine: Git and the bundled runtime are there;
  // AI is not set up in a fresh data folder, and the fix is offered.
  const checks = dialog.getByRole('list', { name: 'Requirements' })
  await expect(checks.getByText('Git is installed')).toBeVisible()
  await expect(checks.getByRole('button', { name: 'Set up AI…' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog.getByRole('radio', { name: /Same as/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByRole('button', { name: 'Turn on agents' }).click()
  await expect(dialog).toBeHidden()
  await expect(window.getByRole('heading', { name: 'Built-in agent' })).toBeVisible()
  const harness = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const result = await api.getConfig()
    return result.ok ? result.value.harness : null
  })
  expect(harness).toMatchObject({ enabled: true, maxConcurrentAgents: 1, autoRunQueued: false })
})

test('creates and moves persistent work in a project workspace', async () => {
  // One long end-to-end flow (create, board, drawer, queue, session, milestones).
  test.setTimeout(60_000)
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-planning-project-'))
  const project: WatchedProject = {
    id: 'e2e-planning-project',
    name: 'Planning project',
    path: projectDir,
    color: '#8b5cf6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, { agents: true })

  await test.step('opens on Overview, with no AI summary until AI is set up', async () => {
    // The app opens on Home; a project opens its workspace on Overview, which
    // holds what the old Planning page's Today view did.
    await window.getByRole('link', { name: 'Planning project' }).click()
    await expect(window.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(window.getByRole('heading', { name: 'Needs you' })).toBeVisible()
    await expect(window.getByRole('group', { name: 'Project numbers' })).toBeVisible()
    // The AI summary is an AI feature; it stays hidden until AI is set up.
    await expect(window.getByRole('heading', { name: 'AI summary' })).toHaveCount(0)
  })

  await test.step('creates a goal, a milestone and a labelled task', async () => {
    // Goals and milestones are made in the Milestones view.
    await openProjectView(window, 'Milestones')
    await window.getByRole('button', { name: 'Goal', exact: true }).click()
    let dialog = window.getByRole('dialog', { name: 'New goal' })
    await dialog.getByLabel('Goal title').fill('Ship the planning workspace')
    await dialog.getByLabel('Outcome').fill('Project work is visible and organized')
    await dialog.getByRole('button', { name: 'Create goal' }).click()
    await expect(dialog).not.toBeVisible()

    // AI actions stay hidden until AI is set up.
    await expect(window.getByRole('button', { name: 'Break down with AI…' })).toHaveCount(0)

    await window.getByRole('button', { name: 'Milestone', exact: true }).click()
    dialog = window.getByRole('dialog', { name: 'New milestone' })
    await dialog.getByLabel('Milestone name').fill('First usable board')
    await dialog
      .getByLabel('Goal', { exact: true })
      .selectOption({ label: 'Ship the planning workspace' })
    await dialog.getByRole('button', { name: 'Create milestone' }).click()

    await window.getByRole('button', { name: 'New task' }).click()
    dialog = window.getByRole('dialog', { name: 'New task' })
    await dialog.getByLabel('Title').fill('Render planning cards')
    await dialog.getByLabel('Description').fill('Show persisted work on the planning board')
    await dialog.getByLabel('Priority').selectOption('high')
    await dialog.getByLabel('Milestone').selectOption({ label: 'First usable board' })
    const newLabel = dialog.getByRole('combobox', { name: 'Add a label' })
    await newLabel.fill('renderer')
    await newLabel.press('Enter')
    await newLabel.fill('planning')
    await newLabel.press('Enter')
    await dialog.getByLabel('Checklist').fill('Card survives restart')
    await dialog.getByRole('button', { name: 'Create' }).click()
  })

  await test.step('moves the task to Ready on the Board and filters by priority', async () => {
    await window.getByRole('tab', { name: 'Board' }).click()
    const backlog = window.locator('.ostler-planning-column--backlog')
    await expect(backlog.getByText('Render planning cards')).toBeVisible()
    await backlog
      .locator('.ostler-planning-card', { hasText: 'Render planning cards' })
      .dragTo(window.locator('.ostler-planning-column--ready'))
    await expect(
      window.locator('.ostler-planning-column--ready').getByText('Render planning cards')
    ).toBeVisible()

    await expect
      .poll(async () => {
        return window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getPlanningWorkItems('e2e-planning-project')
          return result.ok ? result.value[0]?.status : null
        })
      })
      .toBe('ready')

    await window.getByRole('button', { name: 'New task in Backlog' }).click()
    const dialog = window.getByRole('dialog', { name: 'New task' })
    await expect(dialog.getByLabel('Status')).toHaveValue('backlog')
    await dialog.getByLabel('Title').fill('Define planning contract')
    await dialog.getByRole('button', { name: 'Create' }).click()

    // A filter chip (P5.7): Priority is High, the first value offered.
    await window.getByRole('button', { name: 'Add filter' }).click()
    await window
      .getByRole('dialog', { name: 'Add filter' })
      .getByRole('button', { name: 'Priority' })
      .click()
    await window
      .getByRole('dialog', { name: 'Edit filter: Priority' })
      .getByRole('button', { name: 'Done' })
      .click()
    await expect(window.getByRole('heading', { name: 'Render planning cards' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Define planning contract' })).toHaveCount(0)
    await window.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Define planning contract' })).toBeVisible()
  })

  await test.step('groups the Board into swimlanes and moves the task between milestones', async () => {
    // Verify Swimlanes grouping and cross-lane drag/drop with explicit confirmation.
    // Grouping lives under View options (P4.1).
    const viewOptions = window.getByRole('dialog', { name: 'View options' })
    await window.getByRole('button', { name: 'View options' }).click()
    await viewOptions.getByLabel('Group by').selectOption('milestone')
    await window.keyboard.press('Escape')
    await expect(window.getByLabel('Planning swimlanes')).toBeVisible()
    await expect(window.getByRole('region', { name: 'Swimlane: First usable board' })).toBeVisible()
    await expect(window.getByRole('region', { name: 'Swimlane: No milestone' })).toBeVisible()

    // Drag 'Render planning cards' from 'First usable board' into 'No milestone' Ready column
    await window.evaluate(() => {
      type BrowserDOM = {
        document: {
          querySelector: (
            s: string
          ) => { dispatchEvent: (e: unknown) => boolean; textContent?: string } | null
          querySelectorAll: (
            s: string
          ) => ArrayLike<{ dispatchEvent: (e: unknown) => boolean; textContent?: string }>
        }
        DataTransfer: new () => unknown
        DragEvent: new (type: string, init: Record<string, unknown>) => unknown
      }
      const g = globalThis as unknown as BrowserDOM
      const source = g.document.querySelector(
        '.ostler-planning-swimlane[aria-label="Swimlane: First usable board"] .ostler-planning-card'
      )
      const target = g.document.querySelector(
        '.ostler-planning-swimlane[aria-label="Swimlane: No milestone"] .ostler-planning-column--ready'
      )
      if (!source || !target) throw new Error('Drag source or target not found')
      const dt = new g.DataTransfer()
      source.dispatchEvent(
        new g.DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      target.dispatchEvent(
        new g.DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      target.dispatchEvent(
        new g.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      source.dispatchEvent(
        new g.DragEvent('dragend', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
    })

    // Explicit confirmation modal should appear
    const moveModal = window.getByRole('dialog', { name: 'Move task to milestone' })
    await expect(moveModal).toBeVisible()
    await expect(moveModal).toContainText(
      'Move Render planning cards from First usable board to No milestone'
    )
    await moveModal.getByRole('button', { name: 'Move task' }).click()
    await expect(moveModal).not.toBeVisible()

    // Verify milestone reassignment in database (unassigned)
    await expect
      .poll(async () => {
        return window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getPlanningWorkItems('e2e-planning-project')
          const renderItem = result.ok
            ? result.value.find((i) => i.title === 'Render planning cards')
            : null
          return renderItem?.milestoneId
        })
      })
      .toBeNull()

    // Drag 'Render planning cards' back to 'First usable board'
    await window.evaluate(() => {
      type BrowserDOM = {
        document: {
          querySelector: (
            s: string
          ) => { dispatchEvent: (e: unknown) => boolean; textContent?: string } | null
          querySelectorAll: (
            s: string
          ) => ArrayLike<{ dispatchEvent: (e: unknown) => boolean; textContent?: string }>
        }
        DataTransfer: new () => unknown
        DragEvent: new (type: string, init: Record<string, unknown>) => unknown
      }
      const g = globalThis as unknown as BrowserDOM
      const cards = Array.from(
        g.document.querySelectorAll(
          '.ostler-planning-swimlane[aria-label="Swimlane: No milestone"] .ostler-planning-card'
        )
      )
      const source = cards.find((c) => c.textContent?.includes('Render planning cards'))
      const target = g.document.querySelector(
        '.ostler-planning-swimlane[aria-label="Swimlane: First usable board"] .ostler-planning-column--ready'
      )
      if (!source || !target) throw new Error('Drag source or target not found')
      const dt = new g.DataTransfer()
      source.dispatchEvent(
        new g.DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      target.dispatchEvent(
        new g.DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      target.dispatchEvent(
        new g.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
      source.dispatchEvent(
        new g.DragEvent('dragend', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
    })

    const restoreModal = window.getByRole('dialog', { name: 'Move task to milestone' })
    await expect(restoreModal).toBeVisible()
    await expect(restoreModal).toContainText(
      'Move Render planning cards from No milestone to First usable board'
    )
    await restoreModal.getByRole('button', { name: 'Move task' }).click()
    await expect(restoreModal).not.toBeVisible()

    // Verify milestone reassigned back to First usable board
    await expect
      .poll(async () => {
        return window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getPlanningWorkItems('e2e-planning-project')
          const renderItem = result.ok
            ? result.value.find((i) => i.title === 'Render planning cards')
            : null
          return renderItem?.milestoneId
        })
      })
      .not.toBeNull()

    // Switch to Origin grouping
    await window.getByRole('button', { name: 'View options' }).click()
    await viewOptions.getByLabel('Group by').selectOption('origin')
    await window.keyboard.press('Escape')
    await expect(window.getByRole('region', { name: 'Swimlane: Human-authored' })).toBeVisible()

    // Switch back to None grouping
    await window.getByRole('button', { name: 'View options' }).click()
    await viewOptions.getByLabel('Group by').selectOption('none')
    await window.keyboard.press('Escape')
    await expect(window.getByLabel('Planning board')).toBeVisible()
  })

  await test.step('edits the task in its drawer and refuses a dependency loop', async () => {
    // One click on a card opens the drawer, which is named after the task, and
    // "Improve with AI" became "Improve scope" (b786fd0).
    await window.getByRole('heading', { name: 'Render planning cards', exact: true }).click()
    let details = window.getByRole('dialog', { name: 'Render planning cards' })
    await expect(details.getByRole('button', { name: 'Improve scope' })).toHaveCount(0)
    await details.getByLabel('Due date').fill('2026-09-15')
    // Labels are chips with a picker that creates new ones (P4.1).
    const addLabel = details.getByRole('combobox', { name: 'Add a label' })
    await addLabel.fill('tested')
    await addLabel.press('Enter')
    // The checklist is a list of rows (P4.1).
    await details.getByRole('button', { name: 'Add item' }).click()
    await details.getByLabel('Checklist item 2').fill('Status is visible')
    // Waits on is one of the parts a task adds when it needs it.
    await addTaskPart(window, details, 'Waits on')
    const addDependency = details.getByRole('combobox', { name: 'Add a task it waits on' })
    await addDependency.fill('Define planning')
    await addDependency.press('Enter')
    // Every field saved as it changed; closing saves what is still typed first (D30).
    await details.getByRole('button', { name: 'Close' }).click()
    await expect(details).not.toBeVisible()
    // Cards say what is still open rather than "1 dependency" (4316522).
    await expect(window.getByText('Waiting on 1')).toBeVisible()

    await expect
      .poll(async () => {
        return window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getPlanningWorkItems('e2e-planning-project')
          if (!result.ok) return null
          const item = result.value.find((candidate) => candidate.title === 'Render planning cards')
          const dependency = result.value.find(
            (candidate) => candidate.title === 'Define planning contract'
          )
          return item && dependency
            ? {
                targetDate: item.targetDate,
                labels: item.labels,
                acceptanceCriteria: item.acceptanceCriteria,
                dependsOnContract: item.dependencyIds.includes(dependency.id)
              }
            : null
        })
      })
      .toEqual({
        targetDate: '2026-09-15',
        labels: ['renderer', 'planning', 'tested'],
        acceptanceCriteria: ['Card survives restart', 'Status is visible'],
        dependsOnContract: true
      })

    await window.getByRole('heading', { name: 'Define planning contract', exact: true }).click()
    details = window.getByRole('dialog', { name: 'Define planning contract' })
    await addTaskPart(window, details, 'Waits on')
    const addCycle = details.getByRole('combobox', { name: 'Add a task it waits on' })
    await addCycle.fill('Render planning')
    await addCycle.press('Enter')
    // The picker saves at once, so the cycle is refused in place (P4.1).
    await expect(details.getByRole('alert').first()).toContainText(
      "Tasks can't wait on each other in a loop"
    )
    // A save that failed asks before the drawer closes: discard that one change (D30).
    await details.getByRole('button', { name: 'Close' }).click()
    await window
      .getByRole('alertdialog', { name: "A change didn't save" })
      .getByRole('button', { name: 'Discard change' })
      .click()
    await expect(details).not.toBeVisible()
  })

  await test.step('queues the task once what it waits on is done', async () => {
    // Queueing moved from the card face to its menu (P4.1), which a right-click opens; its
    // More button is for the keyboard. Since c9b1cfd work can be queued before its
    // dependencies land (it waits in the queue), so the item stays enabled and its hint says
    // what it will do instead.
    const moreFor = (title: string) => ({
      click: () =>
        window.getByRole('heading', { name: title, exact: true }).click({ button: 'right' })
    })
    await moreFor('Render planning cards').click()
    let queueItem = window.getByRole('menuitem', { name: 'Queue for agent', exact: true })
    await expect(queueItem).not.toHaveAttribute('aria-disabled', 'true')
    await expect(queueItem).toHaveAttribute('title', /waits in the queue/)
    await window.keyboard.press('Escape')
    // The card's done control is the menu's Move to › Done.
    await moreFor('Define planning contract').click()
    await window.getByRole('menuitem', { name: 'Done' }).click()
    await expect(
      window.locator('.ostler-planning-column--done').getByText('Define planning contract')
    ).toBeVisible()
    // The card re-renders as its dependency lands, which closes a menu opened on it meanwhile,
    // so open it again until the task is queued.
    const queuedPill = window.getByLabel('Planning board').getByText('Queued', { exact: true })
    await expect(async () => {
      if (await queuedPill.isVisible()) return
      await moreFor('Render planning cards').click()
      queueItem = window.getByRole('menuitem', { name: 'Queue for agent', exact: true })
      await expect(queueItem).toHaveAttribute('title', 'Add this task to the agent queue', {
        timeout: 2000
      })
      await queueItem.click({ timeout: 2000 })
      await expect(queuedPill).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30_000 })

    await expect
      .poll(async () => {
        return window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const planningResult = await api.getPlanningWorkItems('e2e-planning-project')
          const harnessResult = await api.getHarnessState('e2e-planning-project')
          if (!planningResult.ok || !harnessResult.ok) return null
          const item = planningResult.value.find(
            (candidate) => candidate.title === 'Render planning cards'
          )
          if (!item?.linkedHarnessTaskId) return null
          await api.queuePlanningWorkItem('e2e-planning-project', item.id)
          const afterRetry = await api.getHarnessState('e2e-planning-project')
          if (!afterRetry.ok) return null
          return {
            linkedTaskId: item.linkedHarnessTaskId,
            matchingTasks: afterRetry.value.taskQueue.filter(
              (task) => task.id === item.linkedHarnessTaskId
            ).length
          }
        })
      })
      .toEqual({
        linkedTaskId: expect.any(String),
        matchingTasks: 1
      })
  })

  await test.step('runs the task with an agent over the harness API and closes its review', async () => {
    const execution = await window.evaluate(async () => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const planningResult = await api.getPlanningWorkItems('e2e-planning-project')
      const configResult = await api.getConfig()
      if (!planningResult.ok || !configResult.ok) return null
      const item = planningResult.value.find(
        (candidate) => candidate.title === 'Render planning cards'
      )
      if (!item?.linkedHarnessTaskId) return null
      const sessionResult = await api.startHarnessTaskSession(
        'e2e-planning-project',
        item.linkedHarnessTaskId
      )
      if (!sessionResult.ok) return null
      // The renderer never holds the session token: main builds the prompt,
      // copies it, and returns it masked.
      const promptResult = await api.copyHarnessSessionPrompt(
        'e2e-planning-project',
        sessionResult.value.id
      )
      return promptResult.ok
        ? {
            session: sessionResult.value,
            port: configResult.value.harness.port,
            preview: promptResult.value
          }
        : null
    })
    expect(execution).not.toBeNull()
    // The card's agent pill says Running; its tooltip carries the detail (P4.1).
    const renderPill = window
      .locator('.task-card', { hasText: 'Render planning cards' })
      .locator('.task-card__pill')
    await expect(renderPill).toHaveText('Running')
    await expect(renderPill).toHaveAttribute('title', /Open its menu to watch the run/)

    // The agent works from the copied prompt, exactly as a human pastes it.
    const copiedPrompt = await copiedText(app)
    const sessionToken = /Bearer (\S+)/.exec(copiedPrompt)?.[1] ?? ''
    expect(copiedPrompt).toContain(`You are session ${execution!.session.id}`)
    expect(sessionToken).not.toBe('')
    expect(execution!.preview).not.toContain(sessionToken)
    const harnessBase = `http://127.0.0.1:${execution!.port}/harness/e2e-planning-project`
    const authHeaders = { Authorization: `Bearer ${sessionToken}` }
    const connectResponse = await fetch(`${harnessBase}/status`, { headers: authHeaders })
    expect(connectResponse.ok).toBe(true)
    await expect(renderPill).toHaveAttribute('title', /Running/)
    await expect(
      window.locator('.ostler-planning-column--active').getByText('Render planning cards')
    ).toBeVisible()

    const completeResponse = await fetch(`${harnessBase}/session/${execution!.session.id}/update`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      // A finish needs evidence: commits, or a report saying no change was needed.
      body: JSON.stringify({
        note: 'Planning E2E complete',
        done: true,
        report: { summary: 'Nothing to change for this check.', filesChanged: [] }
      })
    })
    expect(completeResponse.ok).toBe(true)
    // Finished work waits for the person's review; with nothing changed, they close it.
    await expect(
      window
        .locator('.ostler-planning-column', { hasText: 'In review' })
        .getByText('Render planning cards')
    ).toBeVisible()
    const closed = await window.evaluate(async (sessionId) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.applyHarnessTaskWork('e2e-planning-project', sessionId)
      return result.ok || result.error
    }, execution!.session.id)
    expect(closed).toBe(true)
    await expect(
      window.locator('.ostler-planning-column--done').getByText('Render planning cards')
    ).toBeVisible()
    // A finished run that needs no review shows no pill: the Done column says it.
    await expect(renderPill).toHaveCount(0)

    const storedPlanningStatus = await window.evaluate(async () => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getPlanningWorkItems('e2e-planning-project')
      return result.ok
        ? result.value.find((candidate) => candidate.title === 'Render planning cards')?.status
        : null
    })
    // The stored status follows the harness task: closing its review finishes it.
    expect(storedPlanningStatus).toBe('done')
  })

  await test.step('marks the goal achieved and the milestone complete', async () => {
    // Goals and milestones live in the Milestones view.
    await openProjectView(window, 'Milestones')
    await window.getByLabel('Goal status Ship the planning workspace').selectOption('achieved')
    await window.getByLabel('Milestone status First usable board').selectOption('complete')
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const [goals, milestones] = await Promise.all([
            api.getPlanningGoals('e2e-planning-project'),
            api.getPlanningMilestones('e2e-planning-project')
          ])
          return goals.ok && milestones.ok
            ? { goal: goals.value[0]?.status, milestone: milestones.value[0]?.status }
            : null
        })
      )
      .toEqual({ goal: 'achieved', milestone: 'complete' })

    // Goals head their milestones; the card shows progress from its linked task.
    const goalGroup = window.getByRole('region', { name: 'Goal: Ship the planning workspace' })
    const milestoneCard = goalGroup.getByRole('article', { name: 'First usable board' })
    await expect(milestoneCard.getByRole('heading', { name: 'First usable board' })).toBeVisible()
    await expect(milestoneCard.getByText('1 of 1 task done')).toBeVisible()
  })
})

test('shows agent connection details and lets a human queue a task', async () => {
  test.setTimeout(60_000)
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-project-'))
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const value = 1\n')
  const project: WatchedProject = {
    id: 'e2e-project',
    name: 'E2E project',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, { agents: true })

  const taskList = window.getByLabel('Planning board')
  const managedCard = taskList.locator('.ostler-planning-card', { hasText: 'E2E managed task' })
  const executionQueue = window.getByRole('region', { name: 'Agent execution queue' })
  const executionList = executionQueue.getByRole('list', { name: 'Agent run list' })
  const managedExecution = executionList.locator('.ostler-execution-task', {
    hasText: 'E2E managed task'
  })
  const releaseNotesExecution = executionList.locator('.ostler-execution-task', {
    hasText: 'Write release notes'
  })

  await test.step('creates a task on the Board and moves it to Ready', async () => {
    // Work is created and queued from the project's Board; the execution queue is
    // the project's Agents view, and the manual connection details are in
    // Settings > Harness.
    await window.getByRole('link', { name: 'E2E project' }).click()
    await window.getByRole('button', { name: 'New task' }).click()
    const taskCreate = window.getByRole('dialog', { name: 'New task' })
    await expect(taskCreate).toBeVisible()
    await taskCreate.getByLabel('Title').fill('E2E managed task')
    await taskCreate.getByLabel('Status').selectOption('backlog')
    await taskCreate.getByLabel('Priority').selectOption('high')
    await taskCreate.getByRole('button', { name: 'Create' }).click()
    await expect(taskCreate).not.toBeVisible()

    await window.getByRole('tab', { name: 'Board' }).click()
    await expect(
      window
        .locator('.ostler-planning-column--backlog')
        .getByText('E2E managed task', { exact: true })
    ).toBeVisible()

    await window
      .locator('.ostler-planning-column--backlog .ostler-planning-card', {
        hasText: 'E2E managed task'
      })
      .dragTo(window.locator('.ostler-planning-column--ready'))
    await expect(
      window
        .locator('.ostler-planning-column--ready')
        .getByText('E2E managed task', { exact: true })
    ).toBeVisible()
  })

  await test.step('queues it and edits it from the Agents view', async () => {
    // Queue for agent is in the card's menu (P4.1).
    await managedCard.getByRole('heading', { name: 'E2E managed task' }).click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Queue for agent', exact: true }).click()
    await expect(managedCard.getByText('Queued', { exact: true })).toBeVisible()
    await window.getByRole('tab', { name: /^Agents/ }).click()
    await expect(window.getByRole('region', { name: 'Agent controls' })).toBeVisible()

    await expect(executionQueue.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible()
    await expect(
      executionQueue.getByRole('list', { name: 'Agent run list' }).getByText('E2E managed task', {
        exact: true
      })
    ).toBeVisible()
    await expect(executionQueue.getByText('Next to start')).toBeVisible()
    const linkedProjectTaskButton = executionQueue.getByRole('button', {
      name: 'Open task'
    })
    await expect(linkedProjectTaskButton).toBeVisible()
    await expect(executionQueue.getByText('Kept in step with its task')).toBeVisible()
    // The linked task opens the work item drawer over the Agents view.
    await linkedProjectTaskButton.click()
    const linkedTaskEditor = window.getByRole('dialog', { name: 'E2E managed task' })
    await linkedTaskEditor.getByLabel('Priority').selectOption('low')
    await linkedTaskEditor.getByRole('button', { name: 'Close' }).click()
    await expect(linkedTaskEditor).not.toBeVisible()
    await expect(executionQueue.getByLabel('Priority for E2E managed task')).toHaveValue('low')
  })

  await test.step('queues two one-off runs, then reorders and sorts the queue', async () => {
    await executionQueue.getByText('Queue a one-off agent run').click()
    await executionQueue.getByLabel('Agent run title').fill('Investigate deployment alert')
    await executionQueue
      .getByLabel('Agent run details')
      .fill('Find the failing check and report the evidence.')
    await executionQueue.getByLabel('Agent run priority').selectOption('critical')
    await executionQueue.getByRole('button', { name: 'Add to queue' }).click()
    await expect(
      executionQueue.getByText('Investigate deployment alert', { exact: true })
    ).toBeVisible()
    await expect(
      executionQueue
        .getByRole('list', { name: 'Agent run list' })
        .getByText('Find the failing check and report the evidence.')
    ).toBeVisible()

    await executionQueue.getByLabel('Agent run title').fill('Write release notes')
    await executionQueue.getByLabel('Agent run details').fill('Summarize the delivered changes.')
    await executionQueue.getByLabel('Agent run priority').selectOption('low')
    await executionQueue.getByRole('button', { name: 'Add to queue' }).click()

    // A task can be reordered once its copy is no longer getting ready.
    await waitForCopies(window, project.id)
    await releaseNotesExecution.dragTo(managedExecution)
    await expect
      .poll(() => executionList.locator('h4').allTextContents())
      .toEqual(['Write release notes', 'E2E managed task', 'Investigate deployment alert'])

    await managedExecution.getByLabel('Priority for E2E managed task').selectOption('critical')
    await expect(managedExecution.getByLabel('Priority for E2E managed task')).toHaveValue(
      'critical'
    )

    await waitForCopies(window, project.id)
    await executionQueue.getByRole('button', { name: 'Sort queue by priority' }).click()
    await expect
      .poll(() => executionList.locator('h4').allTextContents())
      .toEqual(['E2E managed task', 'Investigate deployment alert', 'Write release notes'])
  })

  await test.step('cancels the task, and Ready queues it again', async () => {
    // Cancelling is in the row's More menu, beside the main action.
    await managedExecution
      .getByRole('button', { name: 'More actions for E2E managed task' })
      .click()
    await window.getByRole('menuitem', { name: 'Cancel task' }).click()
    const cancelConfirm = window.getByRole('alertdialog', { name: 'Cancel "E2E managed task"?' })
    await expect(
      cancelConfirm.getByText(
        /the task stays in Ready\. While agents are on, every task in Ready is queued, so it is queued again straight away/
      )
    ).toBeVisible()
    await cancelConfirm.getByRole('button', { name: 'Cancel task' }).click()
    await expect(managedExecution.getByText('Cancelled', { exact: true })).toBeVisible()
    await expect(
      managedExecution.getByRole('button', { name: 'Returned to project planning' })
    ).toBeVisible()
    // The Board shows the same task, critical now. It went back to Ready, and Ready tasks
    // always go to the queue while agents are on (simplify pass), so it is queued afresh.
    await window.getByRole('tab', { name: 'Board' }).click()
    await expect(managedCard.getByRole('img', { name: 'Critical priority' })).toBeVisible()
    await window.getByRole('tab', { name: /^Agents/ }).click()
    await expect(executionList.locator('h4')).toHaveCount(4)

    const durableQueueState = await window.evaluate(async () => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const [harness, planning] = await Promise.all([
        api.getHarnessState('e2e-project'),
        api.getPlanningWorkItems('e2e-project')
      ])
      if (!harness.ok || !planning.ok) return null
      const invalidReorder = await api.reorderHarnessTasks('e2e-project', [
        harness.value.taskQueue.find((task) => task.status === 'pending')!.id
      ])
      return {
        queue: harness.value.taskQueue.map((task) => ({
          title: task.title,
          status: task.status,
          priority: task.priority,
          planningWorkItemId: task.planningWorkItemId
        })),
        workItem: planning.value.find((item) => item.title === 'E2E managed task'),
        invalidReorderRejected: !invalidReorder.ok
      }
    })
    expect(durableQueueState).toMatchObject({
      queue: [
        {
          title: 'E2E managed task',
          status: 'cancelled',
          priority: 'critical'
        },
        {
          title: 'Investigate deployment alert',
          status: 'pending',
          priority: 'critical'
        },
        { title: 'Write release notes', status: 'pending', priority: 'low' },
        { title: 'E2E managed task', status: 'pending', priority: 'critical' }
      ],
      workItem: { status: 'ready', priority: 'critical' },
      invalidReorderRejected: true
    })
  })

  await test.step('searches the runs and finds agent health in Settings', async () => {
    await executionQueue.getByLabel('Search agent runs').fill('deployment')
    await expect(executionQueue.getByText('Showing 1 of 4')).toBeVisible()
    await expect(executionQueue.getByText('E2E managed task', { exact: true })).not.toBeVisible()
    await executionQueue.getByRole('button', { name: 'Clear filters' }).click()
    await expect(executionQueue.getByText('Showing 4 of 4')).toBeVisible()

    await window.getByRole('link', { name: 'Settings' }).click()
    await window
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Agents', exact: true })
      .click()
    // There is no shared agent token any more (each session has its own), and no token is shown.
    await expect(window.getByText('e2e-test-token')).toHaveCount(0)
    // Each project's agent health is reported here instead.
    await expect(window.getByRole('heading', { name: /^Health/ })).toBeVisible()
  })
})

test('keeps the project views within the available width while resizing', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-responsive-project-'))
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const responsive = true\n')
  const project: WatchedProject = {
    id: 'e2e-responsive-project',
    name: 'Responsive project with a deliberately long name',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: ['responsive-layout'],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, { agents: true })
  await window
    .getByRole('link', { name: 'Responsive project with a deliberately long name' })
    .click()

  for (const width of [1180, 820]) {
    await window.setViewportSize({ width, height: 900 })
    // The views that came from the old project page (Overview, Code as Files, Library).
    for (const tabName of ['Overview', 'Files', 'Library']) {
      await window.getByRole('tab', { name: tabName }).click()
      await expect(window.locator('.ostler-workspace')).toBeVisible()
      const dimensions = await window.locator('.ostler-workspace').evaluate((element) => {
        const container = element as unknown as { clientWidth: number; scrollWidth: number }
        return { clientWidth: container.clientWidth, scrollWidth: container.scrollWidth }
      })
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
      // Overview lays out its own columns; Files and Library share the project-detail grid.
      const gridColumnCount = await window
        .locator(tabName === 'Overview' ? '.overview__columns' : '.ostler-project-detail-grid')
        .evaluate((element) => {
          const layoutElement = element as unknown as {
            ownerDocument: {
              defaultView: {
                getComputedStyle(target: unknown): { gridTemplateColumns: string }
              } | null
            }
          }
          const columns = layoutElement.ownerDocument.defaultView?.getComputedStyle(element)
          return columns?.gridTemplateColumns.trim().split(/\s+/).length ?? 0
        })
      expect(gridColumnCount).toBe(1)
    }
  }
})

test('reviews, edits, rejects, cancels, and approves AI next-task proposals in Agents', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-ai-next-project-'))
  const providerSuggestions = Array.from({ length: 5 }, (_, index) => ({
    title: `Suggested task ${index + 1}`,
    description: `Description for proposed task ${index + 1}.`,
    priority: index === 0 ? 'high' : 'medium',
    acceptanceCriteria: [`Criterion ${index + 1}`],
    rationale: `Rationale ${index + 1}`,
    evidence: [`Database record ${index + 1}`]
  }))
  const provider = await startFakeAiProvider(
    JSON.stringify({
      summary: 'Use the recorded planning gaps and recent activity.',
      assumptions: ['The database is current.'],
      warnings: ['No source files were inspected.'],
      suggestions: providerSuggestions
    })
  )
  aiProviderServer = provider.server
  const providerPort = provider.port
  const project: WatchedProject = {
    id: 'e2e-ai-next-project',
    name: 'AI next project',
    path: projectDir,
    color: '#7c3aed',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, {
    agents: true,
    ai: {
      provider: 'custom',
      baseUrl: `http://127.0.0.1:${providerPort}/v1`,
      model: 'e2e-model'
    },
    environment: { OSTLER_AI_API_KEY: 'e2e-provider-key' }
  })

  const seeded = await window.evaluate(async (projectId) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    return api.createPlanningWorkItem(projectId, {
      title: 'Existing database task',
      description: 'This task must not be duplicated.',
      status: 'backlog',
      priority: 'medium'
    })
  }, project.id)
  expect(seeded.ok).toBe(true)

  const suggestTasks = window
    .getByRole('region', { name: 'Board' })
    .getByRole('button', { name: 'Suggest tasks…' })

  await test.step('drafts suggestions from the database, and Cancel adds nothing', async () => {
    // "Suggest tasks…" sits in the Board toolbar while AI is set up (here, a
    // keyless provider on this computer), and drafts straight into the review dialog.
    await window.getByRole('link', { name: 'AI next project' }).click()
    await window.getByRole('tab', { name: 'Board' }).click()

    await suggestTasks.click()
    const review = window.getByRole('dialog', { name: 'Review the suggested tasks' })
    await expect(review).toBeVisible()
    await expect(review.getByText(/0 milestones, 1 task, /)).toBeVisible()
    expect(provider.lastRequestBody()).toContain('Existing database task')
    expect(provider.lastRequestBody()).toContain('Ostler database evidence')
    await review.getByRole('checkbox', { name: 'Include Suggestion 2' }).uncheck()
    await expect(review.getByText('4 of 5 will be added')).toBeVisible()
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(review).not.toBeVisible()
  })

  await test.step('adds the edited suggestions, leaving out the rejected one', async () => {
    await suggestTasks.click()
    const review = window.getByRole('dialog', { name: 'Review the suggested tasks' })
    await review.getByLabel('Suggestion 1 title').fill('Human-edited first task')
    await review.getByLabel('Priority').first().selectOption('critical')
    await review.getByLabel('Initial status').first().selectOption('ready')
    await review.getByRole('checkbox', { name: 'Include Suggestion 2' }).uncheck()
    await review.getByRole('button', { name: 'Add 4 tasks' }).click()
    await expect(review).not.toBeVisible()

    const persisted = await window.evaluate(async (projectId) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const [planning, harness] = await Promise.all([
        api.getPlanningWorkItems(projectId),
        api.getHarnessState(projectId)
      ])
      if (!planning.ok || !harness.ok) return null
      return {
        planning: planning.value,
        queue: harness.value.taskQueue
      }
    }, project.id)
    const edited = persisted?.planning.find((item) => item.title === 'Human-edited first task')
    expect(edited).toMatchObject({
      title: 'Human-edited first task',
      priority: 'critical',
      status: 'ready',
      origin: 'ai-approved'
    })
    expect(edited?.labels).toEqual([])
    expect(persisted?.planning.filter((item) => item.origin === 'ai-approved')).toHaveLength(4)
    expect(persisted?.planning.map((item) => item.title)).not.toContain('Suggested task 2')
    expect(persisted?.queue).toEqual([])
  })
})

test('drives a harness session over the agent HTTP API and shows it live in the UI', async () => {
  projectDir = makeGitProject('ostler-e2e-http-project-')
  const project: WatchedProject = {
    id: 'e2e-http-project',
    name: 'E2E HTTP project',
    path: projectDir,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, { agents: true })

  // The project's Agents view shows the queue and its live sessions.
  await window.getByRole('link', { name: 'E2E HTTP project' }).click()
  await window.getByRole('tab', { name: /^Agents/ }).click()
  await expect(
    window.getByRole('region', { name: 'Agent controls' }).getByText('Idle')
  ).toBeVisible()

  const port = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const configResult = await api.getConfig()
    return configResult.ok ? configResult.value.harness.port : null
  })
  expect(port).toBeTruthy()

  // Every session starts on a queued task, with a token of its own.
  const taskId = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const task = await api.addHarnessTask(
      'e2e-http-project',
      'Live agent session',
      'Working from outside Ostler'
    )
    return task.ok ? task.value.id : null
  })
  expect(taskId).toBeTruthy()
  const session = await startExternalSession(app, window, project.id, taskId!)

  // The Agents view surfaces a live session through its "Watch agent" button,
  // whose title lists the watchable sessions.
  const watchAgent = window.getByRole('button', { name: 'Watch agent' })
  await expect(watchAgent).toBeVisible()
  await expect(watchAgent).toHaveAttribute('title', /Live agent session/)

  const askRes = await fetch(
    `http://127.0.0.1:${port}/harness/${project.id}/session/${session.id}/ask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ question: 'Should I deploy to staging first?' })
    }
  )
  expect(askRes.ok).toBe(true)

  // Pending questions show on Overview (and in the Agents view).
  await window.getByRole('tab', { name: 'Overview' }).click()
  const question = window
    .getByRole('region', { name: 'Agent questions' })
    .getByRole('listitem')
    .filter({ hasText: 'Should I deploy to staging first?' })
  await expect(question).toBeVisible()
  await expect(question).toContainText('Live agent session')
})

test('opens a working agent transcript straight from the planning board', async () => {
  projectDir = makeGitProject('ostler-e2e-watch-project-')
  const project: WatchedProject = {
    id: 'e2e-watch-project',
    name: 'Watch project',
    path: projectDir,
    color: '#10b981',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project, { agents: true })

  // Seed through the API: this test is about the route into the transcript,
  // not about re-proving the create/queue flow the planning test covers.
  const queued = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem('e2e-watch-project', {
      title: 'Rework the export pipeline',
      description: 'Long-running agent work',
      status: 'ready',
      priority: 'high'
    } as never)
    if (!created.ok) return null
    const handoff = await api.queuePlanningWorkItem('e2e-watch-project', created.value.id)
    return handoff.ok ? handoff.value.workItem.linkedHarnessTaskId : null
  })
  expect(queued).toBeTruthy()

  // Starting the queued task claims it for its session.
  await startExternalSession(app, window, project.id, queued!)

  // The Agents view counts the run; before this it could say "1 running" and
  // still offer no way to see what that run was doing.
  await window.getByRole('link', { name: 'Watch project' }).click()
  await window.getByRole('tab', { name: /^Agents/ }).click()
  await expect(
    window.getByRole('region', { name: 'Agent controls' }).getByText('1 running')
  ).toBeVisible()
  await expect(window.getByRole('button', { name: /Watch agent/ })).toBeVisible()

  await window.getByRole('tab', { name: 'Board' }).click()

  // A claimed task leaves the queue, so before this the card in flight was the
  // one card on the board with no way into what the agent was doing.
  const card = window.locator('.ostler-planning-card', { hasText: 'Rework the export pipeline' })
  // The card says Running, and its menu opens the run (P4.1).
  await expect(card.locator('.task-card__pill')).toHaveText('Running')
  await card.getByRole('heading', { name: 'Rework the export pipeline' }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Watch agent run' }).click()

  const transcript = window.getByRole('dialog', { name: /transcript/i })
  await expect(transcript).toBeVisible()
  await expect(transcript.getByText('Rework the export pipeline').first()).toBeVisible()
})

test('adds a selected project to the shared dashboard state', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-selected-project-'))
  await launchApp()

  const browseMockInstalled = await app.evaluate(({ dialog }, selectedPath) => {
    const browseMock = async () => ({ canceled: false, filePaths: [selectedPath] })
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: browseMock
    })
    return dialog.showOpenDialog === browseMock
  }, projectDir)
  expect(browseMockInstalled).toBe(true)

  await window.getByRole('link', { name: 'Settings' }).click()
  await window.getByRole('link', { name: 'Projects', exact: true }).click()

  await window.getByRole('button', { name: 'New project…' }).first().click()

  const wizard = window.getByRole('dialog', { name: 'New project' })
  await expect(wizard).toBeVisible()
  await expect(wizard.getByRole('radio', { name: 'Blank' })).toBeChecked()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByRole('radio', { name: 'A folder on this PC' }).check()
  await wizard.getByRole('button', { name: 'Browse…' }).click()
  await expect(wizard.getByLabel('Folder', { exact: true })).toHaveValue(projectDir)
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByLabel('Project name').fill('Selected project')
  await wizard.getByRole('button', { name: 'Create project' }).click()
  const done = window.getByRole('dialog', { name: 'Selected project' })
  await expect(done).toBeVisible()
  await done.getByRole('button', { name: 'Close' }).first().click()
  await expect(
    window.getByRole('list', { name: 'Projects' }).getByText('Selected project')
  ).toBeVisible()

  await window.getByRole('link', { name: 'Selected project' }).click()
  await expect(window.getByRole('heading', { name: 'Selected project' })).toBeVisible()
  // A linked folder brings the Files view, which loads the code workspace.
  await window.getByRole('tab', { name: 'Files' }).click()
  await expect(window.getByLabel('Code workspace root')).toBeVisible()
})

test('opens the path in its hash on the Library', async () => {
  const project: WatchedProject = {
    id: 'e2e-hash-link-project',
    name: 'Hash link project',
    path: null,
    color: '#10b981',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null
  }
  await launchApp(project)
  await expect(window.getByRole('heading', { name: /^Good / })).toBeVisible()

  // The app opens at the internal path in its hash: here a project's Library.
  // (The window refuses page-initiated navigation, so main reloads it.)
  await window.evaluate(() => {
    const page = globalThis as unknown as { location: { hash: string } }
    page.location.hash = '#/projects/e2e-hash-link-project/library'
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload())
  await window.waitForLoadState('domcontentloaded')
  await expect(window.getByRole('tab', { name: 'Library' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(window.getByRole('heading', { name: 'Hash link project' })).toBeVisible()
})

test('creates a project with no folder and adds a task to it', async () => {
  await launchApp()

  await window.getByRole('button', { name: 'New project', exact: true }).click()
  const wizard = window.getByRole('dialog', { name: 'New project' })
  await expect(wizard.getByRole('radio', { name: 'Blank' })).toBeChecked()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await expect(wizard.getByRole('radio', { name: 'Just in Ostler' })).toBeChecked()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByLabel('Project name').fill('Wedding')
  await wizard.getByRole('button', { name: 'Create project' }).click()
  const done = window.getByRole('dialog', { name: 'Wedding' })
  await expect(done.getByText(/link a folder in Settings/)).toBeVisible()
  await done.getByRole('button', { name: 'Open project' }).click()

  // No folder: no Files or Agents tab, and the project opens on Overview.
  await expect(window.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(window.getByRole('tab', { name: 'Files' })).toHaveCount(0)
  await expect(window.getByRole('tab', { name: /^Agents/ })).toHaveCount(0)

  const projectId = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const result = await api.getProjects()
    return result.ok ? { id: result.value[0]?.id, path: result.value[0]?.path } : null
  })
  expect(projectId?.path).toBeNull()

  await window.getByRole('button', { name: 'New task' }).click()
  const dialog = window.getByRole('dialog', { name: 'New task' })
  await dialog.getByLabel('Title').fill('Book the venue')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(
    window.locator('.ostler-planning-column--backlog').getByText('Book the venue')
  ).toBeVisible()

  await window.getByRole('link', { name: 'Settings' }).click()
  await window.getByRole('link', { name: 'Projects', exact: true }).click()
  await expect(window.getByText('No folder')).toBeVisible()
  await window.getByRole('button', { name: 'Settings for Wedding' }).click()
  await window.getByRole('tab', { name: 'Folder and GitHub' }).click()
  await expect(window.getByRole('button', { name: 'Link a folder…' })).toBeVisible()
})

test('creates a project from the Event planning template and finds its first milestone', async () => {
  await launchApp()

  await window.getByRole('button', { name: 'New project', exact: true }).click()
  const wizard = window.getByRole('dialog', { name: 'New project' })
  await wizard.getByRole('radio', { name: 'From a template' }).check()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByRole('radio', { name: 'Event planning' }).check()
  await expect(wizard.getByText('3 milestones, 12 tasks')).toBeVisible()
  await expect(wizard.getByText('Shortlist venues')).toBeVisible()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await expect(wizard.getByRole('radio', { name: 'Just in Ostler' })).toBeChecked()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await expect(wizard.getByLabel('Project name')).toHaveValue('Event planning')
  await wizard.getByLabel('Project name').fill('Summer fair')
  await wizard.getByRole('button', { name: 'Create project' }).click()
  await window
    .getByRole('dialog', { name: 'Summer fair' })
    .getByRole('button', { name: 'Open project' })
    .click()

  await expect(window.getByRole('heading', { name: 'Summer fair' })).toBeVisible()
  await openProjectView(window, 'Milestones')
  await expect(window.getByText('Venue booked').first()).toBeVisible()
  await window.getByRole('tab', { name: 'Board' }).click()
  await expect(window.getByText('Visit and book the venue').first()).toBeVisible()
})

test('preserves the API key while changing another AI setting', async () => {
  await launchApp()
  // The renderer only ever sees whether a key is saved and its last four
  // characters; the key itself stays in main.
  const readApiKey = () =>
    window.evaluate(async () => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getConfig()
      if (!result.ok) return null
      const ai = result.value.ai as Record<string, unknown>
      return { hasApiKey: ai.hasApiKey, apiKeyHint: ai.apiKeyHint, apiKey: ai.apiKey }
    })
  const saved = { hasApiKey: true, apiKeyHint: '-key', apiKey: undefined }
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    await api.updateConfig({ ai: { apiKey: 'temporary-test-key', model: 'gpt-4o' } })
  })
  await expect.poll(readApiKey).toEqual(saved)

  await window.getByRole('link', { name: 'Settings' }).click()
  await window.getByRole('link', { name: 'AI', exact: true }).click()
  await expect(window.getByText('Saved, ending -key')).toBeVisible()
  await window.getByLabel('Longest answer').fill('2048')
  await window.getByLabel('Longest answer').blur()
  await expect.poll(readApiKey).toEqual(saved)
})

test('assigns a task to me, sets its due date and ticks its checklist, and the card shows it', async () => {
  await launchApp({
    id: 'essentials-project',
    name: 'Essentials',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  // A task with a two-item checklist, written the way any surface writes one.
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem('essentials-project', {
      title: 'Send the invitations',
      status: 'ready',
      acceptanceCriteria: ['Guest list agreed', 'Cards printed']
    })
    if (!created.ok) throw new Error(created.error)
  })
  const me = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const people = await api.getPeople()
    return people.ok ? people.value.find((person) => person.isMe) : undefined
  })
  // Ostler made Me from the Windows user name at start-up.
  expect(me?.name).toBeTruthy()

  await window.getByRole('link', { name: 'Essentials' }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  const card = window.locator('.task-card', { hasText: 'Send the invitations' })
  await expect(card).toBeVisible()
  await expect(card.getByTitle('Checklist: 0 of 2 done')).toBeVisible()
  await card.click()

  const drawer = window.locator('.task-drawer')
  await drawer.getByRole('button', { name: 'Assign to me' }).click()
  await expect(drawer.getByRole('combobox', { name: 'Assignee' })).toHaveValue(`${me!.name} (you)`)
  await drawer.getByLabel('Due date').fill('2030-01-15')
  // The tick is saved at once, so the box follows the stored state.
  const tick = drawer.getByRole('checkbox', { name: 'Done: Guest list agreed' })
  await tick.click()
  await expect(tick).toBeChecked()
  await expect(drawer.getByText('1 of 2 done')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()

  // The card shows who is doing it, its checklist progress and its due date.
  await expect(card.getByTitle(`Assigned to ${me!.name}`)).toBeVisible()
  await expect(card.getByTitle('Checklist: 1 of 2 done')).toHaveText(/1\/2/)
  await expect(card.locator('.task-card__due')).toHaveAttribute(
    'title',
    /January 15, 2030|15 January 2030/
  )

  // And it survives a reload: the tick and the fields were saved.
  const saved = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('essentials-project')
    return items.ok ? items.value[0] : null
  })
  expect(saved).toMatchObject({
    assigneeId: me!.id,
    targetDate: '2030-01-15',
    checkedCriteria: ['Guest list agreed'],
    status: 'ready'
  })
})

test('comments on a task, changes its priority, and sees both in its activity', async () => {
  await launchApp({
    id: 'activity-project',
    name: 'Activity',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem('activity-project', {
      title: 'Book the venue',
      status: 'ready'
    })
    if (!created.ok) throw new Error(created.error)
  })

  await window.getByRole('link', { name: 'Activity' }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  const card = window.locator('.task-card', { hasText: 'Book the venue' })
  await card.click()
  const drawer = window.locator('.task-drawer')

  // A comment, sent with Ctrl+Enter (the default), rendered as markdown.
  const box = drawer.getByRole('textbox', { name: 'Comment' })
  await box.fill('Asked for **two** quotes')
  await box.press('Control+Enter')
  const activity = drawer.locator('.task-activity')
  await expect(activity.locator('strong', { hasText: 'two' })).toBeVisible()
  await expect(box).toHaveValue('')

  // A priority change, saved like any edit.
  await drawer.getByLabel('Priority').selectOption('high')
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()

  // The card counts the comment; the drawer's activity has both, newest first.
  await expect(card.getByTitle('1 comment')).toBeVisible()
  await card.click()
  await expect(activity.getByText(/changed the priority from Medium to High/)).toBeVisible()
  const summaries = await activity.locator('.activity-row__summary').allTextContents()
  expect(summaries[0]).toMatch(/changed the priority from Medium to High/)
  await expect(activity.locator('.activity-row--comment')).toHaveCount(1)

  // Comments only.
  await activity.getByRole('radio', { name: 'Comments' }).click()
  await expect(activity.locator('.activity-row')).toHaveCount(1)
})

test('groups the List by status, changes a due date in place, and assigns two tasks at once', async () => {
  await launchApp({
    id: 'list-project',
    name: 'Listing',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  const ada = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    for (const [title, status] of [
      ['Book the venue', 'ready'],
      ['Send the invitations', 'ready'],
      ['Plan the menu', 'backlog']
    ] as const) {
      const created = await api.createPlanningWorkItem('list-project', { title, status })
      if (!created.ok) throw new Error(created.error)
    }
    const person = await api.createPerson({ name: 'Ada Lovelace' })
    if (!person.ok) throw new Error(person.error)
    return person.value
  })

  await window.getByRole('link', { name: 'Listing' }).first().click()
  await window.getByRole('tab', { name: 'List' }).click()
  const grid = window.getByRole('grid', { name: 'Tasks' })
  await expect(grid).toBeVisible()

  // Group by status.
  await window.getByRole('button', { name: 'View options' }).click()
  await window
    .getByRole('dialog', { name: 'View options' })
    .getByLabel('Group by')
    .selectOption('status')
  await window.keyboard.press('Escape')
  const groupRows = grid.locator('[role="row"][aria-expanded]')
  await expect(groupRows.filter({ hasText: 'Ready' })).toContainText('2')
  await expect(groupRows.filter({ hasText: 'Backlog' })).toContainText('1')

  // The due date, in place: focus the cell, Enter, pick, save.
  const venue = grid.getByRole('row', { name: /Book the venue/ })
  const dueCell = venue.locator('[data-column="due"]')
  await dueCell.click()
  await dueCell.press('Enter')
  const editor = window.getByRole('dialog', { name: 'Due date' })
  await editor.getByLabel('Due date').fill('2030-01-15')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toBeHidden()
  await expect(dueCell).toHaveText(/15 Jan 2030|Jan 15, 2030/)

  // Two tasks, one bulk change.
  await grid.getByRole('checkbox', { name: 'Select Book the venue' }).click()
  await grid.getByRole('checkbox', { name: 'Select Send the invitations' }).click()
  const bar = window.getByRole('toolbar', { name: 'Bulk actions' })
  await expect(bar.getByText('2 selected')).toBeVisible()
  await bar.getByLabel('Assign to').selectOption(ada.id)
  await expect(bar).toBeHidden()

  const saved = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('list-project')
    return items.ok
      ? Object.fromEntries(
          items.value.map((item) => [item.title, [item.assigneeId, item.targetDate]])
        )
      : null
  })
  expect(saved).toEqual({
    'Book the venue': [ada.id, '2030-01-15'],
    'Send the invitations': [ada.id, null],
    'Plan the menu': [null, null]
  })
})

test('drags a task to the next day on the Calendar and the drawer shows its new due date', async () => {
  await launchApp({
    id: 'calendar-project',
    name: 'Party planner',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  // The 10th and 11th of this month: both always on the month's grid.
  const { due, next } = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const created = await api.createPlanningWorkItem('calendar-project', {
      title: 'Book the venue',
      status: 'ready',
      targetDate: `${month}-10`
    })
    if (!created.ok) throw new Error(created.error)
    return { due: `${month}-10`, next: `${month}-11` }
  })

  await window.getByRole('link', { name: 'Party planner' }).first().click()
  await window.getByRole('tab', { name: 'Calendar' }).click()
  const grid = window.getByRole('grid', { name: 'Calendar' })
  await expect(grid).toBeVisible()
  const chip = grid.locator(`[data-date="${due}"] [data-item-id]`)
  await expect(chip).toContainText('Book the venue')

  await chip.dragTo(grid.locator(`[data-date="${next}"]`))
  await expect(grid.locator(`[data-date="${next}"]`)).toContainText('Book the venue')
  await expect(notifications(window).getByText(/"Book the venue" is now due/)).toBeVisible()

  await grid
    .locator(`[data-date="${next}"]`)
    .getByRole('button', { name: /^Book the venue,/ })
    .click()
  const drawer = window.locator('.task-drawer')
  await expect(drawer.getByLabel('Due date')).toHaveValue(next)
})

test("extends a bar's due date on the Timeline by keyboard and the drawer agrees", async () => {
  await launchApp({
    id: 'timeline-project',
    name: 'Stage build',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  const { later } = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const created = await api.createPlanningWorkItem('timeline-project', {
      title: 'Build the stage',
      status: 'ready',
      startDate: `${month}-10`,
      targetDate: `${month}-12`
    })
    if (!created.ok) throw new Error(created.error)
    return { later: `${month}-13` }
  })

  await window.getByRole('link', { name: 'Stage build' }).first().click()
  await openProjectView(window, 'Timeline')
  const timeline = window.getByRole('group', { name: 'Timeline' })
  await expect(timeline).toBeVisible()
  const bar = timeline.getByRole('button', { name: /^Build the stage,/ })
  await bar.focus()
  await window.keyboard.press('Alt+Shift+ArrowRight')
  await expect(notifications(window).getByText(/"Build the stage" is now due/)).toBeVisible()
  await expect(bar).toBeFocused()

  await window.keyboard.press('Enter')
  const drawer = window.locator('.task-drawer')
  await expect(drawer.getByLabel('Due date')).toHaveValue(later)
})

test('opens the Timeline across projects from the command palette and moves a milestone', async () => {
  await launchApp({
    id: 'overview-project',
    name: 'House move',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  const { milestoneId, later } = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const created = await api.createPlanningMilestone('overview-project', {
      name: 'Keys',
      targetDate: `${month}-10`
    })
    if (!created.ok) throw new Error(created.error)
    return { milestoneId: created.value.id, later: `${month}-11` }
  })

  await window.keyboard.press('Control+K')
  await window
    .getByRole('combobox', { name: 'Command palette search' })
    .fill('Timeline across projects')
  await window
    .getByRole('option', { name: /Timeline across projects/ })
    .first()
    .click()
  const timeline = window.getByRole('group', { name: 'Timeline across projects' })
  await expect(timeline).toBeVisible()
  const diamond = timeline.getByRole('button', { name: /^House move: Milestone: Keys,/ })
  await diamond.focus()
  await window.keyboard.press('Alt+ArrowRight')
  await expect(notifications(window).getByText(/"Keys" is now due/)).toBeVisible()
  await expect
    .poll(async () =>
      window.evaluate(async (id) => {
        const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
        const milestones = await api.getPlanningMilestones('overview-project')
        return milestones.ok ? milestones.value.find((entry) => entry.id === id)?.targetDate : null
      }, milestoneId)
    )
    .toBe(later)
})

test('offers to move what waits on a task when its due date moves later on the Timeline', async () => {
  await launchApp({
    id: 'waits-project',
    name: 'Stage plan',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  const { waitingId } = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const first = await api.createPlanningWorkItem('waits-project', {
      title: 'Build the stage',
      status: 'ready',
      startDate: `${month}-10`,
      targetDate: `${month}-12`
    })
    if (!first.ok) throw new Error(first.error)
    const waiting = await api.createPlanningWorkItem('waits-project', {
      title: 'Light the stage',
      status: 'ready',
      startDate: `${month}-12`,
      targetDate: `${month}-14`,
      dependencyIds: [first.value.id]
    })
    if (!waiting.ok) throw new Error(waiting.error)
    return { waitingId: waiting.value.id }
  })

  await window.getByRole('link', { name: 'Stage plan' }).first().click()
  await openProjectView(window, 'Timeline')
  const timeline = window.getByRole('group', { name: 'Timeline' })
  const bar = timeline.getByRole('button', { name: /^Build the stage,/ })
  await bar.focus()
  await window.keyboard.press('Alt+Shift+ArrowRight')
  const offer = notifications(window).locator('.ui-toast', {
    hasText: '1 task that waits on this now starts too early'
  })
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name: 'Preview' }).click()
  const dialog = window.getByRole('dialog', { name: 'Move what waits on it' })
  await expect(dialog.getByRole('table', { name: 'New dates' })).toContainText('Light the stage')
  await dialog.getByRole('button', { name: 'Move 1 task' }).click()
  await expect(notifications(window).getByText('Moved 1 task that waits on it')).toBeVisible()
  const moved = await window.evaluate(async (id) => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('waits-project')
    if (!items.ok) throw new Error(items.error)
    return items.value.find((item) => item.id === id)!
  }, waitingId)
  // One day later at least, more when that lands on a day off.
  expect(moved.targetDate! > moved.startDate!).toBe(true)
  expect(moved.startDate!.slice(-2) >= '13').toBe(true)
})

test('shows the critical path on the Timeline, with what can slip and the chain in a panel', async () => {
  await launchApp({
    id: 'critical-project',
    name: 'Venue plan',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const create = async (input: Parameters<OstlerAPI['createPlanningWorkItem']>[1]) => {
      const result = await api.createPlanningWorkItem('critical-project', input)
      if (!result.ok) throw new Error(result.error)
      return result.value.id
    }
    const book = await create({
      title: 'Book the hall',
      status: 'ready',
      startDate: `${month}-03`,
      targetDate: `${month}-08`
    })
    await create({
      title: 'Set up the hall',
      status: 'ready',
      startDate: `${month}-08`,
      targetDate: `${month}-12`,
      dependencyIds: [book]
    })
    await create({ title: 'Order flowers', status: 'ready', targetDate: `${month}-10` })
    await create({ title: 'Find a band', status: 'backlog' })
  })

  await window.getByRole('link', { name: 'Venue plan' }).first().click()
  await openProjectView(window, 'Timeline')
  await window.getByRole('checkbox', { name: 'Show critical path' }).check()
  const timeline = window.getByRole('group', { name: 'Timeline' })
  await expect(timeline.getByRole('button', { name: /^Set up the hall,/ })).toHaveAccessibleName(
    /Critical/
  )
  await expect(timeline.getByRole('button', { name: /^Order flowers,/ })).toHaveAccessibleName(
    /Can slip 2 days/
  )
  const panel = window.getByRole('complementary', { name: 'Critical path' })
  await expect(panel.getByRole('listitem')).toHaveText([
    /Book the hall/,
    /Set up the hall/,
    /Find a band/
  ])
  await expect(panel).toContainText('1 task has no dates and is not counted')
  await panel.getByRole('button', { name: /^Set up the hall/ }).click()
  await expect(window.locator('.task-drawer').getByLabel('Title')).toHaveValue('Set up the hall')
})

test('draws a start-to-start link with a lag on the Timeline and shows it in the drawer', async () => {
  await launchApp({
    id: 'link-draw-project',
    name: 'Decorating',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  const ids = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const day = (offset: number) => {
      const date = new Date()
      date.setDate(date.getDate() + offset)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    const create = async (input: Parameters<OstlerAPI['createPlanningWorkItem']>[1]) => {
      const result = await api.createPlanningWorkItem('link-draw-project', input)
      if (!result.ok) throw new Error(result.error)
      return result.value.id
    }
    const plaster = await create({
      title: 'Plastering',
      status: 'ready',
      startDate: day(1),
      targetDate: day(5)
    })
    const paint = await create({
      title: 'Painting',
      status: 'ready',
      startDate: day(3),
      targetDate: day(8)
    })
    return { plaster, paint }
  })

  await window.getByRole('link', { name: 'Decorating' }).first().click()
  await openProjectView(window, 'Timeline')
  const timeline = window.getByRole('group', { name: 'Timeline' })
  await expect(timeline.getByRole('button', { name: /^Painting,/ })).toBeVisible()
  const from = await window
    .locator(`[data-bar-id="${ids.plaster}"] [data-link-end="start"]`)
    .boundingBox()
  const to = await window
    .locator(`[data-bar-id="${ids.paint}"] [data-link-end="start"]`)
    .boundingBox()
  if (!from || !to) throw new Error('No link handles')
  await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await window.mouse.down()
  await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 })
  await window.mouse.up()

  const popover = window.getByRole('dialog', { name: 'Link from Plastering to Painting' })
  await expect(popover.getByLabel('How it waits')).toHaveValue('start-to-start')
  await popover.getByLabel(/Days after/).fill('2')
  await popover.getByRole('button', { name: 'Add link' }).click()
  await expect(
    timeline.getByRole('button', { name: 'Painting starts 2 days after Plastering starts' })
  ).toBeVisible()

  await timeline.locator('.timeline-task__open', { hasText: 'Painting' }).click()
  const drawer = window.locator('.task-drawer')
  await expect(drawer.getByLabel('Title')).toHaveValue('Painting')
  await expect(drawer).toContainText('Starts 2 days after Plastering starts')
})

test('quick adds "Pay invoice tomorrow #admin !high" and finds it on Home under Upcoming', async () => {
  await launchApp({
    id: 'quick-add-project',
    name: 'Household',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  await expect(window.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/
  )

  // Ctrl+Shift+N opens quick add from anywhere.
  await window.keyboard.press('Control+Shift+N')
  const dialog = window.getByRole('dialog', { name: 'Quick add' })
  const field = dialog.getByRole('textbox', { name: 'Quick add a task' })
  await field.fill('Pay invoice tomorrow #admin !high')
  const chips = dialog.getByRole('list', { name: 'What quick add found' })
  await expect(chips).toContainText('admin')
  await expect(chips).toContainText('High')
  await field.press('Enter')
  await expect(dialog).toHaveCount(0)

  const upcoming = window.getByRole('region', { name: 'Tomorrow' })
  await expect(upcoming.getByRole('link', { name: 'Pay invoice' })).toBeVisible()

  const task = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('quick-add-project')
    return items.ok ? items.value[0] : null
  })
  expect(task).toMatchObject({ title: 'Pay invoice', labels: ['admin'], priority: 'high' })

  // The task opens from Home.
  await upcoming.getByRole('link', { name: 'Pay invoice' }).click()
  await expect(window.getByRole('textbox', { name: 'Title' })).toHaveValue('Pay invoice')
})

test('plans the day from Home, then ticks a task done in My day (N1.4)', async () => {
  await launchApp({
    id: 'my-day-project',
    name: 'Household',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'hours'
  })
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    await api.createPlanningWorkItem('my-day-project', {
      title: 'Pay the plumber',
      targetDate: today,
      estimate: 1
    })
    await api.createPlanningWorkItem('my-day-project', {
      title: 'Book the van',
      targetDate: today,
      estimate: 2
    })
  })

  await window.getByRole('button', { name: 'Plan my day' }).click()
  const dialog = window.getByRole('dialog', { name: 'Plan my day' })
  await dialog.getByRole('checkbox', { name: /^Book the van/ }).check()
  await dialog.getByRole('checkbox', { name: /^Pay the plumber/ }).check()
  await expect(dialog).toContainText('3 h picked')
  await dialog.getByRole('button', { name: 'Start my day' }).click()
  await expect(dialog).toHaveCount(0)

  const myDay = window.getByRole('list', { name: 'My day tasks' })
  await expect(myDay.getByRole('link')).toHaveText(['Book the van', 'Pay the plumber'])
  await myDay.getByRole('checkbox', { name: 'Mark Book the van done' }).check()
  await expect(myDay.getByRole('checkbox', { name: 'Mark Book the van not done' })).toBeChecked()
  const status = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('my-day-project')
    return items.ok ? items.value.find((item) => item.title === 'Book the van')?.status : null
  })
  expect(status).toBe('done')
})

const viewsProject: WatchedProject = {
  id: 'views-project',
  name: 'Website relaunch',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: Date.now(),
  lastActivity: null
}

test('closing the window saves typing still waiting for its pause (R1.5)', async () => {
  test.setTimeout(60_000)
  await launchApp(viewsProject)
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const created = await api.createPlanningWorkItem('views-project', { title: 'Book the venue' })
    if (!created.ok) throw new Error(created.error)
  })
  await window.getByRole('link', { name: 'Website relaunch' }).first().click()
  await window.getByRole('tab', { name: 'Board' }).click()
  await window.locator('.task-card', { hasText: 'Book the venue' }).click()
  const drawer = window.locator('.task-drawer')
  await drawer.getByRole('textbox', { name: 'Description' }).fill('Typed a moment before closing')

  // Close the window at once, well inside the pause, as the close button does.
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await exited

  ;({ app, window } = await startDashboard(dataDir, launchEnvironment))
  const saved = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('views-project')
    if (!items.ok) throw new Error(items.error)
    return items.value.find((item) => item.title === 'Book the venue')?.description
  })
  expect(saved).toBe('Typed a moment before closing')
})

test('builds a filter, saves it as a view, and reopens it after a restart', async () => {
  test.setTimeout(60_000)
  await launchApp(viewsProject)
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    for (const [title, priority] of [
      ['Pay the invoice', 'high'],
      ['Plan the party', 'low'],
      ['Fix the footer', 'critical']
    ] as const) {
      const created = await api.createPlanningWorkItem('views-project', { title, priority })
      if (!created.ok) throw new Error(created.error)
    }
  })

  await window.getByRole('link', { name: 'Website relaunch' }).first().click()
  await window.getByRole('tab', { name: 'List' }).click()
  const count = window.locator('.task-toolbar__count')
  await expect(count).toHaveText('3 of 3 tasks')

  // Priority is High or Critical, as a chip.
  await window.getByRole('button', { name: 'Add filter' }).click()
  await window
    .getByRole('dialog', { name: 'Add filter' })
    .getByRole('button', { name: 'Priority' })
    .click()
  const editor = window.getByRole('dialog', { name: 'Edit filter: Priority' })
  await editor.getByRole('checkbox', { name: 'Critical' }).check()
  await editor.getByRole('button', { name: 'Done' }).click()
  await expect(
    window.getByRole('button', { name: 'Edit filter: Priority is High or Critical' })
  ).toBeVisible()
  await expect(count).toHaveText('2 of 3 tasks')

  await window.getByRole('button', { name: /^Views: Default view/ }).click()
  await window.getByRole('menuitem', { name: 'Save view…' }).click()
  const naming = window.getByRole('dialog', { name: 'Save view' })
  await naming.getByLabel('Name').fill('Urgent')
  await naming.getByRole('button', { name: 'Save' }).click()
  await expect(window.getByRole('button', { name: 'Views: Urgent' })).toBeVisible()

  // Back to the default view, cleared.
  await window.getByRole('button', { name: 'Views: Urgent' }).click()
  await window.getByRole('menuitemradio', { name: 'Default view' }).click()
  await window.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(count).toHaveText('3 of 3 tasks')

  // Restart against the same data folder.
  await relaunchApp()
  await window.getByRole('link', { name: 'Website relaunch' }).first().click()
  await window.getByRole('tab', { name: 'List' }).click()
  await expect(window.locator('.task-toolbar__count')).toHaveText('3 of 3 tasks')
  await window.getByRole('button', { name: /^Views: Default view/ }).click()
  await window.getByRole('menuitemradio', { name: 'Urgent' }).click()
  await expect(window.getByRole('button', { name: 'Views: Urgent' })).toBeVisible()
  await expect(window.locator('.task-toolbar__count')).toHaveText('2 of 3 tasks')
  await expect(window.getByText('Fix the footer')).toBeVisible()
  await expect(window.getByText('Plan the party')).toHaveCount(0)

  // The palette opens it too.
  await window.keyboard.press('Control+K')
  await window.getByRole('combobox', { name: 'Command palette search' }).fill('Urgent')
  await expect(
    window.getByRole('option', { name: /Open view.*Urgent.*Website relaunch/ })
  ).toBeVisible()
})

test('finds a word in a comment, a decision and a Library note from the palette and the search page', async () => {
  await launchApp(viewsProject)
  await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const task = await api.createPlanningWorkItem('views-project', { title: 'Homepage' })
    if (!task.ok) throw new Error(task.error)
    const comment = await api.addPlanningComment(
      task.value.id,
      'Where did we decide the turquoise palette?'
    )
    if (!comment.ok) throw new Error(comment.error)
    const decision = await api.createPlanningDecision('views-project', {
      title: 'Brand colours',
      decision: 'We use the turquoise palette with sand accents'
    })
    if (!decision.ok) throw new Error(decision.error)
    const note = await api.createLibraryItem('views-project', {
      kind: 'note',
      title: 'Style guide',
      body: 'Fonts, spacing and the turquoise palette for print'
    })
    if (!note.ok) throw new Error(note.error)
  })

  await window.keyboard.press('Control+K')
  const search = window.getByRole('combobox', { name: 'Command palette search' })
  await search.fill('turquoise')
  const results = window.getByRole('listbox', { name: 'Results' })
  await expect(results.getByRole('option', { name: /Comment on Homepage/ })).toBeVisible()
  await expect(results.getByRole('option', { name: /Brand colours/ })).toBeVisible()
  await expect(results.getByRole('option', { name: /Style guide/ })).toBeVisible()
  await expect(results.locator('.palette__snippet mark', { hasText: /^turquoise$/i })).toHaveCount(
    3
  )

  await results.getByRole('option', { name: /See all results/ }).click()
  await expect(window.getByRole('heading', { name: 'Search' })).toBeVisible()
  const page = window.getByRole('listbox', { name: 'Results' })
  await expect(page.getByRole('option')).toHaveCount(3)
  await expect(page.locator('mark', { hasText: /^turquoise$/i })).toHaveCount(3)

  // Keyboard: down to the decision and open it in place.
  const field = window.getByRole('combobox', { name: 'Search for' })
  await field.focus()
  const decisionIndex = await page
    .getByRole('option')
    .evaluateAll((options) =>
      options.findIndex((option) =>
        (option as unknown as { getAttribute(name: string): string | null })
          .getAttribute('aria-label')
          ?.startsWith('Decision')
      )
    )
  for (let step = 0; step < decisionIndex; step++) await field.press('ArrowDown')
  await field.press('Enter')
  await expect(window.getByRole('tab', { name: 'Decisions' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(window.getByRole('dialog', { name: /Brand colours|Edit decision/ })).toBeVisible()
})

test('imports a small CSV into a new project, then undoes the import from the Inbox', async () => {
  await launchApp()
  const csvPath = path.join(dataDir, 'plan.csv')
  fs.writeFileSync(
    csvPath,
    'Summary,Status,Due Date\r\nBook the venue,In Progress,2026-10-20\r\nSend invites,To Do,\r\nOrder the cake,Done,\r\n'
  )
  // The file picker is the operating system's; main is told which file was picked.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath]
    })) as unknown as typeof dialog.showOpenDialog
  }, csvPath)

  await window.getByRole('button', { name: 'New project', exact: true }).click()
  const wizard = window.getByRole('dialog', { name: 'New project' })
  await wizard.getByRole('radio', { name: 'Import into a new project' }).check()
  await wizard.getByRole('button', { name: 'Next' }).click()
  const importer = window.getByRole('dialog', { name: 'Import' })
  await importer.getByRole('button', { name: 'Choose a file…' }).click()
  await expect(importer.getByText('plan.csv')).toBeVisible()
  await importer.getByRole('button', { name: 'Next' }).click()
  await expect(importer.getByLabel('Title (required)')).toHaveValue('0')
  await importer.getByRole('button', { name: 'Next' }).click()
  await expect(importer.getByText('3 tasks', { exact: true })).toBeVisible()
  await importer.getByLabel('Project name').fill('Summer party')
  await importer.getByRole('button', { name: 'Import 3 tasks' }).click()

  await expect(window.getByRole('heading', { name: 'Summer party' })).toBeVisible()
  const list = window.getByRole('grid', { name: 'Tasks' })
  await expect(list.getByText('Book the venue')).toBeVisible()
  await expect(list.getByText('Order the cake')).toBeVisible()

  await window.getByRole('link', { name: /^Inbox/ }).click()
  await expect(window.getByText('Imported 3 tasks into Summer party')).toBeVisible()
  await window.getByRole('button', { name: 'Undo import' }).click()
  await expect(
    notifications(window).getByText('Moved 3 imported tasks to the recycle bin')
  ).toBeVisible()

  const remaining = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const projects = await api.getProjects()
    if (!projects.ok) throw new Error(projects.error)
    const project = projects.value.find((entry) => entry.name === 'Summer party')!
    const live = await api.getPlanningWorkItems(project.id)
    const binned = await api.getPlanningWorkItems(project.id, 'deleted')
    if (!live.ok || !binned.ok) throw new Error('Could not read the tasks')
    return { live: live.value.length, binned: binned.value.length }
  })
  expect(remaining).toEqual({ live: 0, binned: 3 })
})

test('exports the sample project as one file and imports it back under a free name, with grouped activity', async () => {
  await launchApp(undefined, { fresh: true })
  await test.step('opens the sample project and expands its grouped activity', async () => {
    await window.getByRole('textbox', { name: 'What should we call you?' }).fill('Robin')
    await window.getByRole('button', { name: 'Continue' }).click()
    await window.getByRole('button', { name: 'Create project' }).click()
    await window.getByRole('button', { name: 'Open the project' }).click()
    await expect(window.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible()

    // Recent activity tells the sample's tasks as rows that expand to them. The
    // newest row holds the last 10 added; Weekly catch-up call's take turns and
    // repeat, set as it is added, separate them from the first 8.
    const recent = window.locator('.recent-activity')
    await expect(
      recent.getByText(
        /^Robin added 10 tasks from the “Welcome to Ostler \(Demo Project\)” template$/
      )
    ).toBeVisible()
    await recent.getByRole('button', { name: 'Show the 10 tasks' }).click()
    await expect(
      recent
        .locator('.activity-group__tasks')
        .getByRole('button', { name: 'Pay the cabin deposit' })
    ).toBeVisible()
  })

  // Export project writes one file where the person chose.
  const exportPath = path.join(dataDir, '..', `${path.basename(dataDir)}-sample.ostler-project`)
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath
    })) as unknown as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath]
    })) as unknown as typeof dialog.showOpenDialog
  }, exportPath)
  try {
    await test.step('exports the project to one file', async () => {
      await window.getByRole('button', { name: 'More project actions' }).click()
      // The long More menu reads in labelled parts, such as Import and export.
      const more = window.getByRole('menu')
      await more
        .getByRole('group', { name: 'Import and export' })
        .getByRole('menuitem', { name: 'Export project…' })
        .click()
      const exporter = window.getByRole('dialog', { name: /^Export / })
      await exporter.getByRole('button', { name: 'Choose where…' }).click()
      await expect(exporter).toHaveCount(0)
      expect(fs.lstatSync(exportPath).isFile()).toBe(true)
    })

    await test.step('imports it back under a free name', async () => {
      // Importing it proposes a free name, and says why.
      await window.getByRole('button', { name: 'New project', exact: true }).click()
      const wizard = window.getByRole('dialog', { name: 'New project' })
      await wizard.getByRole('radio', { name: 'Import into a new project' }).check()
      await wizard.getByRole('button', { name: 'Next' }).click()
      const importer = window.getByRole('dialog', { name: 'Import' })
      await importer.getByRole('button', { name: 'Choose a file…' }).click()
      await importer.getByRole('button', { name: 'Next' }).click()
      const name = importer.getByLabel('Project name')
      await expect(name).toHaveValue('Welcome to Ostler (Demo Project) (2)')
      await expect(
        importer.getByText(/already called “Welcome to Ostler \(Demo Project\)”/)
      ).toBeVisible()
      await importer.getByRole('button', { name: 'Import project' }).click()
      await expect(
        window.getByRole('heading', { name: 'Welcome to Ostler (Demo Project) (2)' })
      ).toBeVisible()

      const counts = await window.evaluate(async () => {
        const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
        const projects = await api.getProjects()
        if (!projects.ok) throw new Error(projects.error)
        const tasks = await Promise.all(
          projects.value.map(async (project) => {
            const items = await api.getPlanningWorkItems(project.id)
            if (!items.ok) throw new Error(items.error)
            return [project.name, items.value.length] as const
          })
        )
        return Object.fromEntries(tasks)
      })
      // The import brings every task, beside the café demo also on a new install.
      expect(counts['Welcome to Ostler (Demo Project) (2)']).toBe(18)
      expect(counts['Welcome to Ostler (Demo Project)']).toBe(18)
    })
  } finally {
    fs.rmSync(exportPath, { force: true })
  }
})

test('exports the Calendar as a calendar file and shares the project as a web page', async () => {
  await launchApp(undefined, { fresh: true })
  await window.getByRole('textbox', { name: 'What should we call you?' }).fill('Robin')
  await window.getByRole('button', { name: 'Continue' }).click()
  await window.getByRole('button', { name: 'Create project' }).click()
  await window.getByRole('button', { name: 'Open the project' }).click()
  await window.getByRole('tab', { name: 'Calendar' }).click()

  const base = path.join(dataDir, '..', path.basename(dataDir))
  const calendarPath = `${base}-dates.ics`
  const pagePath = `${base}-report.html`
  const saveTo = (filePath: string) =>
    app.evaluate(({ dialog }, chosen) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: chosen
      })) as unknown as typeof dialog.showSaveDialog
    }, filePath)
  try {
    await saveTo(calendarPath)
    await window.getByRole('button', { name: 'More project actions' }).click()
    await window.getByRole('menuitem', { name: 'Export to calendar file…' }).click()
    const calendar = window.getByRole('dialog', { name: /to a calendar file$/ })
    await expect(
      calendar.getByRole('checkbox', { name: 'Include finished tasks' })
    ).not.toBeChecked()
    await calendar.getByRole('button', { name: 'Choose where…' }).click()
    await expect(calendar).toHaveCount(0)
    const ics = fs.readFileSync(calendarPath, 'utf8')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toMatch(/URL:ostler:\/\/task\//)

    await saveTo(pagePath)
    await window.getByRole('button', { name: 'More project actions' }).click()
    await window.getByRole('menuitem', { name: 'Share as a web page…' }).click()
    const share = window.getByRole('dialog', { name: /as a web page$/ })
    await expect(share.getByRole('checkbox', { name: 'Include finished tasks' })).toBeChecked()
    await expect(
      share.getByRole('checkbox', { name: 'Include task descriptions' })
    ).not.toBeChecked()
    await share.getByRole('button', { name: 'Choose where…' }).click()
    await expect(share).toHaveCount(0)
    const html = fs.readFileSync(pagePath, 'utf8')
    expect(html).toContain('<h1>Welcome to Ostler (Demo Project)</h1>')
    expect(html).toContain('Put money in the trip pot')
    expect(html.toLowerCase()).not.toContain('<script')
  } finally {
    fs.rmSync(calendarPath, { force: true })
    fs.rmSync(pagePath, { force: true })
  }
})

test('prints my week to a PDF from Home', async () => {
  await launchApp(undefined, { fresh: true })
  await window.getByRole('textbox', { name: 'What should we call you?' }).fill('Robin')
  await window.getByRole('button', { name: 'Continue' }).click()
  await window.getByRole('button', { name: 'Create project' }).click()
  await window.getByRole('button', { name: 'Open the project' }).click()
  await window.getByRole('link', { name: 'Home' }).click()

  const pdfPath = path.join(dataDir, '..', `${path.basename(dataDir)}-my-week.pdf`)
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: chosen
    })) as unknown as typeof dialog.showSaveDialog
  }, pdfPath)
  try {
    await window.getByRole('button', { name: 'Home options' }).click()
    await window.getByRole('menuitem', { name: 'Save my week as PDF' }).click()
    await expect(window.getByText('Saved your week as a PDF', { exact: true })).toBeVisible({
      timeout: 30_000
    })
    const pdf = fs.readFileSync(pdfPath)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
  } finally {
    fs.rmSync(pdfPath, { force: true })
  }
})

test("copies, cuts and pastes with Ostler's own clipboard off screen", async () => {
  await launchApp(undefined, { fresh: true })
  const name = window.getByRole('textbox', { name: 'What should we call you?' })
  // Paste first: it only reads, so the keys are proven to stay in Ostler
  // before a copy could reach the Windows clipboard.
  const copied = await window.evaluate(() =>
    (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI.copyText('Copied by Ostler')
  )
  expect(copied.ok).toBe(true)
  await name.fill('')
  await name.press('Control+V')
  await expect(name).toHaveValue('Copied by Ostler')

  await name.fill('Robin')
  await name.press('Control+A')
  await name.press('Control+C')
  await expect.poll(() => copiedText(app)).toBe('Robin')
  await name.fill('Grace')
  await name.press('Control+A')
  await name.press('Control+X')
  await expect(name).toHaveValue('')
  await expect.poll(() => copiedText(app)).toBe('Grace')
  await name.press('Control+V')
  await expect(name).toHaveValue('Grace')
})

test('snips the screen to a task from the command palette and finds the picture in its drawer (N4.2a)', async () => {
  await launchApp({
    id: 'snip-project',
    name: 'Website',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    estimateUnit: 'points'
  })
  await expect(window.getByRole('heading', { level: 1 })).toContainText(
    /Good (morning|afternoon|evening)/
  )
  // Off screen Ostler never reads the real screen: each display gets a picture
  // it generates. A tripwire stands in for desktopCapturer, so a read would
  // capture nothing (and the snip would fail) and is counted below.
  await app.evaluate(({ desktopCapturer }) => {
    const state = globalThis as unknown as { __screenReads?: number }
    state.__screenReads = 0
    desktopCapturer.getSources = (async () => {
      state.__screenReads = (state.__screenReads ?? 0) + 1
      return []
    }) as unknown as typeof desktopCapturer.getSources
  })

  const overlayOpened = app.waitForEvent('window', {
    predicate: (page) => page.url().includes('#/snip/')
  })
  await window.keyboard.press('Control+K')
  await window.getByRole('combobox', { name: 'Command palette search' }).fill('Snip to task')
  await window
    .getByRole('option', { name: /Snip to task/ })
    .first()
    .click()

  const overlay = await overlayOpened
  await expect(
    overlay.getByRole('application', { name: 'Snip to task: drag a rectangle' })
  ).toBeVisible()
  await expect(overlay.locator('.snip-overlay__picture')).toBeVisible()
  await overlay.mouse.move(100, 100)
  await overlay.mouse.down()
  await overlay.mouse.move(260, 220, { steps: 5 })
  await expect(overlay.getByTestId('snip-selection')).toBeVisible()
  await overlay.mouse.up()

  const dialog = window.getByRole('dialog', { name: 'Snip to task' })
  await expect(dialog.getByRole('img', { name: /^The snip, / })).toBeVisible()
  const field = dialog.getByRole('textbox', { name: 'Quick add a task' })
  await expect(field).toHaveValue('')
  await field.fill('The chart is upside down')
  await dialog.getByRole('button', { name: 'Add task' }).click()
  await expect(dialog).toHaveCount(0)

  const stored = await window.evaluate(async () => {
    const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
    const items = await api.getPlanningWorkItems('snip-project')
    const task = items.ok
      ? items.value.find((item) => item.title === 'The chart is upside down')
      : null
    const library = await api.listLibraryItems('snip-project', {})
    const attachments = task ? await api.listWorkItemAttachments('snip-project', task.id) : null
    return {
      library: library.ok ? library.value : [],
      attached: attachments?.ok ? attachments.value.map((entry) => entry.item.id) : []
    }
  })
  expect(stored.library).toHaveLength(1)
  expect(stored.library[0]).toMatchObject({ kind: 'image', aiAccess: 'when-selected' })
  expect(stored.library[0].file?.fileName).toMatch(/^Screenshot .+\.png$/)
  expect(stored.attached).toEqual([stored.library[0].id])

  // The toast opens the task; its drawer lists the picture.
  await notifications(window).getByRole('button', { name: 'Open' }).click()
  await expect(window.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'The chart is upside down'
  )
  await expect(window.getByText(stored.library[0].title, { exact: true })).toBeVisible()

  const screenReads = await app.evaluate(
    () => (globalThis as unknown as { __screenReads?: number }).__screenReads
  )
  expect(screenReads).toBe(0)
})
