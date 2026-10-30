import { describe, expect, it, vi } from 'vitest'
import { TaskWindows, type TaskWindowLike } from '../../electron/app/task-windows'
import { parseTaskWindowHash, taskWindowHash } from '../../src/shared/task-window'

class FakeWindow implements TaskWindowLike {
  destroyed = false
  private closed: (() => void)[] = []
  on(_event: 'closed', listener: () => void) {
    this.closed.push(listener)
    return this
  }
  isDestroyed() {
    return this.destroyed
  }
  close() {
    this.destroyed = true
    this.closed.forEach((listener) => listener())
  }
}

function setup() {
  const made: FakeWindow[] = []
  const focus = vi.fn()
  const windows = new TaskWindows<FakeWindow>({
    create: () => {
      const win = new FakeWindow()
      made.push(win)
      return win
    },
    focus,
    projectExists: (projectId) => projectId === 'p1'
  })
  return { windows, made, focus }
}

describe('a task in a window of its own (MOP-12)', () => {
  it('reads back the hash it writes, and nothing else', () => {
    const hash = taskWindowHash({ projectId: 'p1', taskId: 't-1' })
    expect(hash).toBe('/task-window/p1/t-1')
    expect(parseTaskWindowHash(hash)).toEqual({ projectId: 'p1', taskId: 't-1' })
    expect(parseTaskWindowHash('/task-window/p1')).toBeNull()
    expect(parseTaskWindowHash('/task-window/p1/t1/extra')).toBeNull()
    expect(parseTaskWindowHash('/task-window/p 1/t1')).toBeNull()
    expect(parseTaskWindowHash('/new-task/p1')).toBeNull()
  })

  it('opens one window per task, and brings an open one forward instead of a second', () => {
    const { windows, made, focus } = setup()
    expect(windows.open('p1', 't1')).toBe(true)
    expect(windows.open('p1', 't1')).toBe(false)
    expect(made).toHaveLength(1)
    expect(focus).toHaveBeenCalledWith(made[0])
    expect(windows.open('p1', 't2')).toBe(true)
    made[0].close()
    expect(windows.open('p1', 't1')).toBe(true)
    expect(made).toHaveLength(3)
  })

  it('refuses ids it does not accept and projects Ostler does not have', () => {
    const { windows } = setup()
    expect(() => windows.open('p1', '../t1')).toThrow()
    expect(() => windows.open(42, 't1')).toThrow()
    expect(() => windows.open('p2', 't1')).toThrow(/not in Ostler/)
  })
})
