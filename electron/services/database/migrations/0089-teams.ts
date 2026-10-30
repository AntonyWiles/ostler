import type { Migration } from './types'

/**
 * Teams (team-leaders plan, D1): named groups of people from the address book, with an optional
 * lead. A team is the person's own organiser: it grants nothing, it is not shared with a
 * project's members, and it travels only between the person's own devices (personal tables).
 */
export const teams: Migration = {
  version: 89,
  name: 'teams',
  up(db) {
    db.exec(`
      CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        lead_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE TABLE team_members (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, person_id)
      );
      CREATE INDEX idx_team_members_person ON team_members (person_id);
    `)
  }
}
