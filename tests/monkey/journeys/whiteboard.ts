import type { Locator } from '@playwright/test'
import type { OstlerAPI } from '../../../src/shared/ostler-api'
import { SAMPLE_TEMPLATE_ID } from '../../../src/shared/ostler-api/template-types'
import { setWindowSize } from '../lib/app'
import type { FakeAi } from '../lib/fake-ai'
import type { Session, Target } from '../lib/session'
import { runPhases, type Phase, type PhaseContext } from './phases'

/**
 * The whiteboard monkey (`npm run monkey -- whiteboard`): a whiteboard used
 * hard, through the mouse and keyboard, the way a person who has never seen
 * it would. Every tool on the board, drawing and dragging with the pointer,
 * every style and Arrange choice, the dialogs, zoom and pan, the keyboard,
 * every template, export, rename and a restart, then a seeded random spell of
 * clicks, double-clicks, right-clicks, drags and keys on the board.
 *
 * Pointer work is filmed: a drag is photographed while the button is still
 * down, and every action ends with a burst of screenshots a moment apart, so
 * what flickers, jumps or lags shows up in the run's `review/` sheets. After
 * every action the board itself is checked: no object drawn at NaN, nothing
 * left in a "Couldn't save" state.
 */

interface BoardState {
  projectId?: string
  boardId?: string
}

/** Screenshots a moment apart after an action: what moves or flickers shows between them. */
const BURST_GAPS_MS = [0, 120, 400]

function boardState(context: PhaseContext): BoardState {
  return context.state as unknown as BoardState
}

class Board {
  constructor(private readonly session: Session) {}

  get page() {
    return this.session.page
  }

  /** The open board: the group the editor names "Whiteboard: <title>". */
  get locator(): Locator {
    return this.page.getByRole('group', { name: /^Whiteboard: / })
  }

  target(): Target {
    return { locator: this.locator, description: 'the whiteboard' }
  }

  toolbar(name: string): Locator {
    return this.page.getByRole('toolbar', { name, exact: true })
  }

  objects(): Locator {
    return this.locator.locator('[data-object-id]')
  }

  async box(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.locator.boundingBox()
    if (!box) throw new Error('The whiteboard is not on screen')
    return box
  }

  /** A point on the board, as fractions of its width and height. */
  async at(fx: number, fy: number): Promise<{ x: number; y: number }> {
    const box = await this.box()
    return { x: box.x + box.width * fx, y: box.y + box.height * fy }
  }

  async burst(label: string): Promise<void> {
    let last = 0
    for (const [index, gap] of BURST_GAPS_MS.entries()) {
      await this.page.waitForTimeout(gap - last)
      last = gap
      await this.session.recorder.screenshot(this.page, `${label} burst ${index + 1}`, {
        force: true
      })
    }
  }

  /** What the screen shows now, as a burst, with no action. */
  async shotAll(label: string): Promise<void> {
    await this.burst(label)
  }

  /** Anything wrong the board shows on its own: NaN geometry, a failed save. */
  async sanity(after: string): Promise<void> {
    const found = await this.page
      .evaluate(() => {
        const problems: string[] = []
        const board = document.querySelector('.wb-editor__board')
        if (board) {
          for (const element of Array.from(board.querySelectorAll('*'))) {
            for (const attribute of Array.from(element.attributes)) {
              if (/NaN|Infinity/.test(attribute.value) && attribute.name !== 'aria-label') {
                problems.push(
                  `<${element.tagName.toLowerCase()} ${attribute.name}="${attribute.value.slice(0, 80)}">`
                )
              }
            }
          }
        }
        const save = document.querySelector('.statusbar-save')
        const failed = save?.getAttribute('data-state') === 'failed'
        return { problems: problems.slice(0, 5), failed }
      })
      .catch(() => ({ problems: [] as string[], failed: false }))
    const where = await this.session.screen()
    if (found.problems.length) {
      this.session.recorder.finding({
        kind: 'broken',
        severity: 'S2',
        title: 'The whiteboard draws something at NaN or Infinity',
        details: `After ${after}: ${found.problems.join(', ')}`,
        where,
        screenshot: this.session.recorder.lastScreenshot,
        key: 'wb-nan'
      })
    }
    if (found.failed) {
      this.session.recorder.finding({
        kind: 'broken',
        severity: 'S2',
        title: "The whiteboard says it couldn't save",
        details: `After ${after}.`,
        where,
        screenshot: this.session.recorder.lastScreenshot,
        key: 'wb-save-failed'
      })
    }
  }

  /**
   * A pointer gesture on the board, recorded as one action and filmed: a
   * screenshot while the button is down halfway, another at the end before it
   * is let go, then a burst after.
   */
  async gesture(
    label: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    { button = 'left', modifier }: { button?: 'left' | 'middle' | 'right'; modifier?: string } = {}
  ): Promise<void> {
    const { hand, recorder } = this.session
    await hand
      .act(
        'drag',
        this.target(),
        async () => {
          const mouse = this.page.mouse
          if (modifier) await this.page.keyboard.down(modifier)
          await mouse.move(from.x, from.y)
          await mouse.down({ button })
          const steps = 12
          for (let step = 1; step <= steps; step += 1) {
            const x = from.x + ((to.x - from.x) * step) / steps
            // A slight curve, as a hand draws.
            const y =
              from.y + ((to.y - from.y) * step) / steps + Math.sin((step / steps) * Math.PI) * 25
            await mouse.move(x, y)
            if (step === steps / 2) {
              await recorder.screenshot(this.page, `${label} mid-drag`, { force: true })
            }
          }
          await recorder.screenshot(this.page, `${label} before release`, { force: true })
          await mouse.up({ button })
          if (modifier) await this.page.keyboard.up(modifier)
        },
        { value: label, noShot: true }
      )
      .catch(() => {})
    await this.burst(label)
    await this.sanity(label)
  }

  /** A click on the board at a point (single, double or right). */
  async clickAt(
    label: string,
    point: { x: number; y: number },
    {
      button = 'left',
      clickCount = 1,
      modifier
    }: {
      button?: 'left' | 'right' | 'middle'
      clickCount?: number
      modifier?: string
    } = {}
  ): Promise<void> {
    const kind = clickCount > 1 ? 'double-click' : button === 'right' ? 'right-click' : 'click'
    await this.session.hand
      .act(
        kind,
        this.target(),
        async () => {
          if (modifier) await this.page.keyboard.down(modifier)
          await this.page.mouse.click(point.x, point.y, { button, clickCount })
          if (modifier) await this.page.keyboard.up(modifier)
        },
        { value: label, noShot: true }
      )
      .catch(() => {})
    await this.burst(label)
    await this.sanity(label)
  }

  /** A control pressed, then filmed. Failures are recorded by the hand and passed over. */
  async press(target: Target, label = target.description): Promise<boolean> {
    try {
      await this.session.hand.click(target, { noShot: true, timeout: 4000 })
      await this.burst(label)
      await this.sanity(label)
      return true
    } catch {
      return false
    }
  }

  async key(keys: string, label = keys): Promise<void> {
    await this.session.hand.press(keys, { noShot: true }).catch(() => {})
    await this.burst(`key ${label}`)
    await this.sanity(`key ${label}`)
  }

  /** The middle of an object on the board, or null when it is not there. */
  async centreOf(object: Locator): Promise<{ x: number; y: number } | null> {
    const box = await object.boundingBox().catch(() => null)
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
  }

  byId(id: string): Locator {
    return this.locator.locator(`[data-object-id="${id}"]`)
  }

  /**
   * A point on the board where the object itself is what the pointer would
   * hit (not its empty middle, not something on top of it), or null.
   */
  async hitPoint(id: string): Promise<{ x: number; y: number } | null> {
    return this.page
      .evaluate((id) => {
        const element = document.querySelector(`.wb-editor__board [data-object-id="${id}"]`)
        const board = document.querySelector('.wb-editor__board')
        if (!element || !board) return null
        const box = element.getBoundingClientRect()
        const area = board.getBoundingClientRect()
        const steps = 9
        for (let row = 1; row < steps; row += 1) {
          for (let column = 1; column < steps; column += 1) {
            const x = box.left + (box.width * column) / steps
            const y = box.top + (box.height * row) / steps
            if (x < area.left + 4 || x > area.right - 4 || y < area.top + 4 || y > area.bottom - 4)
              continue
            const hit = document.elementFromPoint(x, y)?.closest('[data-object-id]')
            if (hit?.getAttribute('data-object-id') === id) return { x, y }
          }
        }
        return null
      }, id)
      .catch(() => null)
  }

  /** A whiteboard finding, with the last screenshot. */
  async lead(title: string, details: string, key: string): Promise<void> {
    this.session.recorder.finding({
      kind: 'broken',
      severity: 'S3',
      title,
      details,
      where: await this.session.screen(),
      screenshot: this.session.recorder.lastScreenshot,
      key
    })
  }

  /** Leaves editing and menus, and puts the select tool back. */
  async calm(): Promise<void> {
    await this.page.keyboard.press('Escape').catch(() => {})
    await this.page.keyboard.press('Escape').catch(() => {})
    const select = this.toolbar('Tools').getByRole('button').first()
    await select.click({ timeout: 2000 }).catch(() => {})
  }

  /** The names of the buttons in a toolbar, as a screen reader reads them. */
  async buttonNames(toolbar: Locator): Promise<string[]> {
    const buttons = toolbar.getByRole('button')
    const count = await buttons.count().catch(() => 0)
    const names: string[] = []
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index)
      const name =
        (await button.getAttribute('aria-label').catch(() => null)) ??
        (await button.innerText().catch(() => ''))
      if (name) names.push(name.trim())
    }
    return names
  }

  /** How many objects the board shows, against how many are saved. */
  async compareWithSaved(context: PhaseContext, after: string): Promise<void> {
    const { projectId, boardId } = boardState(context)
    if (!projectId || !boardId) return
    await this.page
      .locator('.statusbar-save[data-state="saved"]')
      .waitFor({ timeout: 8000 })
      .catch(() => {})
    const shown = await this.objects().count()
    const saved = await this.session
      .api(
        'whiteboard objects as saved',
        async ({ projectId, boardId }) => {
          const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
          const found = await api.getWhiteboard(projectId, boardId)
          return found.ok ? found.value.objects.length : -1
        },
        { projectId, boardId }
      )
      .catch(() => -1)
    this.session.recorder.journal(`- ${after}: ${shown} objects on screen, ${saved} saved.`)
    if (saved >= 0 && shown !== saved) {
      this.session.recorder.finding({
        kind: 'broken',
        severity: 'S2',
        title: `The board shows ${shown} objects but ${saved} are saved`,
        details: `After ${after}, once the board said Saved.`,
        where: await this.session.screen(),
        screenshot: this.session.recorder.lastScreenshot,
        key: `wb-count|${after}`
      })
    }
  }
}

/** Opens an internal route the way a deep link does: a fresh render at that route. */
async function openRoute(session: Session, route: string): Promise<void> {
  const page = session.page
  await page.evaluate((hash) => {
    location.hash = hash
  }, route)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('main').first().waitFor({ timeout: 15_000 })
  await session.hand.settle(800)
}

async function openPlan(session: Session, projectId: string): Promise<void> {
  await openRoute(session, `/projects/${projectId}/plan`)
}

async function openWhiteboardsList(session: Session): Promise<void> {
  const ui = session.ui
  if (await session.hand.sees(ui.button('New whiteboard'), 1500)) return
  await session.hand.click(ui.button(/^Whiteboards/, false))
}

/** A new board from a template, through the New whiteboard dialog. */
async function newBoard(session: Session, board: Board, template: string): Promise<void> {
  const { hand, ui } = session
  await openWhiteboardsList(session)
  await hand.click(ui.button('New whiteboard'))
  const dialog = ui.dialog('New whiteboard')
  await board.press(dialog.text(template, true), `template ${template}`)
  await hand.click(dialog.button('Create'))
  await hand.expect({ locator: board.locator, description: 'the new whiteboard' }, 10_000)
  await board.burst(`new board ${template}`)
}

/** The open board's id: the board titled as the heading says (the router keeps no URL). */
async function currentBoardId(session: Session, projectId: string): Promise<string | undefined> {
  const title = await session.page
    .locator('.plan-board__title')
    .innerText()
    .catch(() => '')
  return session
    .api(
      'find the open whiteboard',
      async ({ projectId, title }) => {
        const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
        const listed = await api.listLibraryItems(projectId, { kind: 'whiteboard' })
        if (!listed.ok) return undefined
        return listed.value.find((item) => item.title === title)?.id
      },
      { projectId, title: title.trim() }
    )
    .catch(() => undefined)
}

/**
 * Types only when a text box has the focus. Typed into the board itself, the
 * letters would be tool shortcuts (E is the eraser), so a gesture that should
 * have opened a text box and did not is noted instead.
 */
async function typeIfEditing(session: Session, text: string, after: string): Promise<boolean> {
  const editing = await session.page
    .evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      return (
        !!active &&
        (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)
      )
    })
    .catch(() => false)
  if (!editing) {
    session.recorder.journal(`- No text box after ${after}: nothing typed.`)
    return false
  }
  await session.hand.type(text, { noShot: true }).catch(() => {})
  return true
}

function phases(): Phase[] {
  return [
    {
      name: 'wb-setup',
      title: 'A project and a blank whiteboard, through the Plan',
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        // A new install opens on the welcome; skip it, as someone here for the whiteboard would.
        const skip = session.ui.button('Skip for now')
        if (await session.hand.sees(skip, 4000)) await session.hand.click(skip)
        const projectId = await session.api(
          'make the sample project',
          async (templateId) => {
            const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
            const created = await api.createProject({
              name: 'Whiteboard monkey',
              color: '',
              tags: [],
              notes: '',
              folder: null,
              templateId
            })
            if (!created.ok) throw new Error(created.error)
            return created.value.project.id
          },
          SAMPLE_TEMPLATE_ID
        )
        boardState(context).projectId = projectId
        await openPlan(session, projectId)
        // The sample project offers a tour. Not now brings it back on the next
        // reload, over the board's Export button, so the monkey turns it off.
        const never = session.ui.text("Don't show this again", true)
        if (await session.hand.sees(never, 3000)) {
          await session.hand.shot('the tour, over the Plan')
          await session.hand.click(never)
        }
        await session.hand.shot('plan')
        await openWhiteboardsList(session)
        await session.hand.shot('whiteboards list, empty')
        await newBoard(session, board, 'Blank')
        boardState(context).boardId = await currentBoardId(session, projectId)
      }
    },
    {
      name: 'wb-tools',
      title: 'Every tool: chosen, clicked on the board and dragged across it',
      needs: ['wb-setup'],
      run: async ({ session }) => {
        const board = new Board(session)
        const names = await board.buttonNames(board.toolbar('Tools'))
        session.recorder.journal(`- Tools on the board: ${names.join(', ')}`)
        let row = 0
        for (const name of names) {
          if (/picture|^Link/i.test(name)) continue
          row += 1
          // Each tool gets its own patch of the board: four across, three down.
          const x = 0.04 + ((row - 1) % 4) * 0.24
          const y = 0.06 + Math.floor((row - 1) / 4) * 0.31
          await board.calm()
          await board.press(
            {
              locator: board.toolbar('Tools').getByRole('button', { name, exact: true }),
              description: `tool "${name}"`
            },
            `tool ${name}`
          )
          // A click where nothing is.
          await board.clickAt(`${name}: click`, await board.at(x, y))
          if (/note|text|frame|idea|mind/i.test(name)) {
            await board.key('Enter')
            await typeIfEditing(session, `${name} ${row} — Ünïcödé ✓`, 'the gesture before')
            await board.burst(`${name}: typed`)
            await board.key('Control+Enter')
          }
          await board.calm()
          await board.press(
            {
              locator: board.toolbar('Tools').getByRole('button', { name, exact: true }),
              description: `tool "${name}"`
            },
            `tool ${name} again`
          )
          // A drag across empty board.
          await board.gesture(
            `${name}: drag`,
            await board.at(x + 0.02, y + 0.14),
            await board.at(x + 0.18, y + 0.26)
          )
          if (/note|text|frame|idea|mind/i.test(name)) {
            await typeIfEditing(session, `dragged ${name}`, 'the gesture before')
            await board.key('Escape')
          }
        }
        await board.calm()
        await board.shotAll('after every tool')
      }
    },
    {
      name: 'wb-eraser',
      title: 'The eraser dragged through what is there',
      needs: ['wb-tools'],
      run: async ({ session }) => {
        const board = new Board(session)
        const eraser = board.toolbar('Tools').getByRole('button', { name: /^Eraser/ })
        if (!(await board.press({ locator: eraser, description: 'tool Eraser' }))) return
        await board.gesture(
          'eraser through the drawings',
          await board.at(0.3, 0.1),
          await board.at(0.65, 0.9)
        )
        await board.calm()
        await board.key('Control+z', 'Ctrl+Z after erasing')
      }
    },
    {
      name: 'wb-select',
      title: 'Selecting, moving, resizing and box-selecting with the pointer',
      needs: ['wb-tools'],
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        await board.calm()
        const count = await board.objects().count()
        session.recorder.journal(`- ${count} objects on the board before selecting.`)
        const ids = await board
          .objects()
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-object-id') ?? '')
          )
        for (const id of ids.slice(0, 10)) {
          const object = board.byId(id)
          const name = (await object.getAttribute('aria-label').catch(() => null)) ?? id
          const point = await board.hitPoint(id)
          if (!point) {
            session.recorder.journal(`- ${name}: no visible part of it to click.`)
            continue
          }
          await board.clickAt(`select ${name}`, point)
          if ((await object.getAttribute('aria-pressed').catch(() => null)) !== 'true') {
            await board.lead(
              `Clicking a ${name.split(':')[0]} did not select it`,
              `Clicked on a visible part of "${name}" with the Select tool; it was not selected (aria-pressed is not true).`,
              `wb-no-select|${name.split(':')[0]}`
            )
            continue
          }
          // Move it, and check it moved.
          const before = await object.boundingBox().catch(() => null)
          await board.gesture(`move ${name}`, point, { x: point.x + 60, y: point.y + 40 })
          const after = await board
            .byId(id)
            .boundingBox()
            .catch(() => null)
          if (before && after) {
            const dx = after.x - before.x
            const dy = after.y - before.y
            if (Math.abs(dx - 60) > 12 || Math.abs(dy - 40) > 12) {
              await board.lead(
                `Dragging a ${name.split(':')[0]} by (60, 40) moved it by (${Math.round(dx)}, ${Math.round(dy)})`,
                `"${name}" was dragged 60 px right and 40 px down at 100% zoom.`,
                `wb-move|${name.split(':')[0]}`
              )
            }
          }
          // A resize handle, if it has one: bigger, then dragged far past its opposite corner.
          // The bottom-right one, unless it is near the board's edge: then the top-left, outwards.
          const area = await board.box()
          const se = await board.locator
            .locator('[data-handle="se"]')
            .first()
            .boundingBox()
            .catch(() => null)
          const roomy =
            !!se && se.x + 100 < area.x + area.width && se.y + 100 < area.y + area.height
          const outwards = roomy ? 1 : -1
          const handle = board.locator.locator(`[data-handle="${roomy ? 'se' : 'nw'}"]`).first()
          const handleBox = await handle.boundingBox().catch(() => null)
          if (handleBox) {
            const from = {
              x: handleBox.x + handleBox.width / 2,
              y: handleBox.y + handleBox.height / 2
            }
            const sized = await board
              .byId(id)
              .boundingBox()
              .catch(() => null)
            await board.gesture(`resize ${name}`, from, {
              x: from.x + 70 * outwards,
              y: from.y + 50 * outwards
            })
            const resized = await board
              .byId(id)
              .boundingBox()
              .catch(() => null)
            if (
              sized &&
              resized &&
              resized.width <= sized.width + 5 &&
              resized.height <= sized.height + 5
            ) {
              await board.lead(
                `Dragging the resize handle of a ${name.split(':')[0]} did not make it bigger`,
                `Size before ${Math.round(sized.width)}×${Math.round(sized.height)}, after ${Math.round(resized.width)}×${Math.round(resized.height)}.`,
                `wb-resize|${name.split(':')[0]}`
              )
            }
            const again = await handle.boundingBox().catch(() => null)
            if (again) {
              const corner = { x: again.x + again.width / 2, y: again.y + again.height / 2 }
              await board.gesture(`shrink ${name} past zero`, corner, {
                x: corner.x - 400 * outwards,
                y: corner.y - 300 * outwards
              })
            }
          }
          // A line's end, dragged somewhere else.
          const end = board.locator.locator('[data-end="to"]').first()
          const endBox = await end.boundingBox().catch(() => null)
          if (endBox) {
            const from = { x: endBox.x + endBox.width / 2, y: endBox.y + endBox.height / 2 }
            await board.gesture(`drag the end of ${name}`, from, await board.at(0.8, 0.5))
          }
          const again = await board.hitPoint(id)
          if (again) {
            await board.clickAt(`double-click ${name}`, again, { clickCount: 2 })
            await typeIfEditing(session, ' edited', `double-clicking ${name}`)
            await board.key('Escape')
          }
          await board.key('Escape')
        }
        // Shift-click two objects, then box-select everything.
        const first = await board.centreOf(board.objects().nth(0))
        const second = await board.centreOf(board.objects().nth(1))
        if (first && second) {
          await board.clickAt('click the first object', first)
          await board.clickAt('shift-click the second', second, { modifier: 'Shift' })
          await board.gesture('move both', first, { x: first.x - 40, y: first.y + 60 })
        }
        await board.clickAt('click empty board', await board.at(0.97, 0.97))
        await board.gesture(
          'box-select everything',
          await board.at(0.02, 0.02),
          await board.at(0.98, 0.98)
        )
        await board.gesture(
          'move the whole selection',
          await board.at(0.5, 0.5),
          await board.at(0.55, 0.55)
        )
        await board.compareWithSaved(context, 'selecting and moving')
      }
    },
    {
      name: 'wb-style',
      title: 'Every choice in the Style bar, on one object and on many',
      needs: ['wb-tools'],
      run: async ({ session }) => {
        const board = new Board(session)
        await board.calm()
        for (const [label, select] of [
          [
            'one object',
            async () => {
              const centre = await board.centreOf(board.objects().first())
              if (centre) await board.clickAt('select one object', centre)
            }
          ],
          [
            'everything',
            async () => {
              await board.clickAt('click empty board', await board.at(0.97, 0.97))
              await board.key('Control+a')
            }
          ]
        ] as const) {
          await select()
          const bar = board.toolbar('Style')
          if (!(await bar.isVisible().catch(() => false))) {
            await board.shotAll(`no Style bar for ${label}`)
            continue
          }
          const names = await board.buttonNames(bar)
          session.recorder.journal(`- Style bar for ${label}: ${names.join(', ')}`)
          for (const name of names) {
            if (/^(Connect to|Make tasks)/.test(name)) continue
            await board.press(
              {
                locator: board.toolbar('Style').getByRole('button', { name, exact: true }).first(),
                description: `style "${name}"`
              },
              `style ${name} on ${label}`
            )
            // A choice that opens a menu: take its first item and its last.
            const menu = session.page.getByRole('menu').last()
            if (await menu.isVisible().catch(() => false)) {
              const items = menu.getByRole('menuitem').or(menu.getByRole('menuitemradio'))
              const count = await items.count()
              if (count > 0) {
                await board.press({
                  locator: items.nth(count - 1),
                  description: `menu item ${count} of ${name}`
                })
              }
            }
            // The selection may have changed; keep it.
            if (
              !(await board
                .toolbar('Style')
                .isVisible()
                .catch(() => false))
            )
              await select()
          }
        }
      }
    },
    {
      name: 'wb-arrange',
      title: 'Every Arrange choice on everything',
      needs: ['wb-tools'],
      run: async ({ session }) => {
        const board = new Board(session)
        await board.calm()
        await board.clickAt('click empty board', await board.at(0.97, 0.97))
        await board.key('Control+a')
        const trigger = board.toolbar('Zoom').getByRole('button', { name: 'Arrange' })
        await board.press({ locator: trigger, description: 'Arrange' })
        const items = session.page.getByRole('menuitem')
        const labels = (await items.allInnerTexts().catch(() => [])).map((text) =>
          text.split('\n')[0].trim()
        )
        await session.page.keyboard.press('Escape')
        session.recorder.journal(`- Arrange: ${labels.join(', ')}`)
        for (const label of labels) {
          if (
            !(await board.press(
              { locator: trigger, description: 'Arrange' },
              `Arrange for ${label}`
            ))
          ) {
            await board.key('Control+a')
            await board.press({ locator: trigger, description: 'Arrange' })
          }
          const item = session.page
            .getByRole('menuitem', { name: new RegExp(`^${escape(label)}`) })
            .first()
          if (await item.isDisabled().catch(() => true)) {
            await session.page.keyboard.press('Escape')
            continue
          }
          await board.press({ locator: item, description: `Arrange › ${label}` })
        }
        await board.key('Control+g', 'Ctrl+G group')
        await board.gesture('move the group', await board.at(0.5, 0.5), await board.at(0.45, 0.4))
        // The drag above may have started on empty board and cleared the selection.
        await board.key('Control+a')
        await board.key('Control+Shift+g', 'Ctrl+Shift+G ungroup')
      }
    },
    {
      name: 'wb-view',
      title: 'Zoom and pan: buttons, wheel, the hand tool, space and the middle button',
      needs: ['wb-setup'],
      run: async ({ session }) => {
        const board = new Board(session)
        await board.calm()
        const bar = board.toolbar('Zoom')
        for (const name of [
          /^Zoom in/,
          /^Zoom in/,
          /^Zoom in/,
          /^Zoom out/,
          /%: zoom to 100%/,
          /^Zoom to fit|^Fit/
        ]) {
          await board.press({
            locator: bar.getByRole('button', { name }).first(),
            description: `view ${name.source}`
          })
        }
        for (let index = 0; index < 4; index += 1) {
          await board.press({
            locator: bar.getByRole('button', { name: /^Zoom out/ }).first(),
            description: 'Zoom out'
          })
        }
        const centre = await board.at(0.5, 0.5)
        await session.hand.act(
          'scroll',
          board.target(),
          async () => {
            await session.page.mouse.move(centre.x, centre.y)
            for (let index = 0; index < 6; index += 1) await session.page.mouse.wheel(0, -240)
          },
          { value: 'wheel up ×6', noShot: true }
        )
        await board.burst('wheel up')
        await session.hand.act(
          'scroll',
          board.target(),
          async () => {
            await session.page.keyboard.down('Control')
            for (let index = 0; index < 6; index += 1) await session.page.mouse.wheel(0, -240)
            await session.page.keyboard.up('Control')
          },
          { value: 'Ctrl+wheel up ×6', noShot: true }
        )
        await board.burst('ctrl wheel up')
        await session.hand.act(
          'scroll',
          board.target(),
          async () => {
            await session.page.keyboard.down('Control')
            for (let index = 0; index < 12; index += 1) await session.page.mouse.wheel(0, 240)
            await session.page.keyboard.up('Control')
          },
          { value: 'Ctrl+wheel down ×12', noShot: true }
        )
        await board.burst('ctrl wheel down')
        await session.hand.act(
          'scroll',
          board.target(),
          async () => {
            await session.page.keyboard.down('Shift')
            for (let index = 0; index < 4; index += 1) await session.page.mouse.wheel(0, 240)
            await session.page.keyboard.up('Shift')
          },
          { value: 'Shift+wheel ×4', noShot: true }
        )
        await board.burst('shift wheel')
        await board.press({
          locator: board.toolbar('Tools').getByRole('button', { name: /^Hand/ }),
          description: 'tool Hand'
        })
        await board.gesture(
          'pan with the hand tool',
          await board.at(0.3, 0.3),
          await board.at(0.7, 0.6)
        )
        await board.calm()
        await board.gesture(
          'pan with the middle button',
          await board.at(0.6, 0.6),
          await board.at(0.3, 0.4),
          { button: 'middle' }
        )
        await session.page.mouse.move(centre.x, centre.y)
        await session.page.keyboard.down(' ')
        await board.gesture(
          'pan with space held',
          await board.at(0.5, 0.5),
          await board.at(0.4, 0.3)
        )
        await session.page.keyboard.up(' ')
        await board.burst('space released')
        for (const key of ['Control+=', 'Control+-', 'Control+0', 'Shift+1', 'Shift+2'])
          await board.key(key)
      }
    },
    {
      name: 'wb-keys',
      title: 'The keyboard: new objects, nudges, copy and paste, duplicate, delete, undo and redo',
      needs: ['wb-setup'],
      run: async ({ session }) => {
        const board = new Board(session)
        await board.calm()
        await board.clickAt('click empty board', await board.at(0.9, 0.9))
        for (const key of ['n', 'Enter']) await board.key(key)
        await typeIfEditing(session, 'Made by keyboard', 'the gesture before')
        await board.key('Control+Enter')
        for (const key of [
          'ArrowRight',
          'Shift+ArrowRight',
          'Shift+ArrowDown',
          'Control+d',
          'Control+c',
          'Control+v',
          'Control+v',
          'Delete',
          's',
          'Enter',
          't',
          'Enter'
        ]) {
          await board.key(key)
        }
        await typeIfEditing(session, 'Typed in a text box', 'the gesture before')
        await board.key('Escape')
        await board.key('Control+a')
        await board.key('Delete', 'Delete everything')
        await board.key('Control+z', 'Ctrl+Z bring everything back')
        for (let index = 0; index < 8; index += 1) await board.key('Control+z')
        for (let index = 0; index < 8; index += 1) await board.key('Control+y')
        await board.key(
          'Control+Shift+z',
          'Ctrl+Shift+Z redo (the delete, still on the redo stack)'
        )
        await board.key('Control+z', 'Ctrl+Z bring everything back again')
        await board.key('Tab')
        await board.key('Tab')
        await board.key('?')
        await board.key('Escape')
      }
    },
    {
      name: 'wb-dialogs',
      title: 'Connect to…, Link, Make tasks and Picture',
      needs: ['wb-tools'],
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        const { hand, ui } = session
        await board.calm()
        // Everything in view, nothing selected, then one note, clicked where it shows.
        await board.press({
          locator: board.toolbar('Zoom').getByRole('button', { name: /fit/i }).first(),
          description: 'Zoom to fit'
        })
        await board.clickAt('click empty board', await board.at(0.99, 0.99))
        await board.key('Escape')
        const noteId = await board.locator
          .getByRole('button', { name: /^Note:/ })
          .first()
          .getAttribute('data-object-id')
          .catch(() => null)
        const centre = noteId ? await board.hitPoint(noteId) : null
        if (centre) await board.clickAt('select a note', centre)
        if (await board.press(ui.button('Connect to…'))) {
          const dialog = session.page.getByRole('dialog', { name: 'Connect to another object' })
          await board.press({
            locator: dialog.getByRole('radio').last(),
            description: 'the last object to connect to'
          })
          await board.press({
            locator: dialog.getByRole('button', { name: 'Connect' }),
            description: 'Connect'
          })
        }
        if (centre) await board.clickAt('select the note again', centre)
        await board.key('l', 'L link')
        const link = session.page.getByRole('dialog', { name: 'Link to an item or web page' })
        if (await link.isVisible().catch(() => false)) {
          await typeIfEditing(session, 'a', 'the gesture before')
          await board.burst('link search typed')
          await board.key('ArrowDown')
          await board.key('Enter', 'Enter to link')
        }
        if (centre) await board.clickAt('select the note again', centre)
        if (await board.press(ui.button('Make tasks'))) {
          const make = session.page.getByRole('dialog', { name: 'Make tasks' })
          await board.press({
            locator: make.getByRole('button', { name: /^Make \d+ task/ }),
            description: 'Make tasks'
          })
        }
        await board.calm()
        const picture = board.toolbar('Tools').getByRole('button', { name: /picture/i })
        if (await board.press({ locator: picture, description: 'Picture' })) {
          const fromLibrary = session.page.getByRole('menuitem', { name: /From the Library/ })
          if (await board.press({ locator: fromLibrary, description: 'From the Library…' })) {
            await hand.press('Escape').catch(() => {})
          }
        }
        await board.calm()
        const linkTool = board.toolbar('Tools').getByRole('button', { name: /^Link to/ })
        if (await board.press({ locator: linkTool, description: 'Link tool' }))
          await board.key('Escape')
        await board.compareWithSaved(context, 'the dialogs')
      }
    },
    {
      name: 'wb-context',
      title: 'Right-clicks on the board and on objects',
      needs: ['wb-tools'],
      run: async ({ session }) => {
        const board = new Board(session)
        await board.calm()
        await board.clickAt('right-click empty board', await board.at(0.85, 0.2), {
          button: 'right'
        })
        await board.key('Escape')
        const centre = await board.centreOf(board.objects().first())
        if (centre) {
          await board.clickAt('right-click an object', centre, { button: 'right' })
          await board.key('Escape')
        }
      }
    },
    {
      name: 'wb-templates',
      title: 'A board from every template, and the mind map grown',
      needs: ['wb-setup'],
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        const projectId = boardState(context).projectId as string
        for (const template of ['Brainstorm', 'Retrospective', 'Project kick-off', 'Journey map']) {
          await openPlan(session, projectId)
          const back = session.ui.button('Back to the plan')
          if (await session.hand.sees(back, 800)) await session.hand.click(back)
          await newBoard(session, board, template).catch(() => {})
          await board.press({
            locator: board.toolbar('Zoom').getByRole('button', { name: /fit/i }).first(),
            description: 'Zoom to fit'
          })
        }
        // The last board was the kick-off; go back to the brainstorm for the mind map.
        await openPlan(session, projectId)
        const back = session.ui.button('Back to the plan')
        if (await session.hand.sees(back, 800)) await session.hand.click(back)
        await openWhiteboardsList(session)
        await board.press(session.ui.button(/^Open Whiteboard 2/, false), 'open the brainstorm')
        const central = board.locator.getByRole('button', { name: /^Central idea/ }).first()
        const centre = await board.centreOf(central)
        if (centre) {
          await board.clickAt('select the central idea', centre)
          await board.key('Tab', 'Tab: a child idea')
          await typeIfEditing(session, 'Child idea', 'the gesture before')
          await board.key('Enter', 'Enter: a sibling idea')
          await typeIfEditing(session, 'Sibling idea', 'the gesture before')
          await board.key('Escape')
          await board.gesture('drag the central idea', centre, {
            x: centre.x + 120,
            y: centre.y + 80
          })
          const idea = board.locator.getByRole('button', { name: /^Idea:/ }).first()
          const ideaCentre = await board.centreOf(idea)
          if (ideaCentre)
            await board.gesture(
              'drag an idea onto another branch',
              ideaCentre,
              await board.at(0.2, 0.8)
            )
        }
      }
    },
    {
      name: 'wb-head',
      title: 'Rename, every export, back to the plan and open again',
      needs: ['wb-setup'],
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        const { hand, ui } = session
        if (await board.press(ui.button('Rename'))) {
          const dialog = ui.dialog('Rename whiteboard')
          await hand.fill(dialog.textbox('Title'), 'Renamed by the monkey 🐒').catch(() => {})
          await board.press(dialog.button('Save'))
        }
        for (const item of ['PNG picture', 'SVG drawing', 'Whiteboard file', 'Save as PDF…']) {
          if (!(await board.press(ui.button('Export')))) break
          await board.press(ui.menuitem(item), `Export › ${item}`)
          await hand.wait(`export ${item}`, 1500).catch(() => {})
          await board.burst(`after export ${item}`)
        }
        await board.press(ui.button('Back to the plan'))
        await board.shotAll('the list of boards')
        await board.press(ui.button(/^Open /, false), 'open the first board')
        await board.press(ui.tab('Library'), 'Library tab')
        await board.shotAll('Library')
      }
    },
    {
      name: 'wb-random',
      title: 'The monkey loose on a board: random clicks, drags, keys and tools',
      needs: ['wb-setup'],
      run: async (context) => {
        const { session } = context
        const { random, options } = session
        const board = new Board(session)
        const projectId = boardState(context).projectId as string
        const boardId = boardState(context).boardId
        if (boardId) {
          await openRoute(session, `/projects/${projectId}/plan?whiteboard=${boardId}`)
        }
        if (!(await board.locator.isVisible().catch(() => false))) {
          await openPlan(session, projectId)
          await openWhiteboardsList(session)
          await board.press(session.ui.button(/^Open /, false))
        }
        const keys = [
          'n',
          's',
          't',
          'Enter',
          'Escape',
          'Delete',
          'Control+z',
          'Control+y',
          'Control+a',
          'Control+d',
          'Control+c',
          'Control+v',
          'ArrowLeft',
          'Shift+ArrowUp',
          'v',
          'h',
          'p',
          'e',
          'c',
          'm',
          'f',
          '1',
          'Tab',
          'Control+g'
        ]
        const steps = Math.min(options.steps, 120)
        for (let step = 0; step < steps; step += 1) {
          if (!(await board.locator.isVisible().catch(() => false))) {
            await board.shotAll(`random ${step}: the board went away`)
            await session.page.keyboard.press('Escape').catch(() => {})
            if (!(await board.locator.isVisible().catch(() => false))) break
          }
          const point = async () =>
            board.at(random.next() * 0.96 + 0.02, random.next() * 0.96 + 0.02)
          const roll = random.next()
          if (roll < 0.25) {
            const tools = board.toolbar('Tools').getByRole('button')
            const count = await tools.count()
            const tool = tools.nth(random.int(0, Math.max(0, count - 1)))
            const name = (await tool.getAttribute('aria-label').catch(() => null)) ?? 'a tool'
            if (/^Picture/.test(name)) continue
            await board.press(
              { locator: tool, description: `tool "${name}"` },
              `random ${step}: tool ${name}`
            )
          } else if (roll < 0.5) {
            await board.gesture(`random ${step}: drag`, await point(), await point())
          } else if (roll < 0.62) {
            await board.clickAt(`random ${step}: click`, await point())
          } else if (roll < 0.7) {
            await board.clickAt(`random ${step}: double-click`, await point(), { clickCount: 2 })
            await typeIfEditing(
              session,
              random.pick(['hi', 'Ünïcödé 🍅', 'a'.repeat(120), 'Line one\nLine two']),
              'the gesture before'
            )
          } else if (roll < 0.75) {
            await board.clickAt(`random ${step}: right-click`, await point(), { button: 'right' })
          } else if (roll < 0.95) {
            {
              const key = random.pick(keys)
              await board.key(key, `random ${step}: ${key}`)
            }
          } else {
            const object = board
              .objects()
              .nth(random.int(0, Math.max(0, (await board.objects().count()) - 1)))
            const centre = await board.centreOf(object)
            if (centre) await board.gesture(`random ${step}: drag an object`, centre, await point())
          }
        }
        await board.calm()
        await board.compareWithSaved(context, 'the random spell')
      }
    },
    {
      name: 'wb-small',
      title: 'The board in a small window and in the dark theme',
      needs: ['wb-setup'],
      run: async ({ session }) => {
        const board = new Board(session)
        await setWindowSize(session.app, session.page, { width: 900, height: 620 })
        await board.burst('small window')
        await board.gesture(
          'drag in a small window',
          await board.at(0.2, 0.2),
          await board.at(0.7, 0.7)
        )
        await setWindowSize(session.app, session.page, session.options.viewport)
        await session.page.emulateMedia({ colorScheme: 'dark' })
        await session.page.evaluate(() =>
          document.documentElement.setAttribute('data-theme', 'dark')
        )
        await board.burst('dark theme')
        await session.page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
        await session.page.emulateMedia({ colorScheme: 'light' })
      }
    },
    {
      name: 'wb-restart',
      title: 'Closed and opened again: is every board as it was?',
      needs: ['wb-setup'],
      run: async (context) => {
        const { session } = context
        const board = new Board(session)
        const { projectId, boardId } = boardState(context)
        if (!projectId || !boardId) return
        await openRoute(session, `/projects/${projectId}/plan?whiteboard=${boardId}`)
        await board.page
          .locator('.statusbar-save[data-state="saved"]')
          .waitFor({ timeout: 8000 })
          .catch(() => {})
        const before = await board.objects().count()
        await board.shotAll('before the restart')
        await session.restart('whiteboard kept after a restart')
        await openRoute(session, `/projects/${projectId}/plan?whiteboard=${boardId}`)
        await board.burst('after the restart')
        const after = await board.objects().count()
        session.recorder.journal(`- Restart: ${before} objects before, ${after} after.`)
        if (after !== before) {
          session.recorder.finding({
            kind: 'broken',
            severity: 'S1',
            title: `The whiteboard lost objects over a restart: ${before} before, ${after} after`,
            details: 'The board said Saved before Ostler was closed.',
            where: await session.screen(),
            screenshot: session.recorder.lastScreenshot,
            key: 'wb-restart'
          })
        }
      }
    }
  ]
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function runWhiteboard(session: Session, fakeAi: FakeAi | null): Promise<void> {
  await runPhases(phases(), session, fakeAi)
}
