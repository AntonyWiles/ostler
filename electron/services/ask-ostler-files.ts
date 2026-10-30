import * as fs from 'fs'
import * as path from 'path'
import { searchTerms } from './database/search-terms'
import { isWithinRoot } from '../paths'
import { listProjectFiles, readProjectFile, type ProjectFolderRef } from './project-files'

/**
 * Ask Ostler's file search (N8.3a): the same queries as the records, run
 * locally over the text files in one project's linked folder. Files come from
 * `listProjectFiles` (so `.gitignore` holds) and are read with
 * `readProjectFile` (text only, inside the folder only). Read-only, and main
 * process only.
 */

/** A file larger than this is skipped unread. */
export const ASK_FILE_MAX_BYTES = 1024 * 1024
/** At most this many files are looked at in one project. */
export const ASK_FILE_MAX_FILES = 5000
/** And for at most this long. */
export const ASK_FILE_MAX_MS = 3000
/** Lines kept around each matching line. */
export const ASK_PASSAGE_CONTEXT_LINES = 5
/** Files read between pauses, so the main process stays responsive. */
const FILES_PER_PAUSE = 50

export interface FilePassage {
  projectId: string
  path: string
  /** 1-based, inclusive. */
  startLine: number
  endLine: number
  text: string
  /** Lower is better, on the records' scale. */
  score: number
}

export interface FolderSearchResult {
  passages: FilePassage[]
  /** The file or time limit stopped the search before every file was looked at. */
  cutShort: boolean
}

export interface FolderSearchLimits {
  maxFiles?: number
  maxMs?: number
  maxBytes?: number
  /** The clock, for tests. */
  now?: () => number
}

const pause = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Every passage in the folder that a query finds: a file matches a query
 * when it holds every one of its words (the rule search uses), and its best
 * matching line, with five lines either side, is the passage. One passage
 * per file, the best over all the queries.
 */
export async function searchFolderFiles(
  projectId: string,
  folder: ProjectFolderRef,
  queries: string[],
  limits: FolderSearchLimits = {}
): Promise<FolderSearchResult> {
  const maxFiles = limits.maxFiles ?? ASK_FILE_MAX_FILES
  const maxMs = limits.maxMs ?? ASK_FILE_MAX_MS
  const maxBytes = limits.maxBytes ?? ASK_FILE_MAX_BYTES
  const now = limits.now ?? Date.now
  const termSets = queries
    .map((query) => searchTerms(query).map((term) => term.toLowerCase()))
    .filter((terms) => terms.length > 0)
  if (termSets.length === 0) return { passages: [], cutShort: false }

  const started = now()
  let listing: string[]
  try {
    listing = await listProjectFiles(folder.root, folder.ignorePatterns)
  } catch {
    return { passages: [], cutShort: false }
  }
  const passages: FilePassage[] = []
  let cutShort = false
  for (let index = 0; index < listing.length; index += 1) {
    if (index >= maxFiles || now() - started >= maxMs) {
      cutShort = true
      break
    }
    if (index > 0 && index % FILES_PER_PAUSE === 0) await pause()
    const relative = listing[index]
    const content = readSmallTextFile(folder.root, relative, maxBytes)
    if (content === null) continue
    const passage = bestPassage(content, termSets)
    if (passage) passages.push({ projectId, path: relative, ...passage })
  }
  return { passages, cutShort }
}

/** A file's text, or null when it is over `maxBytes`, binary, unreadable or outside the folder. */
function readSmallTextFile(root: string, relative: string, maxBytes: number): string | null {
  try {
    const target = path.resolve(root, relative)
    if (!isWithinRoot(target, root)) return null
    // A link that leads out of the folder is never followed.
    if (!isWithinRoot(fs.realpathSync(target), fs.realpathSync(root))) return null
    if (fs.statSync(target).size > maxBytes) return null
    return readProjectFile(root, relative)?.content ?? null
  } catch {
    return null
  }
}

/**
 * The best passage `content` holds for any of the queries, or null when no
 * query has every word in the file. Scored like search's LIKE fallback: one
 * point for each of a query's words in the passage, so a passage that holds
 * a whole query ranks with a record whose body does.
 */
export function bestPassage(
  content: string,
  termSets: string[][]
): Omit<FilePassage, 'projectId' | 'path'> | null {
  const lower = content.toLowerCase()
  const lines = content.split(/\r?\n/)
  const lowerLines = lines.map((line) => line.toLowerCase())
  let best: Omit<FilePassage, 'projectId' | 'path'> | null = null
  for (const terms of termSets) {
    if (!terms.every((term) => lower.includes(term))) continue
    // The line that holds the most of this query's words, first one on a tie.
    let bestLine = -1
    let bestCount = 0
    for (let index = 0; index < lowerLines.length; index += 1) {
      const count = terms.filter((term) => lowerLines[index].includes(term)).length
      if (count > bestCount) {
        bestCount = count
        bestLine = index
        if (count === terms.length) break
      }
    }
    if (bestLine === -1) continue
    const start = Math.max(0, bestLine - ASK_PASSAGE_CONTEXT_LINES)
    const end = Math.min(lines.length - 1, bestLine + ASK_PASSAGE_CONTEXT_LINES)
    const window = lowerLines.slice(start, end + 1).join('\n')
    const inWindow = terms.filter((term) => window.includes(term)).length
    const score = -inWindow
    if (!best || score < best.score) {
      best = {
        startLine: start + 1,
        endLine: end + 1,
        text: lines.slice(start, end + 1).join('\n'),
        score
      }
    }
  }
  return best
}
