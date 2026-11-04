import type { Migration } from './types'

/** Removes the task flag `owner_only` that migration 92 added; nothing reads or writes it. */
export const dropOwnerOnly: Migration = {
  version: 93,
  name: 'drop-owner-only',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(planning_work_items)').all() as { name: string }[]
    if (columns.some((column) => column.name === 'owner_only'))
      db.exec('ALTER TABLE planning_work_items DROP COLUMN owner_only')
  }
}
