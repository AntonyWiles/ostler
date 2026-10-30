import type Database from 'better-sqlite3'
import type { MembershipEvent, ShareRole } from '@shared/ostler-api'
import { parseStamp } from '@shared/sync/clock'

interface MemberRow {
  name: string
  joined_at: number
  me: string | null
  left_at: number | null
  removed_at: number | null
  person_key: string
}

interface RoleFileRow {
  stamp: string
  person_public_key: string | null
  role: ShareRole | null
  previous_role: ShareRole | null
  signed_by: string | null
  applied_at: number | null
}

function meName(me: string | null): string | null {
  if (!me) return null
  try {
    const { name } = JSON.parse(me) as { name?: unknown }
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}

/** When a role file was applied; for rows from before it was recorded, the wall time in its stamp. */
function timeOf(row: RoleFileRow): number | null {
  if (row.applied_at !== null) return row.applied_at
  try {
    return parseStamp(row.stamp).wall
  } catch {
    return null
  }
}

/**
 * Who joined, left, was removed and changed role in a shared project, newest first (team leaders,
 * prompt 02). Built from the member rows and the applied role files this PC already holds, grouped
 * by person; names are resolved here, so no key leaves the main process except as an id.
 */
export function membershipHistory(db: Database.Database, shareId: string): MembershipEvent[] {
  const members = db
    .prepare(
      `SELECT name, joined_at, me, left_at, removed_at, COALESCE(person_public_key, public_key) AS person_key
       FROM sync_members WHERE share_id = @shareId ORDER BY joined_at, name`
    )
    .all({ shareId }) as MemberRow[]
  const files = db
    .prepare(
      `SELECT stamp, person_public_key, role, previous_role, signed_by, applied_at
       FROM sync_role_files WHERE share_id = @shareId AND applied = 1 ORDER BY stamp`
    )
    .all({ shareId }) as RoleFileRow[]

  const byPerson = new Map<string, MemberRow[]>()
  for (const row of members)
    byPerson.set(row.person_key, [...(byPerson.get(row.person_key) ?? []), row])
  const nameOf = (personKey: string): string => {
    const devices = byPerson.get(personKey)
    if (!devices) return ''
    const named = [...devices]
      .reverse()
      .map((device) => meName(device.me))
      .find(Boolean)
    return named ?? devices[devices.length - 1].name
  }

  const events: MembershipEvent[] = []
  for (const [personKey, devices] of byPerson) {
    const name = nameOf(personKey)
    const founded = files.some(
      (file) =>
        file.person_public_key === personKey && file.previous_role === null && file.role === 'owner'
    )
    events.push({
      kind: 'joined',
      personKey,
      name,
      at: Math.min(...devices.map((device) => device.joined_at)),
      ...(founded ? { role: 'owner' as const } : {})
    })
    if (devices.every((device) => device.left_at !== null)) {
      events.push({
        kind: 'left',
        personKey,
        name,
        at: Math.max(...devices.map((device) => device.left_at as number))
      })
    } else if (devices.every((device) => device.removed_at !== null)) {
      events.push({
        kind: 'removed',
        personKey,
        name,
        at: Math.max(...devices.map((device) => device.removed_at as number))
      })
    }
  }
  for (const file of files) {
    // The founder file (no role before) is the person's join as Owner; a repeat is no change.
    if (!file.person_public_key || !file.role || file.previous_role === null) continue
    if (file.role === file.previous_role) continue
    const by = file.signed_by ? nameOf(file.signed_by) : ''
    events.push({
      kind: 'role-changed',
      personKey: file.person_public_key,
      name: nameOf(file.person_public_key),
      at: timeOf(file),
      role: file.role,
      previousRole: file.previous_role,
      ...(by ? { byName: by } : {})
    })
  }
  // An Owner stopped every earlier invite (the key changed, no one was removed).
  const reset = db
    .prepare(
      'SELECT invites_reset_at AS at, invites_reset_by AS by FROM sync_shares WHERE share_id = @shareId'
    )
    .get({ shareId }) as { at: number | null; by: string | null } | undefined
  if (reset?.at != null) {
    const by = reset.by ? nameOf(reset.by) : ''
    events.push({
      kind: 'invites-stopped',
      personKey: reset.by ?? '',
      name: by,
      at: reset.at,
      ...(by ? { byName: by } : {})
    })
  }
  // Newest first; events with no known time go last.
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (b.event.at ?? -1) - (a.event.at ?? -1) || b.index - a.index)
    .map(({ event }) => event)
}
