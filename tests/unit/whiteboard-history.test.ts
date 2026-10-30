import { describe, expect, it } from 'vitest'
import {
  WHITEBOARD_HISTORY_LIMIT,
  amendObjects,
  canRedo,
  canUndo,
  commitObjects,
  diffObjectMaps,
  objectList,
  redoWhiteboard,
  startWhiteboardHistory,
  undoWhiteboard,
  type WhiteboardHistory
} from '../../src/shared/whiteboard/history'
import { defaultObject, type WhiteboardObjectInput } from '../../src/shared/whiteboard/model'

/** The whiteboard editor's undo history (docs/plans/whiteboards/, prompt 02a, D12). */

function note(id: string, x = 0, z = 1): WhiteboardObjectInput {
  return defaultObject('note', { id, x, y: 0, z })
}

describe('whiteboard history', () => {
  it('starts with the objects and nothing to undo or redo', () => {
    const history = startWhiteboardHistory([note('a'), note('b')])
    expect([...history.present.keys()]).toEqual(['a', 'b'])
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(false)
    expect(undoWhiteboard(history)).toBe(history)
    expect(redoWhiteboard(history)).toBe(history)
  })

  it('commits, undoes and redoes', () => {
    const start = startWhiteboardHistory([note('a')])
    const moved = commitObjects(start, [note('a', 50)])
    expect(moved.present.get('a')?.x).toBe(50)
    expect(canUndo(moved)).toBe(true)

    const undone = undoWhiteboard(moved)
    expect(undone.present).toBe(start.present)
    expect(canRedo(undone)).toBe(true)

    const redone = redoWhiteboard(undone)
    expect(redone.present).toBe(moved.present)
    expect(canRedo(redone)).toBe(false)
  })

  it('returns the same history for a commit that changes nothing', () => {
    const history = startWhiteboardHistory([note('a')])
    expect(commitObjects(history, [note('a')], ['missing'])).toBe(history)
    expect(amendObjects(history, [note('a')])).toBe(history)
  })

  it('clears future on a commit after an undo', () => {
    const one = commitObjects(startWhiteboardHistory([]), [note('a')])
    const undone = undoWhiteboard(one)
    expect(canRedo(undone)).toBe(true)
    const branched = commitObjects(undone, [note('b')])
    expect(canRedo(branched)).toBe(false)
    expect(branched.past).toHaveLength(1)
  })

  it('drops the oldest step on the 201st commit', () => {
    let history = startWhiteboardHistory([note('a')])
    const initial = history.present
    for (let step = 1; step <= WHITEBOARD_HISTORY_LIMIT + 1; step += 1) {
      history = commitObjects(history, [note('a', step)])
    }
    expect(history.past).toHaveLength(WHITEBOARD_HISTORY_LIMIT)
    expect(history.past).not.toContain(initial)
    expect(history.past[0].get('a')?.x).toBe(1)
  })

  it('amendObjects folds into the current step without touching past', () => {
    const typed = commitObjects(startWhiteboardHistory([note('a')]), [{ ...note('a'), text: 'H' }])
    const amended = amendObjects(typed, [{ ...note('a'), text: 'Hi' }])
    expect(amended.past).toBe(typed.past)
    expect(amended.future).toBe(typed.future)
    expect(amended.present.get('a')?.text).toBe('Hi')
    expect(undoWhiteboard(amended).present.get('a')?.text).toBe('')
  })

  it('deletes objects', () => {
    const history = commitObjects(startWhiteboardHistory([note('a'), note('b')]), [], ['a'])
    expect([...history.present.keys()]).toEqual(['b'])
  })

  it('does not mutate its inputs', () => {
    const objects = [note('a'), note('b')].map((object) => Object.freeze(object))
    const start = startWhiteboardHistory(Object.freeze(objects))
    const frozen: WhiteboardHistory = Object.freeze({
      past: Object.freeze([...start.past]),
      present: start.present,
      future: Object.freeze([...start.future])
    })
    const presentBefore = [...frozen.present.entries()]
    const changed = Object.freeze([Object.freeze(note('a', 99)), Object.freeze(note('c'))])
    const deleted = Object.freeze(['b'])

    const committed = commitObjects(frozen, changed, deleted)
    const amended = amendObjects(frozen, changed, deleted)
    const undone = undoWhiteboard(committed)
    redoWhiteboard(Object.freeze(undone))
    diffObjectMaps(frozen.present, committed.present)

    expect([...frozen.present.entries()]).toEqual(presentBefore)
    expect(frozen.past).toHaveLength(0)
    expect(objects[0].x).toBe(0)
    expect([...committed.present.keys()].sort()).toEqual(['a', 'c'])
    expect(amended.present).not.toBe(frozen.present)
    expect(undone.present).toBe(frozen.present)
  })
})

describe('diffObjectMaps and objectList', () => {
  it('finds new, changed and deleted objects and ignores unchanged ones', () => {
    const before = new Map([
      ['same', note('same')],
      ['moved', note('moved')],
      ['gone', note('gone')],
      ['also-gone', note('also-gone')]
    ])
    const after = new Map([
      ['same', note('same')],
      ['moved', note('moved', 40)],
      ['new', note('new')]
    ])
    const diff = diffObjectMaps(before, after)
    expect(diff.upserts.map((object) => object.id)).toEqual(['moved', 'new'])
    expect(diff.deletes).toEqual(['also-gone', 'gone'])
  })

  it('lists objects in draw order', () => {
    const map = new Map([
      ['b', note('b', 0, 2)],
      ['f', defaultObject('frame', { id: 'f', x: 0, y: 0, z: 5 })],
      ['a', note('a', 0, 1)]
    ])
    expect(objectList(map).map((object) => object.id)).toEqual(['f', 'a', 'b'])
  })
})
