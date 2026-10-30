import type { Rectangle } from 'electron'
import {
  isStickyTaskRef,
  MAX_STICKY_TASKS,
  stickyTaskKey,
  type StickyPinResult,
  type StickyTaskRef,
  type StickyTaskState
} from '@shared/sticky-task'
import { boundsOnScreen } from '../window-state'

/**
 * Sticky task on the desktop (N5.8b, N43): the pinned tasks' windows, at most
 * five, and what `config.stickyTasks` remembers of each (its task, size and
 * place). A pinned task stays pinned until the person unpins it or closes its
 * window, and every pinned task reopens at start, as a sticky note stays on a
 * monitor. Every window is made by `deps.create`, which goes through
 * `createOstlerWindow` like the main window.
 */

/** What this needs of a window: Electron's `BrowserWindow`, or a test's fake. */
export interface StickyWindowLike {
  on(event: 'close' | 'closed' | 'moved' | 'resized', listener: () => void): unknown
  getBounds(): Rectangle
  isDestroyed(): boolean
  close(): void
  readonly webContents: unknown
}

export interface StickyTaskWindowsDependencies<W extends StickyWindowLike> {
  /** Opens a window on `ref` at `bounds` (through `createStickyTaskWindow`). */
  create(ref: StickyTaskRef, bounds: Partial<Rectangle> & { width: number; height: number }): W
  /** Shows an open sticky window again, without taking the focus. */
  reveal(win: W): void
  /** `config.stickyTasks.windows` as it is now. */
  read(): StickyTaskState[]
  write(windows: StickyTaskState[]): void
  /** The work areas of the displays connected now. */
  workAreas(): Rectangle[]
  /** Whether a project is registered: a task is pinned only from one that is. */
  projectExists(projectId: string): boolean
}

/** About 320 by 240: a sticky note, not a window to work in. */
export const STICKY_DEFAULT_SIZE = { width: 320, height: 240 }
export const STICKY_MIN_SIZE = { width: 240, height: 160 }

/**
 * Where a sticky window opens: where it was left, on the display it was on,
 * unless that display is gone, when it opens at the default size, centred on
 * the main display.
 */
export function stickyPlace(
  saved: StickyTaskState | undefined,
  workAreas: readonly Rectangle[]
): Partial<Rectangle> & { width: number; height: number } {
  const bounds = saved?.bounds
  if (bounds && boundsOnScreen(bounds, workAreas)) {
    return {
      ...bounds,
      width: Math.max(STICKY_MIN_SIZE.width, bounds.width),
      height: Math.max(STICKY_MIN_SIZE.height, bounds.height)
    }
  }
  return { ...STICKY_DEFAULT_SIZE }
}

export class StickyTaskWindows<W extends StickyWindowLike> {
  /** Open sticky windows by task key, oldest first. */
  private readonly windows = new Map<string, W>()
  private quitting = false

  constructor(private readonly deps: StickyTaskWindowsDependencies<W>) {}

  /** The pinned tasks, oldest first. */
  pinned(): StickyTaskRef[] {
    return this.deps.read().map(({ projectId, taskId }) => ({ projectId, taskId }))
  }

  /** Whether `ref` is pinned now. */
  isPinned(ref: StickyTaskRef): boolean {
    const key = stickyTaskKey(ref)
    return this.deps.read().some((entry) => stickyTaskKey(entry) === key)
  }

  /** The task a window shows, or null when it is not a sticky window. */
  taskOf(contents: unknown): StickyTaskRef | null {
    for (const win of this.windows.values()) {
      if (win.isDestroyed() || win.webContents !== contents) continue
      return this.refOf(win)
    }
    return null
  }

  /**
   * Pins a task to the desktop, or shows its window again when it is already
   * pinned. With five pinned it pins nothing and names the oldest, unless
   * `unpinOldest` says the person chose to unpin it.
   */
  pin(ref: StickyTaskRef, unpinOldest = false): StickyPinResult {
    if (!isStickyTaskRef(ref.projectId, ref.taskId)) throw new Error('Pin one task')
    if (!this.deps.projectExists(ref.projectId)) {
      throw new Error('That project is not in Ostler any more')
    }
    const key = stickyTaskKey(ref)
    const already = this.windows.get(key)
    if (already && !already.isDestroyed()) {
      this.deps.reveal(already)
      return { pinned: true }
    }
    const current = this.deps.read()
    if (current.length >= MAX_STICKY_TASKS) {
      const oldest = current[0]
      if (!unpinOldest) {
        return {
          pinned: false,
          full: true,
          oldest: { projectId: oldest.projectId, taskId: oldest.taskId }
        }
      }
      this.unpin(oldest)
    }
    this.deps.write([...this.deps.read(), { ...ref, bounds: null }])
    this.open({ ...ref, bounds: null })
    return { pinned: true }
  }

  /** Unpins a task: its window closes and it does not reopen at start. */
  unpin(ref: StickyTaskRef): void {
    const key = stickyTaskKey(ref)
    this.deps.write(this.deps.read().filter((entry) => stickyTaskKey(entry) !== key))
    const win = this.windows.get(key)
    this.windows.delete(key)
    if (win && !win.isDestroyed()) win.close()
  }

  /**
   * A project was removed: its pinned tasks are unpinned and their windows
   * close, rather than staying on the desktop to say the project is gone.
   */
  unpinRemovedProjects(): void {
    for (const entry of this.deps.read())
      if (!this.deps.projectExists(entry.projectId)) this.unpin(entry)
  }

  /** At start: reopens every pinned task, where it was left. */
  restore(): void {
    for (const entry of this.deps.read()) {
      if (this.windows.size >= MAX_STICKY_TASKS) break
      if (this.windows.has(stickyTaskKey(entry))) continue
      // A task or project gone since still opens: its window says so and offers Unpin.
      this.open(entry)
    }
  }

  /**
   * A real quit is starting: remember where every sticky window is before
   * they close with the app. Closing them then unpins nothing.
   */
  beforeQuit(): void {
    if (this.quitting) return
    this.quitting = true
    for (const win of this.windows.values()) this.rememberPlace(win)
  }

  private open(entry: StickyTaskState): void {
    const ref = { projectId: entry.projectId, taskId: entry.taskId }
    const key = stickyTaskKey(ref)
    const win = this.deps.create(ref, stickyPlace(entry, this.deps.workAreas()))
    this.windows.set(key, win)
    const remember = () => this.rememberPlace(win)
    win.on('moved', remember)
    win.on('resized', remember)
    win.on('close', remember)
    win.on('closed', () => {
      if (this.windows.get(key) === win) this.windows.delete(key)
      // Closed by the person (Alt+F4) rather than by quitting: unpinned.
      if (!this.quitting) {
        this.deps.write(this.deps.read().filter((candidate) => stickyTaskKey(candidate) !== key))
      }
    })
  }

  private refOf(win: W): StickyTaskRef | null {
    for (const [key, candidate] of this.windows) {
      if (candidate !== win) continue
      const [projectId, taskId] = key.split('/')
      return { projectId, taskId }
    }
    return null
  }

  private rememberPlace(win: W): void {
    if (win.isDestroyed()) return
    const ref = this.refOf(win)
    if (!ref) return
    const key = stickyTaskKey(ref)
    const { x, y, width, height } = win.getBounds()
    const current = this.deps.read()
    if (!current.some((entry) => stickyTaskKey(entry) === key)) return
    this.deps.write(
      current.map((entry) =>
        stickyTaskKey(entry) === key ? { ...entry, bounds: { x, y, width, height } } : entry
      )
    )
  }
}
