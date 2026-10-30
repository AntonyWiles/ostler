import { isIsoDate } from './dates'
import { initialsFromName } from './people'
import { findPerson, type QuickAddPerson } from './quick-add'

/**
 * Tasks from text or a photo (N4.1a): the person pastes, dictates or
 * photographs a list, Ostler AI suggests tasks, and the person reviews them in
 * `AiTaskReview` before any is added. This file holds the limits and the one
 * reader of the model's answer, shared by main and the renderer. The answer is
 * data: every field is checked here, and anything that fails is dropped or
 * left empty rather than trusted.
 */

/** The longest text the box sends. */
export const TEXT_TASKS_MAX_TEXT = 20_000
/** The largest photo the panel takes, before main scales it down. */
export const TEXT_TASKS_MAX_PHOTO_BYTES = 10 * 1024 * 1024
/** The photo types the panel takes; HEIC only when Windows can read it. */
export const TEXT_TASKS_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/heic', 'image/heif']
/** At most this many suggestions: the most one approval may add. */
export const TEXT_TASKS_MAX_SUGGESTIONS = 8

const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000
const MAX_PERSON = 80
const MAX_CHECKLIST_ITEM = 500
const MAX_CHECKLIST_ITEMS = 20

export interface TasksFromTextPhoto {
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export interface TasksFromTextRequest {
  text: string
  /** Sent only when the person added one, and only on Find tasks. */
  photo?: TasksFromTextPhoto | null
  /** Today where the person is, `YYYY-MM-DD`. */
  today: string
  /** The first day of the person's week: 0 Sunday … 6 Saturday. */
  weekStart: number
}

export interface TextTaskSuggestion {
  title: string
  description: string
  dueDate: string | null
  /** The name as the words gave it, or null. */
  personName: string | null
  /** The person it matched on this PC, or null. */
  assigneeId: string | null
  checklist: string[]
}

export interface TasksFromTextDraft {
  draftId: string
  projectId: string
  model: string
  generatedAt: number
  suggestions: TextTaskSuggestion[]
  /** Names that matched nobody on this PC: left empty on their tasks. */
  unmatchedNames: string[]
  /** Dates the model gave that are not real days: left empty. */
  badDates: number
  /** Suggestions refused (no title, a title too long) or past the limit. */
  dropped: number
}

/** One ticked suggestion, as the person edited it. */
export interface TextTaskApproval {
  title: string
  description: string
  dueDate: string | null
  assigneeId: string | null
  checklist: string[]
}

export interface AddTasksFromTextInput {
  draftId: string
  tasks: TextTaskApproval[]
  /** Kept in the project's Library and attached to each task when given. */
  keepPhoto?: TasksFromTextPhoto | null
}

/**
 * A name as written, matched to a person on this PC: the quick-add rule
 * (full name, first name, a unique start), then initials. Null when it is
 * nobody or more than one person.
 */
export function matchPersonName(
  name: string,
  people: Array<QuickAddPerson & { initials?: string }>
): QuickAddPerson | null {
  const found = findPerson(name, people)
  if (found) return found
  const wanted = name.replace(/[^\p{L}]/gu, '').toUpperCase()
  if (wanted.length < 2 || wanted.length > 3) return null
  const byInitials = people.filter(
    (person) =>
      (person.initials ?? '').toUpperCase() === wanted || initialsFromName(person.name) === wanted
  )
  return byInitials.length === 1 ? byInitials[0] : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * The model's answer, checked field by field. A suggestion without a title,
 * or with one too long, is refused; a date that is not a real day, a name too
 * long, and checklist items too long are dropped; names are matched locally.
 */
export function readTextTaskSuggestions(
  parsed: Record<string, unknown>,
  people: Array<QuickAddPerson & { initials?: string }>
): Pick<TasksFromTextDraft, 'suggestions' | 'unmatchedNames' | 'badDates' | 'dropped'> {
  const raw = Array.isArray(parsed.tasks) ? parsed.tasks : []
  const suggestions: TextTaskSuggestion[] = []
  const unmatched = new Set<string>()
  let badDates = 0
  let dropped = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      dropped += 1
      continue
    }
    const value = entry as Record<string, unknown>
    const title = text(value.title)
    if (!title || title.length > MAX_TITLE || suggestions.length >= TEXT_TASKS_MAX_SUGGESTIONS) {
      dropped += 1
      continue
    }
    const description =
      typeof value.description === 'string'
        ? value.description.trim().slice(0, MAX_DESCRIPTION)
        : ''
    let dueDate: string | null = null
    const date = text(value.dueDate)
    if (date) {
      if (isIsoDate(date)) dueDate = date
      else badDates += 1
    }
    const personText = text(value.person)
    const personName = personText && personText.length <= MAX_PERSON ? personText : null
    const person = personName ? matchPersonName(personName, people) : null
    if (personName && !person) unmatched.add(personName)
    const checklist = (Array.isArray(value.checklist) ? value.checklist : [])
      .map(text)
      .filter((item) => item && item.length <= MAX_CHECKLIST_ITEM)
      .slice(0, MAX_CHECKLIST_ITEMS)
    suggestions.push({
      title,
      description,
      dueDate,
      personName,
      assigneeId: person?.id ?? null,
      checklist
    })
  }
  return { suggestions, unmatchedNames: [...unmatched], badDates, dropped }
}

/** Whether a photo the person picked may go into the panel. */
export function isAcceptedPhoto(photo: { mimeType: string; size: number }): boolean {
  return (
    TEXT_TASKS_PHOTO_TYPES.includes(photo.mimeType.toLowerCase()) &&
    photo.size > 0 &&
    photo.size <= TEXT_TASKS_MAX_PHOTO_BYTES
  )
}
