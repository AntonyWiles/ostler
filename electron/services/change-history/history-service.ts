import Database from 'better-sqlite3'
import type {
  ChangeDetail,
  ChangeEntryKind,
  ChangeHistoryClear,
  ChangeHistoryEntry,
  ChangeHistoryHead,
  ChangeHistoryPage,
  ChangeHistoryQuery,
  ChangeHistoryStats,
  ChangeSubject,
  ChangeSubjectAction,
  ChangeUndoResult
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { openChangeContext, setChangeFinisher, type ChangeContext } from './context'
import { attachChangeRecorder, quote, rowImage, tableShape, type TableShape } from './recorder'
import {
  BOOKKEEPING_COLUMNS,
  PARENT_NAMES,
  REFERENCE_NAMES,
  STATE_COLUMNS,
  TRACKED_TABLES
} from './tables'

const DAY_MS = 24 * 60 * 60 * 1000
/** Edits to the same one thing through the same action, this close together, are one step. */
export const JOIN_EDITS_MS = 90_000
/** Rows a step left without an entry (a crash part-way) are swept after this. */
const ORPHAN_ROWS_MS = DAY_MS
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
/** Subjects an entry keeps by name; the rest are counted. */
const MAX_SUBJECTS = 25
const MAX_NAME_LENGTH = 120
const MAX_DETAIL_LENGTH = 400

interface EntryRow {
  id: string
  at: number
  last_at: number
  channel: string
  project_id: string | null
  undoes_id: string | null
  subjects: string
}

interface StoredSubjects {
  subjects: ChangeSubject[]
  count: number
}

interface ChangeRow {
  id: number
  entry_id: string
  at: number
  table_name: string
  row_key: string
  op: 'insert' | 'update' | 'delete'
  before_row: string | null
  after_row: string | null
}

type Image = Record<string, unknown>

/** A row an undo wrote, for reindexing and telling the windows. */
export interface UndoneRow {
  table: string
  /** The row's own id column, when it has one. */
  id: string | null
  /** The task it belongs to, for a part of a task. */
  workItemId: string | null
  projectId: string | null
}

export interface ChangeHistoryOptions {
  getProjectIds: () => string[]
  /** How many days entries are kept (`history.keepChangesDays`). */
  keepDays: () => number
  /** An undo wrote these rows: reindex what search holds and tell the windows. */
  afterUndo: (rows: UndoneRow[]) => void
  /** The history itself changed: an entry came, went or was undone. */
  changed: () => void
  now?: () => number
}

const ACTION_RANK: Record<ChangeSubjectAction, number> = {
  added: 5,
  removed: 4,
  restored: 3,
  archived: 2,
  unarchived: 1,
  changed: 0
}

function parse(text: string | null): Image | null {
  if (text === null) return null
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Image) : null
  } catch {
    return null
  }
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function shorten(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The columns an update changed that the person would call a change. */
function changedColumns(before: Image, after: Image): string[] {
  return Object.keys(after).filter(
    (column) => !BOOKKEEPING_COLUMNS.has(column) && !same(before[column], after[column])
  )
}

function stateAction(before: Image, after: Image): ChangeSubjectAction | null {
  for (const [kind, column] of Object.entries(STATE_COLUMNS)) {
    if (!(column in after)) continue
    const was = before[column] ?? null
    const now = after[column] ?? null
    if (was === null && now !== null) return kind === 'removed' ? 'removed' : 'archived'
    if (was !== null && now === null) return kind === 'removed' ? 'restored' : 'unarchived'
  }
  return null
}

/**
 * Undo history: every change the person makes in a window, step by step,
 * with any step undone on its own later.
 *
 * Recording is done by triggers on each service's connection
 * (`recorder.ts`) while an IPC call runs (`context.ts`); this service turns
 * a call's rows into one entry, lists and describes the entries, and undoes
 * one by putting back, value by value, only what still holds the step's
 * result. A value something changed later is kept, so undoing an old step
 * never breaks later ones. The undo is itself recorded as an entry, so undoing
 * it again is redo.
 */
export class ChangeHistoryService {
  private readonly db: Database.Database
  private readonly now: () => number

  constructor(
    dbPath: string,
    private readonly options: ChangeHistoryOptions
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    attachChangeRecorder(this.db)
    this.now = options.now ?? Date.now
    setChangeFinisher((context) => void this.finish(context))
  }

  close(): void {
    setChangeFinisher(null)
    this.db.close()
  }

  // ─── Recording ────────────────────────────────────────────────────────────

  /** Turns a finished call's rows into an entry, or joins them to the one before. */
  finish(context: ChangeContext): ChangeHistoryEntry | null {
    context.finished = true
    const rows = this.rowsOf(context.entryId)
    if (rows.length === 0) return null
    const subjects = this.describe(rows)
    if (subjects.length === 0) {
      this.db.prepare('DELETE FROM change_history_rows WHERE entry_id = ?').run(context.entryId)
      return null
    }
    const at = rows[0].at
    const lastAt = rows[rows.length - 1].at
    const joined = context.undoes ? null : this.joinPrevious(context, subjects, lastAt)
    if (joined) {
      this.options.changed()
      return this.toEntry(joined)
    }
    const projects = new Set(subjects.map((subject) => subject.projectId))
    const row: EntryRow = {
      id: context.entryId,
      at,
      last_at: lastAt,
      channel: context.channel,
      project_id: projects.size === 1 ? [...projects][0] : null,
      undoes_id: context.undoes,
      subjects: JSON.stringify({
        subjects: subjects.slice(0, MAX_SUBJECTS),
        count: subjects.length
      } satisfies StoredSubjects)
    }
    this.db
      .prepare(
        `INSERT INTO change_history_entries (id, at, last_at, channel, project_id, undoes_id, subjects)
         VALUES (@id, @at, @last_at, @channel, @project_id, @undoes_id, @subjects)`
      )
      .run(row)
    this.options.changed()
    return this.toEntry(row)
  }

  /**
   * Typing into a description saves many times: edits to the same one thing
   * through the same action within `JOIN_EDITS_MS` of each other join the step
   * before, unless that step has been undone.
   */
  private joinPrevious(
    context: ChangeContext,
    subjects: ChangeSubject[],
    lastAt: number
  ): EntryRow | null {
    if (subjects.length !== 1 || subjects[0].action !== 'changed') return null
    // Steps in the same millisecond share `at`; rowid, not the random id, keeps them in order.
    const previous = this.db
      .prepare('SELECT * FROM change_history_entries ORDER BY at DESC, rowid DESC LIMIT 1')
      .get() as EntryRow | undefined
    if (!previous || previous.undoes_id !== null || previous.channel !== context.channel)
      return null
    if (lastAt - previous.last_at > JOIN_EDITS_MS) return null
    const stored = this.storedSubjects(previous)
    if (stored.count !== 1) return null
    const [before] = stored.subjects
    const [next] = subjects
    if (before.kind !== next.kind || before.id !== next.id || before.action !== 'changed')
      return null
    // The same field again (typing); a different field is a step of its own.
    if (next.fields.some((field) => !before.fields.includes(field))) return null
    if (this.undoneBy(previous.id)) return null
    const merged: ChangeSubject = {
      ...next,
      fields: [...new Set([...before.fields, ...next.fields])]
    }
    const subjectsText = JSON.stringify({ subjects: [merged], count: 1 } satisfies StoredSubjects)
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE change_history_rows SET entry_id = ? WHERE entry_id = ?')
        .run(previous.id, context.entryId)
      this.db
        .prepare('UPDATE change_history_entries SET last_at = ?, subjects = ? WHERE id = ?')
        .run(lastAt, subjectsText, previous.id)
    })()
    return { ...previous, last_at: lastAt, subjects: subjectsText }
  }

  /** What a step's rows changed, one subject per thing, a task's parts counted as the task. */
  private describe(rows: ChangeRow[]): ChangeSubject[] {
    const subjects = new Map<string, ChangeSubject>()
    const parentNames = new Map<string, string | null>()
    for (const row of rows) {
      const meta = TRACKED_TABLES[row.table_name]
      if (!meta) continue
      const before = parse(row.before_row)
      const after = parse(row.after_row)
      const image = after ?? before
      if (!image) continue
      const projectId = typeof image.project_id === 'string' ? image.project_id : null
      const parentId = meta.parent ? image[meta.parent.column] : null

      let subject: ChangeSubject
      if (meta.parent && typeof parentId === 'string') {
        subject = {
          kind: meta.parent.kind,
          id: parentId,
          projectId,
          name: null,
          action: 'changed',
          fields: [meta.parent.aspect]
        }
        parentNames.set(`${subject.kind}|${subject.id}`, null)
      } else {
        let action: ChangeSubjectAction = 'changed'
        let fields: string[] = []
        if (row.op === 'insert') action = 'added'
        else if (row.op === 'delete') action = 'removed'
        else if (before && after) {
          fields = changedColumns(before, after)
          if (fields.length === 0) continue
          action = stateAction(before, after) ?? 'changed'
        }
        const id = image[meta.idColumn ?? 'id']
        const name = meta.nameColumn ? image[meta.nameColumn] : null
        subject = {
          kind: meta.kind,
          id: typeof id === 'string' || typeof id === 'number' ? String(id) : row.row_key,
          projectId,
          name: shorten(name, MAX_NAME_LENGTH),
          action,
          fields: action === 'changed' ? fields : []
        }
      }

      const key = `${subject.kind}|${subject.id}`
      const known = subjects.get(key)
      if (!known) {
        subjects.set(key, subject)
        continue
      }
      if (ACTION_RANK[subject.action] > ACTION_RANK[known.action]) known.action = subject.action
      known.fields = [...new Set([...known.fields, ...subject.fields])]
      if (subject.name) known.name = subject.name
      known.projectId ??= subject.projectId
    }

    // A task's parts are named by the task; read it, or the task's own row in this step.
    for (const key of parentNames.keys()) {
      const subject = subjects.get(key)
      if (!subject || subject.name) continue
      const source = PARENT_NAMES[subject.kind]
      if (!source) continue
      const found = this.db
        .prepare(
          `SELECT ${quote(source.column)} AS name, project_id FROM ${quote(source.table)} WHERE id = ?`
        )
        .get(subject.id) as { name: unknown; project_id?: unknown } | undefined
      if (found) {
        subject.name = shorten(found.name, MAX_NAME_LENGTH)
        if (!subject.projectId && typeof found.project_id === 'string')
          subject.projectId = found.project_id
      }
    }

    for (const subject of subjects.values()) if (subject.action !== 'changed') subject.fields = []
    return [...subjects.values()]
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  list(query: ChangeHistoryQuery = {}): ChangeHistoryPage {
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
    const where: string[] = []
    const params: unknown[] = []
    if (query.projectId) {
      where.push('project_id = ?')
      params.push(query.projectId)
    }
    if (typeof query.since === 'number') {
      where.push('last_at >= ?')
      params.push(query.since)
    }
    const search = query.search?.trim()
    if (search) {
      where.push("subjects LIKE ? ESCAPE '\\'")
      params.push(`%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    }
    if (query.before) {
      const bar = query.before.indexOf('|')
      const at = Number(query.before.slice(0, bar))
      if (bar < 1 || !Number.isFinite(at)) throw new Refusal(t('errors:changeHistory.badCursor'))
      where.push(
        '(at < ? OR (at = ? AND rowid < (SELECT rowid FROM change_history_entries WHERE id = ?)))'
      )
      params.push(at, at, query.before.slice(bar + 1))
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM change_history_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY at DESC, rowid DESC LIMIT ?`
      )
      .all(...params, limit + 1) as EntryRow[]
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return {
      entries: page.map((row) => this.toEntry(row)),
      nextBefore: rows.length > limit && last ? `${last.at}|${last.id}` : null
    }
  }

  get(entryId: string): ChangeHistoryEntry | null {
    const row = this.entryRow(entryId)
    return row ? this.toEntry(row) : null
  }

  /** Every value a step changed, before and after, for its details. */
  details(entryId: string): ChangeDetail[] {
    if (!this.entryRow(entryId)) throw new Refusal(t('errors:changeHistory.entryNotFound'))
    const details: ChangeDetail[] = []
    const value = (column: string, image: Image | null) =>
      image ? shorten(this.referenceName(column, image[column]), MAX_DETAIL_LENGTH) : null
    for (const row of this.rowsOf(entryId)) {
      const action = row.op === 'insert' ? 'added' : row.op === 'delete' ? 'removed' : 'changed'
      const meta = TRACKED_TABLES[row.table_name]
      if (!meta) continue
      const before = parse(row.before_row)
      const after = parse(row.after_row)
      const image = after ?? before
      if (!image) continue
      const parentId = meta.parent ? image[meta.parent.column] : null
      if (meta.parent && typeof parentId === 'string') {
        const describe = (image: Image | null) => {
          if (!image) return null
          const column = [
            'body',
            'criterion_text',
            'text_value',
            'text',
            'name',
            'note',
            'description',
            'rule',
            'day',
            'remind_at',
            'depends_on_id'
          ].find((name) => image[name] !== undefined && image[name] !== null && image[name] !== '')
          return column ? value(column, image) : null
        }
        details.push({
          kind: meta.parent.kind,
          subjectId: parentId,
          field: meta.parent.aspect,
          action,
          before: row.op === 'insert' ? null : describe(before),
          after: row.op === 'delete' ? null : describe(after)
        })
        continue
      }
      const id = String(image[meta.idColumn ?? 'id'] ?? row.row_key)
      const name = meta.nameColumn ?? null
      if (row.op !== 'update' || !before || !after) {
        details.push({
          kind: meta.kind,
          subjectId: id,
          field: name ?? 'id',
          action,
          before: row.op === 'insert' ? null : shorten(name ? image[name] : id, MAX_DETAIL_LENGTH),
          after: row.op === 'delete' ? null : shorten(name ? image[name] : id, MAX_DETAIL_LENGTH)
        })
        continue
      }
      for (const column of changedColumns(before, after)) {
        details.push({
          kind: meta.kind,
          subjectId: id,
          field: column,
          action,
          before: value(column, before),
          after: value(column, after)
        })
      }
    }
    return details
  }

  /** What an id column points to, by name (a milestone's id reads as its name); else the value. */
  private referenceName(column: string, id: unknown): unknown {
    const source = REFERENCE_NAMES[column]
    if (!source || typeof id !== 'string' || id === '') return id
    try {
      const found = this.db
        .prepare(`SELECT ${quote(source.column)} AS name FROM ${quote(source.table)} WHERE id = ?`)
        .get(id) as { name: unknown } | undefined
      return found && typeof found.name === 'string' && found.name !== '' ? found.name : id
    } catch {
      return id
    }
  }

  /** What the toolbar's Undo and Redo would act on now. */
  head(): ChangeHistoryHead {
    return { undo: this.undoTarget(), redo: this.redoTarget() }
  }

  stats(): ChangeHistoryStats {
    const entries = this.db
      .prepare(
        'SELECT COUNT(*) AS count, MIN(at) AS oldest, COALESCE(SUM(LENGTH(subjects)), 0) AS bytes FROM change_history_entries'
      )
      .get() as { count: number; oldest: number | null; bytes: number }
    const rows = this.db
      .prepare(
        'SELECT COALESCE(SUM(LENGTH(before_row)), 0) + COALESCE(SUM(LENGTH(after_row)), 0) + COALESCE(SUM(LENGTH(row_key)), 0) AS bytes FROM change_history_rows'
      )
      .get() as { bytes: number }
    return { entries: entries.count, oldestAt: entries.oldest, bytes: entries.bytes + rows.bytes }
  }

  // ─── Undo and redo ────────────────────────────────────────────────────────

  /** Undoes the newest step that is still in force. */
  undoLatest(): ChangeUndoResult {
    const target = this.undoTarget()
    if (!target) throw new Refusal(t('errors:changeHistory.nothingToUndo'))
    return this.undo(target.id)
  }

  /** Puts back the newest step that was undone, by undoing its undo. */
  redoLatest(): ChangeUndoResult {
    const target = this.redoTarget()
    if (!target) throw new Refusal(t('errors:changeHistory.nothingToRedo'))
    return this.undo(target.id)
  }

  /** Redo for one entry: undoes the undo that took it out. */
  redo(entryId: string): ChangeUndoResult {
    const undoneBy = this.undoneBy(entryId)
    if (!undoneBy) throw new Refusal(t('errors:changeHistory.notUndone'))
    return this.undo(undoneBy)
  }

  /**
   * Undoes one step, whenever it was. Each value it changed goes back only
   * where it still holds what the step left: later changes stay. Runs inside
   * the IPC call's step, which becomes the undo's own entry.
   */
  undo(entryId: string): ChangeUndoResult {
    const context = openChangeContext()
    if (!context) throw new Error('An undo must run inside a recorded step.')
    const entry = this.entryRow(entryId)
    if (!entry) throw new Refusal(t('errors:changeHistory.entryNotFound'))
    if (this.undoneBy(entryId)) throw new Refusal(t('errors:changeHistory.alreadyUndone'))
    const rows = this.rowsOf(entryId).reverse()
    const known = new Set(this.options.getProjectIds())
    for (const row of rows) {
      const projectId = parse(row.after_row ?? row.before_row)?.project_id
      if (typeof projectId === 'string' && !known.has(projectId))
        throw new Refusal(t('errors:changeHistory.projectGone'))
    }

    context.undoes = entryId
    let reverted = 0
    let kept = 0
    const undone: UndoneRow[] = []
    const shapes = new Map<string, TableShape | null>()
    const shapeOf = (table: string) => {
      if (!shapes.has(table)) shapes.set(table, tableShape(this.db, table))
      return shapes.get(table) ?? null
    }
    this.db.transaction(() => {
      // Rows go back newest first; a task and its parts may land in either order.
      this.db.pragma('defer_foreign_keys = ON')
      for (const row of rows) {
        const result = this.revert(row, shapeOf(row.table_name))
        reverted += result.reverted
        kept += result.kept
        if (result.reverted > 0) undone.push(this.undoneRow(row))
      }
    })()

    const made = context.touched ? this.finish(context) : null
    context.finished = true
    if (undone.length > 0) this.options.afterUndo(undone)
    return { entry: made, reverted, kept }
  }

  private revert(row: ChangeRow, shape: TableShape | null): { reverted: number; kept: number } {
    const before = parse(row.before_row)
    const after = parse(row.after_row)
    if (!shape) return { reverted: 0, kept: 1 }
    const table = quote(shape.table)
    const where = shape.keyColumns
      .map((column, index) => `${quote(column)} IS json_extract(@key, '$[${index}]')`)
      .join(' AND ')
    const current = this.db
      .prepare(
        `SELECT rowid AS rid, ${rowImage(shape.columns, '')} AS image FROM ${table} WHERE ${where} LIMIT 1`
      )
      .get({ key: row.row_key }) as { rid: number; image: string } | undefined
    const now = parse(current?.image ?? null)

    try {
      switch (row.op) {
        case 'insert': {
          if (!current) return { reverted: 0, kept: 0 }
          this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(current.rid)
          return { reverted: 1, kept: 0 }
        }
        case 'delete': {
          if (!before) return { reverted: 0, kept: 0 }
          if (current) return { reverted: 0, kept: 1 }
          const columns = shape.columns.filter((column) => column in before)
          this.db
            .prepare(
              `INSERT INTO ${table} (${columns.map(quote).join(', ')})
               VALUES (${columns.map((column) => `json_extract(@image, '$.${quote(column)}')`).join(', ')})`
            )
            .run({ image: row.before_row })
          return { reverted: 1, kept: 0 }
        }
        case 'update': {
          if (!before || !after) return { reverted: 0, kept: 0 }
          const changed = changedColumns(before, after).filter((column) =>
            shape.columns.includes(column)
          )
          if (!now) return { reverted: 0, kept: changed.length }
          const restore: string[] = []
          let kept = 0
          for (const column of changed) {
            if (same(now[column], after[column])) restore.push(column)
            else if (!same(now[column], before[column])) kept++
          }
          if (restore.length === 0) return { reverted: 0, kept }
          const sets = restore.map(
            (column) => `${quote(column)} = json_extract(@image, '$.${quote(column)}')`
          )
          if (shape.columns.includes('updated_at')) sets.push('updated_at = @now')
          this.db
            .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE rowid = @rid`)
            .run({ image: row.before_row, now: this.now(), rid: current!.rid })
          return { reverted: restore.length, kept }
        }
      }
    } catch (error) {
      // A row that can no longer go back (a clash with a newer one) is kept as it is.
      console.warn(`Undo kept a ${shape.table} row it could not put back:`, error)
      return { reverted: 0, kept: 1 }
    }
  }

  private undoneRow(row: ChangeRow): UndoneRow {
    const image = parse(row.before_row) ?? parse(row.after_row) ?? {}
    const meta = TRACKED_TABLES[row.table_name]
    const id = image[meta?.idColumn ?? 'id']
    const parentColumn = meta?.parent?.kind === 'task' ? meta.parent.column : null
    const workItemId = parentColumn ? image[parentColumn] : null
    return {
      table: row.table_name,
      id: typeof id === 'string' ? id : null,
      workItemId: typeof workItemId === 'string' ? workItemId : null,
      projectId: typeof image.project_id === 'string' ? image.project_id : null
    }
  }

  private undoTarget(): ChangeHistoryEntry | null {
    const candidates = this.db
      .prepare(
        'SELECT * FROM change_history_entries WHERE undoes_id IS NULL ORDER BY at DESC, rowid DESC LIMIT 200'
      )
      .all() as EntryRow[]
    const found = candidates.find((row) => !this.undoneBy(row.id))
    return found ? this.toEntry(found) : null
  }

  /** The newest undo still in force that took out a change (not a redo). */
  private redoTarget(): ChangeHistoryEntry | null {
    const candidates = this.db
      .prepare(
        'SELECT * FROM change_history_entries WHERE undoes_id IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT 200'
      )
      .all() as EntryRow[]
    const found = candidates.find((row) => !this.undoneBy(row.id) && this.kindOf(row) === 'undo')
    return found ? this.toEntry(found) : null
  }

  // ─── Forgetting ───────────────────────────────────────────────────────────

  /** Forgets one step, with the undos and redos of it. What it changed stays as it is. */
  delete(entryId: string): number {
    if (!this.entryRow(entryId)) throw new Refusal(t('errors:changeHistory.entryNotFound'))
    const ids = [entryId]
    for (let index = 0; index < ids.length; index++) {
      const undos = this.db
        .prepare('SELECT id FROM change_history_entries WHERE undoes_id = ?')
        .all(ids[index]) as { id: string }[]
      for (const undo of undos) if (!ids.includes(undo.id)) ids.push(undo.id)
    }
    this.forget(ids)
    this.options.changed()
    return ids.length
  }

  /** Forgets every step, or those older than a time, or one project's. */
  clear(options: ChangeHistoryClear = {}): number {
    const where: string[] = []
    const params: unknown[] = []
    if (typeof options.olderThan === 'number') {
      where.push('last_at < ?')
      params.push(options.olderThan)
    }
    if (options.projectId) {
      where.push('project_id = ?')
      params.push(options.projectId)
    }
    const ids = (
      this.db
        .prepare(
          `SELECT id FROM change_history_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
        )
        .all(...params) as { id: string }[]
    ).map((row) => row.id)
    this.forget(ids)
    this.db
      .prepare(
        'DELETE FROM change_history_rows WHERE at < ? AND entry_id NOT IN (SELECT id FROM change_history_entries)'
      )
      .run(this.now() - ORPHAN_ROWS_MS)
    if (ids.length > 0) this.options.changed()
    return ids.length
  }

  /** Housekeeping: forgets steps older than `keepDays`. */
  prune(): number {
    const days = Math.max(1, Math.floor(this.options.keepDays()))
    return this.clear({ olderThan: this.now() - days * DAY_MS })
  }

  private forget(ids: string[]): void {
    if (ids.length === 0) return
    const rows = this.db.prepare('DELETE FROM change_history_rows WHERE entry_id = ?')
    const entries = this.db.prepare('DELETE FROM change_history_entries WHERE id = ?')
    this.db.transaction(() => {
      for (const id of ids) {
        rows.run(id)
        entries.run(id)
      }
    })()
  }

  // ─── Entries ──────────────────────────────────────────────────────────────

  private entryRow(id: string): EntryRow | null {
    return (
      (this.db.prepare('SELECT * FROM change_history_entries WHERE id = ?').get(id) as
        EntryRow | undefined) ?? null
    )
  }

  private rowsOf(entryId: string): ChangeRow[] {
    return this.db
      .prepare('SELECT * FROM change_history_rows WHERE entry_id = ? ORDER BY id')
      .all(entryId) as ChangeRow[]
  }

  private storedSubjects(row: EntryRow): StoredSubjects {
    try {
      const value = JSON.parse(row.subjects) as StoredSubjects
      return { subjects: value.subjects ?? [], count: value.count ?? value.subjects?.length ?? 0 }
    } catch {
      return { subjects: [], count: 0 }
    }
  }

  /** The undo still in force that took this step out, if any. */
  private undoneBy(entryId: string, depth = 0): string | null {
    if (depth > 50) return null
    const undos = this.db
      .prepare(
        'SELECT id FROM change_history_entries WHERE undoes_id = ? ORDER BY at DESC, rowid DESC'
      )
      .all(entryId) as { id: string }[]
    for (const undo of undos) if (!this.undoneBy(undo.id, depth + 1)) return undo.id
    return null
  }

  /** A change, an undo of a change (or of a redo), or a redo (an undo of an undo). */
  private kindOf(row: EntryRow, depth = 0): ChangeEntryKind {
    if (!row.undoes_id || depth > 50) return 'change'
    const target = this.entryRow(row.undoes_id)
    if (!target) return 'undo'
    return this.kindOf(target, depth + 1) === 'undo' ? 'redo' : 'undo'
  }

  /** The change at the start of an undo chain, whose subjects the chain is told by. */
  private rootOf(row: EntryRow): EntryRow {
    let current = row
    for (let depth = 0; current.undoes_id && depth < 50; depth++) {
      const target = this.entryRow(current.undoes_id)
      if (!target) break
      current = target
    }
    return current
  }

  private toEntry(row: EntryRow): ChangeHistoryEntry {
    const told = this.storedSubjects(this.rootOf(row))
    const own = told.count > 0 ? told : this.storedSubjects(row)
    return {
      id: row.id,
      at: row.at,
      lastAt: row.last_at,
      kind: this.kindOf(row),
      projectId: row.project_id,
      subjects: own.subjects,
      subjectCount: own.count,
      undoesId: row.undoes_id,
      undoneById: this.undoneBy(row.id)
    }
  }
}
