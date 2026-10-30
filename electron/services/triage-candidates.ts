import type { PlanningWorkItem, SearchOptions, SearchResult } from '@shared/ostler-api'
import {
  TRIAGE_CANDIDATE_LIMIT,
  TRIAGE_RECENTLY_CLOSED_MS,
  type TriageCandidate
} from '@shared/triage-suggestions'

/** What finding candidates needs from the planning service. */
export interface TriageCandidateSource {
  search: { search(query: string, options?: SearchOptions): SearchResult[] }
  getWorkItem(workItemId: string): PlanningWorkItem
}

/** At most this many of the task's words are searched for. */
const MAX_WORDS = 12
/** Matches read per word. */
const PER_WORD = 50

/** Words too common to say two tasks are alike. */
const COMMON = new Set(
  (
    'the and for are but not you all any can her was one our out has had his how its may new now ' +
    'see two way who did get got let put say she too use with that this from have they will your ' +
    'what when were them then than there their which would could should about into some more just ' +
    'also only over make like need needs want task tasks please'
  ).split(' ')
)

/** The task's distinctive words, title first: lower case, three letters or more, each once. */
export function candidateWords(title: string, description: string): string[] {
  const words: string[] = []
  for (const word of `${title}\n${description}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3 || COMMON.has(word) || words.includes(word)) continue
    words.push(word)
    if (words.length === MAX_WORDS) break
  }
  return words
}

/**
 * Likely duplicates for a task in triage (N4.3b), found on this PC through
 * Ostler's own search before any AI request: up to ten open or recently closed
 * tasks in the same project that share words with its title and description,
 * those sharing the most words first. Search matches every word of a query,
 * so each word is searched alone and the matches are counted.
 */
export function triageCandidates(
  source: TriageCandidateSource,
  item: PlanningWorkItem,
  now = Date.now()
): TriageCandidate[] {
  const tally = new Map<string, { words: number; score: number }>()
  for (const word of candidateWords(item.title, item.description)) {
    const results = source.search.search(word, {
      projectId: item.projectId,
      types: ['task'],
      includeArchived: true,
      limit: PER_WORD
    })
    for (const result of results) {
      if (result.type !== 'task' || result.id === item.id) continue
      const seen = tally.get(result.id)
      tally.set(result.id, {
        words: (seen?.words ?? 0) + 1,
        score: Math.min(seen?.score ?? Infinity, result.score)
      })
    }
  }
  const ranked = [...tally.entries()].sort(([, a], [, b]) => b.words - a.words || a.score - b.score)
  const candidates: TriageCandidate[] = []
  for (const [id] of ranked) {
    let found: PlanningWorkItem
    try {
      found = source.getWorkItem(id)
    } catch {
      continue
    }
    if (found.projectId !== item.projectId || found.deletedAt) continue
    const closedAt = found.archivedAt ?? (found.status === 'done' ? found.updatedAt : null)
    if (closedAt !== null && closedAt !== undefined && now - closedAt > TRIAGE_RECENTLY_CLOSED_MS) {
      continue
    }
    candidates.push({ id: found.id, title: found.title, status: found.status })
    if (candidates.length === TRIAGE_CANDIDATE_LIMIT) break
  }
  return candidates
}
