import { expect, test, type Locator, type Page } from '@playwright/test'
import type { OstlerAPI } from '../../src/shared/ostler-api'
import { OFF_SCREEN_CLIPBOARD_KEY } from '../../src/shared/off-screen-clipboard'
import { copiedText } from './copied-text'
import {
  closeAudit,
  createSampleProject,
  launchForAudit,
  openPath,
  startApp,
  type A11yApp
} from './a11y-app'

/**
 * Whiteboards end to end (plan `docs/plans/whiteboards/`, prompt 19a), in the
 * real app, off screen, through keys and clicks: IPC only seeds a board or
 * reads what was saved. A template from the Plan and the board in the
 * Library; notes, a shape and Connect to… by keyboard with undo and redo; a
 * link opened in the task drawer; Make tasks and its Undo; copy and paste
 * between boards, Ctrl+Shift+V as one note per line; and the board as it was
 * after a restart.
 */

let target: A11yApp | null = null

test.afterEach(async () => {
  if (target) await closeAudit(target)
  target = null
})

async function start(
  options: { theme?: 'light' | 'dark'; viewport?: { width: number; height: number } } = {}
): Promise<{ page: Page; projectId: string; taskId: string }> {
  target = await launchForAudit({ theme: options.theme ?? 'light', viewport: options.viewport })
  const page = target.page
  await page.locator('main').first().waitFor()
  const { projectId, taskId } = await createSampleProject(page)
  return { page, projectId, taskId }
}

/** The open board: the group the editor names "Whiteboard: <title>". */
const board = (page: Page): Locator => page.getByRole('group', { name: /^Whiteboard: / })

/** An object on the open board, by its spoken name. */
const object = (page: Page, name: string | RegExp): Locator =>
  board(page).getByRole('button', typeof name === 'string' ? { name, exact: true } : { name })

/** A board made through IPC, with optional first objects; returns its id. */
async function seedBoard(
  page: Page,
  projectId: string,
  title: string,
  objects: unknown[] = []
): Promise<string> {
  return page.evaluate(
    async ({ projectId, title, objects }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const created = await api.createWhiteboard(projectId, { title, objects: objects as never })
      if (!created.ok) throw new Error(created.error)
      return created.value.item.id
    },
    { projectId, title, objects }
  )
}

/** The board as stored: each object's kind, text, link and box. */
async function storedObjects(page: Page, projectId: string, whiteboardId: string) {
  return page.evaluate(
    async ({ projectId, whiteboardId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const found = await api.getWhiteboard(projectId, whiteboardId)
      if (!found.ok) throw new Error(found.error)
      return found.value.objects
        .map(({ id, kind, text, link, x, y, width, height }) => ({
          id,
          kind,
          text,
          link,
          x,
          y,
          width,
          height
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    },
    { projectId, whiteboardId }
  )
}

async function taskTitle(page: Page, projectId: string, taskId: string): Promise<string> {
  return page.evaluate(
    async ({ projectId, taskId }) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const items = await api.getPlanningWorkItems(projectId)
      if (!items.ok) throw new Error(items.error)
      const task = items.value.find((item) => item.id === taskId)
      if (!task) throw new Error('No such task')
      return task.title
    },
    { projectId, taskId }
  )
}

async function press(page: Page, key: string, times: number): Promise<void> {
  for (let count = 0; count < times; count++) await page.keyboard.press(key)
}

/** Opens a Library section by its tab, or from More when the tab does not fit. */
async function openLibrarySection(page: Page, name: string): Promise<void> {
  const sections = page.locator('.ostler-library-sections')
  const tab = sections.getByRole('tab', { name: new RegExp(`^${name}`) })
  if ((await tab.count()) > 0) {
    await tab.click()
    return
  }
  await sections.getByRole('button', { name: /^More/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click()
}

test('makes a whiteboard from the Brainstorm template and opens it from the Library', async () => {
  test.setTimeout(120_000)
  const { page, projectId } = await start()

  await openPath(page, `/projects/${projectId}/plan`)
  await page.getByRole('button', { name: /^Whiteboards/ }).click()
  await page.getByRole('button', { name: 'New whiteboard' }).click()
  const dialog = page.getByRole('dialog', { name: 'New whiteboard' })
  // A template is chosen by its card (the radio inside it sits under the preview).
  await dialog.getByText('Brainstorm', { exact: true }).click()
  await expect(dialog.getByRole('radio', { name: 'Brainstorm' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Whiteboard 1' })).toBeVisible()
  // The mind map grows from the project's name, with three ideas.
  await expect(object(page, /^Central idea: Sample project, 3 branches/)).toHaveCount(1)
  await expect(object(page, /^Idea: Idea \d, level 1/)).toHaveCount(3)

  // The Library lists it under Whiteboards; opening it there opens the Plan with the board.
  await openPath(page, `/projects/${projectId}/library`)
  await openLibrarySection(page, 'Whiteboards')
  const row = page.getByRole('option', { name: /Whiteboard 1/ })
  await expect(row).toHaveCount(1)
  await row.dblclick()
  await expect(page.getByRole('heading', { name: 'Whiteboard 1' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Plan', selected: true })).toBeVisible()
  await expect(object(page, /^Central idea: Sample project/)).toHaveCount(1)
})

test('builds, connects, links and makes tasks on a board by keyboard', async () => {
  test.setTimeout(180_000)
  const { page, projectId, taskId } = await start()
  const title = await taskTitle(page, projectId, taskId)
  const whiteboardId = await seedBoard(page, projectId, 'Venue plan')
  await openPath(page, `/projects/${projectId}/plan?whiteboard=${whiteboardId}`)
  await expect(page.getByRole('heading', { name: 'Venue plan' })).toBeVisible()

  // N, Enter: a note in the middle of the view with its text box open.
  await board(page).focus()
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused()
  await page.keyboard.type('Call the venue')
  await page.keyboard.press('Control+Enter')
  const note = object(page, /^Note: Call the venue/)
  await expect(note).toBeFocused()

  // S, Enter: a rectangle, moved out from under the note.
  await page.keyboard.press('s')
  await page.keyboard.press('Enter')
  const shape = object(page, 'Rectangle')
  await expect(shape).toBeFocused()
  await press(page, 'Shift+ArrowRight', 30)
  await expect(shape).toBeFocused()

  // The note, C (Connect to…), the rectangle: an arrow joins them.
  await note.click()
  await expect(note).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('c')
  const connect = page.getByRole('dialog', { name: 'Connect to another object' })
  await connect.getByRole('radio', { name: 'Rectangle' }).check()
  await connect.getByRole('button', { name: 'Connect' }).click()
  await expect(connect).toHaveCount(0)
  const arrow = object(page, 'Arrow from Call the venue to Rectangle')
  await expect(arrow).toHaveCount(1)
  await expect(note).toBeFocused()
  // Ctrl+Z takes it away and Ctrl+Y brings it back.
  await page.keyboard.press('Control+z')
  await expect(arrow).toHaveCount(0)
  await page.keyboard.press('Control+y')
  await expect(arrow).toHaveCount(1)

  // L: the note links to the sample project's task, found by its title.
  await expect(note).toBeFocused()
  await page.keyboard.press('l')
  const link = page.getByRole('dialog', { name: 'Link to an item or web page' })
  await expect(link.getByRole('combobox', { name: 'Find an item' })).toBeFocused()
  await page.keyboard.type(title)
  await expect(link.getByRole('option', { name: new RegExp(title) }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(link).toHaveCount(0)
  const linked = object(page, new RegExp(`^Note: Call the venue, linked to task ${title}`))
  await expect(linked).toHaveCount(1)
  await expect(linked).toBeFocused()

  // O opens the task in its drawer; closing the drawer shows the board again.
  await page.keyboard.press('o')
  const drawer = page.getByRole('dialog', { name: title })
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Venue plan' })).toBeVisible()
  await expect(linked).toHaveCount(1)

  // A second note, moved below the first; Make tasks from the style bar.
  await linked.click()
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused()
  await page.keyboard.type('Book the band')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ask about dates')
  await page.keyboard.press('Control+Enter')
  const second = object(page, /^Note: Book the band Ask about dates/)
  await expect(second).toBeFocused()
  await press(page, 'Shift+ArrowDown', 30)
  // The style bar's Make tasks, which can't be used once the note is linked.
  await page
    .getByRole('toolbar', { name: 'Style' })
    .getByRole('button', { name: 'Make tasks' })
    .click()
  const make = page.getByRole('dialog', { name: 'Make tasks' })
  await make.getByRole('button', { name: 'Make 1 task' }).click()
  await expect(make).toHaveCount(0)
  const made = object(page, /^Note: Book the band Ask about dates, linked to task/)
  await expect(made).toHaveCount(1)
  // The button can't be used with the note's last task made: focus goes back to the note.
  await expect(made).toBeFocused()
  const toast = page.locator('.ui-toast', { hasText: 'Made 1 task' })
  await expect(toast).toBeVisible()

  // The task, titled with the note's first line, is in the List view.
  await page.getByRole('tab', { name: 'List', exact: true }).click()
  const listed = page.getByRole('gridcell', { name: 'Book the band', exact: true })
  await expect(listed).toBeVisible()
  // The toast's Undo removes the task and the note's link.
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(listed).toHaveCount(0)
  await expect
    .poll(async () => {
      const objects = await storedObjects(page, projectId, whiteboardId)
      return objects.find((entry) => entry.text.startsWith('Book the band'))?.link
    })
    .toBeNull()
})

/** The open board's page and the room it has, in CSS pixels. */
async function boardWidths(page: Page) {
  return page.evaluate(() => {
    const boardPage = document.querySelector('.plan-page--board') as HTMLElement
    const room = boardPage.closest('.ostler-workspace') as HTMLElement
    const style = getComputedStyle(room)
    const inner = room.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const editor = document.querySelector('.plan-board__editor') as HTMLElement
    return {
      room: Math.round(inner),
      page: Math.round(boardPage.getBoundingClientRect().width),
      editor: Math.round(editor.getBoundingClientRect().width)
    }
  })
}

test('an open board fills the page, its style controls fixed in place while objects are styled', async () => {
  test.setTimeout(120_000)
  const { page, projectId } = await start({ viewport: { width: 1440, height: 900 } })
  const whiteboardId = await seedBoard(page, projectId, 'Wide board', [
    { id: 'note-a', kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, text: 'A note' }
  ])
  await openPath(page, `/projects/${projectId}/plan?whiteboard=${whiteboardId}`)
  await expect(page.getByRole('heading', { name: 'Wide board' })).toBeVisible()

  const empty = await boardWidths(page)
  expect(empty.page).toBe(empty.room)
  expect(empty.editor).toBe(empty.room)

  // The Style controls are in the top bar, with or without a selection, in the same place.
  const styleBar = page.getByRole('toolbar', { name: 'Style' })
  await expect(styleBar).toBeVisible()
  const before = (await styleBar.boundingBox())!
  await object(page, 'Note: A note').click()
  expect(await boardWidths(page)).toEqual(empty)
  expect(await styleBar.boundingBox()).toEqual(before)
  // Every control fits in the bar, and the bar sits above the board, not over it.
  const fits = await styleBar.evaluate((bar) => {
    const stage = document.querySelector('.wb-editor__stage') as HTMLElement
    return (
      bar.scrollWidth <= bar.clientWidth &&
      bar.getBoundingClientRect().bottom <= stage.getBoundingClientRect().top
    )
  })
  expect(fits).toBe(true)
  await page.keyboard.press('Escape')
  expect(await styleBar.boundingBox()).toEqual(before)
  expect(await boardWidths(page)).toEqual(empty)
})

test('a text box being edited has the colours of the object in the dark theme', async () => {
  test.setTimeout(120_000)
  const { page, projectId } = await start({ theme: 'dark' })
  const whiteboardId = await seedBoard(page, projectId, 'Dark board', [
    { id: 'note-y', kind: 'note', x: 0, y: 200, width: 200, height: 200, z: 0, text: 'Yellow' },
    {
      id: 'shape-b',
      kind: 'shape',
      x: 300,
      y: 200,
      width: 160,
      height: 120,
      z: 1,
      text: 'Solid',
      colour: 'blue',
      data: { shape: 'rectangle', fill: 'solid' }
    }
  ])
  await openPath(page, `/projects/${projectId}/plan?whiteboard=${whiteboardId}`)
  await expect(page.getByRole('heading', { name: 'Dark board' })).toBeVisible()

  for (const [name, box] of [
    ['Note: Yellow', 'Note text'],
    ['Rectangle: Solid', 'Shape text']
  ]) {
    const shown = object(page, name)
    // The colours the scene draws the object with, before it is hidden for editing.
    const drawn = await shown.evaluate((group) => {
      const text = group.querySelector('text') as SVGTextElement
      const fill = group.querySelector('[data-note-body], rect') as SVGGraphicsElement
      return { fill: getComputedStyle(fill).fill, text: getComputedStyle(text).fill }
    })
    await shown.dblclick()
    const editor = page.getByRole('textbox', { name: box })
    await expect(editor).toBeFocused()
    const editing = await editor.evaluate((node) => {
      const style = getComputedStyle(node)
      return { fill: style.backgroundColor, text: style.color }
    })
    expect(editing).toEqual(drawn)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
  }
})

test('copies between boards, pastes lines as notes, and keeps the board after a restart', async () => {
  test.setTimeout(180_000)
  const { page, projectId } = await start()
  const firstId = await seedBoard(page, projectId, 'Board one', [
    {
      id: 'note-venue',
      kind: 'note',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      z: 0,
      text: 'Call the venue'
    },
    {
      id: 'shape-stage',
      kind: 'shape',
      x: 300,
      y: 40,
      width: 160,
      height: 120,
      z: 1,
      text: 'Stage',
      data: { shape: 'ellipse' }
    }
  ])
  const secondId = await seedBoard(page, projectId, 'Board two')
  await openPath(page, `/projects/${projectId}/plan?whiteboard=${firstId}`)
  await expect(page.getByRole('heading', { name: 'Board one' })).toBeVisible()

  // Ctrl+A, Ctrl+C: the objects' text goes on Ostler's own clipboard.
  await object(page, 'Note: Call the venue').click()
  await page.keyboard.press('Control+a')
  await expect(object(page, 'Ellipse: Stage')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+c')
  await expect.poll(() => copiedText(target!.app)).toContain('Call the venue')
  expect(await copiedText(target!.app)).toContain('Stage')

  // Another board, Ctrl+V: the objects arrive.
  await page.getByRole('button', { name: 'Back to the plan' }).click()
  await page.getByRole('button', { name: 'Open Board two' }).click()
  await expect(page.getByRole('heading', { name: 'Board two' })).toBeVisible()
  await board(page).click()
  await page.keyboard.press('Control+v')
  await expect(object(page, 'Note: Call the venue')).toHaveCount(1)
  await expect(object(page, 'Ellipse: Stage')).toHaveCount(1)

  // Ctrl+Shift+V with three lines on the clipboard: three notes.
  await target!.app.evaluate(
    (_electron, { key, text }) => {
      ;(globalThis as unknown as Record<symbol, { text: string }>)[Symbol.for(key)] = { text }
    },
    { key: OFF_SCREEN_CLIPBOARD_KEY, text: 'Ring the caterer\nHire chairs\nPrint the invitations' }
  )
  await page.keyboard.press('Control+Shift+v')
  for (const line of ['Ring the caterer', 'Hire chairs', 'Print the invitations']) {
    await expect(object(page, `Note: ${line}`)).toHaveCount(1)
  }
  await expect(board(page).locator('[data-object-id]')).toHaveCount(5)

  // Saved, closed and started again: every object is where it was.
  await expect(page.locator('.statusbar-save')).toHaveText('Saved')
  const before = await storedObjects(page, projectId, secondId)
  expect(before).toHaveLength(5)
  const dataDir = target!.dataDir
  await target!.app.close()
  target = await startApp(dataDir)
  const again = target.page
  await again.locator('main').first().waitFor()
  await openPath(again, `/projects/${projectId}/plan?whiteboard=${secondId}`)
  await expect(again.getByRole('heading', { name: 'Board two' })).toBeVisible()
  await expect(board(again).locator('[data-object-id]')).toHaveCount(5)
  for (const entry of before) {
    await expect(board(again).locator(`[data-object-id="${entry.id}"]`)).toHaveCount(1)
  }
  expect(await storedObjects(again, projectId, secondId)).toEqual(before)
})
