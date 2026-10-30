import type { Migration } from './types'

/**
 * Answers to "Is this Bob?" (docs/plans/people-and-devices/overview.md, D12, section 3).
 *
 * When a member's own person has the same name as a person this PC added
 * before they joined, the owner is asked once whether they are the same
 * person. `answer` is 'yes' (the two were merged) or 'no' (never asked again).
 * One row per (share, member's person key, candidate person).
 */
export const personLinkAnswers: Migration = {
  version: 71,
  name: 'person-link-answers',
  up(db) {
    db.exec(`
      CREATE TABLE sync_person_link_answers (
        share_id TEXT NOT NULL,
        person_public_key TEXT NOT NULL,
        candidate_person_id TEXT NOT NULL,
        answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
        answered_at INTEGER NOT NULL,
        PRIMARY KEY (share_id, person_public_key, candidate_person_id)
      );
    `)
  }
}
