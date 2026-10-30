import * as fs from 'fs'
import * as path from 'path'
import type { Locator } from 'playwright'
import type { OstlerAPI } from '../../../src/shared/ostler-api'
import { queueOpenFile, setWindowSize } from '../lib/app'
import type { Target } from '../lib/session'
import { PROJECT_NAME, TASKS } from '../dummy-app/plan'
import type { Phase, PhaseContext } from './phases'
import { attempt, openProject, openSettings, openTab, openTask, openView, verify } from './steps'

/**
 * The parts of Ostler the Pomodoro Desk story does not need but a person
 * uses anyway: every screen and every menu on it, the everyday work on a
 * task (time, subtasks, renaming, deleting and undoing, the recycle bin, the
 * archive, bulk changes), My work, the Timesheet, Workload, the Library's
 * file import, the emergency stop, and how it all looks in the dark theme
 * and a small window. Which screens, tabs and settings sections exist is read
 * from the window itself, so a new one is visited without being listed here.
 */

/** Menus the sweep opens and closes but never chooses from. */
const AVOID = /\b(remove|delete|quit|restore|stop all|archive project|uninstall)\b/i

interface LiveItem {
  id: string
  title: string
  status: string
  priority: string
  parentWorkItemId: string | null
}

async function items(
  context: PhaseContext,
  scope: 'live' | 'archived' | 'deleted' = 'live'
): Promise<LiveItem[]> {
  return context.session.api(
    `list ${scope} tasks`,
    async ({ id, scope }: { id: string; scope: string }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getPlanningWorkItems(
        id,
        scope === 'live' ? undefined : (scope as 'archived' | 'deleted')
      )
      if (!result.ok) throw new Error(result.error)
      return result.value.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        parentWorkItemId: item.parentWorkItemId
      }))
    },
    { id: context.state.projectId!, scope }
  )
}

/** A target for a control found by looking at the screen, named as the probe names it. */
async function seen(locator: Locator, where: string): Promise<Target> {
  const name = await locator
    .evaluate(
      (element) =>
        (window as unknown as { __monkeyDescribe?: (e: Element) => string }).__monkeyDescribe?.(
          element
        ) ?? ''
    )
    .catch(() => '')
  return { locator, description: `${name || 'a control'} on ${where}`, control: name || undefined }
}

/** Looks at the screen, then opens each kind of menu on it once and closes it again. */
async function lookAround(context: PhaseContext, where: string): Promise<void> {
  const { session } = context
  const { hand, page } = session
  await hand.shot(`sweep ${where}`)
  const menus = page.locator(
    'main [aria-haspopup="menu"]:visible, main [aria-haspopup="true"]:visible'
  )
  const count = Math.min(await menus.count().catch(() => 0), 40)
  const opened = new Set<string>()
  for (let index = 0; index < count && opened.size < 8; index += 1) {
    if (
      !(await menus
        .nth(index)
        .isEnabled()
        .catch(() => false))
    )
      continue
    const target = await seen(menus.nth(index), where)
    // "More actions for <task>" is one kind of menu, however many tasks there are.
    const kind = (target.control ?? '').replace(/ for .+"$/, '"')
    if (!target.control || opened.has(kind) || AVOID.test(target.control)) continue
    opened.add(kind)
    await attempt(context, `${where}: open ${target.control}`, async () => {
      await hand.click(target)
      await hand.press('Escape')
    })
  }
}

/** Opens a view from the command palette, as a person does for one not in the sidebar. */
async function fromPalette(context: PhaseContext, name: string): Promise<void> {
  const { ui, hand } = context.session
  await hand.press('Control+K')
  await hand.type(name)
  await hand.click(ui.option(new RegExp(`^${name}`), false))
  await hand.expect(ui.heading(new RegExp(name), false), 8000)
}

const sweep: Phase = {
  name: 'sweep',
  title: 'Every screen and every menu on it, the way a curious person clicks around',
  needs: ['create-project'],
  run: async (context) => {
    const { session } = context
    const { ui, hand, page } = session

    for (const place of ['Home', 'Inbox', 'My work']) {
      await attempt(context, `Open ${place} from the sidebar`, async () => {
        await hand.click(ui.link(new RegExp(`^${place}`), false))
        await lookAround(context, place)
      })
    }
    for (const place of ['Search', 'Timesheet', 'Workload', 'Team']) {
      await attempt(context, `Open ${place} from the command palette`, async () => {
        await fromPalette(context, place)
        await lookAround(context, place)
      })
    }

    await attempt(context, 'Read every page of the user guide', async () => {
      await hand.click(ui.button('Help'))
      await hand.click(ui.menuitem('User guide'))
      const nav = page.getByRole('navigation', { name: 'User guide pages' })
      await nav.waitFor({ timeout: 8000 })
      const pages = await nav.getByRole('link').count()
      for (let index = 0; index < pages; index += 1) {
        await hand.click(await seen(nav.getByRole('link').nth(index), 'the user guide'), {
          noShot: index % 4 !== 0
        })
      }
    })

    await attempt(context, 'Open every settings section', async () => {
      await hand.click(ui.link('Settings'))
      const nav = page.getByRole('navigation', { name: 'Settings sections' })
      await nav.waitFor({ timeout: 8000 })
      const names = (await nav.getByRole('link').allInnerTexts()).map((name) => name.trim())
      for (const name of names) {
        await attempt(context, `Settings › ${name}`, async () => {
          await hand.click(ui.within(nav, 'the settings sections').link(name))
          await lookAround(context, `Settings › ${name}`)
        })
      }
    })

    await attempt(context, 'Open every tab of the project', async () => {
      await openProject(session, PROJECT_NAME)
      const tabs = page.locator('main [role=tablist]').first().getByRole('tab')
      const count = await tabs.count()
      for (let index = 0; index < count; index += 1) {
        const tab = await seen(tabs.nth(index), PROJECT_NAME)
        await attempt(context, `Project tab ${tab.control}`, async () => {
          await hand.click(tab)
          await lookAround(context, `${PROJECT_NAME} › ${tab.control}`)
        })
      }
    })

    for (const place of ['Archive', 'Recycle bin']) {
      await attempt(context, `Open the project's ${place} from its menu`, async () => {
        await openView(session, place)
        await lookAround(context, `${PROJECT_NAME} › ${place}`)
      })
    }
  }
}

const everyday: Phase = {
  name: 'everyday',
  title:
    'Everyday task work: timer and time, subtasks, renaming, delete and undo, the recycle bin, the archive, bulk changes, My work, Timesheet, the Library',
  needs: ['plan'],
  run: async (context) => {
    const { session, state } = context
    const { ui, hand, options } = session
    const projectId = state.projectId!
    const human = TASKS.filter((task) => !task.forAgent)
    const timed = human[0].title
    await openProject(session, PROJECT_NAME)
    await openTab(session, 'Board')

    await attempt(context, 'Time a task with its timer', async () => {
      await openTask(session, timed)
      const drawer = ui.dialog(timed)
      await hand.click(drawer.button('Start timer'))
      await hand.wait('the timer runs', 2500)
      const running = await hand.sees(ui.button(/^Timer running on/, false), 2000)
      verify(
        context,
        running,
        'A running timer shows in the status bar',
        'After Start timer, no "Timer running on …" control appeared.',
        'S3'
      )
      await hand.click(drawer.button('Stop timer'))
    })

    await attempt(context, 'Add time to a task by hand', async () => {
      if (!(await hand.sees(ui.dialog(timed).heading(timed), 1000))) await openTask(session, timed)
      await hand.click(ui.dialog(timed).button('Add time'))
      await hand.fill(ui.label('Duration'), '1h 30m')
      await hand.click(ui.dialog('Add time').button('Add time'))
      await hand.wait('the entry saves', 600)
      const id = state.tasks[human[0].key]
      const entries = await session.api(
        'read the time entries',
        async ({ projectId, id }: { projectId: string; id: string }) => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const result = await api.getTaskTimeEntries(projectId, id)
          return result.ok ? result.value.length : -1
        },
        { projectId, id }
      )
      verify(
        context,
        entries >= 2,
        'The timer and the hand-added time are both logged',
        `The task has ${entries} time entries; expected the timer's and the hand-added one.`
      )
    })

    await attempt(context, 'Add a subtask in the drawer', async () => {
      if (!(await hand.sees(ui.dialog(timed).heading(timed), 1000))) await openTask(session, timed)
      await hand.click(ui.dialog(timed).button('Add subtask'))
      await hand.fill(ui.label('New subtask title'), 'Export the icon at 16, 32 and 256 px')
      await hand.press('Enter')
      await hand.wait('the subtask saves', 600)
      const child = (await items(context)).find((item) => item.title.startsWith('Export the icon'))
      verify(
        context,
        !!child && child.parentWorkItemId === state.tasks[human[0].key],
        'A subtask added in the drawer belongs to its task',
        JSON.stringify(child ?? null)
      )
    })
    await hand.press('Escape').catch(() => {})

    const spare = 'Order tomato stickers'
    let spareTitle = (await items(context)).find((item) => item.title.startsWith(spare))?.title
    if (!spareTitle) {
      await attempt(context, 'Quick add a spare task to work on', async () => {
        await hand.press('Control+N')
        await hand.type(`${spare} for the launch`)
        await hand.press('Enter')
        await hand.wait('the task lands', 800)
      })
      spareTitle = (await items(context)).find((item) => item.title.startsWith(spare))?.title
    }
    const renamed = `${spare} (200, matte)`
    await attempt(context, 'Rename a task in its drawer', async () => {
      await openTask(session, spareTitle!)
      // The drawer is named by the task's title, which is what changes here.
      const drawer = ui.within(session.page.getByRole('dialog').last(), 'the task drawer')
      await hand.fill(drawer.textbox('Title'), renamed)
      await hand.press('Tab')
      await hand.wait('the title saves', 600)
      await hand.press('Escape')
      const saved = (await items(context)).some((item) => item.title === renamed)
      verify(context, saved, 'Renaming a task in its drawer saves the new title', `No "${renamed}"`)
      if (saved) spareTitle = renamed
    })

    await attempt(context, 'Move a task to the recycle bin, then Undo', async () => {
      await hand.click(ui.button(`More actions for ${spareTitle}`))
      await hand.click(ui.menuitem('Move to recycle bin'))
      await hand.click(ui.button('Undo'))
      await hand.wait('the task comes back', 800)
      verify(
        context,
        (await items(context)).some((item) => item.title === spareTitle),
        'Undo brings a task back from the recycle bin',
        'After Move to recycle bin and Undo, the task is not live.'
      )
    })

    await attempt(context, 'Move a task to the recycle bin and restore it from there', async () => {
      await hand.click(ui.button(`More actions for ${spareTitle}`))
      await hand.click(ui.menuitem('Move to recycle bin'))
      await hand.wait('the toast goes', 500)
      verify(
        context,
        (await items(context, 'deleted')).some((item) => item.title === spareTitle),
        'A task moved to the recycle bin is in the recycle bin',
        'Not listed as deleted.'
      )
      await openView(session, 'Recycle bin')
      await hand.click(ui.checkbox(`Select ${spareTitle}`))
      await hand.click(ui.button(/^Restore/, false))
      await hand.wait('the task is restored', 800)
      verify(
        context,
        (await items(context)).some((item) => item.title === spareTitle),
        'Restoring from the recycle bin puts the task back',
        'The task is not live after Restore.'
      )
    })

    await attempt(
      context,
      'Finish a task, archive it, and restore it from the archive',
      async () => {
        await openTab(session, 'Board')
        await hand.click(ui.button(`More actions for ${spareTitle}`))
        // Already done on a continued run: then the menu offers no Done.
        if (await hand.sees(ui.menuitem('Done'), 1500)) await hand.click(ui.menuitem('Done'))
        else await hand.press('Escape')
        await hand.click(ui.button(`More actions for ${spareTitle}`))
        await hand.click(ui.menuitem('Archive'))
        await hand.wait('the task is archived', 600)
        verify(
          context,
          (await items(context, 'archived')).some((item) => item.title === spareTitle),
          'Archiving a done task moves it to the archive',
          'Not listed as archived.'
        )
        await openView(session, 'Archive')
        await hand.click(ui.checkbox(`Select ${spareTitle}`))
        await hand.click(ui.button(/^Restore/, false))
        await hand.wait('the task is restored', 800)
        verify(
          context,
          (await items(context)).some((item) => item.title === spareTitle),
          'Restoring from the archive puts the task back',
          'The task is not live after Restore.'
        )
      }
    )

    await attempt(context, 'Select a card in the last column with the keyboard', async () => {
      await openTab(session, 'Board')
      // Focus moves to it as Tab would, scrolling it into view the browser's way.
      await hand.act(
        'press',
        ui.checkbox(`Select ${spareTitle}`),
        async (checkbox) => {
          await checkbox.focus({ timeout: 5000 })
          await session.page.keyboard.press('Space')
        },
        { value: 'Space' }
      )
      await hand.press('Escape')
      if (await hand.sees(ui.button('Clear selection'), 1000))
        await hand.click(ui.button('Clear selection'))
    })

    await attempt(context, 'Change the priority of two tasks at once', async () => {
      await openTab(session, 'Board')
      // Two tasks a person can see without scrolling the board: both hand-done tasks.
      const [first, second] = [human[0].title, human[1].title]
      await hand.click(ui.checkbox(`Select ${first}`))
      await hand.click(ui.checkbox(`Select ${second}`))
      await hand.expect(ui.text('2 selected'), 4000)
      await hand.select(ui.combobox('Set priority'), 'critical')
      await hand.wait('the change saves', 600)
      const now = await items(context)
      verify(
        context,
        [first, second].every(
          (title) => now.find((item) => item.title === title)?.priority === 'critical'
        ),
        'A bulk priority change reaches every selected task',
        JSON.stringify(
          now
            .filter((item) => [first, second].includes(item.title))
            .map((item) => [item.title, item.priority])
        )
      )
      if (await hand.sees(ui.button('Clear selection'), 1000))
        await hand.click(ui.button('Clear selection'))
    })

    await attempt(context, 'My work lists the task assigned to me', async () => {
      await hand.click(ui.link(/^My work/, false))
      await hand.expect(ui.heading('My work'), 8000)
      verify(
        context,
        await hand.sees(ui.text(timed), 5000),
        'My work lists a task assigned to me',
        `"${timed}" was assigned to me in the drawer but is not in My work.`
      )
    })

    await attempt(context, 'The Timesheet shows the time logged', async () => {
      await fromPalette(context, 'Timesheet')
      verify(
        context,
        await hand.sees(ui.text(timed), 5000),
        'The Timesheet shows time logged this week',
        `"${timed}" had 1h 30m logged today but is not on the Timesheet.`
      )
    })

    await attempt(context, 'Workload opens', async () => {
      await fromPalette(context, 'Workload')
    })

    await attempt(context, 'Import a file into the Library', async () => {
      const inputs = path.join(options.runDir, 'inputs')
      fs.mkdirSync(inputs, { recursive: true })
      const file = path.join(inputs, 'icon-licence.txt')
      fs.writeFileSync(file, 'Tomato icon pack: MIT licence, (c) the icon author.\n')
      await queueOpenFile(session.app, [file])
      await openProject(session, PROJECT_NAME)
      await openTab(session, 'Library')
      await hand.click(ui.region('Library items').button('Add'))
      await hand.click(ui.menuitem('Import files…'))
      verify(
        context,
        await hand.sees(ui.text(/icon-licence/), 8000),
        'An imported file shows in the Library',
        'icon-licence.txt was chosen in Import files… but is not listed.'
      )
    })

    await attempt(context, 'Mark the Inbox read', async () => {
      await hand.click(ui.link(/^Inbox/, false))
      const markAll = ui.button('Mark all as read')
      if (
        (await hand.sees(markAll, 2000)) &&
        (await markAll.locator.isEnabled().catch(() => false))
      ) {
        await hand.click(ui.button('Mark all as read'))
      }
    })

    await attempt(context, 'Stop all AI from the status bar, then resume', async () => {
      await hand.click(ui.button('Stop all AI'))
      const confirm = ui.button(/^Stop/, false)
      if (await hand.sees(ui.role('alertdialog', /stop/i, false), 1500)) await hand.click(confirm)
      const resume = ui.button(/Resume/, false)
      await hand.expect(resume, 5000)
      await hand.click(resume)
      verify(
        context,
        await hand.sees(ui.button('Stop all AI'), 5000),
        'Resume after Stop all AI brings the Stop all AI button back',
        'After Resume, the status bar does not offer Stop all AI again.'
      )
    })
  }
}

/** Screens shown again in the dark theme and in small windows. */
async function revisit(context: PhaseContext, label: string): Promise<void> {
  const { session } = context
  const { ui, hand } = session
  session.lookAgain()
  await attempt(context, `${label}: Home`, async () => {
    await hand.click(ui.link('Home'))
    await hand.shot(`${label} Home`)
  })
  await attempt(context, `${label}: the project`, async () => {
    await openProject(session, PROJECT_NAME)
    for (const tab of ['Overview', 'Board', 'List', 'Timeline', 'Library', 'History', 'Agents']) {
      await attempt(context, `${label}: ${tab}`, async () => {
        await openTab(session, tab)
        await hand.shot(`${label} ${tab}`)
      })
    }
    await openTab(session, 'Board')
    await openTask(session, TASKS.find((task) => !task.forAgent)!.title)
    await hand.shot(`${label} task drawer`)
    await hand.press('Escape')
  })
  await attempt(context, `${label}: Settings`, async () => {
    await openSettings(session, 'General')
    await hand.shot(`${label} Settings`)
  })
}

const appearance: Phase = {
  name: 'appearance',
  title: 'How it looks: the dark theme, and a small window',
  needs: ['plan'],
  run: async (context) => {
    const { session } = context
    const { ui, hand, page, options } = session
    await openSettings(session, 'General')
    await hand.click(ui.radio(/^Dark/, false))
    const theme = await page.locator('html').getAttribute('data-theme')
    verify(
      context,
      theme === 'dark',
      'Choosing Dark applies it at once',
      `data-theme is ${theme}`,
      'S3'
    )
    await revisit(context, 'Dark')
    await openSettings(session, 'General')
    await hand.click(ui.radio(/^Light/, false))

    for (const size of [
      { width: 1024, height: 640 },
      // The smallest window Ostler allows (electron/app/window.ts).
      { width: 900, height: 600 }
    ]) {
      await setWindowSize(session.app, page, size)
      await revisit(context, `${size.width}×${size.height}`)
    }
    await setWindowSize(session.app, page, options.viewport)
  }
}

export const COVERAGE_PHASES: Phase[] = [sweep, everyday, appearance]
