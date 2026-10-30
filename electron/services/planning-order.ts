import type Database from 'better-sqlite3'
import { MAX_ORDER_KEY_LENGTH, orderKeyBetween, spacedOrderKeys } from '@shared/planning/order-key'
import type { PlanningWorkItemStatus } from '@shared/ostler-api'

/**
 * Where a task goes in its project's manual order (D31). The key itself is
 * internal: a task is only ever placed before or after another one, or at the
 * start or end of a status.
 */
export type OrderPlacement =
  | { beforeId: string }
  | { afterId: string }
  | { position: 'start' | 'end'; status: PlanningWorkItemStatus }

/**
 * The project's manual order: one key per task in `planning_work_items.order_key`.
 * One order serves every view. The Board's columns, the List and a task's
 * subtasks each show their tasks in key order, so a key that sits between two
 * tasks of the whole project also sits between them in any column or among
 * any siblings. A move therefore writes one row; only a key grown longer than
 * `MAX_ORDER_KEY_LENGTH` respaces the project's keys.
 */
export class PlanningOrder {
  constructor(private readonly db: Database.Database) {}

  /** The key of a task made now: after every other task of the project. */
  nextKey(projectId: string): string {
    const key = orderKeyBetween(this.lastKey(projectId, []), null)
    if (key.length <= MAX_ORDER_KEY_LENGTH) return key
    this.respace(projectId)
    return orderKeyBetween(this.lastKey(projectId, []), null)
  }

  /**
   * Puts `ids` at the end of the project, in this order: a plan or a project
   * file made its tasks parents and dependencies first, and this restores the
   * order they were listed in.
   */
  appendInOrder(projectId: string, ids: string[]): string[] {
    if (ids.length === 0) return []
    let key = this.lastKey(projectId, ids)
    const write = this.db.prepare('UPDATE planning_work_items SET order_key = ? WHERE id = ?')
    return ids.map((id) => {
      key = orderKeyBetween(key, null)
      write.run(key, id)
      return key
    })
  }

  /**
   * The key that puts `itemId` at `placement`, written to its row; or the
   * key it already has when there is nowhere to go (an empty status).
   */
  place(projectId: string, itemId: string, placement: OrderPlacement): string {
    let key = this.keyFor(projectId, itemId, placement)
    if (key !== null && key.length > MAX_ORDER_KEY_LENGTH) {
      this.respace(projectId)
      key = this.keyFor(projectId, itemId, placement)
    }
    if (key === null) return this.keyOf(itemId)
    this.db.prepare('UPDATE planning_work_items SET order_key = ? WHERE id = ?').run(key, itemId)
    return key
  }

  /** Spaces every key of the project out again, keeping the order. */
  respace(projectId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM planning_work_items WHERE project_id = ? ORDER BY order_key, id')
      .all(projectId) as { id: string }[]
    const keys = spacedOrderKeys(rows.length)
    const write = this.db.prepare('UPDATE planning_work_items SET order_key = ? WHERE id = ?')
    rows.forEach((row, index) => write.run(keys[index], row.id))
  }

  private keyFor(projectId: string, itemId: string, placement: OrderPlacement): string | null {
    if ('beforeId' in placement) {
      const anchor = this.keyOf(placement.beforeId)
      return orderKeyBetween(this.neighbour(projectId, itemId, anchor, 'before'), anchor)
    }
    if ('afterId' in placement) {
      const anchor = this.keyOf(placement.afterId)
      return orderKeyBetween(anchor, this.neighbour(projectId, itemId, anchor, 'after'))
    }
    const edge = this.db
      .prepare(
        `SELECT id FROM planning_work_items
         WHERE project_id = ? AND status = ? AND id != ? AND archived_at IS NULL AND deleted_at IS NULL
         ORDER BY order_key ${placement.position === 'start' ? 'ASC' : 'DESC'}, id LIMIT 1`
      )
      .get(projectId, placement.status, itemId) as { id: string } | undefined
    if (!edge) return null
    return this.keyFor(
      projectId,
      itemId,
      placement.position === 'start' ? { beforeId: edge.id } : { afterId: edge.id }
    )
  }

  /** The nearest other key before or after `anchor` in the whole project, or null at an end. */
  private neighbour(
    projectId: string,
    itemId: string,
    anchor: string,
    side: 'before' | 'after'
  ): string | null {
    const row = this.db
      .prepare(
        side === 'before'
          ? 'SELECT MAX(order_key) AS key FROM planning_work_items WHERE project_id = ? AND id != ? AND order_key < ?'
          : 'SELECT MIN(order_key) AS key FROM planning_work_items WHERE project_id = ? AND id != ? AND order_key > ?'
      )
      .get(projectId, itemId, anchor) as { key: string | null }
    return row.key || null
  }

  private lastKey(projectId: string, excluding: string[]): string | null {
    const marks = excluding.map(() => '?').join(', ')
    const row = this.db
      .prepare(
        `SELECT MAX(order_key) AS key FROM planning_work_items WHERE project_id = ?${
          excluding.length > 0 ? ` AND id NOT IN (${marks})` : ''
        }`
      )
      .get(projectId, ...excluding) as { key: string | null }
    return row.key || null
  }

  private keyOf(itemId: string): string {
    const row = this.db
      .prepare('SELECT order_key FROM planning_work_items WHERE id = ?')
      .get(itemId) as { order_key: string } | undefined
    return row?.order_key ?? ''
  }
}
