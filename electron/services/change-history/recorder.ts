import type Database from 'better-sqlite3'
import { openChangeContext } from './context'
import { BOOKKEEPING_COLUMNS, TRACKED_TABLES } from './tables'
import { attachSyncCapture } from '../sync/capture'
import { NOW_MS, quote, rowKey, tableShape, type TableShape } from './table-shape'

export { NOW_MS, quote, rowKey, tableShape, type TableShape }

/** `json_object('a', P."a", …)`: a row's image, as the triggers and undo both write it. */
export function rowImage(columns: readonly string[], prefix: string): string {
  return `json_object(${columns.map((column) => `'${column}', ${prefix}${quote(column)}`).join(', ')})`
}

const attached = new WeakSet<Database.Database>()

/**
 * Records the person's changes made through this connection (undo history).
 *
 * The triggers are TEMP: they belong to this connection alone and are made
 * again each time it opens, from the tables as they are, so they follow
 * every migration and are never part of the schema. They call two functions
 * registered here, which read the step the running IPC call belongs to
 * (`context.ts`); outside a step they record nothing. A connection that
 * never attaches (tests, backups, removal) records nothing either, and can
 * never fail for want of the functions.
 */
export function attachChangeRecorder(db: Database.Database): void {
  attachSyncCapture(db)
  if (attached.has(db)) return
  const hasHistory = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'change_history_rows'")
    .get()
  if (!hasHistory) return
  attached.add(db)

  db.function('ostler_change_active', { deterministic: false }, () => (openChangeContext() ? 1 : 0))
  db.function('ostler_change_entry', { deterministic: false }, () => {
    const context = openChangeContext()
    if (!context) return null
    context.touched = true
    return context.entryId
  })

  for (const table of Object.keys(TRACKED_TABLES)) {
    const shape = tableShape(db, table)
    if (!shape) continue
    db.exec(triggersFor(shape, TRACKED_TABLES[table].skipRow))
  }
}

function triggersFor({ table, columns, keyColumns }: TableShape, skipRow?: string): string {
  const keep = (prefix: 'OLD.' | 'NEW.') =>
    skipRow ? ` AND NOT (${skipRow.replace(/\bROW\./g, prefix)})` : ''
  const insert = (op: string, prefix: 'OLD.' | 'NEW.') =>
    `INSERT INTO change_history_rows (entry_id, at, table_name, row_key, op, before_row, after_row)
     VALUES (ostler_change_entry(), ${NOW_MS}, '${table}', ${rowKey(keyColumns, prefix)}, '${op}',
       ${op === 'insert' ? 'NULL' : rowImage(columns, 'OLD.')},
       ${op === 'delete' ? 'NULL' : rowImage(columns, 'NEW.')});`
  const meaningful = columns.filter((column) => !BOOKKEEPING_COLUMNS.has(column))
  const changed = meaningful
    .map((column) => `OLD.${quote(column)} IS NOT NEW.${quote(column)}`)
    .join(' OR ')
  const name = (op: string) => quote(`ostler_change_${table}_${op}`)
  return `
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('insert')} AFTER INSERT ON main.${quote(table)}
    WHEN ostler_change_active()${keep('NEW.')} BEGIN ${insert('insert', 'NEW.')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('update')} AFTER UPDATE ON main.${quote(table)}
    WHEN ostler_change_active() AND (${changed || '0'})${keep('NEW.')} BEGIN ${insert('update', 'NEW.')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('delete')} AFTER DELETE ON main.${quote(table)}
    WHEN ostler_change_active()${keep('OLD.')} BEGIN ${insert('delete', 'OLD.')} END;
  `
}
