import type { Migration } from './types'

/**
 * N5.2b, countdowns (N37): a pin of a milestone with a target date or a task
 * with a due date can show as a countdown on Home, in the tray menu and in
 * the jump list. `countdown` is 1 while it does. At most three items count
 * down at once; the pin service keeps that limit, not the schema.
 */
export const pinCountdowns: Migration = {
  version: 49,
  name: 'pin-countdowns',
  up(db) {
    db.exec(`
      ALTER TABLE pins ADD COLUMN countdown INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_pins_countdown ON pins(countdown) WHERE countdown = 1;
    `)
  }
}
