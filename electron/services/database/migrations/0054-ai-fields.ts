import type { Migration } from './types'

/**
 * N8.4, AI fields (N58): a Text or Choice field may carry an instruction for
 * Nexus AI (up to 500 characters; null is an ordinary field), and a
 * fill-automatically flag that decision N58's choice A leaves unused (the
 * column stays, always 0). Each value records who filled it, `person` or
 * `nexus-ai`, and for Nexus AI's a short hash of the task text it was filled
 * from, so a value can say it may be out of date. Existing values are the
 * person's.
 */
export const aiFields: Migration = {
  version: 54,
  name: 'ai-fields',
  up(db) {
    db.exec(`
      ALTER TABLE planning_fields ADD COLUMN ai_instruction TEXT
        CHECK (ai_instruction IS NULL OR (length(trim(ai_instruction)) > 0 AND length(ai_instruction) <= 500));
      ALTER TABLE planning_fields ADD COLUMN ai_auto_fill INTEGER NOT NULL DEFAULT 0
        CHECK (ai_auto_fill IN (0, 1));
      ALTER TABLE planning_field_values ADD COLUMN filled_by TEXT NOT NULL DEFAULT 'person'
        CHECK (filled_by IN ('person', 'nexus-ai'));
      ALTER TABLE planning_field_values ADD COLUMN source_hash TEXT;
    `)
  }
}
