import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createRequire } from 'module'
import { PERF_MARKS } from '../../src/shared/perf-marks'
import { BOARD_PROJECT_NAME, LIST_PROJECT_NAME } from '../../electron/app/dev-seed/scale-plan'
import { BUDGETS, type PerfReport, type Measure, judge } from './budgets'

/*
 * The performance suite (P9.1, `npm run perf`). It launches the built app
 * against a copy of the scale dataset (`npm run seed:scale`), measures what
 * docs/performance.md budgets, writes test-results/perf.json, and fails when a
 * budget is missed. Not part of `npm run verify`.
 */

const moduleRequire = createRequire(__filename)
const root = path.resolve(__dirname, '../..')
const SOURCE = process.env.OSTLER_PERF_DATA ?? 'C:\\temp\\ostler-roadmap\\p9-1-scale'
const IDLE_MINUTES = Number(process.env.OSTLER_PERF_IDLE_MINUTES ?? 10)
const REPORT_PATH = path.join(root, 'test-results', 'perf.json')
const COLD_STARTS = 3

const measures: Measure[] = []
const audits: Record<string, unknown> = {}
const copies: string[] = []

function record(id: keyof typeof BUDGETS, value: number, detail?: Record<string, unknown>): void {
  measures.push(judge(id, value, detail))
}

/** A fresh copy of the seeded data folder, so runs do not change it or each other. */
function copyData(): string {
  if (!fs.existsSync(path.join(SOURCE, 'ostler.db'))) {
    throw new Error(`No scale dataset at ${SOURCE}. Run npm run seed:scale -- p9-1-scale first.`)
  }
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-perf-'))
  fs.cpSync(SOURCE, target, { recursive: true })
  copies.push(target)
  return target
}

async function launch(
  dataDir: string,
  environment: Record<string, string> = {}
): Promise<{ app: ElectronApplication; window: Page; launchedAt: number }> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const launchedAt = Date.now()
  const app = await electron.launch({
    executablePath: moduleRequire('electron') as string,
    args: [root],
    env: { ...env, NODE_ENV: 'production', OSTLER_USER_DATA: dataDir, ...environment }
  })
  const window = await app.firstWindow()
  await window.setViewportSize({ width: 1280, height: 800 })
  return { app, window, launchedAt }
}

async function markCount(window: Page, name: string): Promise<number> {
  return window.evaluate((mark) => performance.getEntriesByName(mark).length, name)
}

/**
 * Clicks `selector` inside the page (so no driver round trip sits between
 * the clock and the click) and returns the milliseconds until `mark` is set
 * again, optionally for a given key.
 */
async function timeClickToMark(
  window: Page,
  selector: string,
  mark: string,
  key?: string
): Promise<number> {
  const before = await markCount(window, mark)
  const clickedAt = await window.evaluate((target) => {
    const element = document.querySelector<HTMLElement>(target)
    if (!element) throw new Error(`Nothing matches ${target}`)
    const at = performance.now()
    element.click()
    return at
  }, selector)
  const handle = await window.waitForFunction(
    ({ name, count, wanted }) => {
      const entries = performance.getEntriesByName(name) as PerformanceMark[]
      if (entries.length <= count) return null
      const fresh = entries.slice(count)
      const match = wanted
        ? fresh.find((entry) => (entry.detail as { key?: string } | null)?.key === wanted)
        : fresh[fresh.length - 1]
      return match ? match.startTime : null
    },
    { name: mark, count: before, wanted: key },
    { timeout: 30_000 }
  )
  return ((await handle.jsonValue()) as number) - clickedAt
}

async function projectHref(window: Page, name: string): Promise<string> {
  const link = window.locator('a.project-link', { hasText: name }).first()
  await expect(link).toHaveCount(1)
  return (await link.getAttribute('href')) ?? ''
}

/** Starts collecting long tasks; `stop()` returns the durations over 50 ms. */
async function watchLongTasks(window: Page): Promise<() => Promise<number[]>> {
  await window.evaluate(() => {
    const store = window as unknown as {
      __longTasks: number[]
      __longObserver?: PerformanceObserver
    }
    store.__longTasks = []
    store.__longObserver?.disconnect()
    store.__longObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) store.__longTasks.push(entry.duration)
    })
    store.__longObserver.observe({ type: 'longtask', buffered: false })
  })
  return async () => {
    // Let the last task finish and report.
    await window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))
    return window.evaluate(() => {
      const store = window as unknown as {
        __longTasks: number[]
        __longObserver?: PerformanceObserver
      }
      store.__longObserver?.disconnect()
      return store.__longTasks.filter((duration) => duration > 50)
    })
  }
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  const report: PerfReport = {
    measuredAt: new Date().toISOString(),
    machine: {
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      os: `${os.type()} ${os.release()}`
    },
    dataset: SOURCE,
    idleMinutes: IDLE_MINUTES,
    measures,
    audits,
    passed: measures.every((measure) => measure.passed)
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  for (const copy of copies) fs.rmSync(copy, { recursive: true, force: true })
})

test('cold start to Home', async () => {
  test.setTimeout(180_000)
  const runs: number[] = []
  const phases: Array<Record<string, number>> = []
  for (let run = 0; run < COLD_STARTS; run += 1) {
    const { app, window, launchedAt } = await launch(copyData())
    await window.waitForFunction(
      (mark) => performance.getEntriesByName(mark).length > 0,
      PERF_MARKS.homeRendered,
      { timeout: 60_000 }
    )
    // Where the time went: each mark as milliseconds after the launch call.
    // The marks are timestamps, so the driver's own polling adds nothing.
    const toEpoch = (origin: number, marks: Array<{ name: string; startTime: number }>) =>
      Object.fromEntries(
        marks.map((mark) => [mark.name, Math.round(origin + mark.startTime - launchedAt)])
      )
    const main = await app.evaluate(() => ({
      origin: performance.timeOrigin,
      marks: performance
        .getEntriesByType('mark')
        .map(({ name, startTime }) => ({ name, startTime }))
    }))
    const page = await window.evaluate(() => ({
      origin: performance.timeOrigin,
      marks: [
        ...performance.getEntriesByType('mark'),
        ...performance.getEntriesByType('navigation').map((entry) => ({
          name: 'window:dom-content-loaded',
          startTime: (entry as PerformanceNavigationTiming).domContentLoadedEventEnd
        }))
      ].map(({ name, startTime }) => ({ name, startTime }))
    }))
    const phase = {
      'window:time-origin': Math.round(page.origin - launchedAt),
      ...toEpoch(main.origin, main.marks),
      ...toEpoch(page.origin, page.marks)
    }
    phases.push(phase)
    runs.push(phase[PERF_MARKS.homeRendered])
    await app.close()
  }
  const sorted = [...runs].sort((a, b) => a - b)
  record('coldStart', sorted[Math.floor(sorted.length / 2)], { runs, phases })
})

test.describe('one session on the scale dataset', () => {
  let app: ElectronApplication
  let window: Page

  test.beforeAll(async () => {
    ;({ app, window } = await launch(copyData()))
    await window.waitForFunction(
      (mark) => performance.getEntriesByName(mark).length > 0,
      PERF_MARKS.homeRendered,
      { timeout: 60_000 }
    )
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('switching projects and views', async () => {
    test.setTimeout(180_000)
    const projectNames = ['Scale project 03', 'Scale project 04', 'Scale project 10']
    const hrefs = await Promise.all(projectNames.map((name) => projectHref(window, name)))
    const projectSwitches: number[] = []
    // Twice round, so the second visit measures a warm switch as people make it.
    for (let round = 0; round < 2; round += 1) {
      for (const href of hrefs) {
        projectSwitches.push(
          await timeClickToMark(
            window,
            `a.project-link[href="${href}"]`,
            PERF_MARKS.projectViewRendered
          )
        )
      }
    }
    record('projectSwitch', Math.max(...projectSwitches), { runs: projectSwitches })

    const boardHref = await projectHref(window, BOARD_PROJECT_NAME)
    await timeClickToMark(
      window,
      `a.project-link[href="${boardHref}"]`,
      PERF_MARKS.projectViewRendered
    )
    const viewSwitches: Record<string, number[]> = {}
    for (let round = 0; round < 2; round += 1) {
      for (const view of ['Board', 'List', 'Calendar', 'Timeline', 'Overview']) {
        const tab = window.getByRole('tab', { name: view, exact: true })
        const id = await tab.getAttribute('id')
        const selector = id ? `[id="${id}"]` : `[role="tab"]`
        const ms = await timeClickToMark(window, selector, PERF_MARKS.projectViewRendered)
        ;(viewSwitches[view] ??= []).push(ms)
      }
    }
    const all = Object.values(viewSwitches).flat()
    record('viewSwitch', Math.max(...all), { project: BOARD_PROJECT_NAME, runs: viewSwitches })
  })

  test('opening My work for the person with the most tasks', async () => {
    test.setTimeout(120_000)
    // The scale dataset assigns work to its people, not to Me: My work is
    // opened on whoever has the most, grouped by due date (its default).
    const busiest = await window.evaluate(async () => {
      const people = await window.ostlerAPI.getPeople()
      if (!people.ok) throw new Error(people.error)
      const today = new Date().toISOString().slice(0, 10)
      let best = { id: '', count: -1 }
      for (const person of people.value) {
        const tasks = await window.ostlerAPI.getAssignedTasks({
          personId: person.id,
          hideDone: true,
          today
        })
        if (tasks.ok && tasks.value.length > best.count)
          best = { id: person.id, count: tasks.value.length }
      }
      localStorage.setItem('ostler.myWork', JSON.stringify({ personId: best.id, groupBy: 'due' }))
      return best
    })
    const runs: number[] = []
    for (let round = 0; round < 3; round += 1) {
      await window.evaluate(() =>
        document.querySelector<HTMLElement>('nav a[href="/home"], a[href="/home"]')?.click()
      )
      await expect(window.locator('.ostler-home')).toBeVisible()
      runs.push(await timeClickToMark(window, 'a[href="/my-work"]', PERF_MARKS.myWorkRendered))
    }
    record('myWorkOpen', Math.max(...runs), { tasks: busiest.count, runs })
    expect(busiest.count).toBeGreaterThan(0)
  })

  test('opening Workload over every project', async () => {
    test.setTimeout(120_000)
    // Workload has no sidebar row: it opens from My work's header (D35).
    const runs: number[] = []
    for (let round = 0; round < 3; round += 1) {
      await window.evaluate(() =>
        document.querySelector<HTMLElement>('a[href="/my-work"]')?.click()
      )
      await expect(window.locator('.my-work')).toBeVisible()
      runs.push(await timeClickToMark(window, 'a[href="/workload"]', PERF_MARKS.workloadRendered))
    }
    const tasks = await window.locator('.workload__cell').count()
    record('workloadOpen', Math.max(...runs), { cells: tasks, runs })
    expect(tasks).toBeGreaterThan(0)
  })

  test('opening the Timeline across projects over every project', async () => {
    test.setTimeout(120_000)
    // No sidebar row: it opens from Home's Projects section (D35, N5.4).
    const runs: number[] = []
    for (let round = 0; round < 3; round += 1) {
      await window.evaluate(() =>
        document.querySelector<HTMLElement>('nav a[href="/home"], a[href="/home"]')?.click()
      )
      await expect(window.locator('.ostler-home')).toBeVisible()
      runs.push(
        await timeClickToMark(window, 'a[href="/timeline"]', PERF_MARKS.timelineOverviewRendered)
      )
    }
    const rows = await window.locator('.timeline-overview__project-row').count()
    record('timelineOverviewOpen', Math.max(...runs), { rows, runs })
    expect(rows).toBeGreaterThan(0)
  })

  test('Board with 500 cards: render and drag', async () => {
    test.setTimeout(120_000)
    const boardHref = await projectHref(window, BOARD_PROJECT_NAME)
    // From another project, so the Board renders from scratch.
    const otherHref = await projectHref(window, 'Scale project 05')
    await timeClickToMark(
      window,
      `a.project-link[href="${otherHref}"]`,
      PERF_MARKS.projectViewRendered
    )
    await window.getByRole('tab', { name: 'Overview', exact: true }).click()
    await timeClickToMark(
      window,
      `a.project-link[href="${boardHref}"]`,
      PERF_MARKS.projectViewRendered
    )
    const boardTab = window.getByRole('tab', { name: 'Board', exact: true })
    const tabId = await boardTab.getAttribute('id')
    // Away and back: the Board tab's own render, with the project's tasks loaded.
    await window.getByRole('tab', { name: 'Overview', exact: true }).click()
    await window.waitForTimeout(500)
    const render = await timeClickToMark(window, `[id="${tabId}"]`, PERF_MARKS.projectViewRendered)
    const cards = await window
      .locator('.board-column article.task-card, .board-column [data-status]')
      .count()
    record('boardRender', render, { project: BOARD_PROJECT_NAME, cardsInDom: cards })

    // A drag from Ready across every column and back, one dragover per frame.
    const stop = await watchLongTasks(window)
    const frames = await window.evaluate(async () => {
      const source = document.querySelector<HTMLElement>(
        '.board-column[aria-label="Ready"] [draggable="true"]'
      )
      const columns = [...document.querySelectorAll<HTMLElement>('.board-column')]
      if (!source || columns.length === 0) throw new Error('No draggable card on the Board')
      const transfer = new DataTransfer()
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      const deltas: number[] = []
      let last = await frame()
      const path = [...columns, ...[...columns].reverse()]
      for (const column of path) {
        for (let step = 0; step < 4; step += 1) {
          column.dispatchEvent(
            new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer })
          )
          const now = await frame()
          deltas.push(now - last)
          last = now
        }
      }
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
      return deltas
    })
    const longTasks = await stop()
    const sortedFrames = [...frames].sort((a, b) => a - b)
    record('boardDragLongTask', longTasks.length ? Math.max(...longTasks) : 0, {
      longTasks,
      frames: frames.length,
      frameP50: Math.round(sortedFrames[Math.floor(frames.length / 2)]),
      frameP95: Math.round(sortedFrames[Math.floor(frames.length * 0.95)]),
      frameMax: Math.round(sortedFrames[sortedFrames.length - 1])
    })
  })

  test('List with 5,000 rows: scrolling', async () => {
    test.setTimeout(180_000)
    const listHref = await projectHref(window, LIST_PROJECT_NAME)
    await timeClickToMark(
      window,
      `a.project-link[href="${listHref}"]`,
      PERF_MARKS.projectViewRendered
    )
    const listTab = window.getByRole('tab', { name: 'List', exact: true })
    const tabId = await listTab.getAttribute('id')
    const render = await timeClickToMark(window, `[id="${tabId}"]`, PERF_MARKS.projectViewRendered)
    const grid = window
      .locator('.ui-data-table [role="grid"], .ui-data-table > [role="grid"]')
      .first()
    await expect(grid).toBeVisible()
    const rowCount = Number(await grid.getAttribute('aria-rowcount')) - 1
    const stop = await watchLongTasks(window)
    const scrolled = await window.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.ui-data-table [role="grid"]')
      if (!scroller) throw new Error('No List grid')
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      let frames = 0
      while (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) {
        scroller.scrollTop += 600
        await frame()
        frames += 1
        if (frames > 5_000) break
      }
      scroller.scrollTop = 0
      await frame()
      return frames
    })
    const longTasks = await stop()
    record('listScrollLongTask', longTasks.length ? Math.max(...longTasks) : 0, {
      project: LIST_PROJECT_NAME,
      rows: rowCount,
      render,
      frames: scrolled,
      longTasks
    })
    expect(rowCount).toBeGreaterThanOrEqual(5_000)
  })

  test('search latency', async () => {
    test.setTimeout(120_000)
    const latencies: number[] = []
    for (const query of ['budget', 'release notes', 'survey', 'contract', 'agreed numbers']) {
      await window.keyboard.press('Control+k')
      const input = window.getByRole('dialog').getByRole('combobox')
      await expect(input).toBeFocused()
      const before = await markCount(window, PERF_MARKS.searchResultsShown)
      await input.fill(query)
      const handle = await window.waitForFunction(
        ({ shown, started, count, key }) => {
          const done = (performance.getEntriesByName(shown) as PerformanceMark[])
            .slice(count)
            .find((entry) => (entry.detail as { key?: string } | null)?.key === key)
          if (!done) return null
          const begun = (performance.getEntriesByName(started) as PerformanceMark[])
            .filter((entry) => (entry.detail as { key?: string } | null)?.key === key)
            .pop()
          return begun ? done.startTime - begun.startTime : null
        },
        {
          shown: PERF_MARKS.searchResultsShown,
          started: PERF_MARKS.searchStarted,
          count: before,
          key: query
        },
        { timeout: 30_000 }
      )
      latencies.push((await handle.jsonValue()) as number)
      await window.keyboard.press('Escape')
    }
    record('search', Math.max(...latencies), { runs: latencies })
  })

  test('Whiteboard with 2,000 objects: open and drag', async () => {
    test.setTimeout(180_000)
    // A board of 2,000 notes in a grid, made through IPC within the upsert limit.
    const projectName = 'Scale project 05'
    const { projectId, whiteboardId } = await window.evaluate(async (name) => {
      const config = await window.ostlerAPI.getConfig()
      if (!config.ok) throw new Error(config.error)
      const project = config.value.projects.find((entry) => entry.name === name)
      if (!project) throw new Error(`No project ${name}`)
      const created = await window.ostlerAPI.createWhiteboard(project.id, {
        title: 'Perf whiteboard'
      })
      if (!created.ok) throw new Error(created.error)
      const id = created.value.item.id
      const columns = 50
      const notes = Array.from({ length: 2_000 }, (_, index) => ({
        id: `perf-note-${index}`,
        kind: 'note' as const,
        x: (index % columns) * 120,
        y: Math.floor(index / columns) * 120,
        width: 100,
        height: 100,
        z: index,
        text: `Note ${index + 1}`
      }))
      for (let from = 0; from < notes.length; from += 1_000) {
        const saved = await window.ostlerAPI.saveWhiteboard(project.id, id, {
          upserts: notes.slice(from, from + 1_000) as never,
          deletes: []
        })
        if (!saved.ok) throw new Error(saved.error)
      }
      return { projectId: project.id, whiteboardId: id }
    }, projectName)

    // Open: from the Plan's Open button to the board's mark, three times (the first loads
    // the editor's code). The slowest is judged.
    // The Plan, opened as a deep link does (the scale projects do not show its tab).
    await window.evaluate((id) => {
      window.location.hash = `/projects/${id}/plan`
    }, projectId)
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect(window.getByRole('button', { name: /^Whiteboards/ })).toBeVisible({
      timeout: 30_000
    })
    const runs: number[] = []
    for (let round = 0; round < 3; round += 1) {
      await window.getByRole('button', { name: /^Whiteboards/ }).click()
      const open = window.locator(`[data-whiteboard-id="${whiteboardId}"]`)
      await expect(open).toBeVisible()
      runs.push(
        await timeClickToMark(
          window,
          `[data-whiteboard-id="${whiteboardId}"]`,
          PERF_MARKS.whiteboardRendered,
          whiteboardId
        )
      )
      const drawn = await window.locator('.wb-editor__board [data-object-id]').count()
      expect(drawn).toBe(2_000)
      if (round < 2) await window.getByRole('button', { name: 'Back to the plan' }).click()
    }
    record('whiteboardOpen', Math.max(...runs), { projectId, objects: 2_000, runs })

    // Drag one note on screen 400 px across and down, one pointer move per frame.
    const start = await window.evaluate(() => {
      const board = document.querySelector('.wb-editor__board')?.getBoundingClientRect()
      if (!board) throw new Error('No whiteboard')
      for (const node of document.querySelectorAll('.wb-editor__board [data-object-id]')) {
        const box = node.getBoundingClientRect()
        const x = box.left + box.width / 2
        const y = box.top + box.height / 2
        if (
          x > board.left + 40 &&
          y > board.top + 40 &&
          x < board.right - 450 &&
          y < board.bottom - 250
        ) {
          return { x, y, id: node.getAttribute('data-object-id') }
        }
      }
      throw new Error('No note on screen to drag')
    })
    const stop = await watchLongTasks(window)
    const frame = () =>
      window.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    await window.mouse.move(start.x, start.y)
    await window.mouse.down()
    const steps = 40
    for (let step = 1; step <= steps; step += 1) {
      await window.mouse.move(start.x + step * 10, start.y + step * 5)
      await frame()
    }
    await window.mouse.up()
    const longTasks = await stop()
    record('whiteboardDragLongTask', longTasks.length ? Math.max(...longTasks) : 0, {
      objects: 2_000,
      moves: steps,
      longTasks
    })
    await window.getByRole('button', { name: 'Back to the plan' }).click()
  })

  test('50 view switches: heap and listeners (leak audit)', async () => {
    test.setTimeout(240_000)
    const cdp = await window.context().newCDPSession(window)
    const counters = async () => {
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }
      const dom = (await cdp.send('Memory.getDOMCounters')) as {
        documents: number
        nodes: number
        jsEventListeners: number
      }
      return { heapMb: Math.round((heap.usedSize / 1024 / 1024) * 10) / 10, ...dom }
    }
    const href = await projectHref(window, 'Scale project 06')
    await timeClickToMark(window, `a.project-link[href="${href}"]`, PERF_MARKS.projectViewRendered)
    const views = ['Board', 'List', 'Calendar', 'Timeline', 'Overview']
    const cycle = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        const tab = window.getByRole('tab', { name: views[index % views.length], exact: true })
        const id = await tab.getAttribute('id')
        await timeClickToMark(window, `[id="${id}"]`, PERF_MARKS.projectViewRendered)
      }
    }
    // One round first, so every view's code is loaded before the baseline.
    await cycle(views.length)
    const before = await counters()
    await cycle(50)
    const after = await counters()
    audits.viewSwitchLeak = {
      switches: 50,
      before,
      after,
      heapGrowthMb: Math.round((after.heapMb - before.heapMb) * 10) / 10,
      listenerGrowth: after.jsEventListeners - before.jsEventListeners,
      nodeGrowth: after.nodes - before.nodes
    }
    await cdp.detach()
  })
})

test('idle, agents off: CPU, memory and IPC', async () => {
  test.setTimeout((IDLE_MINUTES + 3) * 60_000)
  const { app, window } = await launch(copyData(), { OSTLER_COUNT_IPC: '1' })
  await window.waitForFunction(
    (mark) => performance.getEntriesByName(mark).length > 0,
    PERF_MARKS.homeRendered,
    { timeout: 60_000 }
  )
  // One open project, on its Board: the budget is per open project.
  const href = await projectHref(window, BOARD_PROJECT_NAME)
  await timeClickToMark(window, `a.project-link[href="${href}"]`, PERF_MARKS.projectViewRendered)
  await window.getByRole('tab', { name: 'Board', exact: true }).click()
  // Let start-up work settle before the idle window opens.
  await window.waitForTimeout(30_000)

  const ipcTotal = () =>
    app.evaluate(() => {
      const totals = (globalThis as { __ostlerIpcCalls?: Map<string, number> }).__ostlerIpcCalls
      return totals ? Object.fromEntries(totals) : null
    })
  const sample = () =>
    app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((metric) => ({
        type: metric.type,
        cpu: metric.cpu.percentCPUUsage,
        memoryKb: metric.memory.workingSetSize,
        // Windows only: the process's own committed memory, about what Task Manager shows.
        privateKb: metric.memory.privateBytes ?? 0
      }))
    )

  const ipcBefore = (await ipcTotal()) ?? {}
  await sample() // The first reading of CPU is always zero; this opens the window.
  const cpu: number[] = []
  let memoryMb = 0
  let byProcess: Record<string, number> = {}
  let privateMb = 0
  let privateByProcess: Record<string, number> = {}
  const samples = Math.max(1, Math.round((IDLE_MINUTES * 60) / 15))
  for (let index = 0; index < samples; index += 1) {
    await window.waitForTimeout(15_000)
    const metrics = await sample()
    cpu.push(metrics.reduce((sum, metric) => sum + metric.cpu, 0))
    memoryMb = metrics.reduce((sum, metric) => sum + metric.memoryKb, 0) / 1024
    privateMb = metrics.reduce((sum, metric) => sum + metric.privateKb, 0) / 1024
    byProcess = {}
    privateByProcess = {}
    for (const metric of metrics) {
      byProcess[metric.type] = Math.round((byProcess[metric.type] ?? 0) + metric.memoryKb / 1024)
      privateByProcess[metric.type] = Math.round(
        (privateByProcess[metric.type] ?? 0) + metric.privateKb / 1024
      )
    }
  }
  const ipcAfter = (await ipcTotal()) ?? {}
  await app.close()

  const channels: Record<string, number> = {}
  for (const [channel, count] of Object.entries(ipcAfter)) {
    const delta = count - (ipcBefore[channel] ?? 0)
    if (delta > 0) channels[channel] = delta
  }
  const calls = Object.values(channels).reduce((sum, count) => sum + count, 0)
  const minutes = (samples * 15) / 60
  record('idleCpu', cpu.reduce((sum, value) => sum + value, 0) / cpu.length, {
    minutes,
    samples: cpu.map((value) => Math.round(value * 100) / 100),
    basis: 'percent of one core, summed over every Ostler process'
  })
  // Judged on private memory, what Task Manager's Memory column shows: a
  // working set counts the shared Chromium and Electron pages again in every
  // process. Both are recorded (docs/performance.md, "Memory").
  record('idleMemory', Math.round(privateMb), {
    minutes,
    basis: 'private memory (privateBytes), summed over every Ostler process',
    privateByProcess,
    workingSetMb: Math.round(memoryMb),
    workingSetByProcess: byProcess
  })
  record('idleIpc', calls / minutes, { openProjects: 1, minutes, channels })
})

test('every budget is met', () => {
  const missed = measures.filter((measure) => !measure.passed)
  expect(
    missed.map((measure) => `${measure.id}: ${measure.value} ${measure.unit} > ${measure.budget}`)
  ).toEqual([])
})
