import type { Migration } from './types'

/**
 * Undo history: what the person changed, step by step, so any change can be
 * seen, undone or redone later without undoing what came after it.
 *
 * `change_history_rows` holds one row's before and after image per write,
 * filled by the connection-local triggers `change-history/recorder.ts`
 * attaches while an IPC call runs. `change_history_entries` groups them into
 * one step each (one IPC call, or a run of edits to the same thing). An undo
 * is itself an entry (`undoes_id`), so redo is undoing the undo. Rows carry
 * no foreign key: the triggers write them before their entry exists.
 */
export const changeHistory: Migration = {
  version: 58,
  name: 'change-history',
  up(db) {
    db.exec(`
      CREATE TABLE change_history_entries (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        channel TEXT NOT NULL,
        project_id TEXT,
        undoes_id TEXT,
        subjects TEXT NOT NULL
      );
      CREATE INDEX idx_change_history_entries_at ON change_history_entries(at);
      CREATE INDEX idx_change_history_entries_undoes ON change_history_entries(undoes_id);

      CREATE TABLE change_history_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
        before_row TEXT,
        after_row TEXT
      );
      CREATE INDEX idx_change_history_rows_entry ON change_history_rows(entry_id, id);
      CREATE INDEX idx_change_history_rows_at ON change_history_rows(at);
    `)
  }
}
