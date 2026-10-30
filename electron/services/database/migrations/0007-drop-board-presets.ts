import type { Migration } from './types'

/**
 * P5.7: saved views replaced board presets, and migration 6 copied every
 * preset into `saved_views`. Nothing reads the old table any more.
 */
export const dropBoardPresets: Migration = {
  version: 7,
  name: 'drop-board-presets',
  up(db) {
    db.exec('DROP TABLE IF EXISTS planning_board_presets')
  }
}
