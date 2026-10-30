import type { Migration } from './types'

/**
 * Every project on every device (docs/plans/people-and-devices/overview.md, D17). A project this PC
 * joined keeps the invite it joined with, sealed like any secret (`sealSecret`), so the personal
 * share's entry for it can be written again: a device of the same person joins the share with the
 * same invite. A project this PC made has no stored invite; its entry is made from its key. Null
 * for every share from before this migration.
 */
export const everyProjectOnEveryDevice: Migration = {
  version: 77,
  name: 'every-project-on-every-device',
  up(db) {
    db.exec(`ALTER TABLE sync_shares ADD COLUMN joined_invite TEXT;`)
  }
}
