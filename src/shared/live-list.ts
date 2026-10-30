import type { PlanningWorkItemStatus } from './ostler-api/planning-types'
import {
  parseTaskFilter,
  type FilterableTask,
  type TaskFilter,
  type TaskFilterContext
} from './task-filter'
import { matchingTasks } from './task-view-filter'
import { t } from './i18n'

/**
 * Live lists in notes (N4.4c, N34): a fenced code block whose info string is
 * `ostler-tasks`, naming a saved view or a filter. The file stays plain text;
 * Ostler shows the matching tasks. The block is untrusted text (imports,
 * agents), so this is the one strict reader of it, and its contents reach
 * nothing but `parseTaskFilter` and a saved view's id lookup.
 *
 * ```ostler-tasks
 * # Tasks where status is In progress
 * filter: {"conditions":[{"field":"status","op":"is","value":["active"]}]}
 * title: Open design work
 * limit: 20
 * ```
 */

export const LIVE_LIST_INFO = 'ostler-tasks'
export const LIVE_LIST_DEFAULT_LIMIT = 20
export const LIVE_LIST_MAX_LIMIT = 100
export const LIVE_LIST_TITLE_MAX = 200
/** Longer than any block a person writes; a longer one is refused unread. */
export const LIVE_LIST_MAX_CHARS = 10_000
/** The blocks one text may ask about at once. */
export const LIVE_LIST_MAX_BLOCKS = 50

const VIEW_ID = /^[A-Za-z0-9_-]{1,100}$/
const KEYS = ['view', 'filter', 'title', 'limit'] as const
type LiveListKey = (typeof KEYS)[number]

export type LiveListSource =
  { kind: 'view'; viewId: string } | { kind: 'filter'; filter: TaskFilter }

export interface LiveListSpec {
  source: LiveListSource
  /** The person's own heading; null for none. */
  title: string | null
  limit: number
}

export type LiveListParse = { ok: true; spec: LiveListSpec } | { ok: false; problem: string }

/** A block's text (between the fences), read strictly. Problems are plain words. */
export function parseLiveListBlock(text: string): LiveListParse {
  if (typeof text !== 'string')
    return { ok: false, problem: t('library:liveList.problems.notText') }
  if (text.length > LIVE_LIST_MAX_CHARS)
    return { ok: false, problem: t('library:liveList.problems.tooLong') }
  const values = new Map<LiveListKey, string>()
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (line === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    const key = colon > 0 ? line.slice(0, colon).trim() : ''
    if (!(KEYS as readonly string[]).includes(key))
      return {
        ok: false,
        problem: t('library:liveList.problems.unknownLine', {
          line: index + 1,
          keys: KEYS.join(', ')
        })
      }
    if (values.has(key as LiveListKey))
      return { ok: false, problem: t('library:liveList.problems.twice', { key }) }
    values.set(key as LiveListKey, line.slice(colon + 1).trim())
  }
  const view = values.get('view')
  const filterText = values.get('filter')
  if (view !== undefined && filterText !== undefined)
    return { ok: false, problem: t('library:liveList.problems.both') }
  let source: LiveListSource
  if (view !== undefined) {
    if (!VIEW_ID.test(view)) return { ok: false, problem: t('library:liveList.problems.badView') }
    source = { kind: 'view', viewId: view }
  } else if (filterText !== undefined) {
    let raw: unknown
    try {
      raw = JSON.parse(filterText)
    } catch {
      return { ok: false, problem: t('library:liveList.problems.badJson') }
    }
    try {
      source = { kind: 'filter', filter: parseTaskFilter(raw) }
    } catch (error) {
      return { ok: false, problem: error instanceof Error ? error.message : String(error) }
    }
  } else {
    return { ok: false, problem: t('library:liveList.problems.neither') }
  }
  const titleText = values.get('title')
  let title: string | null = null
  if (titleText !== undefined) {
    if (!titleText || titleText.length > LIVE_LIST_TITLE_MAX)
      return {
        ok: false,
        problem: t('library:liveList.problems.badTitle', { max: LIVE_LIST_TITLE_MAX })
      }
    title = titleText
  }
  const limitText = values.get('limit')
  let limit = LIVE_LIST_DEFAULT_LIMIT
  if (limitText !== undefined) {
    const number = /^\d{1,3}$/.test(limitText) ? Number(limitText) : NaN
    if (!(number >= 1 && number <= LIVE_LIST_MAX_LIMIT))
      return {
        ok: false,
        problem: t('library:liveList.problems.badLimit', { max: LIVE_LIST_MAX_LIMIT })
      }
    limit = number
  }
  return { ok: true, spec: { source, title, limit } }
}

/** A block's text, as Ostler writes it: the words line first, then the keys. */
export function formatLiveListBlock(spec: LiveListSpec, words: string | null): string {
  const lines: string[] = []
  if (words) lines.push(`# ${oneLine(words)}`)
  lines.push(
    spec.source.kind === 'view'
      ? `view: ${spec.source.viewId}`
      : `filter: ${JSON.stringify(spec.source.filter)}`
  )
  if (spec.title) lines.push(`title: ${oneLine(spec.title)}`)
  if (spec.limit !== LIVE_LIST_DEFAULT_LIMIT) lines.push(`limit: ${spec.limit}`)
  return lines.join('\n')
}

/** The whole fenced block, ready to insert into a note. */
export function fenceLiveListBlock(body: string): string {
  return `\`\`\`${LIVE_LIST_INFO}\n${body}\n\`\`\``
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface LiveListBlockAt {
  /** The text between the fences. */
  body: string
  /** Where the body starts and ends in the whole text (end exclusive). */
  bodyStart: number
  bodyEnd: number
}

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n`]*$/

/**
 * The `ostler-tasks` blocks in a Markdown text, in order, as CommonMark reads
 * fences: an opening fence of three or more backticks or tildes, closed by a
 * fence of the same character at least as long (or the end of the text).
 */
export function findLiveListBlocks(text: string): LiveListBlockAt[] {
  const found: LiveListBlockAt[] = []
  const lines = text.split('\n')
  let offset = 0
  let open: { fence: string; info: string; bodyStart: number } | null = null
  for (const line of lines) {
    const bare = line.replace(/\r$/, '')
    const lineEnd = offset + line.length
    if (!open) {
      const match = OPEN_FENCE.exec(bare)
      if (match) open = { fence: match[1], info: match[2], bodyStart: lineEnd + 1 }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(bare)
      if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
        if (open.info === LIVE_LIST_INFO) {
          const bodyEnd = Math.max(open.bodyStart, offset - 1)
          found.push({
            body: text.slice(open.bodyStart, bodyEnd).replace(/\r$/, ''),
            bodyStart: open.bodyStart,
            bodyEnd
          })
        }
        open = null
      }
    }
    offset = lineEnd + 1
  }
  if (open && open.info === LIVE_LIST_INFO && open.bodyStart <= text.length)
    found.push({
      body: text.slice(open.bodyStart).replace(/\r?\n$/, ''),
      bodyStart: open.bodyStart,
      bodyEnd: text.length
    })
  return found
}

/**
 * The text with each block's words line written again (N4.4c): the `#`
 * lines are replaced by one describing the block now. A block that does not
 * read, or that `describe` has no words for, is left exactly as it was.
 */
export function rewriteLiveListWords(
  text: string,
  describe: (spec: LiveListSpec) => string | null
): string {
  const blocks = findLiveListBlocks(text)
  if (blocks.length === 0) return text
  let result = ''
  let at = 0
  for (const block of blocks) {
    const parsed = parseLiveListBlock(block.body)
    if (!parsed.ok) continue
    const words = describe(parsed.spec)
    if (!words) continue
    const eol = block.body.includes('\r\n') ? '\r\n' : '\n'
    const kept = block.body.split(/\r?\n/).filter((line) => !line.trim().startsWith('#'))
    const body = [`# ${oneLine(words)}`, ...kept].join(eol)
    result += text.slice(at, block.bodyStart) + body
    at = block.bodyEnd
  }
  return result + text.slice(at)
}

/**
 * The tasks a live list shows: its filter and its search text, through
 * `matchingTasks`, the List's own code, so the note and the List agree.
 * Hide done, sort and columns are a view's own and not used.
 */
export function liveListMatches<T extends FilterableTask>(
  items: readonly T[],
  filter: TaskFilter,
  query: string,
  context: TaskFilterContext
): T[] {
  return matchingTasks(items, filter, query, context)
}

/** One task as a live list shows it. */
export interface LiveListTask {
  id: string
  title: string
  status: PlanningWorkItemStatus
  /** The project's own column it is in (MOP-26), for its name. */
  columnId?: string | null
  assigneeName: string | null
  targetDate: string | null
}

/** A block as Ostler shows it, or why it cannot. */
export type LiveListResult =
  | {
      ok: true
      title: string | null
      /** The block in words: "Tasks where status is In progress". */
      words: string
      /** The saved view's name, for a view block. */
      viewName: string | null
      filter: TaskFilter
      query: string
      total: number
      /** Matching tasks by status, in Board order, statuses with none left out. */
      counts: { status: PlanningWorkItemStatus; label: string; count: number }[]
      /** The first `limit` matching tasks. */
      tasks: LiveListTask[]
    }
  | { ok: false; reason: 'invalid' | 'missingView'; problem: string }
