/**
 * The tables a shared project sends to the others (docs/plans/integrations/shared-folder-sync.md,
 * "What is shared"). Left out for now: the `projects` row (it holds this PC's
 * folder path). The personal tables (D13, D14) travel in the personal share
 * instead, listed in `PERSONAL_TABLES` below.
 */

/** How a shared table's row finds its project. */
export type ProjectLink = { column: string } | { via: { column: string; table: string } }

export interface SyncedTable {
  project: ProjectLink
  /** The columns that identify a row, for a table with no primary key. */
  keyColumns?: readonly string[]
  /** Rows that are not shared, as an SQL test on `ROW.` (as in change-history/tables.ts). */
  skipRow?: string
}

const P: ProjectLink = { column: 'project_id' }

export const SYNCED_TABLES: Readonly<Record<string, SyncedTable>> = {
  planning_work_items: { project: P },
  // Only the dates a person is away, shared by them (D6); never the day-off name.
  shared_away: { project: P },
  planning_milestones: { project: P },
  planning_goals: { project: P },
  planning_decisions: { project: P },
  // Sign-off requests on tasks, decisions and milestones; only the approver answers (D9).
  planning_sign_offs: { project: P },
  planning_iterations: { project: P },
  planning_labels: { project: P },
  planning_fields: { project: P },
  planning_task_types: { project: P },
  planning_subprojects: { project: P },
  planning_task_templates: { project: P },
  planning_rules: { project: P },
  planning_column_settings: { project: P },
  planning_wip_limits: { project: P },
  planning_comments: { project: P },
  planning_checklist_checks: { project: P },
  planning_checklist_details: { project: P },
  planning_recurrences: { project: P },
  planning_task_links: { project: P },
  planning_time_entries: { project: P },
  planning_time_blocks: { project: P },
  planning_field_values: { project: P, keyColumns: ['work_item_id', 'field_id'] },
  planning_dependencies: {
    project: { via: { column: 'work_item_id', table: 'planning_work_items' } }
  },
  planning_blockers: { project: { via: { column: 'work_item_id', table: 'planning_work_items' } } },
  goal_check_ins: { project: P },
  library_items: { project: P },
  library_item_revisions: { project: P },
  library_work_item_sources: { project: P },
  library_work_item_attachments: { project: P },
  whiteboard_objects: { project: P },
  project_budgets: { project: P },
  costs: { project: P },
  billings: { project: P },
  status_updates: { project: P },
  saved_views: { project: P, skipRow: 'ROW.is_default = 1' },
  planning_baselines: { project: P },
  planning_baseline_entries: { project: P }
}

/**
 * The project id the personal share uses in the sync tables (`sync_outbox`,
 * `sync_field_stamps`). No project can have it: project ids are generated.
 */
export const PERSONAL_PROJECT_ID = '~personal'

/**
 * A personal table (docs/plans/people-and-devices/overview.md, D14) and how its rows travel
 * in the personal share.
 */
export interface PersonalTable {
  /** The columns that identify a row, for a table with no primary key. */
  keyColumns?: readonly string[]
  /** Rows that do not travel, as an SQL test on `ROW.` (as in `SyncedTable.skipRow`). */
  skipRow?: string
  /**
   * Columns that do not travel, because each PC keeps its own value: a per-PC flag or a
   * mirror's bookkeeping. Each must be nullable or have a default, since the other PC's row
   * is inserted without it.
   */
  omitColumns?: readonly string[]
  /**
   * Columns sealed per PC with `sealSecret`. They travel opened (as plain text inside the
   * encrypted change file) and are sealed again on arrival, so a token works on every PC.
   */
  sealed?: readonly string[]
}

/** Why each table has the entry it has (the decisions are in the people-and-devices report). */
export const PERSONAL_TABLES: Readonly<Record<string, PersonalTable>> = {
  my_day_entries: {},
  pins: {},
  reminders: {},
  inbox_state: {},
  personal_goals: {},
  personal_goal_check_ins: {},
  personal_goal_links: {},
  weekly_reviews: {},
  weekly_review_reminders: {},
  // The source file is a path on the PC that imported it.
  days_off: { omitColumns: ['source_file'] },
  // The projects this person shares their away days with, so the choice follows them.
  away_sharing: {},
  // Teams are the person's own organiser (D1): they follow their own devices, never a project share.
  teams: {},
  team_members: {},
  // Who follows which task is personal (D8): it follows the person's own devices only.
  task_follows: {},
  // A file calendar's path is on one PC; account and link calendars travel. The read
  // counters and fetch bookkeeping belong to the PC that fetches.
  outside_calendars: {
    skipRow: "ROW.kind = 'file'",
    omitColumns: [
      'path',
      'read_count',
      'skipped_count',
      'shown_once_count',
      'etag',
      'last_modified',
      'fetched_at',
      'failed_at',
      'failure'
    ],
    sealed: ['link_secret']
  },
  contacts: {},
  task_contacts: {},
  // Each PC keeps exactly one Me: a Me row never travels, and `is_me` is never sent. Only the
  // address book travels: a project's own people stay with it (migration 78), and `project_id`
  // is never sent, so a PC from before them takes the row as it always did.
  people: {
    skipRow: 'ROW.is_me = 1 OR ROW.project_id IS NOT NULL',
    omitColumns: ['is_me', 'project_id']
  },
  shopping_items: {},
  item_links: {},
  connected_accounts: { sealed: ['secret'] },
  account_apps: { sealed: ['client_secret'] },
  calendar_write_target: { omitColumns: ['synced_at', 'failed_at', 'failure'] },
  task_list_target: { omitColumns: ['synced_at', 'failed_at', 'failure'] }
}
