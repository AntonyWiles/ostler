import {
  draftFromWords,
  LINE_TASKS_MAX,
  noteLineParts,
  noteLines,
  type LineTaskDraft
} from '../note-line-tasks'
import type { QuickAddContext } from '../quick-add'
import type { WhiteboardObjectInput, WhiteboardObjectKind } from './model'
import { readingOrder } from './outline'

/**
 * Make tasks from a whiteboard (plan `docs/plans/whiteboards/`, prompt 13,
 * D17): each selected note, shape with words or mind-map node becomes one
 * task, read by the same rule as Make a task from a line (`draftFromWords`):
 * the first line with words is read with quick add, the rest become the
 * description. Pure, so the dialog, the main process and the tests read one
 * rule.
 */

/** The most tasks one Make tasks makes: the same limit as Make a task from a line. */
export const WHITEBOARD_TASKS_MAX = LINE_TASKS_MAX

/** The kinds that can make a task. */
const TASKABLE_KINDS: ReadonlySet<WhiteboardObjectKind> = new Set(['note', 'shape', 'mindmap'])

/** Why an object makes no task, or null when it makes one. */
export type WhiteboardTaskSkip = 'kind' | 'noText' | 'linked'

type TaskSource = Pick<WhiteboardObjectInput, 'kind' | 'text' | 'link'>

/** The first line with words (a list marker alone has none), or -1. */
function firstWordsLine(lines: readonly string[]): number {
  return lines.findIndex((line) => noteLineParts(line).words.trim() !== '')
}

/** Why `object` cannot make a task, or null when it can. */
export function whiteboardTaskSkip(object: TaskSource): WhiteboardTaskSkip | null {
  if (!TASKABLE_KINDS.has(object.kind)) return 'kind'
  if (object.link !== null) return 'linked'
  if (firstWordsLine(noteLines(object.text)) < 0) return 'noText'
  return null
}

/** True for a note, shape or mind-map node with words and no link. */
export function isTaskableObject(object: TaskSource): boolean {
  return whiteboardTaskSkip(object) === null
}

export type WhiteboardTaskDraft = Omit<LineTaskDraft, 'line'> & {
  /** The object that makes this task, and then links to it. */
  objectId: string
}

/**
 * The tasks `objects` make, in reading order: one per taskable object, at
 * most `WHITEBOARD_TASKS_MAX`. The first line with words is read as Make a
 * task from a line reads a line; the lines after it, trimmed and without
 * blank ones, are the description.
 */
export function whiteboardTaskDrafts(
  objects: readonly WhiteboardObjectInput[],
  context: QuickAddContext
): WhiteboardTaskDraft[] {
  return readingOrder(objects.filter(isTaskableObject))
    .slice(0, WHITEBOARD_TASKS_MAX)
    .map((object) => {
      const lines = noteLines(object.text)
      const first = firstWordsLine(lines)
      const description = lines
        .slice(first + 1)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
      return {
        ...draftFromWords(noteLineParts(lines[first]).words, description, context),
        objectId: object.id
      }
    })
}

export interface MakeWhiteboardTasksInput {
  whiteboardId: string
  /** The milestone every task goes in, or null for none. */
  milestoneId: string | null
  tasks: WhiteboardTaskDraft[]
}

export interface MakeWhiteboardTasksResult {
  /** Which object made which task, in the order of the drafts. */
  made: { objectId: string; taskId: string }[]
}

export interface UndoWhiteboardTasksInput {
  whiteboardId: string
  taskIds: string[]
}
