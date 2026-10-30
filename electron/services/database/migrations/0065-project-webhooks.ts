import type { Migration } from './types'

/**
 * Telling the team (docs/plans/integrations/overview.md, phase 4): a
 * project's webhooks to Teams, Slack, Discord or any https endpoint. The
 * address is sealed with Windows' protection (`url_secret`); `url_shown` is
 * its host and end. Removing a project deletes its rows (it has `project_id`).
 * Not shared through a synced folder: the sealed address opens on this PC only.
 */
export const projectWebhooks: Migration = {
  version: 65,
  name: 'project-webhooks',
  up(db) {
    db.exec(`
      CREATE TABLE project_webhooks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('teams', 'slack', 'discord', 'generic')),
        name TEXT NOT NULL,
        url_secret TEXT NOT NULL,
        url_shown TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_sent_at INTEGER,
        failed_at INTEGER,
        failure TEXT
      );
      CREATE INDEX idx_project_webhooks_project ON project_webhooks (project_id);
    `)
  }
}
