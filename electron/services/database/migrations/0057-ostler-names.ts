import type Database from 'better-sqlite3'
import type { Migration } from './types'

const OLD_AI = 'nexus-ai'
const NEW_AI = 'ostler-ai'

/** FTS5 tables and their shadow tables: written only through the FTS table itself. */
function isSearchTable(name: string, sql: string | null): boolean {
  return /CREATE VIRTUAL TABLE/i.test(sql ?? '') || /_(content|data|idx|docsize|config)$/.test(name)
}

/**
 * Rebuilds a table whose CHECK constraints name `nexus-ai`, with the same
 * columns, rows and indexes, so the constraint names `ostler-ai` instead.
 * Neither such table is referenced by another, so dropping it cascades nothing.
 * Rows whose task or item is gone (written while a connection had foreign
 * keys off) are dropped first: nothing can show them, and the copy would
 * refuse them.
 */
function rebuildTable(db: Database.Database, table: string, sql: string): void {
  const orphans = db.prepare(`PRAGMA foreign_key_check(${table})`).all() as {
    rowid: number | null
  }[]
  const dropRow = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`)
  for (const orphan of orphans) if (orphan.rowid !== null) dropRow.run(orphan.rowid)
  const indexes = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`
    )
    .all(table) as { sql: string }[]
  const temp = `${table}__ostler`
  const createSql = sql
    .replaceAll(`'${OLD_AI}'`, `'${NEW_AI}'`)
    .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?("?)\w+\2/i, `CREATE TABLE ${temp}`)
  db.exec(createSql)
  const names = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => `"${column.name}"`
  )
  // The token changes on the way across: the new constraint refuses the old one.
  const values = names.map(
    (name) => `CASE WHEN ${name} = '${OLD_AI}' THEN '${NEW_AI}' ELSE ${name} END`
  )
  db.exec(`INSERT INTO ${temp} (${names.join(', ')}) SELECT ${values.join(', ')} FROM ${table}`)
  db.exec(`DROP TABLE ${table}`)
  db.exec(`ALTER TABLE ${temp} RENAME TO ${table}`)
  for (const index of indexes) db.exec(index.sql)
}

/**
 * The product was renamed from Nexus to Ostler. Nexus AI's stored actor token
 * `nexus-ai` becomes `ostler-ai`: the CHECK constraints that name it (Library
 * attachments, from the baseline, and AI field fills, from migration 54) are
 * rebuilt, and every stored value that is exactly the token, or holds it as a
 * quoted JSON string, is rewritten. What people wrote themselves is left as
 * it is, and the search tables are not touched.
 */
export const ostlerNames: Migration = {
  version: 57,
  name: 'ostler-names',
  up(db) {
    const tables = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string; sql: string | null }[]
    for (const table of tables) {
      if (table.sql?.includes(`'${OLD_AI}'`)) rebuildTable(db, table.name, table.sql)
    }
    for (const table of tables) {
      if (isSearchTable(table.name, table.sql)) continue
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as {
        name: string
        type: string
      }[]
      for (const column of columns) {
        if (column.type && !/TEXT|CHAR|CLOB/i.test(column.type)) continue
        const name = `"${column.name}"`
        db.prepare(`UPDATE ${table.name} SET ${name} = ? WHERE ${name} = ?`).run(NEW_AI, OLD_AI)
        db.prepare(
          `UPDATE ${table.name} SET ${name} = replace(${name}, ?, ?) WHERE instr(${name}, ?) > 0`
        ).run(`"${OLD_AI}"`, `"${NEW_AI}"`, `"${OLD_AI}"`)
      }
    }
  }
}
