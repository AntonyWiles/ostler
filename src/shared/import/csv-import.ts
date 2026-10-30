import { isScore } from '../planning/idea-scores'
import Papa from 'papaparse'
import type {
  CsvColumnMap,
  CsvCustomColumn,
  CsvDateFormat,
  CsvFieldTarget,
  CsvDelimiter,
  CsvEncoding,
  CsvField,
  CsvImportOptions,
  CsvImportPreview,
  CsvValueMapping,
  ImportPreviewRow,
  ImportRowIssue,
  PlanningFieldDefinition,
  PlanningFieldType,
  PlanningPriority,
  PlanningWorkItemStatus
} from '../ostler-api'
import {
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_PROJECT_FIELDS,
  PLANNING_FIELD_TYPES
} from '../ostler-api'
import { fieldOptionName, hasOptions, parseFieldValueText } from '../planning/custom-fields'
import { isIsoDate } from '../dates'
import {
  cleanImportedText,
  clip,
  guessPriority,
  guessStatus,
  LIMITS,
  MAX_IMPORT_ROWS,
  PREVIEW_ROWS,
  previewTotals,
  type ImportChecklistItem,
  type ImportFieldRef,
  type ImportKnownRecords,
  type ImportNewField,
  type ImportPlan,
  type ImportTaskDraft
} from './import-plan'
import { t } from '../i18n'
import { MAX_TASK_TYPE_NAME_LENGTH } from '../task-types'
import { statusFromColumnWord } from '../board-columns'
import { csvPreset, detectCsvPreset, normaliseHeader, type CsvPreset } from './csv-presets'
import { resolveImportStructure, type ImportRowRefs } from './import-structure'

/**
 * CSV import (P6.1): decoding, delimiter detection, parsing (papaparse),
 * column and value guessing, date reading, and the dry run that turns rows
 * into task drafts with their problems. Pure, so main, the automation API
 * and the tests share it.
 */

export const CSV_FIELDS: readonly CsvField[] = [
  'title',
  'description',
  'status',
  'priority',
  'assignee',
  'labels',
  'start',
  'due',
  'estimate',
  'milestone',
  'iteration',
  'type',
  'showFrom',
  'someday',
  'impact',
  'effort',
  'checklist',
  'key',
  'parent',
  'waitsOn',
  'blocks',
  'done'
]

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  get title() {
    return t('data:csvImport.title')
  },
  get description() {
    return t('data:csvImport.description')
  },
  get status() {
    return t('data:csvImport.status')
  },
  get priority() {
    return t('data:csvImport.priority')
  },
  get assignee() {
    return t('data:csvImport.assignee')
  },
  get labels() {
    return t('data:csvImport.labels')
  },
  get start() {
    return t('data:csvImport.start')
  },
  get due() {
    return t('data:csvImport.due')
  },
  get estimate() {
    return t('data:csvImport.estimate')
  },
  get milestone() {
    return t('data:csvImport.milestone')
  },
  get iteration() {
    return t('data:csvImport.iteration')
  },
  get type() {
    return t('data:csvImport.type')
  },
  get showFrom() {
    return t('data:csvImport.showFrom')
  },
  get someday() {
    return t('data:csvImport.someday')
  },
  get impact() {
    return t('data:csvImport.impact')
  },
  get effort() {
    return t('data:csvImport.effort')
  },
  get checklist() {
    return t('data:csvImport.checklist')
  },
  get key() {
    return t('data:csvImport.key')
  },
  get parent() {
    return t('data:csvImport.parent')
  },
  get waitsOn() {
    return t('data:csvImport.waitsOn')
  },
  get blocks() {
    return t('data:csvImport.blocks')
  },
  get done() {
    return t('data:csvImport.done')
  }
}

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t']

// ─── Decoding ────────────────────────────────────────────────────────────────

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte)
}

/**
 * The file's text. UTF-8, with or without a BOM, when it decodes as UTF-8;
 * otherwise Windows-1252, which is what Excel writes by default. `encoding`
 * overrides the guess.
 */
export function decodeCsv(
  bytes: Uint8Array,
  encoding?: CsvEncoding
): { text: string; encoding: CsvEncoding } {
  const bom = hasUtf8Bom(bytes)
  const body = bom ? bytes.subarray(3) : bytes
  let chosen: CsvEncoding = encoding ?? 'utf-8'
  if (!encoding && !bom) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      chosen = 'windows-1252'
    }
  }
  const text = new TextDecoder(chosen).decode(body)
  return { text: text.replace(/^\ufeff/, ''), encoding: chosen }
}

/** Comma, semicolon or tab: whichever splits the first lines most evenly. */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 64 * 1024)
  let best: CsvDelimiter = ','
  let bestScore = 0
  for (const delimiter of CSV_DELIMITERS) {
    const rows = Papa.parse<string[]>(sample, {
      delimiter,
      preview: 20,
      skipEmptyLines: 'greedy'
    }).data
    const width = rows[0]?.length ?? 0
    if (width < 2) continue
    // Most rows as wide as the header wins; then the most columns.
    const score = rows.filter((row) => row.length === width).length * 1000 + width
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/** The rows of the file, the header first; blank lines are left out. */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' })
  return parsed.data
}

// ─── Guessing columns ───────────────────────────────────────────────────────

/**
 * Header names other tools write, normalised (lower case, letters and
 * digits only): Jira (Summary, Status, Priority, Assignee, Labels, Due Date,
 * Story Points), Asana (Name, Section/Column, Assignee, Due Date, Notes,
 * Tags) and Trello CSV (Card Name, List Name, Labels, Due Date).
 */
const HEADER_NAMES: Record<CsvField, string[]> = {
  title: ['title', 'name', 'summary', 'task', 'taskname', 'cardname', 'subject', 'issue'],
  description: ['description', 'notes', 'details', 'body', 'carddescription', 'note'],
  status: [
    'status',
    'state',
    'sectioncolumn',
    'section',
    'column',
    'listname',
    'list',
    'stage',
    'progress'
  ],
  priority: ['priority', 'importance', 'urgency'],
  assignee: ['assignee', 'assignedto', 'owner', 'responsible', 'members', 'member', 'assigned'],
  labels: ['labels', 'label', 'tags', 'tag', 'categories', 'category'],
  start: ['start', 'startdate', 'starton', 'startson', 'begin'],
  due: ['due', 'duedate', 'dueon', 'deadline', 'enddate'],
  estimate: [
    'estimate',
    'estimatepoints',
    'estimatehours',
    'storypoints',
    'points',
    'storypointestimate',
    'estimatedhours',
    'hours',
    'originalestimate',
    'effort'
  ],
  milestone: ['milestone', 'sprint', 'fixversion', 'fixversions', 'epic', 'epiclink', 'phase'],
  iteration: ['iteration', 'iterationname', 'cycle'],
  type: ['type', 'tasktype', 'issuetype', 'worktype'],
  showFrom: ['showfrom', 'hiddenuntil', 'deferuntil', 'deferdate', 'defer'],
  someday: ['someday', 'somedaymaybe'],
  // A plain "Effort" stays the estimate's, as before (N1.1b); "Effort (1-5)" is the score.
  impact: ['impact15', 'impact', 'impactscore'],
  effort: ['effort15', 'effortscore'],
  checklist: ['checklist', 'checklists', 'checklistitems', 'subtasks', 'todo', 'items'],
  // A plain CSV's structure is mapped by hand; presets name these columns.
  key: [],
  parent: [],
  waitsOn: [],
  blocks: [],
  done: []
}

export function emptyColumnMap(): CsvColumnMap {
  return Object.fromEntries(CSV_FIELDS.map((field) => [field, null])) as CsvColumnMap
}

/**
 * Each field's column, guessed from the headers; each column used once. A
 * preset's columns (and those its `prepare` added) come first; the fields it
 * does not name are guessed as for any CSV.
 */
export function guessColumns(
  headers: string[],
  preset: CsvPreset | null = null,
  added: Partial<Record<CsvField, number>> = {}
): CsvColumnMap {
  const map = emptyColumnMap()
  const used = new Set<number>()
  const names = headers.map(normaliseHeader)
  for (const field of CSV_FIELDS) {
    const index = added[field]
    if (index !== undefined) {
      map[field] = index
      used.add(index)
    }
  }
  for (const field of CSV_FIELDS) {
    if (!preset || map[field] != null) continue
    for (const candidate of preset.columns[field] ?? []) {
      const index = names.findIndex((name, i) => !used.has(i) && name === candidate)
      if (index >= 0) {
        map[field] = index
        used.add(index)
        break
      }
    }
  }
  for (const field of CSV_FIELDS) {
    if (map[field] != null) continue
    for (const candidate of HEADER_NAMES[field]) {
      const index = names.findIndex((name, i) => !used.has(i) && name === candidate)
      if (index >= 0) {
        map[field] = index
        used.add(index)
        break
      }
    }
  }
  return map
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const ISO_LIKE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/
const DAY_MONTH_YEAR =
  /^(\d{1,2}|[a-z]{3,9})[-/. ](\d{1,2}|[a-z]{3,9})[-/. ,]+(\d{4}|\d{2})(?:[T\s,].*)?$/i

function monthNumber(word: string): number | null {
  const index = MONTHS.indexOf(word.slice(0, 3).toLowerCase())
  return index >= 0 ? index + 1 : null
}

function isoFrom(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isIsoDate(value) ? value : null
}

/**
 * A date as `YYYY-MM-DD`, or null when it is not one. `2026-10-20` is read
 * whatever the format; `20/10/2026` and `10/20/2026` follow it; a month
 * written as a word (`20/Oct/26`, Jira's) is read either way. A time after
 * the date is ignored.
 */
export function parseImportDate(value: string, format: CsvDateFormat): string | null {
  const text = value.trim()
  if (!text) return null
  const iso = ISO_LIKE.exec(text)
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const parts = DAY_MONTH_YEAR.exec(text)
  if (!parts) return null
  const [, first, second, yearText] = parts
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
  const firstMonth = /^\d+$/.test(first) ? null : monthNumber(first)
  const secondMonth = /^\d+$/.test(second) ? null : monthNumber(second)
  if (firstMonth && /^\d+$/.test(second)) return isoFrom(year, firstMonth, Number(second))
  if (secondMonth && /^\d+$/.test(first)) return isoFrom(year, secondMonth, Number(first))
  if (!/^\d+$/.test(first) || !/^\d+$/.test(second)) return null
  if (format === 'iso') return null
  return format === 'dmy'
    ? isoFrom(year, Number(second), Number(first))
    : isoFrom(year, Number(first), Number(second))
}

/** Month first for these locales; day first for the rest of the world. */
const MONTH_FIRST_LOCALES = /^(en-us|en-ph|en-um|en-as|en-gu|en-mp|en-pr|en-vi|es-us|fil)/i

/**
 * The format the dates in a file are written in: ISO when they all are,
 * day first when a first number is over 12, month first when a second one
 * is, and otherwise the locale's way.
 */
export function guessDateFormat(values: string[], locale: string): CsvDateFormat {
  const written = values.map((value) => value.trim()).filter(Boolean)
  if (written.length > 0 && written.every((value) => ISO_LIKE.test(value))) return 'iso'
  for (const value of written) {
    const parts = DAY_MONTH_YEAR.exec(value)
    if (!parts || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) continue
    if (Number(parts[1]) > 12) return 'dmy'
    if (Number(parts[2]) > 12) return 'mdy'
  }
  return MONTH_FIRST_LOCALES.test(locale) ? 'mdy' : 'dmy'
}

// ─── The dry run ────────────────────────────────────────────────────────────

export interface CsvFileText {
  text: string
  encoding: CsvEncoding
}

export interface CsvImportAnalysis {
  preview: CsvImportPreview
  plan: ImportPlan
}

function splitList(value: string, separators: RegExp): string[] {
  return value
    .split(separators)
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseEstimate(value: string): number | null | 'invalid' {
  const text = value.trim().replace(/\s*(pts?|points?|h|hrs?|hours?)$/i, '')
  if (!text) return null
  const number = Number(text.replace(',', '.'))
  return Number.isFinite(number) ? number : 'invalid'
}

/** Distinct values of one column, trimmed, most used first. */
function distinctValues(
  rows: string[][],
  column: number | null
): { value: string; count: number }[] {
  if (column === null) return []
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = cleanImportedText(row[column] ?? '').trim()
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function mapValues<T extends string>(
  values: { value: string; count: number }[],
  chosen: Record<string, T> | undefined,
  guess: (value: string) => T,
  allowed: readonly T[]
): CsvValueMapping<T>[] {
  return values.map(({ value, count }) => {
    const pick = chosen?.[value]
    return { value, count, mapped: pick && allowed.includes(pick) ? pick : guess(value) }
  })
}

const STATUSES: readonly PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]
const PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']

/**
 * Reads the whole file against the options and returns the preview (the
 * first 50 rows, every row's problems counted) and the plan the import will
 * write. Rows with an error are left out of the plan; warnings say what was
 * dropped or shortened.
 */
export function analyzeCsv(
  file: CsvFileText,
  options: CsvImportOptions,
  known: ImportKnownRecords,
  locale: string
): CsvImportAnalysis {
  const delimiter =
    options.delimiter && CSV_DELIMITERS.includes(options.delimiter)
      ? options.delimiter
      : detectDelimiter(file.text)
  const table = parseCsv(cleanImportedText(file.text), delimiter)
  if (table.length === 0) throw new Error(t('data:csvImport.fileEmpty'))
  const fileHeaders = table[0].map(
    (header, index) => header.trim() || t('data:csvImport.column', { number: index + 1 })
  )
  if (table.length - 1 > MAX_IMPORT_ROWS)
    throw new Error(
      t('data:csvImport.fileHasRowsImport', {
        localeString: (table.length - 1).toLocaleString('en'),
        localeString2: MAX_IMPORT_ROWS.toLocaleString('en')
      })
    )

  // The other tool the file came from (R4.2): chosen, or recognised by its header.
  const detected = detectCsvPreset(fileHeaders)
  const preset = options.preset === 'none' ? null : (csvPreset(options.preset) ?? detected)
  const prepared = (preset?.prepare ?? ((same) => same))({
    headers: fileHeaders,
    rows: table.slice(1),
    lines: table.slice(1).map((_row, index) => index + 2)
  })
  const headers = prepared.headers
  const body = prepared.rows

  const guessed = guessColumns(headers, preset, prepared.added)
  const columns = emptyColumnMap()
  for (const field of CSV_FIELDS) {
    const chosen = options.columns?.[field]
    columns[field] =
      chosen === undefined
        ? (guessed[field] ?? null)
        : chosen !== null && Number.isInteger(chosen) && chosen >= 0 && chosen < headers.length
          ? chosen
          : null
  }
  // A guessed Type column that a project custom field is named for stays that
  // field's (R2.2 came first); the person importing can still map it to Type by hand.
  const typeColumn = columns.type
  if (
    options.columns?.type === undefined &&
    typeColumn !== null &&
    (known.fields ?? []).some(
      (field) => field.name.toLowerCase() === (headers[typeColumn] ?? '').trim().toLowerCase()
    )
  )
    columns.type = null

  const dateValues = [columns.start, columns.due, columns.showFrom].flatMap((column) =>
    column === null ? [] : body.slice(0, 500).map((row) => row[column] ?? '')
  )
  const dateFormat = options.dateFormat ?? preset?.dateFormat ?? guessDateFormat(dateValues, locale)
  const statuses = mapValues(
    distinctValues(body, columns.status),
    options.statusMap,
    (value) =>
      (known.columns ? statusFromColumnWord(value, known.columns) : null) ??
      preset?.statuses?.[value.toLowerCase()] ??
      guessStatus(value),
    STATUSES
  )
  const priorities = mapValues(
    distinctValues(body, columns.priority),
    options.priorityMap,
    (value) => preset?.priorities?.[value.toLowerCase()] ?? guessPriority(value),
    PRIORITIES
  )
  const statusOf = new Map(statuses.map((entry) => [entry.value, entry.mapped]))
  const priorityOf = new Map(priorities.map((entry) => [entry.value, entry.mapped]))

  // Jira repeats a column per label or link: every column named like the mapped one counts.
  const sameNamed = (column: number | null) =>
    column === null
      ? []
      : headers.flatMap((header, index) =>
          normaliseHeader(header) === normaliseHeader(headers[column]) ? [index] : []
        )
  const labelColumns = sameNamed(columns.labels)
  const waitsOnColumns = sameNamed(columns.waitsOn)
  const blocksColumns = sameNamed(columns.blocks)
  const refColumns = headers.flatMap((header, index) =>
    preset?.refColumns?.includes(normaliseHeader(header)) ? [index] : []
  )

  const custom = customFieldColumns(
    headers,
    body,
    columns,
    [...labelColumns, ...waitsOnColumns, ...blocksColumns],
    options,
    known
  )
  const refs: ImportRowRefs[] = []

  const rows: ImportPreviewRow[] = []
  const tasks: ImportTaskDraft[] = []
  body.forEach((raw, index) => {
    const line = prepared.lines[index]
    const cell = (field: CsvField) => {
      const column = columns[field]
      return column == null ? '' : (raw[column] ?? '')
    }
    const errors: ImportRowIssue[] = []
    const warnings: ImportRowIssue[] = []
    const warn = (field: CsvField | null, message: string) => warnings.push({ field, message })

    let title = cell('title').replace(/\s+/g, ' ').trim()
    if (columns.title === null)
      errors.push({ field: 'title', message: t('data:csvImport.noColumnTitle') })
    else if (!title) errors.push({ field: 'title', message: t('data:csvImport.titleEmpty') })
    let cut: boolean
    ;[title, cut] = clip(title, LIMITS.title)
    if (cut) warn('title', t('data:csvImport.titleCutCharacters', { LIMITSTitle: LIMITS.title }))

    let description = cell('description').trim()
    ;[description, cut] = clip(description, LIMITS.description)
    if (cut)
      warn(
        'description',
        t('data:csvImport.descriptionCutCharacters', { description: LIMITS.description })
      )

    const statusText = cell('status').trim()
    const priorityText = cell('priority').trim()

    let labels = [
      ...new Set(
        labelColumns
          .flatMap((column) => splitList(raw[column] ?? '', /[;,]/))
          .map((label) => {
            const [text, longer] = clip(label, LIMITS.label)
            if (longer)
              warn('labels', t('data:csvImport.labelCutCharacters', { LIMITSLabel: LIMITS.label }))
            return text
          })
      )
    ]
    if (labels.length > LIMITS.labels) {
      warn(
        'labels',
        t('data:csvImport.onlyFirstLabelsKept', {
          labels: LIMITS.labels,
          labelCount: labels.length
        })
      )
      labels = labels.slice(0, LIMITS.labels)
    }

    const date = (field: 'start' | 'due' | 'showFrom') => {
      const text = cell(field).trim()
      if (!text) return null
      const parsed = parseImportDate(text, dateFormat)
      if (!parsed) warn(field, t('data:csvImport.notDateChosenFormat', { text }))
      return parsed
    }
    let startDate = date('start')
    const dueDate = date('due')
    if (startDate && dueDate && startDate > dueDate) {
      warn('start', t('data:csvImport.startAfterDueDate'))
      startDate = null
    }
    const showFrom = date('showFrom')
    const someday = !['', 'false', 'no', '0'].includes(cell('someday').trim().toLowerCase())

    // An idea's scores (N1.1b): a whole number from 1 to 5, or left empty with a warning.
    const score = (field: 'impact' | 'effort') => {
      const text = cell(field).trim()
      if (!text) return null
      const value = Number(text)
      if (isScore(value)) return value
      warn(field, t('data:csvImport.notScore', { text }))
      return null
    }
    const impact = score('impact')
    const effort = score('effort')

    let estimate: number | null = null
    const estimateValue = parseEstimate(cell('estimate'))
    if (estimateValue === 'invalid')
      warn('estimate', t('data:csvImport.notNumberSoLeft', { trim: cell('estimate').trim() }))
    else if (estimateValue !== null && (estimateValue < 0 || estimateValue > LIMITS.estimate))
      warn('estimate', t('data:csvImport.estimateMust0So', { estimate: LIMITS.estimate }))
    else estimate = estimateValue

    let assigneeName: string | null = cell('assignee').trim() || null
    if (assigneeName && preset?.person) assigneeName = preset.person(assigneeName) || null
    if (assigneeName && /[;,]/.test(assigneeName)) {
      const [first] = splitList(assigneeName, /[;,]/)
      warn('assignee', t('data:csvImport.taskHasOneAssignee', { first }))
      assigneeName = first ?? null
    }
    if (assigneeName) [assigneeName] = clip(assigneeName, LIMITS.name)

    let milestoneName: string | null = cell('milestone').trim() || null
    if (milestoneName) [milestoneName] = clip(milestoneName, LIMITS.milestone)

    // An iteration is matched by name (R6.1); it has dates, so one that is not there is left out.
    let iterationName: string | null = cell('iteration').trim() || null
    if (
      iterationName &&
      known.iterations &&
      !known.iterations.some((name) => name.toLowerCase() === iterationName!.toLowerCase())
    ) {
      warn('iteration', t('data:csvImport.noSuchIteration', { name: iterationName }))
      iterationName = null
    }

    // A task type is matched by name, any case, or made, as labels are (N2.7a).
    let typeName: string | null = cell('type').trim() || null
    if (typeName) [typeName] = clip(typeName, MAX_TASK_TYPE_NAME_LENGTH)

    const checklist: ImportChecklistItem[] = []
    for (const entry of splitList(cell('checklist'), /\n|;/)) {
      const ticked = /^\[[xX✓]\]\s*/.test(entry)
      const [text] = clip(entry.replace(/^\[[ xX✓]?\]\s*/, '').trim(), LIMITS.checklistItem)
      if (text && !checklist.some((item) => item.text === text))
        checklist.push({ text, checked: ticked })
    }
    if (checklist.length > LIMITS.checklist) {
      warn(
        'checklist',
        t('data:csvImport.onlyFirstChecklistItems', { checklist: LIMITS.checklist })
      )
      checklist.length = LIMITS.checklist
    }

    const fieldTexts: Record<ImportFieldRef, string> = {}
    for (const entry of custom.mapped) {
      const text = cleanImportedText(raw[entry.column] ?? '').trim()
      if (!text) continue
      try {
        parseFieldValueText(entry.field, text)
        fieldTexts[entry.ref] = text
      } catch {
        warn(null, t('data:csvImport.fieldValueDropped', { fieldName: entry.field.name, text }))
      }
    }

    const cellsOf = (list: number[]) => list.map((column) => raw[column] ?? '')
    refs.push({
      line,
      title,
      keys: [columns.key, ...refColumns].flatMap((column) =>
        column === null ? [] : [(raw[column] ?? '').trim()]
      ),
      parent: cell('parent'),
      waitsOn: cellsOf(waitsOnColumns),
      blocks: cellsOf(blocksColumns)
    })

    const cells: ImportPreviewRow['cells'] = {}
    for (const field of CSV_FIELDS) if (columns[field] != null) cells[field] = cell(field)
    // Every row counts towards the totals; the preview shows the first 50.
    rows.push({ line, title, cells, errors, warnings })
    if (errors.length > 0) return
    // A filled "done" cell (a completion date) wins over the status column.
    const finished = !['', 'false', 'no', '0'].includes(cell('done').trim().toLowerCase())
    tasks.push({
      line,
      title,
      description,
      status: finished ? 'done' : statusText ? (statusOf.get(statusText) ?? 'backlog') : 'backlog',
      priority: priorityText ? (priorityOf.get(priorityText) ?? 'medium') : 'medium',
      labels,
      checklist,
      assigneeName,
      startDate,
      dueDate,
      ...(showFrom ? { showFrom } : {}),
      ...(someday ? { someday } : {}),
      ...(impact !== null ? { impact } : {}),
      ...(effort !== null ? { effort } : {}),
      estimate,
      milestoneName,
      ...(iterationName ? { iterationName } : {}),
      ...(typeName ? { typeName } : {}),
      ...(Object.keys(fieldTexts).length > 0 ? { fieldTexts } : {})
    })
  })

  const rowAt = new Map(rows.map((row) => [row.line, row]))
  const ordered = resolveImportStructure(tasks, refs, (line, field, message) =>
    rowAt.get(line)?.warnings.push({ field, message })
  )

  const plan: ImportPlan = {
    tasks: ordered,
    labelColors: [],
    people: [],
    skipped: body.length - tasks.length,
    ...(custom.newFields.length > 0 ? { newFields: custom.newFields } : {})
  }
  return {
    plan,
    preview: {
      ...previewTotals(rows, plan, known),
      preset: preset?.id ?? null,
      detectedPreset: detected?.id ?? null,
      subtaskCount: ordered.filter((task) => task.parentLine !== undefined).length,
      dependencyCount: ordered.reduce((sum, task) => sum + (task.waitsOnLines?.length ?? 0), 0),
      encoding: file.encoding,
      delimiter,
      dateFormat,
      headers,
      columns,
      statuses,
      priorities,
      customColumns: custom.columns,
      newFields: custom.newFields.map((field) => field.name),
      existingFields: (known.fields ?? []).map((field) => ({ id: field.id, name: field.name })),
      iterationCount: known.iterations?.length ?? 0,
      rows: rows.slice(0, PREVIEW_ROWS)
    }
  }
}

// ─── Custom fields (R2.2) ───────────────────────────────────────────────────

const YES_NO = /^(yes|no|true|false|y|n|x|✓|0|1)$/i
const NUMBER = /^-?[\d,]*\.?\d+$/

/** The type a new field would take from a column's values: what they all are. */
export function suggestFieldType(values: string[]): PlanningFieldType {
  const written = values.map((value) => value.trim()).filter(Boolean)
  if (written.length === 0) return 'text'
  if (written.every((value) => YES_NO.test(value)) && written.some((v) => !/^[01]$/.test(v)))
    return 'checkbox'
  if (written.every((value) => NUMBER.test(value))) return 'number'
  if (written.every((value) => isIsoDate(value))) return 'date'
  const distinct = new Set(written.map((value) => value.toLowerCase()))
  if (written.some((value) => /[;]/.test(value)) && distinct.size > 1) {
    const parts = new Set(
      written.flatMap((value) => splitList(value, /[;,]/)).map((part) => part.toLowerCase())
    )
    if (parts.size <= MAX_FIELD_OPTIONS) return 'choices'
  }
  // Few distinct values, each used more than once on average: a choice.
  if (distinct.size <= Math.min(MAX_FIELD_OPTIONS, 12) && distinct.size * 2 <= written.length)
    return 'choice'
  return 'text'
}

function isFieldTarget(value: unknown): value is CsvFieldTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  if (typeof target.fieldId === 'string') return true
  const create = target.create as Record<string, unknown> | undefined
  return (
    !!create &&
    typeof create.name === 'string' &&
    create.name.trim() !== '' &&
    PLANNING_FIELD_TYPES.includes(create.type as PlanningFieldType)
  )
}

interface MappedFieldColumn {
  column: number
  ref: ImportFieldRef
  /** The field, or a stand-in for one the import creates, to check values against. */
  field: PlanningFieldDefinition
}

/**
 * The columns no task field uses, and the custom fields they fill: what the
 * person chose, or else the existing field named like the header. New
 * fields take their options from the column's values and stop at the
 * project's limit of fields.
 */
function customFieldColumns(
  headers: string[],
  body: string[][],
  columns: CsvColumnMap,
  labelColumns: number[],
  options: CsvImportOptions,
  known: ImportKnownRecords
): { columns: CsvCustomColumn[]; mapped: MappedFieldColumn[]; newFields: ImportNewField[] } {
  const fields = known.fields ?? []
  const used = new Set<number>([
    ...CSV_FIELDS.flatMap((field) => (columns[field] == null ? [] : [columns[field]!])),
    ...labelColumns
  ])
  const result: CsvCustomColumn[] = []
  const mapped: MappedFieldColumn[] = []
  const newFields: ImportNewField[] = []
  const taken = new Set<string>()
  let room = MAX_PROJECT_FIELDS - fields.length
  headers.forEach((header, column) => {
    if (used.has(column)) return
    const values = body.map((row) => cleanImportedText(row[column] ?? ''))
    const suggestedType = suggestFieldType(values)
    const chosen = options.fieldColumns?.[String(column)]
    let target: CsvFieldTarget | null
    if (chosen === null) target = null
    else if (chosen !== undefined && isFieldTarget(chosen)) target = chosen
    else {
      const named = fields.find((field) => field.name.toLowerCase() === header.toLowerCase())
      target = named ? { fieldId: named.id } : null
    }
    if (target && 'fieldId' in target) {
      const fieldId = target.fieldId
      const field = fields.find((candidate) => candidate.id === fieldId)
      if (!field || taken.has(field.id)) target = null
      else {
        taken.add(field.id)
        mapped.push({ column, ref: field.id, field })
      }
    } else if (target) {
      const name = target.create.name.trim().slice(0, MAX_FIELD_NAME_LENGTH)
      const ref = `new:${name.toLowerCase()}`
      const clash =
        fields.some((field) => field.name.toLowerCase() === name.toLowerCase()) ||
        newFields.some((field) => field.ref === ref)
      if (clash || room <= 0) target = null
      else {
        room -= 1
        const type = target.create.type
        const optionNames = hasOptions(type) ? optionNamesOf(values, type) : []
        newFields.push({ ref, name, type, options: optionNames })
        mapped.push({
          column,
          ref,
          field: {
            id: ref,
            projectId: '',
            name,
            type,
            options: optionNames.map((option) => ({ id: option, name: option, color: '' })),
            position: 0,
            createdAt: 0
          } as PlanningFieldDefinition
        })
      }
    }
    result.push({ column, header, target, suggestedType })
  })
  return { columns: result, mapped, newFields }
}

/** A new Choice or Choices field's options: the column's values (or parts), first seen first. */
function optionNamesOf(values: string[], type: PlanningFieldType): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const parts = type === 'choices' ? splitList(value, /[;,]/) : [value.trim()].filter(Boolean)
    for (const part of parts) {
      const name = fieldOptionName(part)
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
    }
  }
  return [...seen.values()].slice(0, MAX_FIELD_OPTIONS)
}
