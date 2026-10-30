import type { Migration } from './types'

/**
 * R2.1, manual order (D31): every task gets an order key, a string that sorts
 * between its neighbours, so the Board's Manual order is one the person sets
 * and a move writes one row.
 *
 * Each project's tasks are keyed in the order the Board showed them before
 * this version (most recently updated first), so nothing moves on screen
 * after the update. Subtasks share the same keys: their order among siblings
 * is the order of their keys.
 *
 * The keys are written here, not by `spacedOrderKeys`, so a later change to
 * that function cannot change what this migration did.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function spacedKeys(count: number): string[] {
  let width = 1
  while (DIGITS.length ** width < count + 1) width++
  width += 1
  const step = Math.floor(DIGITS.length ** width / (count + 1))
  const keys: string[] = []
  for (let i = 1; i <= count; i++) {
    let value = i * step
    let key = ''
    for (let place = 0; place < width; place++) {
      key = DIGITS[value % DIGITS.length] + key
      value = Math.floor(value / DIGITS.length)
    }
    keys.push(key.replace(/0+$/, '') || DIGITS[1])
  }
  return keys
}

export const manualOrder: Migration = {
  version: 10,
  name: 'manual-order',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN order_key TEXT NOT NULL DEFAULT '';
      CREATE INDEX idx_planning_work_items_project_order
        ON planning_work_items(project_id, order_key);
    `)
    const projects = db.prepare('SELECT DISTINCT project_id FROM planning_work_items').all() as {
      project_id: string
    }[]
    const ids = db.prepare(
      'SELECT id FROM planning_work_items WHERE project_id = ? ORDER BY updated_at DESC, rowid DESC'
    )
    const write = db.prepare('UPDATE planning_work_items SET order_key = ? WHERE id = ?')
    for (const { project_id: projectId } of projects) {
      const rows = ids.all(projectId) as { id: string }[]
      const keys = spacedKeys(rows.length)
      rows.forEach((row, index) => write.run(keys[index], row.id))
    }
  }
}
