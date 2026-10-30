import type Database from 'better-sqlite3'
import type { ImportBatch, ImportSource } from '@shared/ostler-api'

interface ImportBatchRow {
  id: string
  project_id: string
  source: ImportSource
  file_name: string
  created_at: number
  item_count: number
  undone_at: number | null
}

function toBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    fileName: row.file_name,
    createdAt: row.created_at,
    itemCount: row.item_count,
    undoneAt: row.undone_at
  }
}

/**
 * The `import_batches` table (P6.1). Plain reads and writes; the rules are
 * `ImportService`'s. A batch is written in the same transaction as its
 * tasks, which carry its id in `planning_work_items.import_batch_id`.
 */
export class ImportBatchRepository {
  constructor(private readonly db: Database.Database) {}

  insert(batch: ImportBatch): void {
    this.db
      .prepare(
        `INSERT INTO import_batches (id, project_id, source, file_name, created_at, item_count, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        batch.id,
        batch.projectId,
        batch.source,
        batch.fileName,
        batch.createdAt,
        batch.itemCount,
        batch.undoneAt
      )
  }

  /** Closes the batch once its tasks are written: their count, and the moment it finished. */
  finish(id: string, itemCount: number, at: number): void {
    this.db
      .prepare('UPDATE import_batches SET item_count = ?, created_at = ? WHERE id = ?')
      .run(itemCount, at, id)
  }

  get(id: string): ImportBatch | null {
    const row = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as
      ImportBatchRow | undefined
    return row ? toBatch(row) : null
  }

  /** Newest first; only the projects given. */
  list(projectIds: string[]): ImportBatch[] {
    if (projectIds.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM import_batches WHERE project_id IN (${projectIds.map(() => '?').join(', ')})
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(...projectIds) as ImportBatchRow[]
    return rows.map(toBatch)
  }

  setUndoneAt(id: string, at: number | null): void {
    this.db.prepare('UPDATE import_batches SET undone_at = ? WHERE id = ?').run(at, id)
  }
}
