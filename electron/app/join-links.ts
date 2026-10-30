/**
 * The invites that came in on join links (people and devices, prompt 07).
 *
 * A join link's invite stays in main. The renderer gets only an opaque id (a UUID),
 * so the invite is never in its memory or on its screen. An id lasts ten minutes, and
 * it ends when the join works; the Join step can keep retrying while the folder is
 * still on its way.
 */
import { randomUUID } from 'node:crypto'

const LIFETIME_MS = 10 * 60 * 1000

const pending = new Map<string, { invite: string; expires: number }>()

function prune(now: number): void {
  for (const [id, entry] of pending) {
    if (entry.expires <= now) pending.delete(id)
  }
}

/** Keeps an invite from a join link; returns the id the renderer is given. */
export function rememberJoinInvite(invite: string, now = Date.now()): string {
  prune(now)
  const id = randomUUID()
  pending.set(id, { invite, expires: now + LIFETIME_MS })
  return id
}

/** The invite for an id, while it lasts. */
export function peekJoinInvite(id: string, now = Date.now()): string | null {
  prune(now)
  return pending.get(id)?.invite ?? null
}

/** Ends an id once its join has worked. */
export function forgetJoinInvite(id: string): void {
  pending.delete(id)
}
