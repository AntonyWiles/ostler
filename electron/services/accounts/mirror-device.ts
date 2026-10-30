import type Database from 'better-sqlite3'
import { thisDeviceId } from '../sync/sync-keys'
import { quote } from '../change-history/recorder'

/**
 * Which device runs a write-back mirror (docs/plans/people-and-devices/overview.md, D18). The
 * target row syncs to every device, but only the device that turned the write-back on runs it:
 * its `device_id` names that device. A row from before `device_id` existed has none; the first
 * device to read it claims it. Returns the row when this device runs it, else null.
 */
export function mirrorTargetHere<T extends { device_id: string | null }>(
  db: Database.Database,
  table: 'calendar_write_target' | 'task_list_target',
  row: T | null
): T | null {
  if (!row) return null
  const me = thisDeviceId(db)
  if (row.device_id === null) {
    db.prepare(`UPDATE ${quote(table)} SET device_id = @me WHERE id = 1 AND device_id IS NULL`).run(
      {
        me
      }
    )
    return { ...row, device_id: me }
  }
  return row.device_id === me ? row : null
}
