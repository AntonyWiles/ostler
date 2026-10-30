import { BRAND } from './brand'
import { extractItemLinks } from './item-links'
import type { LibraryItem, PlanningPriority } from './ostler-api'
import { captureAssigneeId, parseQuickAdd, quickAddMeId, type QuickAddContext } from './quick-add'

/**
 * Make a task from a line (N4.4b): selected lines of a Library note become
 * tasks, and each line that made a task becomes a Markdown link to it. Pure,
 * so the editor, the view mode's list-item button, the main process and the
 * tests all read one rule.
 *
 * Lines are counted from 0 in the note's text as split on line breaks.
 */

/** One task, or one per non-empty line. */
export type LineTaskMode = 'one' | 'each'

/** The most tasks one Make a task makes. */
export const LINE_TASKS_MAX = 50

export interface LineTaskDraft {
  title: string
  description: string
  labels: string[]
  assigneeId: string | null
  priority: PlanningPriority | null
  /** `YYYY-MM-DD`, or null. */
  dueDate: string | null
  /** The line that becomes the link to this task. */
  line: number
}

/** A line split into its indentation, list marker (with any check box) and words. */
export interface NoteLineParts {
  indent: string
  /** "- ", "* ", "1. ", "- [ ] ": kept in the note, dropped from the title. */
  marker: string
  words: string
}

const LINE_PATTERN = /^([\t ]*)((?:[-*+]|\d{1,9}[.)])[\t ]+(?:\[[ xX]\][\t ]+)?)?(.*)$/

export function noteLines(body: string): string[] {
  return body.split(/\r?\n/)
}

export function noteLineParts(line: string): NoteLineParts {
  const match = LINE_PATTERN.exec(line) ?? ['', '', '', line]
  return { indent: match[1] ?? '', marker: match[2] ?? '', words: (match[3] ?? '').trimEnd() }
}

/** The lines a selection touches, from its start and end offsets in `body`. */
export function selectedLineRange(
  body: string,
  start: number,
  end: number
): { from: number; to: number } {
  const lo = Math.max(0, Math.min(start, end))
  let hi = Math.max(0, Math.max(start, end))
  // A selection that ends just after a line break ends on the line before it.
  if (hi > lo && body[hi - 1] === '\n') hi -= 1
  const lineOf = (offset: number) => body.slice(0, offset).split('\n').length - 1
  return { from: lineOf(lo), to: lineOf(hi) }
}

/** True when the line can make a task: it has words and is not already a link to an item. */
export function isTaskableLine(line: string): boolean {
  const { words } = noteLineParts(line)
  return words.trim() !== '' && extractItemLinks(words, BRAND.urlScheme).length === 0
}

/**
 * One task from a line's words, read with quick add's grammar (`#label`,
 * `@person`, `!high`, dates; never a project), and assigned to Me when it
 * names nobody, as quick add does. The one reading of a line: Make a task
 * from a line and Make tasks on a whiteboard both use it.
 */
export function draftFromWords(
  words: string,
  description: string,
  context: QuickAddContext
): Omit<LineTaskDraft, 'line'> {
  const plain = words.trim()
  const parsed = parseQuickAdd(plain, { ...context, projects: [] })
  return {
    title: parsed.title || plain,
    description,
    labels: parsed.labels,
    // No @person: Me, as quick add does.
    assigneeId: captureAssigneeId(parsed.assigneeId, quickAddMeId(context.people)),
    priority: parsed.priority,
    dueDate: parsed.dueDate
  }
}

/**
 * The tasks lines `from`..`to` make. `each`: one per line that can make a
 * task, each read with quick add's grammar (`#label`, `@person`, `!high`,
 * dates), and assigned to Me when it names nobody, as quick add does.
 * `one`: the first such line is the title (read the same way), the rest of
 * the selected lines the description.
 */
export function lineTaskDrafts(
  body: string,
  from: number,
  to: number,
  mode: LineTaskMode,
  context: QuickAddContext
): LineTaskDraft[] {
  const lines = noteLines(body)
  const picked: number[] = []
  for (let index = Math.max(0, from); index <= Math.min(to, lines.length - 1); index++) {
    if (isTaskableLine(lines[index])) picked.push(index)
  }
  const draftOf = (line: number, description: string): LineTaskDraft => ({
    ...draftFromWords(noteLineParts(lines[line]).words, description, context),
    line
  })
  if (mode === 'each') return picked.map((line) => draftOf(line, ''))
  if (picked.length === 0) return []
  const first = picked[0]
  const description = lines
    .slice(first + 1, Math.min(to, lines.length - 1) + 1)
    .map((line) => {
      const parts = noteLineParts(line)
      return parts.words.trim()
    })
    .filter(Boolean)
    .join('\n')
  return [draftOf(first, description)]
}

function escapeLinkText(words: string): string {
  return words.replace(/[\\[\]]/g, (char) => `\\${char}`)
}

/**
 * The note with each named line turned into a link to its task, keeping the
 * line's indentation, list marker, check box and words:
 * `- [Call the venue](ostler://task/<p>/<t>)`. Line breaks stay as
 * they were.
 */
export function rewriteLinesAsLinks(body: string, links: { line: number; url: string }[]): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const lines = noteLines(body)
  for (const { line, url } of links) {
    if (line < 0 || line >= lines.length) continue
    const parts = noteLineParts(lines[line])
    lines[line] = `${parts.indent}${parts.marker}[${escapeLinkText(parts.words.trim())}](${url})`
  }
  return lines.join(eol)
}

export interface MakeLineTasksInput {
  itemId: string
  /** The note's revision the lines were selected in: refused if the note has moved on. */
  revision: number
  /** The text the lines were selected in (the editor's, with any unsaved edits). */
  body: string
  tasks: LineTaskDraft[]
}

export interface MakeLineTasksResult {
  taskIds: string[]
  /** The note as saved, at its new revision. */
  item: LibraryItem
}

export interface UndoLineTasksInput {
  itemId: string
  taskIds: string[]
  /** The revision Make a task saved; the undo is refused if the note has moved on. */
  revision: number
  /** The text to put back. */
  body: string
}
