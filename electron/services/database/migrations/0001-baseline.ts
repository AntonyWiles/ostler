import type Database from 'better-sqlite3'
import type { Migration } from './types'

/**
 * The schema as it stood before the runner existed, moved here unchanged from
 * `EventDatabase`, `PlanningService` and `LibraryRepository`. Every statement
 * is idempotent, so a database written by any earlier build and a brand-new
 * file both end up with the same tables, columns and indexes.
 */
export const baseline: Migration = {
  version: 1,
  name: 'baseline',
  up(db) {
    createEventTables(db)
    createPlanningTables(db)
    createLibraryTables(db)
  }
}

function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(({ name }) => name)
  )
}

function createEventTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      color TEXT,
      enabled INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      added_at INTEGER NOT NULL,
      last_activity INTEGER
    );

    CREATE TABLE IF NOT EXISTS watch_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      extension TEXT DEFAULT '',
      size_bytes INTEGER,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      hash TEXT NOT NULL,
      abbreviated_hash TEXT DEFAULT '',
      author TEXT DEFAULT '',
      message TEXT DEFAULT '',
      body TEXT DEFAULT '',
      date TEXT DEFAULT '',
      files_changed INTEGER DEFAULT 0,
      insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      branch TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS harness_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      agent_session_id TEXT DEFAULT '',
      agent_title TEXT DEFAULT '',
      details TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      project_id TEXT,
      title TEXT DEFAULT 'New conversation',
      messages TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS session_transcripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      entries TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_knowledge (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      extension TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'needs-review',
      feedback TEXT NOT NULL DEFAULT '',
      UNIQUE(project_id, relative_path)
    );
    CREATE INDEX IF NOT EXISTS idx_project_knowledge_project ON project_knowledge(project_id, relative_path);

    CREATE TABLE IF NOT EXISTS project_knowledge_ignores (
      project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      ignored_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, relative_path)
    );

    CREATE TABLE IF NOT EXISTS project_knowledge_folders (
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, path)
    );

    CREATE TABLE IF NOT EXISTS agent_conversation_sources (
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      last_imported_at INTEGER,
      PRIMARY KEY(project_id, path)
    );

    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_file TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      UNIQUE(project_id, source_file)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_conversations_project ON agent_conversations(project_id, modified_at DESC);

    CREATE TABLE IF NOT EXISTS agent_conversation_reports (
      project_id TEXT PRIMARY KEY,
      report TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_conversation_report_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      report TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_conversation_report_history_project
      ON agent_conversation_report_history(project_id, generated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_conversation_report_annotations (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      annotation TEXT NOT NULL,
      ai_response TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_conversation_report_annotations_report
      ON agent_conversation_report_annotations(report_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_watch_events_project_time ON watch_events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_watch_events_category ON watch_events(category, timestamp);
    CREATE INDEX IF NOT EXISTS idx_git_events_project_time ON git_events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_harness_events_project ON harness_events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_time ON ai_conversations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_session_transcripts_project_session ON session_transcripts(project_id, session_id, received_at);
  `)
  // Existing installations predate commit bodies and allowed duplicate observations
  // across application restarts. Keep the newest record before enforcing identity.
  if (!columnNames(db, 'git_events').has('body')) {
    db.exec("ALTER TABLE git_events ADD COLUMN body TEXT DEFAULT ''")
  }
  db.exec(`
    DELETE FROM git_events
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM git_events GROUP BY project_id, hash
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_git_events_project_hash ON git_events(project_id, hash);
  `)
}

/** Columns added to `planning_work_items` after its first release, oldest first. */
const PLANNING_WORK_ITEM_ADDED_COLUMNS: Record<string, string> = {
  auto_queue: 'INTEGER NOT NULL DEFAULT 0',
  rating: 'INTEGER NOT NULL DEFAULT 0',
  rating_note: "TEXT NOT NULL DEFAULT ''",
  parent_work_item_id: 'TEXT',
  task_code: "TEXT NOT NULL DEFAULT ''",
  phase_code: "TEXT NOT NULL DEFAULT ''",
  phase_name: "TEXT NOT NULL DEFAULT ''",
  subtask_phase_number: 'INTEGER',
  subtask_phase_name: "TEXT NOT NULL DEFAULT ''",
  verification_status: "TEXT NOT NULL DEFAULT 'unverified'",
  verified_by: 'TEXT',
  verified_at: 'INTEGER',
  verification_notes: "TEXT NOT NULL DEFAULT ''",
  archived_at: 'INTEGER',
  deleted_at: 'INTEGER'
}

function createPlanningTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_goals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS planning_milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      goal_id TEXT,
      name TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      target_date TEXT,
      success_criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES planning_goals(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS planning_work_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      milestone_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      labels TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      target_date TEXT,
      origin TEXT NOT NULL,
      linked_harness_task_id TEXT,
      auto_queue INTEGER NOT NULL DEFAULT 0,
      rating INTEGER NOT NULL DEFAULT 0,
      rating_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (milestone_id) REFERENCES planning_milestones(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS planning_dependencies (
      work_item_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      PRIMARY KEY (work_item_id, depends_on_id),
      CHECK (work_item_id <> depends_on_id),
      FOREIGN KEY (work_item_id) REFERENCES planning_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_id) REFERENCES planning_work_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planning_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL,
      alternatives_considered TEXT NOT NULL DEFAULT '',
      consequences TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      linked_work_item_ids TEXT NOT NULL DEFAULT '[]',
      origin TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS planning_wip_limits (
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      limit_value INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, status)
    );

    CREATE TABLE IF NOT EXISTS planning_board_presets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      criteria TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS planning_status_history (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      at INTEGER NOT NULL,
      FOREIGN KEY (work_item_id) REFERENCES planning_work_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS planning_blockers (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      reported_by TEXT NOT NULL,
      reported_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      resolution_options TEXT NOT NULL DEFAULT '[]',
      resolution_choice TEXT,
      resolution_note TEXT NOT NULL DEFAULT '',
      resolved_at INTEGER,
      resolved_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_planning_blockers_work_item
      ON planning_blockers(work_item_id, status);

    CREATE INDEX IF NOT EXISTS idx_planning_goals_project
      ON planning_goals(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_planning_milestones_project
      ON planning_milestones(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_planning_work_items_project
      ON planning_work_items(project_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_planning_decisions_project
      ON planning_decisions(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_planning_board_presets_project
      ON planning_board_presets(project_id, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_harness_task_link
      ON planning_work_items(linked_harness_task_id)
      WHERE linked_harness_task_id IS NOT NULL;
  `)
  const existingColumns = columnNames(db, 'planning_work_items')
  for (const [name, definition] of Object.entries(PLANNING_WORK_ITEM_ADDED_COLUMNS)) {
    if (!existingColumns.has(name)) {
      db.exec(`ALTER TABLE planning_work_items ADD COLUMN ${name} ${definition}`)
    }
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_planning_work_items_parent ON planning_work_items(parent_work_item_id)'
  )
}

/**
 * The link tables reference `planning_work_items`, so this runs after the
 * planning tables. `library_search` needs SQLite's FTS5 module; without it the
 * table is simply absent and `LibraryRepository` falls back to LIKE search.
 */
function createLibraryTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      url TEXT,
      file_json TEXT,
      sha256 TEXT,
      ai_access TEXT NOT NULL,
      is_primary_brief INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_library_items_project
      ON library_items(project_id, archived_at);
    CREATE INDEX IF NOT EXISTS idx_library_items_sha256
      ON library_items(project_id, sha256);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_library_items_primary_brief
      ON library_items(project_id) WHERE is_primary_brief = 1;

    CREATE TABLE IF NOT EXISTS library_item_revisions (
      item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (item_id, revision)
    );

    CREATE TABLE IF NOT EXISTS library_work_item_sources (
      library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (library_item_id, work_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_sources_work_item
      ON library_work_item_sources(work_item_id);

    CREATE TABLE IF NOT EXISTS library_work_item_attachments (
      library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      attached_by TEXT NOT NULL CHECK (attached_by IN ('human', 'nexus-ai', 'automation')),
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (library_item_id, work_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_library_attachments_work_item
      ON library_work_item_attachments(work_item_id);
  `)

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(
        item_id UNINDEXED,
        project_id UNINDEXED,
        title,
        summary,
        body,
        tags,
        extracted_text
      );
    `)
  } catch (error) {
    console.warn('Library full-text search unavailable; falling back to LIKE search:', error)
  }
}
