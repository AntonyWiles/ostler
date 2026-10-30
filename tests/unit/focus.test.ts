import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  DEFAULT_FOCUS_SETTINGS,
  type FocusChange,
  type FocusSettings,
  type OstlerConfig,
  type WatchedProject
} from '../../src/shared/ostler-api'

const shown: { title: string; body: string }[] = []
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true
    constructor(private readonly options: { title: string; body: string }) {}
    on() {}
    show() {
      shown.push(this.options)
    }
  },
  BrowserWindow: class {}
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { FocusService } = await import('../../electron/services/focus-service')
const { NotificationService } = await import('../../electron/services/notification-service')
const { InboxService } = await import('../../electron/services/inbox-service')
const { blockerSource } = await import('../../electron/services/inbox-sources')
const { CONFIG_MIGRATIONS, ConfigStore } = await import('../../electron/config-store')
const { focusLengthChoices, minutesLeft, normalizeFocusSettings } =
  await import('../../src/shared/focus')
const { buildTrayMenu, trayTooltip } = await import('../../electron/app/desktop/tray-menu')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const MINUTE = 60_000

function project(id: string, name: string): WatchedProject {
  return { id, name, color: '#3b82f6', enabled: true } as WatchedProject
}

describe('focus settings (N3.5)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-focus-config-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('config migration 35 writes 25 and 50 minutes, a 5-minute break and the chime on', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 35)
    expect(migration?.name).toBe('focus-timer')
    const config: Record<string, unknown> = { notifications: { enabled: true } }
    migration?.up(config, { newInstall: false })
    expect((config.notifications as { focus: FocusSettings }).focus).toEqual({
      lengths: [25, 50],
      breakMinutes: 5,
      chime: true,
      lastMinutes: 25
    })
    const kept: Record<string, unknown> = {
      notifications: { focus: { lengths: [30], breakMinutes: 10, chime: false, lastMinutes: 30 } }
    }
    migration?.up(kept, { newInstall: false })
    expect((kept.notifications as { focus: FocusSettings }).focus).toEqual({
      lengths: [30],
      breakMinutes: 10,
      chime: false,
      lastMinutes: 30
    })
  })

  it('a new install and an older config both get the defaults', () => {
    const fresh = new ConfigStore(path.join(dir, 'fresh.json'))
    expect(fresh.get().notifications.focus).toEqual(DEFAULT_FOCUS_SETTINGS)
    fs.writeFileSync(
      path.join(dir, 'old.json'),
      JSON.stringify({ configVersion: 34, notifications: { enabled: true } })
    )
    const old = new ConfigStore(path.join(dir, 'old.json'))
    expect(old.get().notifications.focus).toEqual(DEFAULT_FOCUS_SETTINGS)
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'old.json'), 'utf8'))
    expect(onDisk.notifications.focus).toEqual(DEFAULT_FOCUS_SETTINGS)
  })

  it('keeps the settings within their bounds', () => {
    expect(
      normalizeFocusSettings({ lengths: [3, 25, 25, 200, 45.5, 90], breakMinutes: 0, chime: 'x' })
    ).toEqual({ lengths: [25, 90], breakMinutes: 5, chime: true, lastMinutes: 25 })
    expect(normalizeFocusSettings({ lengths: [] }).lengths).toEqual([25, 50])
    const store = new ConfigStore(path.join(dir, 'update.json'))
    const updated = store.update({
      notifications: {
        ...store.get().notifications,
        focus: { lengths: [1000], breakMinutes: 15, chime: false, lastMinutes: 180 }
      }
    })
    expect(updated.notifications.focus).toEqual({
      lengths: [25, 50],
      breakMinutes: 15,
      chime: false,
      lastMinutes: 180
    })
  })

  it('offers the lengths with the last one used, smallest first', () => {
    expect(focusLengthChoices({ ...DEFAULT_FOCUS_SETTINGS, lastMinutes: 40 })).toEqual([25, 40, 50])
    expect(focusLengthChoices(DEFAULT_FOCUS_SETTINGS)).toEqual([25, 50])
  })
})

describe('FocusService (N3.5)', () => {
  let dir: string
  let planning: InstanceType<typeof PlanningService>
  let now: number
  let scheduled: { run: () => void; at: number } | null
  let settings: FocusSettings
  let remembered: number[]
  let changes: FocusChange[]
  let focus: InstanceType<typeof FocusService>

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-focus-'))
    planning = new PlanningService(await createMigratedDatabase(dir), () => ['p1', 'p2'])
    now = new Date(2026, 9, 17, 9, 0).getTime()
    scheduled = null
    settings = { ...DEFAULT_FOCUS_SETTINGS }
    remembered = []
    changes = []
    focus = new FocusService({
      time: planning.time,
      settings: () => settings,
      rememberLength: (minutes) => remembered.push(minutes),
      now: () => now,
      schedule: (run, ms) => {
        scheduled = { run, at: now + ms }
        return scheduled
      },
      cancel: (handle) => {
        if (scheduled === handle) scheduled = null
      }
    })
    focus.setChangedListener((change) => changes.push(change))
    // As services.ts wires it: a timer changed anywhere tells the focus.
    planning.time.setChangedListener(() => focus.timerChanged())
  })

  afterEach(() => {
    focus.dispose()
    planning.close()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  /** Moves the clock on and runs the scheduled check if it is due, as a real timer would. */
  function advance(ms: number) {
    now += ms
    if (scheduled && scheduled.at <= now) {
      const { run } = scheduled
      scheduled = null
      run()
    }
  }

  const task = (title: string, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title }, human)

  it("starts the task's timer and counts down from the stored end", () => {
    const write = task('Write the proposal')
    const { focus: started, timer } = focus.start('p1', write.id, 25)
    expect(started).toMatchObject({
      workItemId: write.id,
      workItemTitle: 'Write the proposal',
      entryId: timer.started.id,
      phase: 'focus',
      startedAt: now,
      endsAt: now + 25 * MINUTE
    })
    expect(planning.time.timerState().running?.id).toBe(timer.started.id)
    expect(remembered).toEqual([25])
    expect(changes.map((change) => change.event)).toEqual(['started'])
    expect(focus.holdsNotifications()).toBe(true)

    advance(13 * MINUTE)
    expect(minutesLeft(started.endsAt, now)).toBe(12)
    expect(focus.get()?.phase).toBe('focus')
  })

  it('refuses a length outside 5 to 180 minutes, and a task of another project', () => {
    const write = task('Write')
    expect(() => focus.start('p1', write.id, 4)).toThrow('5 to 180')
    expect(() => focus.start('p1', write.id, 181)).toThrow('5 to 180')
    expect(() => focus.start('p1', write.id, 12.5)).toThrow('5 to 180')
    expect(() => focus.start('p2', write.id, 25)).toThrow()
    expect(focus.get()).toBeNull()
    expect(planning.time.timerState().running).toBeNull()
  })

  it('ends at its end: the timer keeps running and notifications are no longer held', () => {
    const write = task('Write')
    const { timer } = focus.start('p1', write.id, 25)
    advance(25 * MINUTE)
    expect(focus.get()?.phase).toBe('ended')
    expect(changes.map((change) => change.event)).toEqual(['started', 'finished'])
    expect(focus.holdsNotifications()).toBe(false)
    expect(planning.time.timerState().running?.id).toBe(timer.started.id)
  })

  it('wakes from sleep to the end, from the stored end, without counting', () => {
    const write = task('Write')
    focus.start('p1', write.id, 25)
    // The laptop slept through the end: no scheduled check ran.
    now += 3 * 60 * MINUTE
    expect(focus.holdsNotifications()).toBe(false)
    expect(focus.get()?.phase).toBe('ended')
    expect(changes.filter((change) => change.event === 'finished')).toHaveLength(1)
    focus.check()
    expect(changes.filter((change) => change.event === 'finished')).toHaveLength(1)
  })

  it('takes a break: the timer stops at the moment focus ended and the break counts down', () => {
    const write = task('Write')
    const { focus: started, timer } = focus.start('p1', write.id, 25)
    advance(25 * MINUTE)
    advance(3 * MINUTE)
    const onBreak = focus.choose('break')
    expect(onBreak).toMatchObject({ phase: 'break', breakEndsAt: now + 5 * MINUTE })
    expect(planning.time.timerState().running).toBeNull()
    const [entry] = planning.time.listForWorkItem(write.id)
    expect(entry).toMatchObject({ id: timer.started.id, durationSeconds: 25 * 60 })
    expect(started.endsAt - entry.startedAt).toBe(25 * MINUTE)
    expect(focus.holdsNotifications()).toBe(false)

    advance(5 * MINUTE)
    expect(focus.get()).toBeNull()
    expect(changes.map((change) => change.event)).toEqual([
      'started',
      'finished',
      'break',
      'break-over'
    ])
    expect(changes.at(-1)?.focusId).toBe(started.id)
  })

  it('keeps going: the timer runs on with no countdown', () => {
    const write = task('Write')
    const { timer } = focus.start('p1', write.id, 25)
    advance(25 * MINUTE)
    expect(focus.choose('keep')).toBeNull()
    expect(focus.get()).toBeNull()
    expect(planning.time.timerState().running?.id).toBe(timer.started.id)
  })

  it('stops at the moment focus ended, however late the answer', () => {
    const write = task('Write')
    focus.start('p1', write.id, 50)
    advance(50 * MINUTE)
    advance(20 * MINUTE)
    expect(focus.choose('stop')).toBeNull()
    expect(planning.time.timerState().running).toBeNull()
    expect(planning.time.listForWorkItem(write.id)[0].durationSeconds).toBe(50 * 60)
    expect(changes.map((change) => change.event)).toEqual(['started', 'finished', 'ended'])
  })

  it('refuses a choice while no focus has ended', () => {
    const write = task('Write')
    expect(() => focus.choose('break')).toThrow('No focus has ended')
    focus.start('p1', write.id, 25)
    expect(() => focus.choose('stop')).toThrow('No focus has ended')
  })

  it('runs one focus at a time: a new one ends the first and switches the timer', () => {
    const first = task('First')
    const second = task('Second', 'p2')
    const one = focus.start('p1', first.id, 25)
    advance(5 * MINUTE)
    const two = focus.start('p2', second.id, 50)
    expect(two.timer.stopped?.id).toBe(one.timer.started.id)
    expect(focus.get()).toMatchObject({ id: two.focus.id, workItemId: second.id, phase: 'focus' })
    expect(changes.map((change) => change.event)).toEqual(['started', 'started'])
    expect(remembered).toEqual([25, 50])
  })

  it('ends when the timer stops anywhere, or another timer starts', () => {
    const write = task('Write')
    const other = task('Other')
    focus.start('p1', write.id, 25)
    advance(MINUTE)
    planning.time.stopTimer(now)
    expect(focus.get()).toBeNull()
    expect(changes.map((change) => change.event)).toEqual(['started', 'ended'])

    focus.start('p1', write.id, 25)
    advance(MINUTE)
    planning.time.startTimer('p1', other.id, now)
    expect(focus.get()).toBeNull()
  })

  it('stop ends the focus and stops its timer now', () => {
    const write = task('Write')
    focus.start('p1', write.id, 25)
    advance(10 * MINUTE)
    expect(focus.stop()).toBeNull()
    expect(planning.time.timerState().running).toBeNull()
    expect(planning.time.listForWorkItem(write.id)[0].durationSeconds).toBe(10 * 60)
    expect(focus.stop()).toBeNull()
  })

  it('closing Ostler ends the focus and leaves the timer to R2.3', () => {
    const write = task('Write')
    const { timer } = focus.start('p1', write.id, 25)
    focus.dispose()
    expect(focus.get()).toBeNull()
    expect(scheduled).toBeNull()
    expect(planning.time.timerState().running?.id).toBe(timer.started.id)
  })

  it('holds desktop notifications during focus and shows them after; Inbox items still arrive', () => {
    const projects = [project('p1', 'Website')]
    const config = {
      ...DEFAULT_CONFIG,
      projects,
      notifications: { ...DEFAULT_CONFIG.notifications }
    } as OstlerConfig
    const notifications = new NotificationService(
      () => config,
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: () => {} }
      } as never,
      () => new Date(now)
    )
    notifications.setFocusHold(() => focus.holdsNotifications())
    const inbox = new InboxService(planning.database)
    inbox.registerSource(
      'blockers',
      blockerSource(planning.database, () => projects)
    )
    inbox.refresh()

    const write = task('Write')
    focus.start('p1', write.id, 25)
    expect(notifications.shouldNotify('blocker', 'p1')).toBe(false)
    expect(notifications.shouldNotify('reminder', null)).toBe(false)

    const stuck = task('Stuck')
    planning.reportBlocker(stuck.id, 'Waiting on legal', 'human')
    const arrived = inbox.refresh()
    expect(arrived.map((item) => item.title)).toEqual(['Stuck'])
    shown.length = 0
    notifications.notify('blocker', 'Stuck', 'Waiting on legal', 'p1')
    expect(shown).toEqual([])
    expect(inbox.list().items.map((item) => item.title)).toEqual(['Stuck'])

    advance(25 * MINUTE)
    expect(notifications.shouldNotify('blocker', 'p1')).toBe(true)
    notifications.notify('focus', 'Focus finished: Write', '', 'p1')
    expect(shown.map((entry) => entry.title)).toEqual(['Focus finished: Write'])
  })
})

describe('the tray during focus (N3.5)', () => {
  const time = (at: number) => new Date(at).toISOString().slice(11, 16)
  const base = {
    id: 'f1',
    projectId: 'p1',
    workItemId: 'w1',
    workItemTitle: 'Write the proposal',
    entryId: 'e1',
    minutes: 25,
    startedAt: 0,
    endsAt: 25 * MINUTE,
    breakEndsAt: null
  }

  it('says the time left in the tooltip, from the stored end', () => {
    expect(
      trayTooltip({
        focus: { ...base, phase: 'focus' },
        unread: 2,
        now: 13 * MINUTE,
        name: 'Ostler'
      })
    ).toBe('Focus: 12 min left on Write the proposal')
    expect(
      trayTooltip({
        focus: { ...base, phase: 'break', breakEndsAt: 30 * MINUTE },
        unread: 0,
        now: 26 * MINUTE,
        name: 'Ostler'
      })
    ).toBe('Break: 4 min left')
    expect(trayTooltip({ focus: null, unread: 0, now: 0, name: 'Ostler' })).toBe('Ostler')
  })

  it('offers Stop focus first, before Stop timer', () => {
    const items = buildTrayMenu({
      unread: 0,
      aiOn: false,
      remindersPausedUntil: null,
      time,
      timerTask: 'Write the proposal',
      focus: { ...base, phase: 'focus' }
    })
    expect(items.slice(0, 3)).toEqual([
      { label: 'Stop focus', action: 'stop-focus' },
      { label: 'Stop timer: Write the proposal', action: 'stop-timer' },
      { type: 'separator' }
    ])
  })
})
