import type Database from 'better-sqlite3'

/**
 * Helpers that read a table's shape and quote its names. Kept apart from the change recorder so the
 * sync engine's core files can use them without pulling in the undo history or Node-only modules.
 */

/** A tracked table's columns as they are now, and the ones that identify a row. */
export interface TableShape {
  table: string
  columns: string[]
  /** The primary key, or every column for a table that has none. */
  keyColumns: string[]
}

/** Reads a tracked table's shape, or null when this database has no such table. */
export function tableShape(db: Database.Database, table: string): TableShape | null {
  const info = db.prepare(`PRAGMA main.table_info(${quote(table)})`).all() as {
    name: string
    pk: number
  }[]
  if (info.length === 0) return null
  const columns = info.map((column) => column.name)
  const keyed = info
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)
  return { table, columns, keyColumns: keyed.length > 0 ? keyed : columns }
}

export function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function rowKey(keyColumns: readonly string[], prefix: string): string {
  return `json_array(${keyColumns.map((column) => `${prefix}${quote(column)}`).join(', ')})`
}

export const NOW_MS = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)"
