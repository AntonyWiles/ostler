import type { Migration } from './types'

/**
 * A pinned comment (`pinned_at`, the time it was pinned): the feed shows pinned comments first.
 * Pinning is not an edit, so `updated_at` is left alone.
 */
export const commentPins: Migration = {
  version: 81,
  name: 'comment-pins',
  up(db) {
    db.exec(`ALTER TABLE planning_comments ADD COLUMN pinned_at INTEGER;`)
  }
}
