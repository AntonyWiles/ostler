import type { ElectronApplication, Locator, Page } from 'playwright'
import * as path from 'path'
import {
  closeApp,
  drainNativeCalls,
  launchApp,
  MainLogTail,
  prepareDataDir,
  type LaunchSettings,
  type Ports,
  type RunningApp
} from './app'
import { accessibilityFindings, normalise, readScreenState, screenFindings } from './checks'
import { lookFindings } from './look'
import type { MonkeyOptions } from './options'
import type { ActionKind, FindingInput, Recorder } from './recorder'

/**
 * One monkey session: the running app, and the hand that uses it like a
 * person. Every action goes through `Hand.act`, which records it, logs the
 * keys the page received, looks for trouble, notes the screen's controls for
 * coverage and takes the screenshot.
 */

export type AriaRole = Parameters<Page['getByRole']>[0]

export interface Target {
  locator: Locator
  /**
   * For a target built without a scope: the same query from another root,
   * so it can be looked for in the top open dialog first (`resolveTarget`).
   */
  query?: (root: Page | Locator) => Locator
  /** In words, for the logs: `button "Save" in dialog "New task"`. */
  description: string
  /** The control's name, as the coverage inventory knows it. */
  control?: string
}

export class StepError extends Error {
  constructor(
    message: string,
    readonly screenshot?: string
  ) {
    super(message)
  }
}

interface Delays {
  /** Per typed character. */
  key: number
  /** Before an action: reading the screen, moving the mouse. */
  think: [number, number]
  /** After an action: letting the app settle. */
  settle: number
}

const DELAYS: Record<MonkeyOptions['speed'], Delays> = {
  instant: { key: 0, think: [0, 0], settle: 80 },
  brisk: { key: 12, think: [60, 220], settle: 150 },
  human: { key: 70, think: [400, 1400], settle: 300 }
}

/** A small seeded random source, so an exploration can be replayed. */
export class Random {
  private state: number
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9
  }
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
  chance(probability: number): boolean {
    return this.next() < probability
  }
}

export class Session {
  running: RunningApp | null = null
  ports: Ports | null = null
  readonly random: Random
  readonly hand: Hand
  private launchSettings: LaunchSettings = {}
  private mainLog: MainLogTail
  private readonly pageErrors: string[] = []
  private readonly consoleErrors: string[] = []
  private readonly a11yScreens = new Set<string>()
  private readonly lookedAt = new Set<string>()
  /** Error toasts and alerts are expected while this is above zero. */
  expectingErrors = 0

  constructor(
    readonly options: MonkeyOptions,
    readonly recorder: Recorder
  ) {
    this.random = new Random(options.seed)
    this.hand = new Hand(this)
    this.mainLog = new MainLogTail(path.join(options.dataDir, 'logs', 'main.log'))
  }

  get page(): Page {
    if (!this.running) throw new Error('Ostler is not running')
    return this.running.page
  }

  get app(): ElectronApplication {
    if (!this.running) throw new Error('Ostler is not running')
    return this.running.app
  }

  get ui(): Ui {
    return new Ui(this)
  }

  async start(settings: LaunchSettings = {}, extraConfig: { ai?: Record<string, unknown> } = {}) {
    this.launchSettings = settings
    const prepared = await prepareDataDir(this.options, extraConfig)
    this.ports = prepared.ports
    this.recorder.journal(
      prepared.trueNewInstall
        ? '- A truly new install: no config.json until Ostler writes its own.'
        : `- Config prepared: harness port ${prepared.ports.harness}, automation port ${prepared.ports.automation}.`
    )
    this.mainLog = new MainLogTail(path.join(this.options.dataDir, 'logs', 'main.log'))
    this.running = await launchApp(this.options, this.recorder, settings)
    this.watchPage(this.running.page)
    // The window's first screen settles: the welcome or Home.
    await this.page
      .locator('#root *')
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {})
    await this.hand.settle()
    await this.recorder.screenshot(this.page, 'launched', { force: true })
  }

  /** Closes Ostler and starts it again on the same data folder, as a person would. */
  async restart(reason: string): Promise<void> {
    const started = Date.now()
    await closeApp(this.running)
    this.running = await launchApp(this.options, this.recorder, this.launchSettings)
    this.watchPage(this.running.page)
    await this.page
      .locator('#root *')
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {})
    await this.hand.settle(800)
    const shot = await this.recorder.screenshot(this.page, 'after-restart', { force: true })
    this.recorder.action({
      kind: 'restart',
      target: reason,
      durationMs: Date.now() - started,
      ok: true,
      screenshot: shot
    })
  }

  async stop(): Promise<void> {
    await this.collect().catch(() => {})
    await closeApp(this.running)
    this.running = null
  }

  private watchPage(page: Page): void {
    page.on('pageerror', (error) => {
      const text = `${error.name}: ${error.message}`
      this.pageErrors.push(text)
      this.recorder.console(`[pageerror] ${error.stack ?? text}`)
    })
    page.on('console', (message) => {
      const type = message.type()
      const text = message.text()
      this.recorder.console(`[${type}] ${text}`)
      if (type === 'error') this.consoleErrors.push(text)
    })
    page.on('crash', () => {
      this.recorder.finding({
        kind: 'broken',
        severity: 'S1',
        title: 'The window crashed',
        details: 'The renderer process crashed (Playwright "crash" event).',
        where: 'window'
      })
    })
  }

  /**
   * Reads the app's state through its own API from the window, as the e2e
   * suite does: to check what the screen claims, never to do what a person
   * would do through the screen. `read` runs in the window, so it can use
   * nothing from this file; it gets the API from `globalThis.ostlerAPI`.
   */
  async api<T, A>(label: string, read: (arg: A) => Promise<T>, arg: A): Promise<T> {
    const started = Date.now()
    try {
      const result = await this.page.evaluate(read as (arg: unknown) => Promise<T>, arg as unknown)
      this.recorder.action({
        kind: 'api',
        target: label,
        durationMs: Date.now() - started,
        ok: true
      })
      return result
    } catch (error) {
      this.recorder.action({
        kind: 'api',
        target: label,
        durationMs: Date.now() - started,
        ok: false,
        error: firstLine(error)
      })
      throw error
    }
  }

  /** The screen's name: route plus the top dialog. */
  async screen(): Promise<string> {
    return this.page
      .evaluate(
        () =>
          (window as unknown as { __monkeyScreen?: () => string }).__monkeyScreen?.() ??
          location.hash
      )
      .catch(() => 'unknown')
  }

  /** Everything the probe and the main process collected since the last call. */
  async collect(): Promise<void> {
    if (!this.running) return
    const drained = await this.page
      .evaluate(() => {
        const w = window as unknown as { __monkeyKeys?: string[]; __monkeyClicks?: string[] }
        return {
          keys: w.__monkeyKeys ? w.__monkeyKeys.splice(0) : [],
          clicks: w.__monkeyClicks ? w.__monkeyClicks.splice(0) : []
        }
      })
      .catch(() => ({ keys: [] as string[], clicks: [] as string[] }))
    this.recorder.keys([...drained.clicks, ...drained.keys].sort())
    for (const call of await drainNativeCalls(this.app)) {
      this.recorder.journal(`- Ostler asked Windows: \`${call.kind}\` ${call.detail.slice(0, 300)}`)
      if (
        call.kind === 'message-box' ||
        call.kind === 'message-box-sync' ||
        call.kind === 'error-box'
      ) {
        this.recorder.finding({
          kind: 'improve',
          severity: 'S4',
          title: 'Ostler showed a native Windows message box',
          details: `${call.kind}: ${call.detail}`,
          where: await this.screen(),
          key: `native|${normalise(call.detail)}`
        })
      }
    }
  }

  /** Runs every check and records what it finds. Returns the screen it looked at. */
  async check(): Promise<string> {
    const screen = await this.screen()
    const found: FindingInput[] = []
    for (const error of this.pageErrors.splice(0)) {
      found.push({
        kind: 'error',
        severity: 'S2',
        title: `Uncaught error in the window: ${error.slice(0, 140)}`,
        details: error,
        where: screen,
        key: `pageerror|${normalise(error)}`
      })
    }
    for (const error of this.consoleErrors.splice(0)) {
      found.push({
        kind: 'error',
        severity: 'S3',
        title: `Console error: ${error.slice(0, 140)}`,
        details: error,
        where: screen,
        key: `console|${normalise(error)}`
      })
    }
    for (const entry of this.mainLog.read()) {
      // A deliberate mistake (a merge meant to conflict) is logged by main too.
      if (entry.level === 'INFO' || this.expectingErrors > 0) continue
      const first = entry.text.split('\n')[0]
      found.push({
        kind: 'error',
        severity: entry.level === 'ERROR' ? 'S2' : 'S4',
        title: `main.log ${entry.level}: ${first.slice(0, 140)}`,
        details: entry.text,
        where: screen,
        key: `mainlog|${entry.level}|${normalise(first)}`
      })
    }
    const state = await readScreenState(this.page).catch(() => null)
    if (state) {
      for (const finding of screenFindings(state, screen)) {
        if (this.expectingErrors > 0 && finding.kind === 'error') continue
        found.push(finding)
      }
    }
    if (!this.lookedAt.has(screen)) {
      this.lookedAt.add(screen)
      found.push(...(await lookFindings(this.page, screen)))
    }
    if (this.options.a11y && !this.a11yScreens.has(screen)) {
      this.a11yScreens.add(screen)
      found.push(...(await accessibilityFindings(this.page, screen)))
    }
    if (found.length) {
      const shot = await this.recorder.screenshot(this.page, `finding-${screen}`, { force: true })
      for (const finding of found) this.recorder.finding({ screenshot: shot, ...finding })
    }
    return screen
  }

  /** Notes the visible controls on the screen for the coverage report. */
  async inventory(): Promise<{ screen: string; isNew: boolean }> {
    const screen = await this.screen()
    const controls = await this.page
      .evaluate(() => {
        const w = window as unknown as {
          __monkeyInventory?: (tag: boolean) => { role: string; name: string }[]
        }
        return (w.__monkeyInventory?.(false) ?? []).map((c) => `${c.role} "${c.name}"`)
      })
      .catch(() => [] as string[])
    const isNew = this.recorder.sawScreen(screen, controls)
    return { screen, isNew }
  }

  /** Looks at every screen afresh: after the theme or the window size changes. */
  lookAgain(): void {
    this.lookedAt.clear()
  }

  /** Runs `work` with error toasts and alerts expected (a deliberate mistake). */
  async expectErrors<T>(work: () => Promise<T>): Promise<T> {
    this.expectingErrors += 1
    try {
      return await work()
    } finally {
      this.expectingErrors -= 1
    }
  }
}

/**
 * The locator a target means right now. With a dialog open, a person can only
 * reach what is in it, so a target built without a scope is looked for in the
 * top open dialog first, and on the page behind only when the dialog has no
 * such control (a toast, the status bar).
 */
export async function resolveTarget(page: Page, target: Target): Promise<Locator> {
  if (!target.query) return target.locator
  const top = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last()
  if ((await top.count().catch(() => 0)) > 0) {
    const inside = target.query(top)
    if ((await inside.count().catch(() => 0)) > 0) return inside
  }
  return target.locator
}

/** Builds targets the way a person reads the screen: by role and name. */
export class Ui {
  constructor(
    private readonly session: Session,
    private readonly scope?: { locator: Locator; description: string }
  ) {}

  private get root(): Page | Locator {
    return this.scope?.locator ?? this.session.page
  }

  private target(build: (root: Page | Locator) => Locator, what: string, control?: string): Target {
    return {
      locator: build(this.root),
      // Only an unscoped target is redirected into the top dialog.
      query: this.scope ? undefined : (root) => build(root),
      description: this.scope ? `${what} in ${this.scope.description}` : what,
      control
    }
  }

  /** Any ARIA role by name; `nth` picks a later match when several share the name. */
  role(role: AriaRole, name: string | RegExp, exact = true, nth = 0): Target {
    const label = typeof name === 'string' ? `"${name}"` : String(name)
    return this.target(
      (root) =>
        root
          .getByRole(role, { name, exact: typeof name === 'string' ? exact : undefined })
          .nth(nth),
      `${role} ${label}${nth ? ` (#${nth + 1})` : ''}`,
      typeof name === 'string' ? `${role} "${name}"` : undefined
    )
  }

  button(name: string | RegExp, exact = true): Target {
    return this.role('button', name, exact)
  }
  link(name: string | RegExp, exact = true): Target {
    return this.role('link', name, exact)
  }
  tab(name: string | RegExp, exact = true): Target {
    return this.role('tab', name, exact)
  }
  menuitem(name: string | RegExp, exact = true): Target {
    return this.role('menuitem', name, exact)
  }
  checkbox(name: string | RegExp, exact = true): Target {
    return this.role('checkbox', name, exact)
  }
  switch(name: string | RegExp, exact = true): Target {
    return this.role('switch', name, exact)
  }
  radio(name: string | RegExp, exact = true): Target {
    return this.role('radio', name, exact)
  }
  textbox(name: string | RegExp, exact = true): Target {
    return this.role('textbox', name, exact)
  }
  combobox(name: string | RegExp, exact = true): Target {
    return this.role('combobox', name, exact)
  }
  heading(name: string | RegExp, exact = true): Target {
    return this.role('heading', name, exact)
  }
  option(name: string | RegExp, exact = true): Target {
    return this.role('option', name, exact)
  }
  label(text: string | RegExp, exact = true, nth = 0): Target {
    const label = typeof text === 'string' ? `"${text}"` : String(text)
    return this.target(
      (root) =>
        root.getByLabel(text, { exact: typeof text === 'string' ? exact : undefined }).nth(nth),
      `field ${label}${nth ? ` (#${nth + 1})` : ''}`,
      typeof text === 'string' ? `textbox "${text}"` : undefined
    )
  }
  text(text: string | RegExp, exact = false, nth = 0): Target {
    const label = typeof text === 'string' ? `"${text}"` : String(text)
    return this.target(
      (root) => root.getByText(text, { exact }).nth(nth),
      `text ${label}${nth ? ` (#${nth + 1})` : ''}`
    )
  }
  css(selector: string, description: string): Target {
    return this.target((root) => root.locator(selector).first(), description)
  }

  /** A dialog (or alert dialog) by its name; actions inside it are scoped to it. */
  dialog(name: string | RegExp): Ui {
    const label = typeof name === 'string' ? `"${name}"` : String(name)
    const page = this.session.page
    const locator = page
      .getByRole('dialog', { name })
      .or(page.getByRole('alertdialog', { name }))
      .last()
    return new Ui(this.session, { locator, description: `dialog ${label}` })
  }
  region(name: string | RegExp): Ui {
    const label = typeof name === 'string' ? `"${name}"` : String(name)
    return new Ui(this.session, {
      locator: this.root.getByRole('region', { name }).first(),
      description: `region ${label}`
    })
  }
  within(locator: Locator, description: string): Ui {
    return new Ui(this.session, { locator, description })
  }
  get locator(): Locator {
    if (!this.scope) throw new Error('Not scoped')
    return this.scope.locator
  }
}

export interface ActOptions {
  /** This action is expected to take a while (AI, agents): no slow-step lead. */
  slowOk?: boolean
  /** Do not screenshot this one, whatever the policy. */
  noShot?: boolean
}

const SLOW_ACTION_MS = 4000
/** A screen behind a loading placeholder for longer than this is a lead. */
const SLOW_LOAD_MS = 1500
/** The hand waits this long for a screen to load, then looks anyway. */
const LOADING_LIMIT_MS = 8000

export class Hand {
  /** Set when the hand had to clear something out of its way: its own time, not the app's. */
  private recovered = false

  constructor(private readonly session: Session) {}

  private get page(): Page {
    return this.session.page
  }

  private get delays(): Delays {
    return DELAYS[this.session.options.speed]
  }

  async think(ms?: number): Promise<void> {
    const [min, max] = this.delays.think
    const wait = ms ?? this.session.random.int(min, max)
    if (wait > 0) await this.page.waitForTimeout(wait)
  }

  async settle(ms?: number): Promise<void> {
    await this.page.waitForTimeout(ms ?? this.delays.settle).catch(() => {})
  }

  /** Open dialogs, and whether focus is on nothing (the page itself). */
  private async focusState(): Promise<{ dialogs: number; lost: boolean }> {
    return this.page
      .evaluate(() => {
        const open = Array.from(
          document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')
        ).filter((element) => (element as HTMLElement).getBoundingClientRect().width > 0)
        const active = document.activeElement
        return {
          dialogs: open.length,
          lost: !active || active === document.body || active === document.documentElement
        }
      })
      .catch(() => ({ dialogs: 0, lost: false }))
  }

  /**
   * A screen that loads on first use shows a placeholder first. A person
   * waits for it; so does the hand, before it looks or takes the screenshot.
   * Returns how long it waited.
   */
  private async waitForLoading(): Promise<number> {
    const started = Date.now()
    const loading = this.page.locator('.ostler-workspace-loading:visible, .ui-skeleton:visible')
    while (Date.now() - started < LOADING_LIMIT_MS) {
      if ((await loading.count().catch(() => 0)) === 0) break
      await this.page.waitForTimeout(100).catch(() => {})
    }
    return Date.now() - started
  }

  private async mutations(): Promise<number> {
    return this.page
      .evaluate(() => (window as unknown as { __monkeyMutations?: number }).__monkeyMutations ?? 0)
      .catch(() => -1)
  }

  /**
   * Every action: think, find the control, act, settle, then record, check
   * and screenshot. Failures are recorded with a screenshot and rethrown as
   * StepError.
   */
  async act(
    kind: ActionKind,
    target: Target | null,
    run: (locator: Locator) => Promise<void>,
    {
      value,
      slowOk = false,
      noShot = false,
      deadClickCheck = false
    }: ActOptions & {
      value?: string
      deadClickCheck?: boolean
    } = {}
  ): Promise<void> {
    const recorder = this.session.recorder
    await this.think()
    this.recovered = false
    const screenBefore = await this.session.screen()
    const focusBefore = await this.focusState()
    let before = -1
    const started = Date.now()
    let error: unknown = null
    try {
      const locator = target ? await resolveTarget(this.page, target) : this.page.locator('body')
      if (deadClickCheck) {
        // Pressing what is already selected (the open tab, the current page)
        // rightly changes nothing.
        const current = await locator
          .evaluate(
            (element) =>
              element.getAttribute('aria-selected') === 'true' ||
              element.getAttribute('aria-current') !== null ||
              element.getAttribute('aria-checked') === 'true' ||
              element.getAttribute('aria-pressed') === 'true',
            undefined,
            { timeout: 2000 }
          )
          .catch(() => true)
        if (!current) before = await this.mutations()
      }
      await run(locator)
    } catch (caught) {
      error = caught
    }
    const durationMs = Date.now() - started
    await this.settle()
    const loadingMs = await this.waitForLoading()
    await this.session.collect()
    const screen = await this.session.check()
    if (target?.control && !error) recorder.pressed(screenBefore, target.control)
    const focusAfter = await this.focusState()
    if (!error && focusAfter.dialogs < focusBefore.dialogs && focusAfter.lost) {
      recorder.finding({
        kind: 'a11y',
        severity: 'S3',
        title: `Focus is lost when "${screenBefore.split(' › ').pop()}" closes`,
        details:
          `After ${kind} ${target?.description ?? value ?? ''} closed the dialog on ${screenBefore}, focus went to the page itself, ` +
          'not back to the control that opened it. A keyboard user has to start again from the top of the window.',
        where: screenBefore,
        key: `focus-lost|${normalise(screenBefore)}`
      })
    }
    await this.session.inventory()
    const shot = noShot
      ? undefined
      : await recorder.screenshot(this.page, `${kind}-${target?.description ?? value ?? ''}`, {
          force: !!error
        })
    recorder.action({
      kind,
      target: target?.description,
      value,
      route: screen,
      durationMs,
      ok: !error,
      error: error ? firstLine(error) : undefined,
      screenshot: shot
    })
    if (error) {
      throw new StepError(
        `${kind} ${target?.description ?? value ?? ''}: ${firstLine(error)}`,
        shot
      )
    }
    if (!slowOk && !this.recovered && durationMs > SLOW_ACTION_MS) {
      recorder.finding({
        kind: 'perf',
        severity: 'S4',
        title: `Slow: ${kind} ${target?.description ?? ''} took ${(durationMs / 1000).toFixed(1)} s`,
        details: `On ${screenBefore}. Anything a person waits more than a few seconds for without feedback feels broken.`,
        where: screenBefore,
        key: `slow|${kind}|${target?.description}`,
        screenshot: shot
      })
    }
    if (loadingMs > SLOW_LOAD_MS) {
      recorder.finding({
        kind: 'perf',
        severity: loadingMs >= LOADING_LIMIT_MS ? 'S3' : 'S4',
        title: `${screen} took ${(loadingMs / 1000).toFixed(1)} s to show${loadingMs >= LOADING_LIMIT_MS ? ' (still loading when the monkey gave up)' : ''}`,
        details: `After ${kind} ${target?.description ?? value ?? ''} on ${screenBefore}, a loading placeholder stayed up this long, on a small project with the stand-in AI.`,
        where: screen,
        key: `loading|${normalise(screen)}`,
        screenshot: shot
      })
    }
    if (deadClickCheck && before >= 0) {
      const after = await this.mutations()
      if (after === before && screen === screenBefore) {
        recorder.finding({
          kind: 'dead-click',
          severity: 'S4',
          title: `Clicking ${target?.description ?? 'a control'} changed nothing on screen`,
          details: `On ${screenBefore}. Nothing in the window changed and the screen stayed the same. It may be disabled without saying so, or broken.`,
          where: screenBefore,
          key: `dead|${screenBefore}|${target?.description}`,
          screenshot: shot
        })
      }
    }
  }

  async click(
    target: Target,
    options: ActOptions & {
      button?: 'left' | 'right'
      double?: boolean
      timeout?: number
      force?: boolean
      deadClickCheck?: boolean
    } = {}
  ): Promise<void> {
    const kind: ActionKind = options.double
      ? 'double-click'
      : options.button === 'right'
        ? 'right-click'
        : 'click'
    await this.act(
      kind,
      target,
      async (locator) => {
        const timeout = options.timeout ?? 10_000
        await locator.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 3000) }).catch(() => {})
        await locator.hover({ timeout: 1500, force: options.force }).catch(() => {})
        const press = (force: boolean, wait: number) =>
          options.double
            ? locator.dblclick({ timeout: wait, force })
            : locator.click({ timeout: wait, button: options.button, force })
        // Styled radios, checkboxes and switches hide the real input under
        // their card or label, which then "intercepts pointer events". A
        // person clicks the card; so does the hand, by clicking through.
        const checkable = await locator
          .evaluate(
            (element) => {
              const role = element.getAttribute('role')
              const type = element instanceof HTMLInputElement ? element.type : ''
              return (
                role === 'radio' ||
                role === 'checkbox' ||
                role === 'switch' ||
                type === 'radio' ||
                type === 'checkbox'
              )
            },
            undefined,
            { timeout: Math.min(timeout, 5000) }
          )
          .catch(() => false)
        if (checkable && !options.force) {
          try {
            await press(false, Math.min(timeout, 800))
          } catch {
            this.recovered = true
            await press(true, timeout)
          }
        } else if (options.force) {
          await press(true, timeout)
        } else {
          try {
            await press(false, timeout)
          } catch (error) {
            // Playwright's call log says why it never clicked.
            const log = error instanceof Error ? error.message : String(error)
            if (/intercepts pointer events/.test(log)) {
              // Something lies over it: a menu or popover left open. A person
              // closes it first, then clicks.
              this.recovered = true
              await this.page.keyboard.press('Escape')
              await this.page.waitForTimeout(150)
              await press(false, 5000)
            } else if (/not stable/.test(log)) {
              // Visible and enabled, but replaced or moving under the pointer.
              // A person clicks anyway; so does the hand, and notes it.
              await press(true, 5000)
              this.session.recorder.finding({
                kind: 'perf',
                severity: 'S4',
                title: `${target.description} would not hold still long enough to click`,
                details:
                  'Playwright waits for a control to stop moving or being replaced before it clicks. This one never settled for 10 s, which usually means it is re-rendered or animated continuously. Keyboard and screen-reader users lose focus on controls that are replaced.',
                where: await this.session.screen(),
                key: `unstable|${target.description}`
              })
            } else {
              throw error
            }
          }
        }
      },
      options
    )
  }

  /**
   * Types into a field the way a person does: click it, select what is there,
   * type the new text a key at a time. Secrets are typed but never logged.
   */
  async fill(
    target: Target,
    text: string,
    options: ActOptions & { secret?: boolean; append?: boolean } = {}
  ): Promise<void> {
    if (options.secret) this.session.recorder.secret(text)
    const shown = options.secret ? '••••••' : text
    await this.act(
      'type',
      target,
      async (locator) => {
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
        // A native date, time or colour picker takes its value whole (as
        // YYYY-MM-DD for a date), the way choosing it in the picker does.
        const picker = await locator
          .evaluate(
            (element) =>
              element instanceof HTMLInputElement &&
              ['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range'].includes(
                element.type
              ),
            undefined,
            { timeout: 5000 }
          )
          .catch(() => false)
        if (picker) {
          await locator.fill(text, { timeout: 10_000 })
          return
        }
        await locator.click({ timeout: 10_000 })
        if (!options.append) {
          await this.page.keyboard.press('Control+A')
          await this.page.keyboard.press('Backspace')
        }
        // Long text goes in as typing, then a paste; nobody types a whole brief.
        if (text.length > 400 || this.delays.key === 0) {
          await locator.pressSequentially(text.slice(0, 40), { delay: this.delays.key })
          if (text.length > 40) await this.page.keyboard.insertText(text.slice(40))
        } else {
          await locator.pressSequentially(text, { delay: this.delays.key })
        }
      },
      {
        ...options,
        value: shown.length > 300 ? `${shown.slice(0, 300)}… (${shown.length} chars)` : shown
      }
    )
  }

  /** Presses keys on whatever has focus: "Control+K", "Escape", "?". */
  async press(keys: string, options: ActOptions & { times?: number } = {}): Promise<void> {
    const times = options.times ?? 1
    await this.act(
      'press',
      null,
      async () => {
        for (let index = 0; index < times; index += 1) {
          await this.page.keyboard.press(keys)
          if (times > 1) await this.page.waitForTimeout(Math.max(40, this.delays.key * 4))
        }
      },
      { ...options, value: times > 1 ? `${keys} ×${times}` : keys }
    )
  }

  /** Types into whatever has focus, without clicking anything first. */
  async type(text: string, options: ActOptions = {}): Promise<void> {
    await this.act('type', null, () => this.page.keyboard.type(text, { delay: this.delays.key }), {
      ...options,
      value: text
    })
  }

  async select(
    target: Target,
    option: string | { label: string },
    options: ActOptions = {}
  ): Promise<void> {
    await this.act(
      'select',
      target,
      async (locator) => {
        await locator.selectOption(option, { timeout: 10_000 })
      },
      { ...options, value: typeof option === 'string' ? option : option.label }
    )
  }

  async check(target: Target, checked = true, options: ActOptions = {}): Promise<void> {
    await this.act(
      'check',
      target,
      async (locator) => {
        try {
          await locator.setChecked(checked, { timeout: 2500 })
        } catch {
          await locator.setChecked(checked, { timeout: 10_000, force: true })
        }
      },
      { ...options, value: String(checked) }
    )
  }

  async hover(target: Target, options: ActOptions = {}): Promise<void> {
    await this.act('hover', target, (locator) => locator.hover({ timeout: 10_000 }), {
      ...options,
      noShot: options.noShot ?? true
    })
  }

  async scroll(target: Target | null, deltaY: number, options: ActOptions = {}): Promise<void> {
    await this.act(
      'scroll',
      target,
      async (locator) => {
        if (target) await locator.hover({ timeout: 5000 }).catch(() => {})
        await this.page.mouse.wheel(0, deltaY)
      },
      { ...options, value: String(deltaY) }
    )
  }

  async drag(source: Target, destination: Target, options: ActOptions = {}): Promise<void> {
    await this.act(
      'drag',
      source,
      async (locator) => {
        const to = await resolveTarget(this.page, destination)
        await locator.dragTo(to, { timeout: 10_000 })
      },
      { ...options, value: `to ${destination.description}` }
    )
  }

  /**
   * Waits for something to be visible, as a person waits for the screen.
   * Returns false (and records nothing) when it never shows: the caller
   * decides whether that is a finding.
   */
  async sees(target: Target, timeout = 8000): Promise<boolean> {
    const deadline = Date.now() + timeout
    for (;;) {
      const locator = await resolveTarget(this.page, target)
      try {
        await locator.waitFor({
          state: 'visible',
          timeout: Math.min(1000, Math.max(1, deadline - Date.now()))
        })
        return true
      } catch {
        if (Date.now() >= deadline) return false
      }
    }
  }

  /** Waits for something to show, or fails the step. */
  async expect(target: Target, timeout = 8000, options: ActOptions = {}): Promise<void> {
    await this.act(
      'expect',
      target,
      async () => {
        if (!(await this.sees(target, timeout))) {
          throw new Error(`${target.description} did not appear within ${timeout / 1000} s`)
        }
      },
      { ...options, noShot: options.noShot ?? true, slowOk: true }
    )
  }

  /** Waits for something to go away, or fails the step. */
  async expectGone(target: Target, timeout = 8000): Promise<void> {
    await this.act(
      'expect',
      target,
      async (locator) => {
        await locator.waitFor({ state: 'hidden', timeout })
      },
      { noShot: true, value: 'gone', slowOk: true }
    )
  }

  /** A deliberate pause, recorded: waiting for an agent, reading a report. */
  async wait(reason: string, ms: number): Promise<void> {
    await this.act('wait', null, () => this.page.waitForTimeout(ms), {
      value: reason,
      slowOk: true,
      noShot: true
    })
  }

  async shot(label: string): Promise<string | undefined> {
    const shot = await this.session.recorder.screenshot(this.page, label, { force: true })
    this.session.recorder.action({
      kind: 'shot',
      target: label,
      durationMs: 0,
      ok: true,
      screenshot: shot
    })
    return shot
  }
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0].slice(0, 300)
}
