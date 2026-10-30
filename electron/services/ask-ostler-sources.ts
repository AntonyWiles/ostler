import type { AskSourceType, SearchResult } from '@shared/ostler-api'
import { ASK_OSTLER_MAX_QUERIES } from '@shared/ostler-ai-prompts'
import { searchTerms } from './database/search-terms'
import type { FilePassage } from './ask-ostler-files'

/**
 * Ask Ostler's sources (N8.3a), as pure functions: the queries the first step
 * returns, the fallback when it gives none, merging what search and the file
 * search found into at most 20 numbered places, and the text of each source
 * as the answer's request carries it.
 */

/** The most sources one answer is given. */
export const ASK_MAX_SOURCES = 20
/** Of those, the most that may be file passages. */
export const ASK_MAX_FILE_SOURCES = 8
/** The most characters of one source, and of all of them, a request carries. */
export const ASK_SOURCE_CHARS = 2000
export const ASK_TOTAL_CHARS = 40_000
/** A query's longest length; anything longer is not a search query. */
const MAX_QUERY_CHARS = 80
/** The fallback's words: at least this long, at most this many. */
const FALLBACK_MIN_LENGTH = 4
const FALLBACK_MAX_WORDS = 8

/**
 * The record types Ask Ostler searches in each project: every project type
 * Ostler's search has. Contacts, which belong to no project, are searched once.
 */
export const ASK_RECORD_TYPES = [
  'task',
  'comment',
  'goal',
  'milestone',
  'decision',
  'library'
] as const

/** The queries in the first step's reply: a JSON array, or one per line. Never more than four. */
export function parseAskQueries(reply: string): string[] {
  let list: unknown[] = []
  const array = reply.match(/\[[\s\S]*\]/)
  if (array) {
    try {
      const parsed = JSON.parse(array[0]) as unknown
      if (Array.isArray(parsed)) list = parsed
    } catch {
      list = []
    }
  }
  if (list.length === 0)
    list = reply
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, ''))
  const queries: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const query = entry.trim()
    if (!query || query.length > MAX_QUERY_CHARS || searchTerms(query).length === 0) continue
    if (!queries.some((known) => known.toLowerCase() === query.toLowerCase())) queries.push(query)
    if (queries.length === ASK_OSTLER_MAX_QUERIES) break
  }
  return queries
}

/** The fallback: the question's longer words, each searched on its own. */
export function fallbackQueries(question: string): string[] {
  const words = question
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => [...word].length >= FALLBACK_MIN_LENGTH)
  return [...new Set(words)].slice(0, FALLBACK_MAX_WORDS)
}

/** A found thing, before it is numbered: a search result or a file passage. */
export type AskHit =
  | { kind: 'record'; key: string; score: number; record: SearchResult }
  | { kind: 'file'; key: string; score: number; passage: FilePassage }

export function recordHit(record: SearchResult): AskHit {
  return { kind: 'record', key: `${record.type}:${record.id}`, score: record.score, record }
}

export function fileHit(passage: FilePassage): AskHit {
  return {
    kind: 'file',
    key: `file:${passage.projectId}:${passage.path}`,
    score: passage.score,
    passage
  }
}

/**
 * The best `max` distinct hits, best score first: a record found by several
 * queries keeps its best score, and file passages take at most `maxFiles` of
 * the places.
 */
export function mergeHits(
  hits: AskHit[],
  { max = ASK_MAX_SOURCES, maxFiles = ASK_MAX_FILE_SOURCES } = {}
): AskHit[] {
  const best = new Map<string, AskHit>()
  for (const hit of hits) {
    const known = best.get(hit.key)
    if (!known || hit.score < known.score) best.set(hit.key, hit)
  }
  const kept: AskHit[] = []
  let files = 0
  for (const hit of [...best.values()].sort((a, b) => a.score - b.score)) {
    if (kept.length >= max) break
    if (hit.kind === 'file') {
      if (files >= maxFiles) continue
      files += 1
    }
    kept.push(hit)
  }
  return kept
}

/** One source's text as the answer's request carries it. */
export interface AskSourceText {
  type: AskSourceType
  projectName: string
  /** The heading line: what the source is. */
  heading: string
  /** Its listed fields, one per line. */
  body: string
}

/**
 * The sources as numbered, fenced blocks, each at most `perSource`
 * characters and all of them at most `total`. `cut` says whether anything
 * was shortened or left out; `count` how many were sent, always the first
 * ones, since the budget runs out at the end of the list.
 */
export function formatAskSources(
  sources: AskSourceText[],
  { perSource = ASK_SOURCE_CHARS, total = ASK_TOTAL_CHARS } = {}
): { text: string; cut: boolean; count: number } {
  let cut = false
  let used = 0
  const blocks: string[] = []
  sources.forEach((source, index) => {
    let body = source.body.trim()
    if (body.length > perSource) {
      body = `${body.slice(0, perSource)}…`
      cut = true
    }
    const room = total - used
    if (room <= 0) {
      cut = true
      return
    }
    if (body.length > room) {
      body = `${body.slice(0, Math.max(0, room))}…`
      cut = true
    }
    used += body.length
    blocks.push(
      [
        `<source number="${index + 1}" type="${source.type}" project=${JSON.stringify(source.projectName)}>`,
        source.heading,
        body,
        '</source>'
      ]
        .filter(Boolean)
        .join('\n')
    )
  })
  return { text: blocks.join('\n\n'), cut, count: blocks.length }
}
