import type { Migration } from './types'

/**
 * R2.3, time tracking (D33): time entries on tasks.
 *
 * An entry is the task, its project, the person, when it started, how long it
 * lasted, a note, and whether a timer or a person wrote it. A running timer is
 * the one entry whose `duration_seconds` is null; the partial unique index
 * keeps it to one across Ostler. `heartbeat_at` is the last moment Ostler was
 * seen running with that timer, so a restart can stop it at the time Ostler
 * closed. Entries go with their task (cascade), and the project removal
 * service clears them with the project.
 */
export const timeEntries: Migration = {
  version: 12,
  name: 'time-entries',
  up(db) {
    db.exec(`
      CREATE TABLE planning_time_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        person_id TEXT,
        started_at INTEGER NOT NULL,
        duration_seconds INTEGER,
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        heartbeat_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_time_entries_project ON planning_time_entries(project_id, started_at);
      CREATE INDEX idx_planning_time_entries_started ON planning_time_entries(started_at);
      CREATE INDEX idx_planning_time_entries_item ON planning_time_entries(work_item_id);
      CREATE UNIQUE INDEX idx_planning_time_entries_running
        ON planning_time_entries((duration_seconds IS NULL)) WHERE duration_seconds IS NULL;
    `)
  }
}
