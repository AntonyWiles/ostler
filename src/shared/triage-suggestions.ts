import type { PlanningPriority, PlanningWorkItemStatus } from './ostler-api/planning-types'

/**
 * Triage suggestions (N4.3b, N33): Suggest on a task in To triage asks Ostler
 * AI for a priority, labels from the project's own and which of the tasks
 * Ostler's search found look like the same work. Nothing is saved by a
 * suggestion: the person uses it in the row's fields, then accepts.
 */

/** At most this many tasks found by search go with a request. */
export const TRIAGE_CANDIDATE_LIMIT = 10
/** At most this many labels are suggested. */
export const TRIAGE_SUGGESTED_LABELS_MAX = 3
/** A done or closed task counts as a candidate this long after it closed. */
export const TRIAGE_RECENTLY_CLOSED_MS = 30 * 24 * 60 * 60 * 1000
/** The waiting task's description is cut to this many characters. */
export const TRIAGE_DESCRIPTION_MAX_CHARS = 4000
/** A duplicate's reason is cut to this many characters. */
export const TRIAGE_REASON_MAX_CHARS = 200

/** A task Ostler's search found that may be the same work. */
export interface TriageCandidate {
  id: string
  title: string
  status: PlanningWorkItemStatus
}

/** Exactly what one request sends: nothing else reaches the model. */
export interface TriageSuggestionRequest {
  title: string
  description: string
  /** The project's label names. */
  labels: string[]
  /** Each candidate's reference in the prompt (`c1`…), title and status. */
  candidates: Array<{ ref: string; title: string; status: PlanningWorkItemStatus }>
}

/** A candidate the answer says looks like the same work. */
export interface TriageDuplicateSuggestion {
  workItemId: string
  title: string
  status: PlanningWorkItemStatus
  reason: string
}

/** One checked answer. */
export interface TriageSuggestion {
  workItemId: string
  priority: PlanningPriority | null
  /** The project's own label names, as the project spells them. */
  labels: string[]
  duplicates: TriageDuplicateSuggestion[]
  /** How many suggested labels and duplicates were unknown and dropped. */
  dropped: number
}

const PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']

/** The request for a waiting task: only its title and description, label names and candidates. */
export function triageSuggestionRequest(
  item: { title: string; description: string },
  labels: string[],
  candidates: TriageCandidate[]
): TriageSuggestionRequest {
  return {
    title: item.title,
    description: item.description.slice(0, TRIAGE_DESCRIPTION_MAX_CHARS),
    labels: [...labels],
    candidates: candidates.slice(0, TRIAGE_CANDIDATE_LIMIT).map((candidate, index) => ({
      ref: `c${index + 1}`,
      title: candidate.title,
      status: candidate.status
    }))
  }
}

/**
 * Reads the model's answer as data: a priority Ostler knows, at most three of
 * the project's labels, and candidates it was shown. Anything else is dropped.
 * Throws only when the answer is not a JSON object at all.
 */
export function readTriageSuggestion(
  answer: unknown,
  workItemId: string,
  labels: string[],
  candidates: TriageCandidate[]
): TriageSuggestion {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new Error('The answer is not an object')
  }
  const raw = answer as Record<string, unknown>
  let dropped = 0
  const priority =
    typeof raw.priority === 'string' &&
    PRIORITIES.includes(raw.priority.trim().toLowerCase() as PlanningPriority)
      ? (raw.priority.trim().toLowerCase() as PlanningPriority)
      : null

  const byName = new Map(labels.map((label) => [label.toLowerCase(), label]))
  const chosen: string[] = []
  for (const entry of Array.isArray(raw.labels) ? raw.labels : []) {
    const known = typeof entry === 'string' ? byName.get(entry.trim().toLowerCase()) : undefined
    if (!known) {
      dropped += 1
      continue
    }
    if (!chosen.includes(known) && chosen.length < TRIAGE_SUGGESTED_LABELS_MAX) chosen.push(known)
  }

  const shown = candidates.slice(0, TRIAGE_CANDIDATE_LIMIT)
  const duplicates: TriageDuplicateSuggestion[] = []
  for (const entry of Array.isArray(raw.duplicates) ? raw.duplicates : []) {
    const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const ref = typeof record.candidate === 'string' ? record.candidate.trim().toLowerCase() : ''
    const match = /^c(\d+)$/.exec(ref)
    const candidate = match ? shown[Number(match[1]) - 1] : undefined
    if (!candidate || candidate.id === workItemId) {
      dropped += 1
      continue
    }
    if (duplicates.some((duplicate) => duplicate.workItemId === candidate.id)) continue
    const reason =
      typeof record.reason === 'string' ? record.reason.replace(/\s+/g, ' ').trim() : ''
    duplicates.push({
      workItemId: candidate.id,
      title: candidate.title,
      status: candidate.status,
      reason: reason.slice(0, TRIAGE_REASON_MAX_CHARS)
    })
  }
  return { workItemId, priority, labels: chosen, duplicates, dropped }
}
