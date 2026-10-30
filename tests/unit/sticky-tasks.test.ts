import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_STICKY_TASKS,
  normalizeStickyTaskSettings,
  parseStickyTaskHash,
  stickyTaskHash,
  type StickyTaskRef,
  type StickyTaskState
} from '../../src/shared/sticky-task'
import {
  STICKY_DEFAULT_SIZE,
  StickyTaskWindows,
  stickyPlace
} from '../../electron/app/sticky-task-windows'
import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { fromRendererConfigUpdate } from '../../src/shared/renderer-config'
import { useTempDir } from '../helpers/temp-dir'

/** A window as StickyTaskWindows sees it: closing fires `close` then `closed`. */
class FakeWindow {
  listeners = new Map<string, (() => void)[]>()
  destroyed = false
  revealed = 0
  webContents = {}
  constructor(
    readonly ref: StickyTaskRef,
    readonly place: { x?: number; y?: number; width: number; height: number },
    public bounds = { x: 40, y: 50, width: 320, height: 240 }
  ) {}
  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
  getBounds() {
    return { ...this.bounds }
  }
  isDestroyed() {
    return this.destroyed
  }
  close() {
    if (this.destroyed) return
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }
}

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 }

function setup(saved: StickyTaskState[] = [], projects = ['p1', 'p2']) {
  let stored = saved
  const created: FakeWindow[] = []
  const stickies = new StickyTaskWindows<FakeWindow>({
    create: (ref, place) => {
      const win = new FakeWindow(ref, place)
      created.push(win)
      return win
    },
    reveal: (win) => {
      win.revealed += 1
    },
    read: () => stored,
    write: (windows) => {
      stored = normalizeStickyTaskSettings({ windows }).windows
    },
    workAreas: () => [SCREEN],
    projectExists: (projectId) => projects.includes(projectId)
  })
  return { stickies, created, stored: () => stored }
}

const ref = (taskId: string, projectId = 'p1'): StickyTaskRef => ({ projectId, taskId })

describe('the sticky route (N5.8b)', () => {
  it('opens on #/sticky/<project>/<task> and refuses anything else', () => {
    expect(stickyTaskHash(ref('t1'))).toBe('/sticky/p1/t1')
    expect(parseStickyTaskHash('/sticky/p1/t1')).toEqual(ref('t1'))
    expect(parseStickyTaskHash('/sticky/p1')).toBeNull()
    expect(parseStickyTaskHash('/sticky/p1/t1/x')).toBeNull()
    expect(parseStickyTaskHash('/sticky/../t1')).toBeNull()
    expect(parseStickyTaskHash('/pop-out/home')).toBeNull()
  })
})

describe('pinning and unpinning (N5.8b)', () => {
  it('pins a task in a window of the sticky size and remembers it', () => {
    const { stickies, created, stored } = setup()
    expect(stickies.pin(ref('t1'))).toEqual({ pinned: true })
    expect(created).toHaveLength(1)
    expect(created[0].place).toEqual(STICKY_DEFAULT_SIZE)
    expect(stored()).toEqual([{ projectId: 'p1', taskId: 't1', bounds: null }])
    expect(stickies.isPinned(ref('t1'))).toBe(true)
    expect(stickies.taskOf(created[0].webContents)).toEqual(ref('t1'))
    expect(stickies.taskOf({})).toBeNull()
  })

  it('pinning a pinned task shows its window again, without a second one', () => {
    const { stickies, created } = setup()
    stickies.pin(ref('t1'))
    stickies.pin(ref('t1'))
    expect(created).toHaveLength(1)
    expect(created[0].revealed).toBe(1)
  })

  it('refuses a project that is not in Ostler and ids that are not ids', () => {
    const { stickies } = setup()
    expect(() => stickies.pin(ref('t1', 'gone'))).toThrow(/not in Ostler/)
    expect(() => stickies.pin(ref('../t1'))).toThrow()
  })

  it('unpins: the window closes and the task is forgotten', () => {
    const { stickies, created, stored } = setup()
    stickies.pin(ref('t1'))
    stickies.unpin(ref('t1'))
    expect(created[0].destroyed).toBe(true)
    expect(stored()).toEqual([])
  })

  it('a window the person closes is unpinned too', () => {
    const { stickies, created, stored } = setup()
    stickies.pin(ref('t1'))
    created[0].close()
    expect(stored()).toEqual([])
  })

  it('removing a project unpins its tasks, and leaves the others pinned', () => {
    const projects = ['p1', 'p2']
    const { stickies, created, stored } = setup([], projects)
    stickies.pin(ref('t1', 'p1'))
    stickies.pin(ref('t2', 'p2'))
    projects.splice(projects.indexOf('p2'), 1)
    stickies.unpinRemovedProjects()
    expect(created[1].destroyed).toBe(true)
    expect(created[0].destroyed).toBe(false)
    expect(stored().map((entry) => entry.taskId)).toEqual(['t1'])
  })

  it('remembers where a window was moved', () => {
    const { stickies, created, stored } = setup()
    stickies.pin(ref('t1'))
    created[0].bounds = { x: 600, y: 300, width: 360, height: 260 }
    created[0].emit('moved')
    expect(stored()[0].bounds).toEqual({ x: 600, y: 300, width: 360, height: 260 })
  })
})

describe('the limit of five (N5.8b)', () => {
  it('the sixth names the oldest and pins nothing until the person says so', () => {
    const { stickies, created, stored } = setup()
    for (let index = 1; index <= MAX_STICKY_TASKS; index += 1) stickies.pin(ref(`t${index}`))
    expect(stickies.pin(ref('t6'))).toEqual({ pinned: false, full: true, oldest: ref('t1') })
    expect(created).toHaveLength(MAX_STICKY_TASKS)
    expect(stickies.pin(ref('t6'), true)).toEqual({ pinned: true })
    expect(created[0].destroyed).toBe(true)
    expect(stored().map((entry) => entry.taskId)).toEqual(['t2', 't3', 't4', 't5', 't6'])
  })

  it('config keeps at most five, one entry per task', () => {
    const windows = [
      { projectId: 'p1', taskId: 't1' },
      { projectId: 'p1', taskId: 't1' },
      { projectId: 'p1', taskId: '../x' },
      ...Array.from({ length: 8 }, (_, index) => ({ projectId: 'p2', taskId: `u${index}` }))
    ]
    const normalized = normalizeStickyTaskSettings({ windows })
    expect(normalized.windows).toHaveLength(MAX_STICKY_TASKS)
    expect(normalized.windows[0]).toEqual({ projectId: 'p1', taskId: 't1', bounds: null })
  })
})

describe('reopening at start (N5.8b)', () => {
  it('reopens every pinned task where it was, kept on a screen that still exists', () => {
    const { stickies, created } = setup([
      { ...ref('t1'), bounds: { x: 100, y: 100, width: 320, height: 240 } },
      // On a second display that is gone now.
      { ...ref('t2'), bounds: { x: 3000, y: 100, width: 320, height: 240 } }
    ])
    stickies.restore()
    expect(created.map((win) => win.ref.taskId)).toEqual(['t1', 't2'])
    expect(created[0].place).toEqual({ x: 100, y: 100, width: 320, height: 240 })
    expect(created[1].place).toEqual(STICKY_DEFAULT_SIZE)
  })

  it('a task whose project was removed still reopens, to say so and offer Unpin', () => {
    const { stickies, created } = setup([{ ...ref('t1', 'removed'), bounds: null }])
    stickies.restore()
    expect(created).toHaveLength(1)
  })

  it('quitting remembers places and unpins nothing', () => {
    const { stickies, created, stored } = setup()
    stickies.pin(ref('t1'))
    created[0].bounds = { x: 700, y: 20, width: 330, height: 250 }
    stickies.beforeQuit()
    created[0].close()
    expect(stored()).toEqual([
      { projectId: 'p1', taskId: 't1', bounds: { x: 700, y: 20, width: 330, height: 250 } }
    ])
  })

  it('a too-small saved size grows to the minimum', () => {
    expect(
      stickyPlace({ ...ref('t1'), bounds: { x: 10, y: 10, width: 200, height: 100 } }, [SCREEN])
    ).toMatchObject({ x: 10, y: 10, width: 240, height: 160 })
  })
})

describe('config migration 38 (N5.8b)', () => {
  const dir = useTempDir('ostler-sticky-')
  afterEach(() => {})

  it('pins no task yet, and keeps valid ones it finds', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 38)
    expect(migration?.name).toBe('sticky-tasks')
    const config: Record<string, unknown> = {}
    migration?.up(config, { newInstall: false })
    expect(config.stickyTasks).toEqual({ windows: [] })

    const fresh = new ConfigStore(path.join(dir(), 'fresh.json'))
    expect(fresh.get().stickyTasks).toEqual({ windows: [] })
    fs.writeFileSync(path.join(dir(), 'old.json'), JSON.stringify({ configVersion: 37 }))
    const old = new ConfigStore(path.join(dir(), 'old.json'))
    expect(old.get().stickyTasks).toEqual({ windows: [] })
    const entry: StickyTaskState = { ...ref('t1'), bounds: { x: 1, y: 2, width: 320, height: 240 } }
    expect(old.update({ stickyTasks: { windows: [entry] } }).stickyTasks.windows).toEqual([entry])
  })

  it('the renderer cannot change which tasks are pinned', () => {
    const update = fromRendererConfigUpdate({
      stickyTasks: { windows: [] }
    } as never) as Record<string, unknown>
    expect(update.stickyTasks).toBeUndefined()
  })
})
