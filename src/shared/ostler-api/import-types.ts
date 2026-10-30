import type {
  PlanningPriority,
  PlanningWorkItemStatus,
  UpdatePlanningWorkItemInput
} from './planning-types'
import type { PlanningFieldType } from './field-types'
import type { SavedViewConfig } from './search-types'

// ─── Import and export (P6.1) ───────────────────────────────────────────────

/** Where an import came from; `import_batches.source`. */
export type ImportSource = 'csv' | 'trello' | 'package' | 'github'

/** A file the person picked, read by main and kept there until it is imported. */
export interface ImportFileInfo {
  /** Main's handle on the bytes it read; valid for this session only. */
  fileId: string
  fileName: string
  kind: ImportSource
  sizeBytes: number
  /** For a project package: what it holds. */
  packageSummary?: ImportPackageSummary
  /**
   * A password-protected project file (N45): nothing is read from it until
   * `unlockImportFile` is given its password.
   */
  locked?: boolean
}

export interface ImportPackageSummary {
  name: string
  milestoneCount: number
  taskCount: number
  /** Library files beside the package (a full export's `library/` folder). */
  fileCount: number
  isTemplate: boolean
}

// ─── CSV ───────────────────────────────────────────────────────────────────

export type CsvEncoding = 'utf-8' | 'windows-1252'
export type CsvDelimiter = ',' | ';' | '\t'
export type CsvDateFormat = 'iso' | 'dmy' | 'mdy'

/** The task fields a CSV column can map to. */
export type CsvField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'start'
  | 'due'
  | 'estimate'
  | 'milestone'
  /** An iteration of the project, by name (R6.1); one that is not there is left out. */
  | 'iteration'
  /** The task's type by name (N2.7a); one that is not there is created. */
  | 'type'
  /** Hidden until this date (N1.1a). */
  | 'showFrom'
  /** In Someday (N1.1a): a filled cell other than "no", "false" or "0". */
  | 'someday'
  /** An idea's scores (N1.1b): a whole number from 1 to 5. */
  | 'impact'
  | 'effort'
  | 'checklist'
  /** The other tool's id for the row, which parents and dependencies name (R4.2). */
  | 'key'
  /** The parent task: a key or a title in the same file; the row becomes its subtask. */
  | 'parent'
  /** Tasks this one waits on, by key or title (Waits on). */
  | 'waitsOn'
  /** Tasks that wait on this one, by key or title. */
  | 'blocks'
  /** A filled cell (a completion date, say) makes the task Done. */
  | 'done'

/** Column mapping: each field to a header's index, or null for none. */
/**
 * Each field's column, or null. Impact and Effort (N1.1b) came later: a map
 * made before them may leave them out, which reads as not mapped.
 */
export type CsvColumnMap = Record<Exclude<CsvField, 'impact' | 'effort'>, number | null> &
  Partial<Record<'impact' | 'effort', number | null>>

/** The other tools whose CSV exports Ostler recognises (R4.2). */
export type CsvPresetId = 'asana' | 'jira' | 'linear' | 'planner' | 'todoist'

/** What the person chose; anything left out is detected or guessed. */
export interface CsvImportOptions {
  /**
   * The other tool the file came from (R4.2), or 'none' to map every column
   * by hand. Detected from the header when left out.
   */
  preset?: CsvPresetId | 'none'
  encoding?: CsvEncoding
  delimiter?: CsvDelimiter
  columns?: Partial<CsvColumnMap>
  /** Each distinct status value (as written in the file) to an Ostler status. */
  statusMap?: Record<string, PlanningWorkItemStatus>
  priorityMap?: Record<string, PlanningPriority>
  dateFormat?: CsvDateFormat
  /**
   * Custom fields (R2.2): a column (by index, as a string key) to an existing
   * field, a new field, or null to leave it out. A column left out here goes
   * to the field with its header's name, when the project has one.
   */
  fieldColumns?: Record<string, CsvFieldTarget | null>
}

/** Where a CSV column's values go among custom fields (R2.2). */
export type CsvFieldTarget =
  { fieldId: string } | { create: { name: string; type: PlanningFieldType } }

/** A column no task field uses, and the custom field it fills, if any. */
export interface CsvCustomColumn {
  column: number
  header: string
  target: CsvFieldTarget | null
  /** The type a new field from this column would get, from its values. */
  suggestedType: PlanningFieldType
}

/** A distinct value in the status or priority column, how often, and where it maps. */
export interface CsvValueMapping<T extends string> {
  value: string
  count: number
  mapped: T
}

export interface ImportRowIssue {
  /** The field the problem is in, or null for the row. */
  field: CsvField | null
  message: string
}

/** One row of the preview: the task it would make, and its problems. */
export interface ImportPreviewRow {
  /** 1-based line of the file (the header is line 1), or the card's place on a board. */
  line: number
  title: string
  cells: Partial<Record<CsvField, string>>
  errors: ImportRowIssue[]
  warnings: ImportRowIssue[]
}

/** The dry run: everything about the import, before anything is written. */
export interface ImportPreviewTotals {
  rowCount: number
  /** Rows that will become tasks (rows with an error are skipped). */
  importableCount: number
  errorRowCount: number
  warningRowCount: number
  errorCount: number
  warningCount: number
  /** Milestones and people that will be created because they are not there yet. */
  newMilestones: string[]
  newPeople: string[]
  /** Task types the import will create (N2.7a). */
  newTypes?: string[]
}

export interface CsvImportPreview extends ImportPreviewTotals {
  /** The preset in use (R4.2), or null for the plain mapping. */
  preset: CsvPresetId | null
  /** The preset the header matches, whatever was chosen. */
  detectedPreset: CsvPresetId | null
  /** Tasks the import makes subtasks, and Waits on links it makes. */
  subtaskCount: number
  dependencyCount: number
  encoding: CsvEncoding
  delimiter: CsvDelimiter
  dateFormat: CsvDateFormat
  headers: string[]
  columns: CsvColumnMap
  statuses: CsvValueMapping<PlanningWorkItemStatus>[]
  priorities: CsvValueMapping<PlanningPriority>[]
  /** The columns no task field uses, for custom fields (R2.2). */
  customColumns: CsvCustomColumn[]
  /** Fields the import will create. */
  newFields: string[]
  /** The project's custom fields, for mapping a column to one. */
  existingFields: { id: string; name: string }[]
  /** How many iterations the project has (R6.1): with none, the Iteration column is not offered. */
  iterationCount?: number
  /** The first 50 rows. */
  rows: ImportPreviewRow[]
}

// ─── Trello ────────────────────────────────────────────────────────────────

export interface TrelloImportOptions {
  /** Each list's id to an Ostler status. */
  listMap?: Record<string, PlanningWorkItemStatus>
  /** Archived cards, and the cards of archived lists, come too. */
  includeArchived?: boolean
}

export interface TrelloListMapping {
  id: string
  name: string
  cardCount: number
  archived: boolean
  mapped: PlanningWorkItemStatus
}

export interface TrelloImportPreview extends ImportPreviewTotals {
  boardName: string
  lists: TrelloListMapping[]
  archivedCardCount: number
  labelCount: number
  memberCount: number
  rows: ImportPreviewRow[]
}

// ─── Running and undoing ───────────────────────────────────────────────────

/** Into an existing project, or a new one named here. */
export type ImportTarget = { kind: 'project'; projectId: string } | { kind: 'new'; name?: string }

export type ImportRequest =
  | { kind: 'csv'; options: CsvImportOptions }
  | { kind: 'trello'; options: TrelloImportOptions }
  | { kind: 'package' }
  /** Issues read with `loadGithubIssues` (R4.4): into an existing project. */
  | { kind: 'github' }

/** An `import_batches` row: one import, undoable in one step. */
export interface ImportBatch {
  id: string
  projectId: string
  source: ImportSource
  fileName: string
  createdAt: number
  itemCount: number
  undoneAt: number | null
}

export interface ImportResult {
  batch: ImportBatch
  projectId: string
  projectName: string
  /** Rows skipped because of errors, and Library files that could not come across. */
  skipped: number
  warnings: string[]
}

export interface ImportUndoCheck {
  batch: ImportBatch
  /** Tasks of the batch still on the project (not in the recycle bin). */
  taskCount: number
  /** Tasks changed since the import: kept unless the person says otherwise. */
  changed: { id: string; title: string }[]
}

export interface ImportUndoResult {
  batch: ImportBatch
  /** Moved to the recycle bin: what "Undo" puts back. */
  movedIds: string[]
  /** Changed since the import, and kept. */
  kept: { id: string; title: string }[]
}

// ─── Export and print ──────────────────────────────────────────────────────

/** The CSV export's columns, the List view's (`LIST_COLUMN_IDS`). */
export interface TaskCsvExportRequest {
  /** In this order; all live tasks when left out. */
  taskIds?: string[]
  /** In this order; every column when left out. */
  columns?: string[]
  /** "Website relaunch - List" */
  fileName?: string
  /** The ID column first (N2.8): what Edit in Excel writes. */
  withIds?: boolean
}

// ─── Edit in Excel (N2.8, N23) ─────────────────────────────────────────────

/** Edit in Excel's file: the CSV export with the ID column first, opened in the default app. */
export interface EditInExcelFile {
  /** Main's handle on the file's path; the renderer never holds the path itself. */
  editId: string
  fileName: string
  taskCount: number
}

/** A file read for Bring changes back: held by main until it is applied or let go. */
export interface BringBackPreview {
  fileId: string
  preview: CsvUpdatePreview
}

/** One field a row changes: the column, its header, and the old and new text as the sheet writes it. */
export interface CsvUpdateFieldChange {
  column: string
  label: string
  from: string
  to: string
}

/** A cell that could not be read: shown, and its field left as it is. */
export interface CsvUpdateProblem {
  column: string
  label: string
  text: string
  message: string
}

/** A row whose ID is a live task of the project, with what it changes. */
export interface CsvUpdateTask {
  line: number
  taskId: string
  title: string
  changes: CsvUpdateFieldChange[]
  problems: CsvUpdateProblem[]
}

/** Why a row with an ID was left out. */
export type CsvUpdateSkipReason = 'unknown' | 'archived' | 'otherProject' | 'duplicate'

export interface CsvUpdateSkippedRow {
  line: number
  id: string
  title: string
  reason: CsvUpdateSkipReason
}

/** A row without an ID: a new task, as an ordinary CSV import makes one. */
export interface CsvUpdateNewRow {
  line: number
  title: string
  /** Why the row cannot become a task (no title); empty when it can. */
  errors: string[]
  warnings: string[]
}

/** Bring changes back's preview: nothing is written until Apply. */
export interface CsvUpdatePreview {
  fileName: string
  encoding: CsvEncoding
  delimiter: CsvDelimiter
  dateFormat: CsvDateFormat
  /** False when the file has no ID column: every row is then a new task. */
  hasIdColumn: boolean
  /** Rows that change a task, or have a cell that cannot be read. */
  changed: CsvUpdateTask[]
  /** Rows matching a task with nothing different. */
  unchangedCount: number
  newRows: CsvUpdateNewRow[]
  /** People and milestones new rows would add, as an ordinary import does. */
  newPeople: string[]
  newMilestones: string[]
  skipped: CsvUpdateSkippedRow[]
}

/** What to apply: the ticked tasks and new rows (by line). Left out: all of them. */
export interface CsvUpdateApplyRequest {
  taskIds?: string[]
  newLines?: number[]
}

/** A task's fields as they were before an apply: sending these back undoes it. */
export interface TaskValuesRestore {
  id: string
  values: UpdatePlanningWorkItemInput
}

export interface CsvUpdateResult {
  /** The tasks changed, with the columns that changed. */
  changed: { taskId: string; title: string; columns: string[] }[]
  /** Puts every changed task back (one undo for all). */
  undo: TaskValuesRestore[]
  /** The import batch of the new tasks; null when there were none. */
  batch: ImportBatch | null
}

export interface ProjectExportOptions {
  /** Comments travel too (default true). */
  comments?: boolean
  /**
   * Protect with a password (N45): at least 8 characters. Used for this
   * export only; never stored or logged.
   */
  password?: string
}

/** "Export to calendar file…" and `GET /export?format=ics` (R4.1, D37). */
export interface CalendarExportOptions {
  /** Finished tasks and milestones too (default false). */
  includeFinished?: boolean
  /** Time blocks too, as timed events in UTC (N3.4a; default false). */
  includeBlocks?: boolean
}

/** "Export to PowerPoint slide…" and `GET /export?format=pptx` (N7.6, N54). */
export interface TimelineSlidesExportOptions {
  /** The first day shown, `YYYY-MM-DD` (default: the first of the earliest bar's month). */
  from?: string
  /** The last day shown, `YYYY-MM-DD` (default: the end of the latest bar's month). */
  to?: string
  /** The Timeline's zoom: week draws a week axis, month and quarter draw months (default month). */
  zoom?: 'week' | 'month' | 'quarter'
  /** The Timeline's grouping (default milestone). */
  groupBy?: 'milestone' | 'assignee' | 'none'
  /** Group keys shown collapsed: their heading only. */
  collapsed?: string[]
  /** The tasks the Timeline shows (its filter); every live task when absent. */
  taskIds?: string[]
  /** With no taskIds: finished tasks too (default false, as the Timeline). */
  includeFinished?: boolean
}

/** "Share as a web page…" and `GET /export?format=html` (R4.1, D37). */
export interface ShareReportOptions {
  /** Task descriptions (default false). */
  descriptions?: boolean
  /** The decisions log (default false). */
  decisions?: boolean
  /** Finished tasks (default true). */
  finished?: boolean
  /** People's names (default true). */
  people?: boolean
  /** How the task list is grouped (default status). */
  groupBy?: 'status' | 'milestone'
  /** The latest status update (N5.5; default false). */
  statusUpdate?: boolean
}

export type PrintableView = 'list' | 'overview' | 'timeline' | 'shopping'

export interface PrintRequest {
  view: PrintableView
  /** The view's filter, search, sort and columns as it shows them now. */
  config?: SavedViewConfig
  /** Save as PDF to a file the person picks, or send to a printer. */
  output: 'pdf' | 'printer'
}

/** Print the Timeline across projects (N5.4): the projects shown, or every enabled one. */
export interface TimelineOverviewPrintRequest {
  /** The projects the filter shows; null or absent for every enabled project. */
  projectIds?: string[] | null
  output: 'pdf' | 'printer'
}

/** Print or export Compare rounds (N5.7b): the series a milestone belongs to. */
export interface RoundComparisonPrintRequest {
  projectId: string
  /** Any round of the series. */
  milestoneId: string
  /** Each cell's cycle time or time tracked. */
  measure: 'cycle' | 'time'
  output: 'pdf' | 'printer'
}

/** Print my week (N3.1b): Home's Today and Upcoming on one sheet. */
export interface MyWeekPrintRequest {
  /** The renderer's local date, `YYYY-MM-DD`, as Home asks with. */
  today: string
  output: 'pdf' | 'printer'
}
