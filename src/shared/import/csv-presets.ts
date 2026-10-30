import type {
  CsvDateFormat,
  CsvField,
  CsvPresetId,
  PlanningPriority,
  PlanningWorkItemStatus
} from '../ostler-api'
import { t } from '../i18n'

/**
 * Presets for the CSV exports of other tools (R4.2): how to recognise each
 * one from its header, which of its columns fill which task field, and what
 * its status and priority words mean. A preset is a starting point: the
 * mapping step shows everything it chose, and the person can change any of
 * it or map the columns by hand.
 *
 * Every header and value word here is one the tool's own export writes, in
 * English, confirmed from its documentation or a real export. Words in other
 * languages are left to the manual mapping.
 */

export interface CsvPresetTable {
  headers: string[]
  rows: string[][]
  /** Each row's line in the file (the header is line 1). */
  lines: number[]
  /** Columns `prepare` added, and the fields they fill. */
  added?: Partial<Record<CsvField, number>>
}

export interface CsvPreset {
  id: CsvPresetId
  /** The tool's name, as it writes it. */
  name: string
  /** Headers (normalised) the file must have, all of them, to be this tool's. */
  signature: string[]
  /** Each field's column, by header (normalised), the first one present. */
  columns: Partial<Record<CsvField, string[]>>
  /** More columns a parent or dependency may name a row by (Jira's numeric "Issue id"). */
  refColumns?: string[]
  /** Status words (lower case) and what they become; anything else is guessed. */
  statuses?: Record<string, PlanningWorkItemStatus>
  priorities?: Record<string, PlanningPriority>
  dateFormat?: CsvDateFormat
  /** A person as the export writes them, as a name. */
  person?: (value: string) => string
  /** Rewrites the file's rows before anything is mapped (Todoist's indents and sections). */
  prepare?: (table: CsvPresetTable) => CsvPresetTable
}

/** Lower case, letters and digits only: how headers are compared. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Asana (Export / Sync › CSV). Sections become statuses, since they are the
 * board's columns; a filled "Completed At" makes a task Done. "Parent task"
 * and the dependency columns name other tasks by name. Asana has no built-in
 * priority: a "Priority" custom field is read like any CSV's.
 */
const ASANA: CsvPreset = {
  id: 'asana',
  name: 'Asana',
  signature: ['taskid', 'createdat', 'completedat', 'name', 'sectioncolumn'],
  columns: {
    title: ['name'],
    description: ['notes'],
    status: ['sectioncolumn'],
    assignee: ['assignee'],
    labels: ['tags'],
    start: ['startdate'],
    due: ['duedate'],
    key: ['taskid'],
    parent: ['parenttask'],
    waitsOn: ['blockedbydependencies'],
    blocks: ['blockingdependencies'],
    done: ['completedat']
  },
  dateFormat: 'iso'
}

/**
 * Jira (Export › Export CSV). Statuses stay statuses, sprints become
 * milestones, every "Labels" column is read, and "Resolved" makes a task
 * Done. Subtasks name their parent by issue id ("Parent id", or "Parent" in
 * newer exports); "Blocks" links name issues by key. Dates are Jira's
 * "14/Oct/26 9:30 AM".
 */
const JIRA: CsvPreset = {
  id: 'jira',
  name: 'Jira',
  signature: ['summary', 'issuekey', 'issueid', 'issuetype'],
  columns: {
    title: ['summary'],
    description: ['description'],
    status: ['status'],
    priority: ['priority'],
    assignee: ['assignee'],
    labels: ['labels'],
    due: ['duedate'],
    estimate: ['customfieldstorypoints', 'customfieldstorypointestimate'],
    milestone: ['sprint'],
    key: ['issuekey'],
    parent: ['parentid', 'parent'],
    waitsOn: ['inwardissuelinkblocks'],
    blocks: ['outwardissuelinkblocks'],
    done: ['resolved']
  },
  refColumns: ['issueid'],
  statuses: {
    'to do': 'backlog',
    'selected for development': 'ready',
    'in progress': 'active',
    'in review': 'review',
    done: 'done'
  },
  priorities: {
    highest: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    lowest: 'low'
  },
  dateFormat: 'dmy'
}

/**
 * Linear (Settings › Import / Export › Export CSV, or a view's Export).
 * Statuses stay statuses (Todo is Ready; Canceled and Duplicate are Done, so
 * they leave the board), project milestones become milestones, and
 * "Completed" makes a task Done. Sub-issues name their parent by ID.
 */
const LINEAR: CsvPreset = {
  id: 'linear',
  name: 'Linear',
  signature: ['id', 'team', 'title', 'status', 'priority', 'parentissue'],
  columns: {
    title: ['title'],
    description: ['description'],
    status: ['status'],
    priority: ['priority'],
    assignee: ['assignee'],
    labels: ['labels'],
    due: ['duedate'],
    estimate: ['estimate'],
    milestone: ['projectmilestone'],
    key: ['id'],
    parent: ['parentissue'],
    done: ['completed']
  },
  statuses: {
    backlog: 'backlog',
    todo: 'ready',
    'in progress': 'active',
    'in review': 'review',
    done: 'done',
    canceled: 'done',
    duplicate: 'done'
  },
  priorities: {
    urgent: 'critical',
    high: 'high',
    medium: 'medium',
    low: 'low',
    'no priority': 'medium'
  }
}

/**
 * Microsoft Planner (Export plan to Excel, then saved as CSV). Progress is
 * the status, buckets become milestones, checklist items come across, and a
 * "Completed Date" makes a task Done.
 */
const PLANNER: CsvPreset = {
  id: 'planner',
  name: 'Microsoft Planner',
  signature: ['taskid', 'taskname', 'bucketname', 'progress', 'priority'],
  columns: {
    title: ['taskname'],
    description: ['description'],
    status: ['progress'],
    priority: ['priority'],
    assignee: ['assignedto'],
    labels: ['labels'],
    start: ['startdate'],
    due: ['duedate'],
    milestone: ['bucketname'],
    checklist: ['checklistitems'],
    key: ['taskid'],
    done: ['completeddate']
  },
  statuses: {
    'not started': 'backlog',
    'in progress': 'active',
    completed: 'done'
  },
  priorities: {
    urgent: 'critical',
    important: 'high',
    medium: 'medium',
    low: 'low'
  }
}

/**
 * Todoist (a project's ⋯ › Export as a template › Download as CSV). Each row
 * is a task, a section or a note (a comment, left out). Sections become
 * statuses, since they are the board's columns; INDENT makes subtasks;
 * "@labels" in a task's text become labels; RESPONSIBLE is "Name (id)".
 * PRIORITY 1 is Todoist's highest (p1).
 */
const TODOIST: CsvPreset = {
  id: 'todoist',
  name: 'Todoist',
  signature: ['type', 'content', 'priority', 'indent'],
  columns: {
    title: ['content'],
    description: ['description'],
    priority: ['priority'],
    assignee: ['responsible'],
    due: ['date']
  },
  priorities: { '1': 'critical', '2': 'high', '3': 'medium', '4': 'low' },
  person: (value) => value.replace(/\s*\(\d+\)\s*$/, '').trim(),
  prepare: prepareTodoist
}

/** The presets, in the order the mapping step lists them. */
export const CSV_PRESETS: readonly CsvPreset[] = [ASANA, JIRA, LINEAR, PLANNER, TODOIST]

export function csvPreset(id: CsvPresetId | 'none' | null | undefined): CsvPreset | null {
  return CSV_PRESETS.find((preset) => preset.id === id) ?? null
}

/** The preset whose signature the header has, or null. */
export function detectCsvPreset(headers: string[]): CsvPreset | null {
  const names = new Set(headers.map(normaliseHeader))
  return CSV_PRESETS.find((preset) => preset.signature.every((name) => names.has(name))) ?? null
}

const TODOIST_LABEL = /(^|\s)@([^\s@]+)/g

/**
 * Todoist's rows as tasks: sections and notes go, and four columns are
 * added, named in the person's language: the section each task is in, its
 * labels (taken out of its text), its line, and its parent's line (from
 * INDENT).
 */
function prepareTodoist(table: CsvPresetTable): CsvPresetTable {
  const names = table.headers.map(normaliseHeader)
  const column = (name: string) => names.indexOf(name)
  const type = column('type')
  const content = column('content')
  const indent = column('indent')
  const rows: string[][] = []
  const lines: number[] = []
  // The line of the last task at each depth, for the next deeper one's parent.
  const parents: number[] = []
  let section = ''
  table.rows.forEach((row, index) => {
    const kind = (row[type] ?? '').trim().toLowerCase()
    if (kind === 'section') {
      section = (row[content] ?? '').trim()
      parents.length = 0
      return
    }
    if (kind !== 'task') return
    const line = table.lines[index]
    const depth = Math.max(1, Number.parseInt(row[indent] ?? '', 10) || 1)
    parents.length = depth - 1
    const parent = depth > 1 ? (parents[depth - 2] ?? null) : null
    parents[depth - 1] = line
    const labels: string[] = []
    const text = (row[content] ?? '')
      .replace(TODOIST_LABEL, (_match, space: string, label: string) => {
        labels.push(label)
        return space
      })
      .replace(/\s+/g, ' ')
      .trim()
    const next = [...row]
    next[content] = text
    while (next.length < table.headers.length) next.push('')
    next.length = table.headers.length
    next.push(section, labels.join(', '), String(line), parent === null ? '' : String(parent))
    rows.push(next)
    lines.push(line)
  })
  const width = table.headers.length
  return {
    added: { status: width, labels: width + 1, key: width + 2, parent: width + 3 },
    headers: [
      ...table.headers,
      t('data:csvImport.todoistSection'),
      t('data:csvImport.todoistLabels'),
      t('data:csvImport.todoistLine'),
      t('data:csvImport.todoistParent')
    ],
    rows,
    lines
  }
}
