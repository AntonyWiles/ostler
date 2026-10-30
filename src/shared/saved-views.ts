import type { SavedViewConfig, SavedViewType } from './ostler-api/search-types'
import { SAVED_VIEW_TYPES } from './ostler-api/search-types'
import { EMPTY_TASK_FILTER, parseTaskFilter } from './task-filter'
import { t } from './i18n'

/**
 * Checks for saved views (P5.7), the same for the desktop app and the
 * automation API: the main process runs every write through these.
 */

export const SAVED_VIEW_NAME_MAX = 80
/** The name the default view is stored under; the interface calls it "Default view". */
export const DEFAULT_VIEW_NAME = 'Default view'
const QUERY_MAX = 200
const OPTIONS_MAX_BYTES = 20_000

/** A saved view's kind, in the words of the views it opens (`navigation:views.<id>.label`). */
export const SAVED_VIEW_TYPE_LABELS: Record<SavedViewType, string> = {
  get board() {
    return t('navigation:views.board.label')
  },
  get list() {
    return t('navigation:views.list.label')
  },
  get calendar() {
    return t('navigation:views.calendar.label')
  },
  get timeline() {
    return t('navigation:views.timeline.label')
  }
}

export function parseSavedViewType(value: unknown): SavedViewType {
  if (!SAVED_VIEW_TYPES.includes(value as SavedViewType))
    throw new Error(`A view type must be one of: ${SAVED_VIEW_TYPES.join(', ')}`)
  return value as SavedViewType
}

export function parseSavedViewName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A saved view needs a name')
  const name = value.trim()
  if (name.length > SAVED_VIEW_NAME_MAX)
    throw new Error(`A saved view's name can be at most ${SAVED_VIEW_NAME_MAX} characters`)
  return name
}

/** A view's configuration from untrusted input. Throws a plain message. */
export function parseSavedViewConfig(raw: unknown): SavedViewConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('A view configuration must be an object: { filter, query, options }')
  const input = raw as { filter?: unknown; query?: unknown; options?: unknown }
  const filter = input.filter === undefined ? EMPTY_TASK_FILTER : parseTaskFilter(input.filter)
  const query = input.query ?? ''
  if (typeof query !== 'string' || query.length > QUERY_MAX)
    throw new Error(`A view's search text must be text of at most ${QUERY_MAX} characters`)
  const options = input.options ?? {}
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error("A view's options must be an object")
  const json = JSON.stringify(options)
  if (json.length > OPTIONS_MAX_BYTES) throw new Error("A view's options are too large")
  return { filter, query, options: JSON.parse(json) as Record<string, unknown> }
}

export const EMPTY_VIEW_CONFIG: SavedViewConfig = {
  filter: EMPTY_TASK_FILTER,
  query: '',
  options: {}
}
