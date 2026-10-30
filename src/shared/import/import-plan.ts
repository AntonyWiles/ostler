import type {
  PlanningColumnSettings,
  PlanningFieldType,
  ImportPreviewRow,
  ImportPreviewTotals,
  PlanningFieldDefinition,
  PlanningPriority,
  PlanningWorkItemStatus
} from '../ostler-api'
import { PROJECT_COLORS } from '../project-colors'
import { statusFromColumnWord } from '../board-columns'

/**
 * What every importer (CSV, Trello) produces and the one writer
 * (`ImportService`) consumes: plain task drafts, already checked against the
 * limits `PlanningService` enforces, so a dry run and the real import agree.
 * Imported text is data. It is never evaluated and never read as
 * instructions to Ostler AI.
 */

/** A file the person picks may be at most this big. */
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024
/** Tasks in one import. */
export const MAX_IMPORT_ROWS = 20_000
/** Rows the preview shows. */
export const PREVIEW_ROWS = 50

/** The limits `PlanningService.createWorkItem` enforces. */
export const LIMITS = {
  title: 200,
  description: 8000,
  labels: 20,
  label: 80,
  checklist: 30,
  checklistItem: 500,
  estimate: 1000,
  name: 80,
  milestone: 160
} as const

export interface ImportChecklistItem {
  text: string
  checked: boolean
}

export interface ImportTaskDraft {
  /** Where it came from: the file's line, or the card's place on the board. */
  line: number
  title: string
  description: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  labels: string[]
  checklist: ImportChecklistItem[]
  /** Matched to a person by name (any case), or created. */
  assigneeName: string | null
  startDate: string | null
  dueDate: string | null
  /** Hidden until this date (N1.1a). */
  showFrom?: string | null
  /** In Someday (N1.1a). */
  someday?: boolean
  /** An idea's scores (N1.1b), 1 to 5. */
  impact?: number | null
  effort?: number | null
  estimate: number | null
  /** Matched to a milestone by name (any case), or created. */
  milestoneName: string | null
  /** Matched to one of the project's iterations by name, any case (R6.1); never created. */
  iterationName?: string | null
  /** Matched to one of the project's task types by name, any case, or created (N2.7a). */
  typeName?: string | null
  /**
   * Custom field values as written (R2.2), by `ImportFieldRef`: read against
   * the field when the import writes, so a new field's options exist first.
   */
  fieldTexts?: Record<string, string>
  /** The draft (by `line`) this one is a subtask of (R4.2); it comes earlier in the plan. */
  parentLine?: number
  /** The drafts (by `line`) this one waits on (R4.2); they come earlier in the plan. */
  waitsOnLines?: number[]
  /** The GitHub issue the task links (R4.4), with its title and state as just fetched. */
  githubIssue?: ImportGithubIssue
}

/** An imported issue, linked to its task when the import writes. */
export interface ImportGithubIssue {
  owner: string
  repo: string
  number: number
  title: string
  state: 'open' | 'closed'
}

/** A custom field a plan fills: an existing one (`id`) or one it creates (`new:<name>`). */
export type ImportFieldRef = string

export interface ImportNewField {
  ref: ImportFieldRef
  name: string
  type: PlanningFieldType
  /** For Choice and Choices: the option names, in the order first seen. */
  options: string[]
}

export interface ImportPlan {
  tasks: ImportTaskDraft[]
  /** Colours for the labels the tasks use (Trello's, mapped to the palette). */
  labelColors: { name: string; color: string }[]
  /** People to match or create even when no task is theirs (Trello members). */
  people: string[]
  /** Rows not imported because of an error. */
  skipped: number
  /** Custom fields to create before the tasks (R2.2). */
  newFields?: ImportNewField[]
}

/** What a preview knows about the project it imports into. */
export interface ImportKnownRecords {
  milestones: string[]
  people: string[]
  /** The project's iteration names (R6.1); absent when there is no project yet. */
  iterations?: string[]
  /** The project's task type names (N2.7a); absent when there is no project yet. */
  types?: string[]
  /** The project's custom fields (R2.2). */
  fields?: PlanningFieldDefinition[]
  /** The project's column names (R2.4): a value naming one maps to its status. */
  columns?: PlanningColumnSettings
}

/**
 * Removes control characters (keeping tab and new lines) and normalises line
 * endings, so nothing invisible or terminal-like lands in a task.
 */
export function cleanImportedText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2066-\u2069]/g,
    ''
  )
}

/** Cuts text to `max` characters; the returned flag says whether it did. */
export function clip(value: string, max: number): [string, boolean] {
  return value.length > max ? [value.slice(0, max), true] : [value, false]
}

const STATUS_WORDS: [PlanningWorkItemStatus, string[]][] = [
  [
    'done',
    ['done', 'closed', 'complete', 'completed', 'resolved', 'finished', 'shipped', 'released']
  ],
  ['review', ['review', 'in review', 'code review', 'qa', 'testing', 'in testing', 'verify']],
  ['blocked', ['blocked', 'on hold', 'waiting', 'stuck', 'impeded']],
  [
    'active',
    ['in progress', 'doing', 'active', 'started', 'in development', 'wip', 'working on it']
  ],
  ['ready', ['ready', 'selected for development', 'up next', 'next', 'planned', 'to do next']],
  ['backlog', ['backlog', 'to do', 'todo', 'open', 'new', 'ideas', 'later', 'not started']]
]

const PRIORITY_WORDS: [PlanningPriority, string[]][] = [
  ['critical', ['critical', 'highest', 'blocker', 'urgent', 'p0', 'showstopper']],
  ['high', ['high', 'major', 'important', 'p1']],
  ['medium', ['medium', 'normal', 'moderate', 'p2']],
  ['low', ['low', 'lowest', 'minor', 'trivial', 'p3', 'p4']]
]

function words(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A status for a value as other tools write it ("In Progress", "Closed"); backlog when unsure. */
export function guessStatus(value: string): PlanningWorkItemStatus {
  const text = words(value)
  if (!text) return 'backlog'
  for (const [status, names] of STATUS_WORDS) if (names.includes(text)) return status
  for (const [status, names] of STATUS_WORDS)
    if (names.some((name) => name.length > 3 && text.includes(name))) return status
  return 'backlog'
}

/** The project's own column names first (R2.4), then `guessStatus`. */
export function guessProjectStatus(
  value: string,
  columns?: Pick<PlanningColumnSettings, 'names'> | null
): PlanningWorkItemStatus {
  return (columns ? statusFromColumnWord(value, columns) : null) ?? guessStatus(value)
}

/** A priority for a value as other tools write it ("Highest", "Minor"); medium when unsure. */
export function guessPriority(value: string): PlanningPriority {
  const text = words(value)
  if (!text) return 'medium'
  for (const [priority, names] of PRIORITY_WORDS) if (names.includes(text)) return priority
  for (const [priority, names] of PRIORITY_WORDS)
    if (names.some((name) => name.length > 2 && text.includes(name))) return priority
  return 'medium'
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** The palette colour (the tokens' label colours) nearest to `hex`. */
export function nearestPaletteColor(hex: string): string {
  const [r, g, b] = rgb(hex)
  let best = PROJECT_COLORS[0]
  let bestDistance = Infinity
  for (const candidate of PROJECT_COLORS) {
    const [cr, cg, cb] = rgb(candidate)
    // Weighted for how the eye sees: green counts most, blue least.
    const distance = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** Totals for a preview, from every row's problems. */
export function previewTotals(
  rows: ImportPreviewRow[],
  plan: ImportPlan,
  known: ImportKnownRecords
): ImportPreviewTotals {
  const has = (list: string[]) => {
    const lower = new Set(list.map((name) => name.toLowerCase()))
    return (name: string) => lower.has(name.toLowerCase())
  }
  const knownMilestone = has(known.milestones)
  const knownPerson = has(known.people)
  const unique = (names: (string | null)[], isKnown: (name: string) => boolean) => {
    const seen = new Map<string, string>()
    for (const name of names) {
      if (name && !isKnown(name) && !seen.has(name.toLowerCase()))
        seen.set(name.toLowerCase(), name)
    }
    return [...seen.values()]
  }
  return {
    rowCount: rows.length,
    importableCount: plan.tasks.length,
    errorRowCount: rows.filter((row) => row.errors.length > 0).length,
    warningRowCount: rows.filter((row) => row.warnings.length > 0).length,
    errorCount: rows.reduce((sum, row) => sum + row.errors.length, 0),
    warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
    newMilestones: unique(
      plan.tasks.map((task) => task.milestoneName),
      knownMilestone
    ),
    newPeople: unique(
      [...plan.tasks.map((task) => task.assigneeName), ...plan.people],
      knownPerson
    ),
    newTypes: unique(
      plan.tasks.map((task) => task.typeName ?? null),
      has(known.types ?? [])
    )
  }
}
