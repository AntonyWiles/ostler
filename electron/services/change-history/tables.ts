import type { ChangeAspect, ChangeSubjectKind } from '@shared/ostler-api'

/**
 * The tables undo history records, and what each row is to the person.
 *
 * Only the person's own data is here. Left out on purpose: logs and read
 * models that describe changes rather than hold them (activity, status
 * history, description versions, rule runs, the search and link indexes),
 * counters that must never go back (task numbers), what agents and the
 * harness own, Library items (their files live on disk; a whiteboard's objects
 * are tracked, as changes to the whiteboard), and what is fetched from outside
 * (calendars, GitHub, commit links).
 */
export interface TrackedTable {
  kind: ChangeSubjectKind
  /** The column that identifies the thing; default `id`. */
  idColumn?: string
  /**
   * Rows that are not the person's data although the table is, as an SQL
   * test on `ROW.` (a view's kept settings, saved as it is used).
   */
  skipRow?: string
  /** The column that names it. */
  nameColumn?: string
  /**
   * A part of something else: the step is shown as a change to the parent
   * (a comment changes its task). When the parent column is empty, the row is
   * shown as a thing of its own `kind`.
   */
  parent?: { kind: ChangeSubjectKind; column: string; aspect: ChangeAspect }
}

export const TRACKED_TABLES: Readonly<Record<string, TrackedTable>> = {
  planning_work_items: { kind: 'task', nameColumn: 'title' },
  planning_milestones: { kind: 'milestone', nameColumn: 'name' },
  planning_goals: { kind: 'goal', nameColumn: 'title' },
  planning_decisions: { kind: 'decision', nameColumn: 'title' },
  planning_sign_offs: { kind: 'signOff' },
  planning_iterations: { kind: 'iteration', nameColumn: 'name' },
  planning_labels: { kind: 'label', idColumn: 'name', nameColumn: 'name' },
  planning_fields: { kind: 'field', nameColumn: 'name' },
  planning_task_types: { kind: 'taskType', nameColumn: 'name' },
  planning_subprojects: { kind: 'subproject', nameColumn: 'name' },
  planning_task_templates: { kind: 'template', nameColumn: 'name' },
  planning_rules: { kind: 'rule', nameColumn: 'name' },
  // A view's kept default settings follow every filter and sort; only named views are steps.
  saved_views: { kind: 'savedView', nameColumn: 'name', skipRow: 'ROW.is_default = 1' },
  planning_column_settings: { kind: 'column', idColumn: 'status', nameColumn: 'name' },
  planning_wip_limits: { kind: 'column', idColumn: 'status' },
  people: { kind: 'person', nameColumn: 'name' },
  contacts: { kind: 'contact', nameColumn: 'name' },
  costs: { kind: 'cost', nameColumn: 'description' },
  billings: { kind: 'billing' },
  project_budgets: { kind: 'budget', idColumn: 'project_id' },
  // `shared_away` (a mirror of days_off, rewritten by reconcile) and `away_sharing` are not steps.
  days_off: { kind: 'dayOff', nameColumn: 'name' },
  teams: { kind: 'team', nameColumn: 'name' },
  pins: { kind: 'pin' },
  task_follows: { kind: 'task', parent: task('work_item_id', 'following') },
  shopping_items: { kind: 'shoppingItem', nameColumn: 'name' },
  status_updates: { kind: 'statusUpdate', nameColumn: 'note' },
  personal_goals: { kind: 'personalGoal', nameColumn: 'title' },
  weekly_reviews: { kind: 'weeklyReview' },
  planning_baselines: { kind: 'baseline', nameColumn: 'name' },

  planning_comments: { kind: 'task', parent: task('work_item_id', 'comments') },
  planning_checklist_checks: { kind: 'task', parent: task('work_item_id', 'checklist') },
  planning_checklist_details: { kind: 'task', parent: task('work_item_id', 'checklist') },
  planning_dependencies: { kind: 'task', parent: task('work_item_id', 'dependencies') },
  planning_field_values: { kind: 'task', parent: task('work_item_id', 'customFields') },
  planning_recurrences: { kind: 'task', parent: task('work_item_id', 'repeat') },
  planning_blockers: { kind: 'task', parent: task('work_item_id', 'blockers') },
  planning_task_links: { kind: 'task', parent: task('from_work_item_id', 'links') },
  task_contacts: { kind: 'task', parent: task('work_item_id', 'contacts') },
  library_work_item_attachments: { kind: 'task', parent: task('work_item_id', 'attachments') },
  library_work_item_sources: { kind: 'task', parent: task('work_item_id', 'sources') },
  my_day_entries: { kind: 'task', parent: task('work_item_id', 'myDay') },
  reminders: { kind: 'reminder', parent: task('work_item_id', 'reminders') },
  planning_time_entries: { kind: 'task', parent: task('work_item_id', 'time') },
  planning_time_blocks: { kind: 'task', parent: task('work_item_id', 'timeBlocks') },
  goal_check_ins: { kind: 'goal', parent: { kind: 'goal', column: 'goal_id', aspect: 'checkIns' } },
  personal_goal_check_ins: {
    kind: 'personalGoal',
    parent: { kind: 'personalGoal', column: 'personal_goal_id', aspect: 'checkIns' }
  },
  personal_goal_links: {
    kind: 'personalGoal',
    parent: { kind: 'personalGoal', column: 'personal_goal_id', aspect: 'goalLinks' }
  },
  // A whiteboard's drawing is a change to the whiteboard (the Library item is not tracked itself).
  whiteboard_objects: {
    kind: 'whiteboard',
    parent: { kind: 'whiteboard', column: 'whiteboard_id', aspect: 'objects' }
  },
  team_members: { kind: 'team', parent: { kind: 'team', column: 'team_id', aspect: 'members' } },
  planning_baseline_entries: {
    kind: 'baseline',
    parent: { kind: 'baseline', column: 'baseline_id', aspect: 'baselineDates' }
  }
}

function task(column: string, aspect: ChangeAspect): TrackedTable['parent'] {
  return { kind: 'task', column, aspect }
}

/** Where a parent's name is read from, by kind. */
export const PARENT_NAMES: Partial<Record<ChangeSubjectKind, { table: string; column: string }>> = {
  task: { table: 'planning_work_items', column: 'title' },
  goal: { table: 'planning_goals', column: 'title' },
  personalGoal: { table: 'personal_goals', column: 'title' },
  baseline: { table: 'planning_baselines', column: 'name' },
  whiteboard: { table: 'library_items', column: 'title' },
  team: { table: 'teams', column: 'name' }
}

/** Columns that hold another thing's id, and where that thing's name is read from. */
export const REFERENCE_NAMES: Readonly<Record<string, { table: string; column: string }>> = {
  assignee_id: { table: 'people', column: 'name' },
  milestone_id: { table: 'planning_milestones', column: 'name' },
  goal_id: { table: 'planning_goals', column: 'title' },
  iteration_id: { table: 'planning_iterations', column: 'name' },
  parent_work_item_id: { table: 'planning_work_items', column: 'title' },
  depends_on_id: { table: 'planning_work_items', column: 'title' },
  type_id: { table: 'planning_task_types', column: 'name' },
  subproject_id: { table: 'planning_subprojects', column: 'name' },
  lead_person_id: { table: 'people', column: 'name' }
}

/**
 * Columns that keep time rather than hold anything the person changed. A
 * write that touches only these is not a step, and undo neither compares nor
 * restores them (`updated_at` is set to the time of the undo instead).
 */
export const BOOKKEEPING_COLUMNS: ReadonlySet<string> = new Set([
  'updated_at',
  'heartbeat_at',
  'last_nudged_at',
  'edited_at',
  'fetched_at',
  'last_run_at',
  'run_count',
  'delivered_at',
  'loaded_at'
])

/** Columns whose change from empty to a time (and back) is a removal or an archive. */
export const STATE_COLUMNS = {
  removed: 'deleted_at',
  archived: 'archived_at'
} as const
