import type { Migration } from './types'

/**
 * R5.3, run history (D43): one row per agent run, embedded or external.
 *
 * A run is a harness session. Its row is written when the run ends, on every
 * exit path, and updated when a person reviews its work, so `outcome` moves
 * from in_review to the verdict while `ended_as` keeps how the run itself
 * ended. Tokens are in and out; `usage_reported` marks tokens an external
 * agent reported itself. Rows outlive the harness state file, which keeps
 * only what the queue needs, and the project removal service clears them
 * with the project.
 */
export const agentRuns: Migration = {
  version: 15,
  name: 'agent-runs',
  up(db) {
    db.exec(`
      CREATE TABLE agent_runs (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        provenance TEXT NOT NULL,
        model TEXT,
        effort TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        ended_as TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        stalls INTEGER NOT NULL DEFAULT 0,
        nudges INTEGER NOT NULL DEFAULT 0,
        guidance INTEGER NOT NULL DEFAULT 0,
        commits INTEGER,
        files_changed INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        usage_reported INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_agent_runs_project ON agent_runs(project_id, started_at);
    `)
  }
}
