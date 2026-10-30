import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_POP_OUTS,
  MAX_REMEMBERED_POP_OUTS,
  normalizePopOutSettings,
  parsePopOutHash,
  parsePopOutRoute,
  popOutHash,
  staysInPopOut,
  type PopOutWindowState
} from '../../src/shared/pop-out'
import {
  POP_OUT_DEFAULT_SIZE,
  PopOutWindows,
  popOutPlace,
  type PopOutPlace
} from '../../electron/app/pop-out-windows'
import { normalizeMainWindowPath } from '../../electron/ipc/pop-out-handlers'
import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { fromRendererConfigUpdate } from '../../src/shared/renderer-config'
import { useTempDir } from '../helpers/temp-dir'

/** A window as PopOutWindows sees it: closing fires `close` then `closed`. */
class FakeWindow {
  listeners = new Map<string, (() => void)[]>()
  destroyed = false
  focused = 0
  webContents = {}
  constructor(
    readonly route: string,
    readonly place: PopOutPlace,
    public bounds = { x: 10, y: 20, width: 1000, height: 700 }
  ) {}
  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  getNormalBounds() {
    return { ...this.bounds }
  }
  isMaximized() {
    return false
  }
  isDestroyed() {
    return this.destroyed
  }
  close() {
    for (const listener of this.listeners.get('close') ?? []) listener()
    this.destroyed = true
    for (const listener of this.listeners.get('closed') ?? []) listener()
  }
}

const SCREEN = [{ x: 0, y: 0, width: 1920, height: 1040 }]

function setup(initial: PopOutWindowState[] = [], projects = ['p1', 'p2']) {
  let saved = initial
  const created: FakeWindow[] = []
  const popOuts = new PopOutWindows<FakeWindow>({
    create: (route, place) => {
      const win = new FakeWindow(route, place)
      created.push(win)
      return win
    },
    focus: (win) => {
      win.focused += 1
    },
    read: () => saved,
    write: (windows) => {
      saved = windows
    },
    workAreas: () => SCREEN,
    projectExists: (id) => projects.includes(id)
  })
  return { popOuts, created, saved: () => saved }
}

const route = (index: number) =>
  `/projects/p1/${['board', 'list', 'calendar', 'timeline', 'overview', 'library', 'decisions', 'milestones', 'matrix'][index]}`

describe('pop-out routes (N5.8a)', () => {
  it('accepts Home and one project view, nothing else', () => {
    expect(parsePopOutRoute('/home')).toEqual({ kind: 'home' })
    expect(parsePopOutRoute('/projects/p-1/board')).toEqual({
      kind: 'project',
      projectId: 'p-1',
      view: 'board'
    })
    for (const bad of [
      '/settings',
      '/projects/p1',
      '/projects/p1/tasks/t1',
      '/projects/../board',
      'home',
      7,
      '/projects/p1/Board'
    ])
      expect(parsePopOutRoute(bad)).toBeNull()
  })

  it('round-trips the pop-out hash and keeps a pop-out on its own view', () => {
    expect(parsePopOutHash(popOutHash('/projects/p1/board'))).toBe('/projects/p1/board')
    expect(parsePopOutHash('/projects/p1/board')).toBeNull()
    expect(parsePopOutHash('/pop-out/settings')).toBeNull()
    expect(staysInPopOut('/projects/p1/board', '/projects/p1/board')).toBe(true)
    expect(staysInPopOut('/projects/p1/board', '/projects/p2/board')).toBe(false)
    expect(staysInPopOut('/home', '/settings')).toBe(false)
  })

  it('hands the main window only internal paths', () => {
    expect(normalizeMainWindowPath('/settings/general')).toBe('/settings/general')
    for (const bad of ['https://example.com', '//evil', 'settings', '/a\\b', '/a\nb', 3])
      expect(() => normalizeMainWindowPath(bad)).toThrow()
  })
})

describe('the eight-window limit (N5.8a)', () => {
  it('opens eight, then names the oldest instead of a ninth', () => {
    const { popOuts, created } = setup()
    for (let index = 0; index < MAX_POP_OUTS; index += 1) {
      expect(popOuts.open(route(index))).toEqual({ opened: true })
    }
    expect(created).toHaveLength(8)
    expect(popOuts.open(route(8))).toEqual({ opened: false, full: true, oldest: route(0) })
    expect(created).toHaveLength(8)
  })

  it('closes the oldest and opens the ninth when the person chooses to', () => {
    const { popOuts, created } = setup()
    for (let index = 0; index < MAX_POP_OUTS; index += 1) popOuts.open(route(index))
    expect(popOuts.open(route(8), true)).toEqual({ opened: true })
    expect(created[0].destroyed).toBe(true)
    expect(popOuts.openRoutes()).toHaveLength(8)
    expect(popOuts.openRoutes()).not.toContain(route(0))
    expect(popOuts.openRoutes()).toContain(route(8))
  })

  it('brings an open route forward instead of opening it twice', () => {
    const { popOuts, created } = setup()
    popOuts.open('/home')
    popOuts.open('/home')
    expect(created).toHaveLength(1)
    expect(created[0].focused).toBe(1)
  })

  it('refuses a route that is not a view, and a project that is not in Ostler', () => {
    const { popOuts, created } = setup()
    expect(() => popOuts.open('/settings')).toThrow()
    expect(() => popOuts.open('/projects/gone/board')).toThrow()
    expect(created).toHaveLength(0)
  })
})

describe('window state per route (N5.8a)', () => {
  it('remembers each route where it was left, and opens it there again', () => {
    const { popOuts, created, saved } = setup()
    popOuts.open('/projects/p1/board')
    created[0].bounds = { x: 300, y: 200, width: 900, height: 650 }
    created[0].close()
    popOuts.open('/home')
    expect(created[1].place.bounds).toEqual(POP_OUT_DEFAULT_SIZE)
    popOuts.open('/projects/p1/board')
    expect(created[2].place.bounds).toEqual({ x: 300, y: 200, width: 900, height: 650 })
    expect(saved().map((entry) => entry.route)).toEqual(['/home', '/projects/p1/board'])
  })

  it('opens at its default place when its display was removed', () => {
    const left: PopOutWindowState = {
      route: '/home',
      bounds: { x: 2500, y: 100, width: 900, height: 700 },
      maximized: true,
      reopenAtStart: false,
      openAtQuit: false
    }
    expect(popOutPlace(left, SCREEN)).toEqual({ bounds: POP_OUT_DEFAULT_SIZE, maximized: false })
    // On a second display that is still there, it keeps its place.
    expect(popOutPlace(left, [...SCREEN, { x: 1920, y: 0, width: 1920, height: 1040 }])).toEqual({
      bounds: { x: 2500, y: 100, width: 900, height: 700 },
      maximized: true
    })
    // Never smaller than a pop-out's minimum.
    expect(
      popOutPlace({ ...left, bounds: { x: 10, y: 10, width: 120, height: 90 } }, SCREEN).bounds
    ).toMatchObject({ width: 480, height: 360 })
  })
})

describe('reopen at start (N5.8a)', () => {
  it('reopens at start what was open at quit with Reopen at start ticked', () => {
    const first = setup()
    first.popOuts.open('/home')
    first.popOuts.open('/projects/p1/board')
    first.popOuts.open('/projects/p2/list')
    first.popOuts.setReopenAtStart('/home', true)
    first.popOuts.setReopenAtStart('/projects/p1/board', true)
    first.popOuts.setReopenAtStart('/projects/p2/list', true)
    // Closed before quitting: not open at quit, so it does not come back.
    first.created[2].close()
    first.popOuts.beforeQuit()
    // Quitting closes the rest, which changes nothing.
    first.created[0].close()
    first.created[1].close()
    const atQuit = first.saved()
    expect(atQuit.find((entry) => entry.route === '/home')?.openAtQuit).toBe(true)
    expect(atQuit.find((entry) => entry.route === '/projects/p2/list')?.openAtQuit).toBe(false)

    const next = setup(atQuit, ['p1'])
    next.popOuts.restore()
    expect(next.created.map((win) => win.route)).toEqual(['/home', '/projects/p1/board'])
  })

  it('does not reopen a pop-out without Reopen at start, or one whose project went', () => {
    const first = setup()
    first.popOuts.open('/home')
    first.popOuts.open('/projects/p2/board')
    first.popOuts.setReopenAtStart('/projects/p2/board', true)
    first.popOuts.beforeQuit()
    const next = setup(first.saved(), ['p1'])
    next.popOuts.restore()
    expect(next.created).toHaveLength(0)
  })

  it('shows its Reopen at start', () => {
    const { popOuts } = setup()
    popOuts.open('/home')
    expect(popOuts.reopenAtStart('/home')).toBe(false)
    popOuts.setReopenAtStart('/home', true)
    expect(popOuts.reopenAtStart('/home')).toBe(true)
  })
})

describe('config migration 37 (N5.8a)', () => {
  const dir = useTempDir('ostler-pop-outs-')
  afterEach(() => {})

  it('remembers no pop-out windows yet, and keeps valid ones it finds', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 37)
    expect(migration?.name).toBe('pop-out-windows')
    const config: Record<string, unknown> = {}
    migration?.up(config, { newInstall: false })
    expect(config.popOuts).toEqual({ windows: [] })

    const fresh = new ConfigStore(path.join(dir(), 'fresh.json'))
    expect(fresh.get().popOuts).toEqual({ windows: [] })
    fs.writeFileSync(path.join(dir(), 'old.json'), JSON.stringify({ configVersion: 36 }))
    const old = new ConfigStore(path.join(dir(), 'old.json'))
    expect(old.get().popOuts).toEqual({ windows: [] })
    const entry: PopOutWindowState = {
      route: '/home',
      bounds: { x: 1, y: 2, width: 800, height: 600 },
      maximized: false,
      reopenAtStart: true,
      openAtQuit: true
    }
    expect(old.update({ popOuts: { windows: [entry] } }).popOuts.windows).toEqual([entry])
  })

  it('drops what is not a pop-out, keeps one entry per route and caps the list', () => {
    const windows = [
      { route: '/settings', bounds: null },
      { route: '/home', bounds: { x: 'a' } },
      { route: '/home', reopenAtStart: true },
      ...Array.from({ length: MAX_REMEMBERED_POP_OUTS + 5 }, (_, index) => ({
        route: `/projects/p${index}/board`
      }))
    ]
    const normalized = normalizePopOutSettings({ windows })
    expect(normalized.windows).toHaveLength(MAX_REMEMBERED_POP_OUTS)
    expect(normalized.windows.some((entry) => entry.route === '/settings')).toBe(false)
    expect(normalizePopOutSettings({ windows: [windows[1]] }).windows[0]).toEqual({
      route: '/home',
      bounds: null,
      maximized: false,
      reopenAtStart: false,
      openAtQuit: false
    })
    expect(normalizePopOutSettings(null)).toEqual({ windows: [] })
  })

  it('never takes pop-out windows from a renderer settings update', () => {
    const update = fromRendererConfigUpdate({
      popOuts: { windows: [] },
      ui: { theme: 'dark' }
    } as never)
    expect(update).toEqual({ ui: { theme: 'dark' } })
  })
})
