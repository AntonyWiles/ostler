import type { Migration } from './types'

/**
 * Who made a waiting change (docs/plans/people-and-devices/overview.md, D10).
 *
 * A change that waits in sync_pending for its parent is applied later, and its
 * activity line must still name the sender. `actor` is the change's actor as
 * JSON (`{ kind, personId? }`), or NULL for rows written before this migration.
 */
export const pendingActor: Migration = {
  version: 72,
  name: 'pending-actor',
  up(db) {
    db.exec('ALTER TABLE sync_pending ADD COLUMN actor TEXT;')
  }
}
