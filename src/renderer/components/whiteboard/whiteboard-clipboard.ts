import type { WhiteboardObjectInput } from '@shared/whiteboard/model'

/**
 * The whiteboard editor's own record of the objects last copied or cut (plan
 * `docs/plans/whiteboards/`, prompt 06, D16), for this session only. The
 * system clipboard (or, off screen, Ostler's own clipboard in main) carries
 * only the objects' text; a paste whose text matches `text` here pastes these
 * objects. Nothing here reads or writes the system clipboard itself.
 */
export interface CopiedWhiteboardObjects {
  objects: readonly WhiteboardObjectInput[]
  /** The project the objects were copied in; null when the editor was given none. */
  projectId: string | null
  /** The text put on the clipboard with them. */
  text: string
  /** How many times they have been pasted: each paste lands a step further away. */
  pasted: number
}

let held: CopiedWhiteboardObjects | null = null

/** Keeps `objects` as the last copied, replacing what was there. */
export function rememberCopiedObjects(
  objects: readonly WhiteboardObjectInput[],
  projectId: string | null,
  text: string
): void {
  held = { objects: [...objects], projectId, text, pasted: 0 }
}

/** The objects last copied, or null. */
export function copiedWhiteboardObjects(): CopiedWhiteboardObjects | null {
  return held
}

/** Counts one paste of the held objects; returns how many there have been. */
export function countWhiteboardPaste(): number {
  if (!held) return 0
  held = { ...held, pasted: held.pasted + 1 }
  return held.pasted
}

/** Forgets the copied objects (tests). */
export function clearCopiedWhiteboardObjects(): void {
  held = null
}
