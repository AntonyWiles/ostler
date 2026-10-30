import type { Migration } from './types'

/**
 * Shared away days (team-leaders plan, D6). `shared_away` holds only the dates a person is away,
 * for the people of one shared project (never the day-off name); it is synced. `away_sharing`
 * is the person's own choice of which projects see their away days; it is personal, so the
 * choice follows them to their other devices.
 */
export const sharedAway: Migration = {
  version: 88,
  name: 'shared-away',
  up(db) {
    db.exec(`
      CREATE TABLE shared_away (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        first_date TEXT NOT NULL,
        last_date TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_shared_away_project_person ON shared_away (project_id, person_id);
      CREATE TABLE away_sharing (
        project_id TEXT PRIMARY KEY,
        shared_at INTEGER NOT NULL
      );
    `)
  }
}
