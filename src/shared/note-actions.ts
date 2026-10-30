import { LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS } from './ostler-api/library-types'
import type { TasksFromTextDraft, TextTaskApproval, TextTaskSuggestion } from './tasks-from-text'

/**
 * Find actions and decisions (N4.1b): Ostler AI reads one Library note and
 * proposes tasks (as N4.1a does, through `readTextTaskSuggestions`) and
 * decisions; the person reviews both lists before anything is added. This
 * file holds the limits, the types and the reader of the proposed decisions.
 * The answer is data: every field is checked here.
 */

/**
 * The longest note sent: the most the Library sends a planning action at
 * once. A longer note is refused with a message, never cut.
 */
export const NOTE_ACTIONS_MAX_CHARS = LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
/** At most this many proposed decisions. */
export const NOTE_ACTIONS_MAX_DECISIONS = 8

const MAX_DECISION_TITLE = 200
const MAX_DECISION_TEXT = 4000

export interface NoteDecisionSuggestion {
  title: string
  decision: string
  context: string
}

/** A proposed task, marked when it looks like a task already sourced from the note. */
export interface NoteTaskSuggestion extends TextTaskSuggestion {
  /** The task already made from this note that this proposal looks like, or null. */
  alreadyTaskId: string | null
}

export interface NoteActionsDraft extends Omit<TasksFromTextDraft, 'suggestions'> {
  itemId: string
  noteTitle: string
  /** The note's revision the proposals were read from. */
  revision: number
  suggestions: NoteTaskSuggestion[]
  decisions: NoteDecisionSuggestion[]
}

export interface NoteActionsRequest {
  itemId: string
  /** Today where the person is, `YYYY-MM-DD`. */
  today: string
  /** The first day of the person's week: 0 Sunday … 6 Saturday. */
  weekStart: number
}

export interface AddNoteActionsInput {
  draftId: string
  itemId: string
  tasks: TextTaskApproval[]
  decisions: NoteDecisionSuggestion[]
}

export interface AddNoteActionsResult {
  taskIds: string[]
  decisionIds: string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * The proposed decisions, checked field by field: one without a title or a
 * decision, or with a title too long, is refused; long text is cut to fit.
 */
export function readNoteDecisions(parsed: Record<string, unknown>): {
  decisions: NoteDecisionSuggestion[]
  dropped: number
} {
  const raw = Array.isArray(parsed.decisions) ? parsed.decisions : []
  const decisions: NoteDecisionSuggestion[] = []
  let dropped = 0
  for (const entry of raw) {
    const value = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    const title = value ? text(value.title) : ''
    const decision =
      value && typeof value.decision === 'string'
        ? value.decision.trim().slice(0, MAX_DECISION_TEXT)
        : ''
    if (
      !title ||
      !decision ||
      title.length > MAX_DECISION_TITLE ||
      decisions.length >= NOTE_ACTIONS_MAX_DECISIONS
    ) {
      dropped += 1
      continue
    }
    const context =
      value && typeof value.context === 'string'
        ? value.context.trim().slice(0, MAX_DECISION_TEXT)
        : ''
    decisions.push({ title, decision, context })
  }
  return { decisions, dropped }
}

/** A title reduced to its words, for comparing: case, punctuation and spacing ignored. */
function words(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Marks proposals that look like tasks already sourced from the note (the
 * same words, or one title's words inside the other's), so a second pass
 * adds only what is new.
 */
export function markAlreadyTasks(
  suggestions: TextTaskSuggestion[],
  existing: Array<{ id: string; title: string }>
): NoteTaskSuggestion[] {
  const known = existing
    .map((task) => ({ id: task.id, words: words(task.title) }))
    .filter((task) => task.words)
  return suggestions.map((suggestion) => {
    const wanted = words(suggestion.title)
    const match = wanted
      ? known.find(
          (task) =>
            task.words === wanted ||
            ` ${task.words} `.includes(` ${wanted} `) ||
            ` ${wanted} `.includes(` ${task.words} `)
        )
      : undefined
    return { ...suggestion, alreadyTaskId: match?.id ?? null }
  })
}
