import { describe, expect, it } from 'vitest'
import {
  isPassableDraft,
  newTaskWindowHash,
  NEW_TASK_DRAFT_MAX_CHARS,
  parseNewTaskHash
} from '../../src/shared/new-task-window'
import { NewTaskWindows } from '../../electron/app/new-task-windows'

class FakeWindow {
  webContents = {}
  destroyed = false
  closedListeners: (() => void)[] = []
  on(_event: 'closed', listener: () => void) {
    this.closedListeners.push(listener)
  }
  isDestroyed() {
    return this.destroyed
  }
  close() {
    this.destroyed = true
    for (const listener of this.closedListeners) listener()
  }
}

function setup() {
  const made: FakeWindow[] = []
  const returned: string[] = []
  let focused = 0
  const windows = new NewTaskWindows<FakeWindow>({
    create: () => {
      const win = new FakeWindow()
      made.push(win)
      return win
    },
    focus: () => {
      focused += 1
    },
    projectExists: (id) => id === 'p1',
    returned: (id) => returned.push(id)
  })
  return { windows, made, returned, focused: () => focused }
}

describe('New task window hash', () => {
  it('round-trips a project and refuses anything else', () => {
    expect(parseNewTaskHash(newTaskWindowHash('p1'))).toEqual({ projectId: 'p1' })
    expect(parseNewTaskHash('/new-task/a/b')).toBeNull()
    expect(parseNewTaskHash('/new-task/')).toBeNull()
    expect(parseNewTaskHash('/sticky/p1/t1')).toBeNull()
  })

  it('passes plain objects of bounded size only', () => {
    expect(isPassableDraft({ title: 'x' })).toBe(true)
    expect(isPassableDraft(null)).toBe(false)
    expect(isPassableDraft([])).toBe(false)
    expect(isPassableDraft({ title: 'x'.repeat(NEW_TASK_DRAFT_MAX_CHARS) })).toBe(false)
  })
})

describe('NewTaskWindows', () => {
  it('opens one window per project and hands the draft over once', () => {
    const { windows, made, focused } = setup()
    expect(windows.open('p1', { title: 'Draft' })).toBe(true)
    // The second draft is not taken: the window already open comes forward instead.
    expect(windows.open('p1', { title: 'Other' })).toBe(false)
    expect(made).toHaveLength(1)
    expect(focused()).toBe(1)
    expect(windows.takeOutgoing(made[0].webContents)).toEqual({ title: 'Draft' })
    expect(windows.takeOutgoing(made[0].webContents)).toBeNull()
  })

  it('refuses unknown projects, bad ids and strangers', () => {
    const { windows } = setup()
    expect(() => windows.open('nope', {})).toThrow()
    expect(() => windows.open('../x', {})).toThrow()
    expect(() => windows.takeOutgoing({})).toThrow()
    expect(() => windows.giveBack({}, {})).toThrow()
  })

  it('gives a draft back to the main window once and closes', () => {
    const { windows, made, returned } = setup()
    windows.open('p1', { title: 'Draft' })
    windows.giveBack(made[0].webContents, { title: 'Edited' })
    expect(made[0].destroyed).toBe(true)
    expect(returned).toEqual(['p1'])
    expect(windows.takeReturned('p1')).toEqual({ title: 'Edited' })
    expect(windows.takeReturned('p1')).toBeNull()
  })

  it('forgets a window closed without going back', () => {
    const { windows, made } = setup()
    windows.open('p1', { title: 'Draft' })
    made[0].close()
    expect(windows.takeReturned('p1')).toBeNull()
    windows.open('p1', { title: 'Again' })
    expect(made).toHaveLength(2)
  })
})
