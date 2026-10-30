import type { Migration } from './types'

/**
 * N3.4a, time blocks (N28): an hour in the week put aside for a task.
 *
 * `day` is the person's local date (`YYYY-MM-DD`) and `start_minute` the
 * wall-clock start in minutes after midnight, so a 09:00 block stays at
 * 09:00 across a clock change. `length_minutes` never runs past midnight. A
 * task can have several blocks. Blocks are personal planning: they do not
 * travel in the project file or templates. A binned task hides its blocks
 * (the queries join on `deleted_at`); deleting it for good removes them
 * (the cascade), and removing a project removes them through `project_id`.
 */
export const timeBlocks: Migration = {
  version: 32,
  name: 'time-blocks',
  up(db) {
    db.exec(`
      CREATE TABLE planning_time_blocks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        start_minute INTEGER NOT NULL,
        length_minutes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_time_blocks_day ON planning_time_blocks(day, start_minute);
      CREATE INDEX idx_planning_time_blocks_task ON planning_time_blocks(work_item_id, day);
      CREATE INDEX idx_planning_time_blocks_project ON planning_time_blocks(project_id);
    `)
  }
}
