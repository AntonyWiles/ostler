import { drawOrder } from './geometry'
import { sameWhiteboardObject, type WhiteboardObjectInput, type WhiteboardSaveInput } from './model'

/**
 * The whiteboard editor's own undo history (plan `docs/plans/whiteboards/`,
 * prompt 02a, decision D12): each step is the whole board as a map from id to
 * object. Steps share the objects that did not change, so a step costs one
 * map, not a copy of the board. Pure and immutable: nothing here mutates a
 * map or an object it is given, because every past state stays live for undo.
 */

export type ObjectMap = ReadonlyMap<string, WhiteboardObjectInput>
export interface WhiteboardHistory {
  past: readonly ObjectMap[]
  present: ObjectMap
  future: readonly ObjectMap[]
}
/** D12: the editor keeps 200 undo steps for the session. */
export const WHITEBOARD_HISTORY_LIMIT = 200

/** `present` holds the objects by id; nothing to undo or redo. */
export function startWhiteboardHistory(
  objects: readonly WhiteboardObjectInput[]
): WhiteboardHistory {
  return { past: [], present: new Map(objects.map((object) => [object.id, object])), future: [] }
}

/** The present with the change applied, or null when nothing really changes. */
function applyChange(
  present: ObjectMap,
  changed: readonly WhiteboardObjectInput[],
  deleted: readonly string[]
): ObjectMap | null {
  const differs =
    changed.some((object) => {
      const before = present.get(object.id)
      return before === undefined || !sameWhiteboardObject(before, object)
    }) || deleted.some((id) => present.has(id))
  if (!differs) return null
  const next = new Map(present)
  for (const object of changed) next.set(object.id, object)
  for (const id of deleted) next.delete(id)
  return next
}

/**
 * A new step: `changed` set, `deleted` removed, the old present pushed onto
 * `past` (the oldest dropped beyond the limit) and `future` cleared. Returns
 * `history` itself when nothing really changed.
 */
export function commitObjects(
  history: WhiteboardHistory,
  changed: readonly WhiteboardObjectInput[],
  deleted: readonly string[] = []
): WhiteboardHistory {
  const next = applyChange(history.present, changed, deleted)
  if (next === null) return history
  return {
    past: [...history.past, history.present].slice(-WHITEBOARD_HISTORY_LIMIT),
    present: next,
    future: []
  }
}

/** The same change folded into the current step (a run of typing is one undo). */
export function amendObjects(
  history: WhiteboardHistory,
  changed: readonly WhiteboardObjectInput[],
  deleted: readonly string[] = []
): WhiteboardHistory {
  const next = applyChange(history.present, changed, deleted)
  if (next === null) return history
  return { past: history.past, present: next, future: history.future }
}

export function canUndo(history: WhiteboardHistory): boolean {
  return history.past.length > 0
}

export function canRedo(history: WhiteboardHistory): boolean {
  return history.future.length > 0
}

/** One step back; unchanged when there is nothing to undo. */
export function undoWhiteboard(history: WhiteboardHistory): WhiteboardHistory {
  if (!canUndo(history)) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future]
  }
}

/** One step forward; unchanged when there is nothing to redo. */
export function redoWhiteboard(history: WhiteboardHistory): WhiteboardHistory {
  if (!canRedo(history)) return history
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1)
  }
}

/**
 * What the editor sends to save: the objects in `after` that are new or
 * differ from `before`, and the ids in `before` missing from `after`, sorted.
 */
export function diffObjectMaps(before: ObjectMap, after: ObjectMap): WhiteboardSaveInput {
  const upserts: WhiteboardObjectInput[] = []
  for (const object of after.values()) {
    const old = before.get(object.id)
    if (old === undefined || !sameWhiteboardObject(old, object)) upserts.push(object)
  }
  const deletes = [...before.keys()].filter((id) => !after.has(id)).sort()
  return { upserts, deletes }
}

/** The objects in draw order. */
export function objectList(map: ObjectMap): WhiteboardObjectInput[] {
  return drawOrder([...map.values()])
}
