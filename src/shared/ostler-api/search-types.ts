import type { TaskFilter } from '../task-filter'
import type { PlanningResolution } from './planning-types'
import type { LibraryTextLocation } from './library-types'

// ─── Search and saved views (P5.7) ──────────────────────────────────────────

/**
 * What search finds: the planning records in `search_index`, Library items,
 * and contacts (N6.5), which belong to no project and are found only when no
 * project is chosen.
 */
export type SearchEntityType =
  'task' | 'goal' | 'milestone' | 'decision' | 'comment' | 'library' | 'contact'

export const SEARCH_ENTITY_TYPES: readonly SearchEntityType[] = [
  'task',
  'comment',
  'decision',
  'library',
  'milestone',
  'goal',
  'contact'
]

/** A piece of a snippet; `match` pieces are the words the query found. */
export interface SearchSnippetPart {
  text: string
  match: boolean
}

export interface SearchResult {
  type: SearchEntityType
  id: string
  /** '' for a contact (N6.5): contacts are shared by every project. */
  projectId: string
  /** The record's title; for a comment, its task's title. */
  title: string
  /** An excerpt around the match, best part first. Empty when only the title matched. */
  snippet: SearchSnippetPart[]
  /** The task a task or comment belongs to, so it opens in the task's drawer. */
  workItemId: string | null
  /** For a task: its ID, SHOP-12 (N9.8a), when it has a number. */
  key?: string
  /** For a task closed as won't do (N1.2, found with `includeArchived`): its mark. */
  resolution?: PlanningResolution
  /** For a task in a sub-project (shown as a workstream): its ID, so a result names it. */
  subprojectId?: string
  /** For a task waiting in To triage (N4.3a): found, and marked; it opens in To triage. */
  inTriage?: true
  /** A Library file's page, slide or sheet holding the passage (N4.5). */
  location?: LibraryTextLocation
  /** Lower is better (bm25), comparable across types. */
  score: number
}

export interface SearchOptions {
  /** One project; all enabled projects when left out. */
  projectId?: string
  types?: SearchEntityType[]
  /** At most 200; 50 when left out. */
  limit?: number
  /** Archived and binned items too. */
  includeArchived?: boolean
}

/** The views a saved view can be of. */
export type SavedViewType = 'board' | 'list' | 'calendar' | 'timeline'

export const SAVED_VIEW_TYPES: readonly SavedViewType[] = ['board', 'list', 'calendar', 'timeline']

/**
 * A view's state: its filter, the search box, and its own options (sort,
 * grouping, columns, zoom, mode…), which each view reads through its own
 * normalizer.
 */
export interface SavedViewConfig {
  filter: TaskFilter
  query: string
  options: Record<string, unknown>
}

export interface SavedView {
  id: string
  /** Null for a cross-project view (none yet). */
  projectId: string | null
  name: string
  viewType: SavedViewType
  config: SavedViewConfig
  position: number
  /** The view the project's Board, List, Calendar or Timeline opens with. One per type. */
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateSavedViewInput {
  name: string
  viewType: SavedViewType
  config: SavedViewConfig
}

export type UpdateSavedViewInput = Partial<Pick<SavedView, 'name' | 'config' | 'position'>>
