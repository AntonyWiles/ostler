/**
 * The phone's search: the desktop's own `SearchService` over the phone's database, reading the
 * tables directly (its LIKE fallback), because the phone never writes the full-text index. It
 * finds tasks, comments, decisions, milestones and goals in the projects on the phone, scored and
 * excerpted as on the desktop. The Library and contacts stay on the PC: their files and address
 * book are not on the phone.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { SearchEntityType, SearchResult } from '@shared/ostler-api'
import { SearchService } from '../../../electron/services/search-service'
import { projects, type QueryDb } from './queries'

/** The kinds of record the phone can search. */
export const PHONE_SEARCH_TYPES: readonly SearchEntityType[] = [
  'task',
  'comment',
  'decision',
  'milestone',
  'goal'
]

/** At most this many results; the desktop's results page shows as many. */
const LIMIT = 50

/**
 * Every result for the words, best first, in every project on the phone (or one project). Closed
 * and archived work is left out, as on the desktop unless asked for.
 */
export function searchPhone(
  db: QueryDb,
  query: string,
  options: { projectId?: string } = {}
): SearchResult[] {
  // The service asks only for prepare().get/all, which the phone's adapter has.
  const raw = db as unknown as Database.Database
  const service = new SearchService(
    raw,
    () => projects(db).map((project) => project.id),
    () => null,
    false
  )
  return service.search(query, {
    types: [...PHONE_SEARCH_TYPES],
    limit: LIMIT,
    ...(options.projectId ? { projectId: options.projectId } : {})
  })
}
