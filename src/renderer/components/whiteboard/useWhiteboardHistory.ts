import { useEffect, useMemo, useRef, useState } from 'react'
import {
  amendObjects,
  canRedo,
  canUndo,
  commitObjects,
  objectList,
  redoWhiteboard,
  startWhiteboardHistory,
  undoWhiteboard,
  type ObjectMap,
  type WhiteboardHistory
} from '@shared/whiteboard/history'
import type { WhiteboardObjectInput } from '@shared/whiteboard/model'

export interface WhiteboardHistoryApi {
  present: ObjectMap
  /** The present in draw order. */
  list: WhiteboardObjectInput[]
  /** One undo step; with `amend`, folded into the current one. */
  commit(
    changed: readonly WhiteboardObjectInput[],
    deleted?: readonly string[],
    options?: { amend?: boolean }
  ): void
  undo(): void
  redo(): void
  /**
   * Takes back the current step as if it had never been made: nothing to
   * redo. For a step that turned out to change nothing worth keeping (a new
   * text left empty, prompt 06).
   */
  revert(): void
  canUndo: boolean
  canRedo: boolean
  /**
   * The present as the last commit, undo or redo left it, even before it renders. A new
   * object after every step, so holding one tells whether a step is still the latest.
   */
  now(): ObjectMap
}

interface Held {
  version: number
  history: WhiteboardHistory
}

/**
 * The whiteboard editor's undo and redo (plan `docs/plans/whiteboards/`,
 * prompt 05, D12): 200 steps, this session only, over `history.ts`. A new
 * `version` starts a fresh history from `objects` (a load, or a reload after
 * a change made elsewhere, D13). `onChange` hears every new present after a
 * commit, an undo or a redo, never after a reset; it is called at once, so a
 * second commit in the same event builds on the first.
 */
export function useWhiteboardHistory(
  objects: readonly WhiteboardObjectInput[],
  version: number,
  onChange?: (present: ObjectMap) => void
): WhiteboardHistoryApi {
  const [held, setHeld] = useState<Held>(() => ({
    version,
    history: startWhiteboardHistory(objects)
  }))
  let current = held
  if (held.version !== version) {
    // A new version replaces the board and clears undo, in this render.
    current = { version, history: startWhiteboardHistory(objects) }
    setHeld(current)
  }
  /** What event handlers build on: ahead of `held` between a commit and its render. */
  const latest = useRef(current)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    latest.current = current
    onChangeRef.current = onChange
  })
  if (latest.current.version !== current.version) latest.current = current

  const apply = (change: (history: WhiteboardHistory) => WhiteboardHistory) => {
    const before = latest.current
    const history = change(before.history)
    if (history === before.history) return
    const next = { version: before.version, history }
    latest.current = next
    setHeld(next)
    onChangeRef.current?.(history.present)
  }

  const { history } = current
  const list = useMemo(() => objectList(history.present), [history.present])
  return {
    present: history.present,
    list,
    commit: (changed, deleted = [], options) =>
      apply((value) => (options?.amend ? amendObjects : commitObjects)(value, changed, deleted)),
    undo: () => apply(undoWhiteboard),
    redo: () => apply(redoWhiteboard),
    revert: () =>
      apply((value) =>
        value.past.length === 0
          ? value
          : {
              past: value.past.slice(0, -1),
              present: value.past[value.past.length - 1],
              future: value.future
            }
      ),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    now: () => latest.current.history.present
  }
}
