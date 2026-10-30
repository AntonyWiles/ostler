import type { NavigateRequest } from './ostler-api'

/**
 * Deep links (P8.2): `<BRAND.urlScheme>://inbox`, `…://quick-add`,
 * `…://weekly-review` (N1.5), `…://task/<projectId>/<taskId>`,
 * `…://project/<projectId>/<view>`, and (N4.4a) `…://milestone/<projectId>/<id>`,
 * `…://decision/<projectId>/<id>` and `…://library/<projectId>/<id>`, and
 * (N5.6b) `…://goal/<id>`, a goal of one's own.
 * Notifications, the jump list, links in texts and links from other apps all
 * use them.
 *
 * A link is untrusted input from any process on the machine, so the parser
 * accepts exactly these nine shapes and nothing else: ids must be ids (UUIDs), a
 * view must be one the registry knows, and there is no
 * query, fragment, path or extra segment. A link only ever navigates or opens
 * Quick add; it never changes anything.
 */

/** Data-model ids are UUID `TEXT`. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Longer than any link Ostler makes; anything longer is not one of ours. */
const MAX_LINK_LENGTH = 200

export function isEntityId(value: string): boolean {
  return ID.test(value)
}

/** The kinds of item besides a task a link can point at (N4.4a). */
export const ITEM_LINK_KINDS = ['milestone', 'decision', 'library'] as const
export type ItemLinkKind = (typeof ITEM_LINK_KINDS)[number]

function isItemLinkKind(kind: string): kind is ItemLinkKind {
  return (ITEM_LINK_KINDS as readonly string[]).includes(kind)
}

export type DeepLinkResult = { ok: true; request: NavigateRequest } | { ok: false; reason: string }

/**
 * Reads a deep link. `isProjectView` says whether a view id is in the
 * registry (the renderer's `isProjectViewId`, as main last heard it).
 */
export function parseDeepLink(
  raw: unknown,
  scheme: string,
  isProjectView: (view: string) => boolean
): DeepLinkResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'not text' }
  if (raw.length > MAX_LINK_LENGTH) return { ok: false, reason: 'too long' }
  const prefix = `${scheme}://`
  if (raw.slice(0, prefix.length).toLowerCase() !== prefix) {
    return { ok: false, reason: 'another scheme' }
  }
  // Windows may add a trailing slash when it passes the link on.
  const rest = raw.slice(prefix.length).replace(/\/$/, '')
  // Plain characters only: no escapes, queries, fragments, dots or backslashes.
  if (!/^[A-Za-z0-9/-]+$/.test(rest)) return { ok: false, reason: 'unexpected characters' }
  const parts = rest.split('/')
  const [kind] = parts
  if (parts.length === 1 && kind === 'inbox') return { ok: true, request: { kind: 'inbox' } }
  if (parts.length === 1 && kind === 'weekly-review') {
    return { ok: true, request: { kind: 'weekly-review' } }
  }
  if (parts.length === 1 && kind === 'quick-add') {
    return { ok: true, request: { kind: 'quick-add' } }
  }
  if (parts.length === 1 && kind === 'devices') return { ok: true, request: { kind: 'devices' } }
  if (parts.length === 2 && kind === 'goal') {
    const [, id] = parts
    if (!isEntityId(id)) return { ok: false, reason: 'bad id' }
    return { ok: true, request: { kind: 'personal-goal', id } }
  }
  if (parts.length === 3 && kind === 'task') {
    const [, projectId, taskId] = parts
    if (!isEntityId(projectId) || !isEntityId(taskId)) return { ok: false, reason: 'bad id' }
    return { ok: true, request: { kind: 'task', projectId, taskId } }
  }
  if (parts.length === 3 && isItemLinkKind(kind)) {
    const [, projectId, id] = parts
    if (!isEntityId(projectId) || !isEntityId(id)) return { ok: false, reason: 'bad id' }
    return { ok: true, request: { kind, projectId, id } }
  }
  if (parts.length === 3 && kind === 'project') {
    const [, projectId, view] = parts
    if (!isEntityId(projectId)) return { ok: false, reason: 'bad id' }
    if (!isProjectView(view)) return { ok: false, reason: 'unknown view' }
    return { ok: true, request: { kind: 'project', projectId, view } }
  }
  return { ok: false, reason: 'unknown link' }
}

/** The deep link for a navigate request, as notifications and the jump list carry it. */
export function deepLinkFor(request: NavigateRequest, scheme: string): string {
  switch (request.kind) {
    case 'inbox':
      return `${scheme}://inbox`
    case 'quick-add':
      return `${scheme}://quick-add`
    // A snip's picture never travels in a link (N4.2a): the nearest is quick add.
    case 'snip':
      return `${scheme}://quick-add`
    case 'weekly-review':
      return `${scheme}://weekly-review`
    // A status update reminder (N5.5): its link is the project's Overview.
    case 'status-update':
      return `${scheme}://project/${request.projectId}/overview`
    case 'task':
      return `${scheme}://task/${request.projectId}/${request.taskId}`
    case 'project':
      return `${scheme}://project/${request.projectId}/${request.view}`
    case 'milestone':
    case 'decision':
    case 'library':
      return `${scheme}://${request.kind}/${request.projectId}/${request.id}`
    case 'personal-goal':
      return `${scheme}://goal/${request.id}`
    // A join link carries an invite, which never goes into a notification: the nearest is the Inbox.
    case 'join-share':
      return `${scheme}://inbox`
    case 'devices':
      return `${scheme}://devices`
  }
}

/** The start of every invite (`electron/services/sync/sharing.ts`). */
export const INVITE_PREFIX = 'ostler-invite:1:'

/** Longest invite a join link can carry (its payload), and the longest a pasted invite may be. */
export const MAX_INVITE_LENGTH = 4096

export type JoinLinkResult = { ok: true; invite: string } | { ok: false; reason: string }

/**
 * Reads a join link (people and devices, prompt 07): `<scheme>://join/<payload>`, where the
 * payload is an invite's base64url part. An invite is longer than the other links, so
 * it has its own parser. It only gives the invite back; it never reads its JSON, and
 * the caller never joins from a link by itself.
 */
export function parseJoinLink(raw: unknown, scheme: string): JoinLinkResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'not text' }
  const prefix = `${scheme}://`
  if (raw.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) {
    return { ok: false, reason: 'another scheme' }
  }
  const rest = raw.slice(prefix.length)
  if (!rest.startsWith('join/')) return { ok: false, reason: 'not a join link' }
  // Windows may add a trailing slash when it passes the link on.
  const payload = rest.slice('join/'.length).replace(/\/$/, '')
  if (payload.length === 0) return { ok: false, reason: 'empty' }
  if (payload.length > MAX_INVITE_LENGTH) return { ok: false, reason: 'too long' }
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return { ok: false, reason: 'unexpected characters' }
  return { ok: true, invite: INVITE_PREFIX + payload }
}

/** Longest pasted text an invite is looked for in: the invite message carries it twice, plus its steps. */
export const MAX_PASTED_INVITE_LENGTH = 4 * MAX_INVITE_LENGTH

/**
 * The invite in whatever a person pasted: the invite itself, the invite message Ostler
 * copies (steps, a join link and the invite), or just the join link. The first invite
 * wins; null when there is none. It never reads the invite's JSON.
 */
export function findInvite(text: unknown, scheme: string): string | null {
  if (typeof text !== 'string' || text.length > MAX_PASTED_INVITE_LENGTH) return null
  const escaped = INVITE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const plain = new RegExp(`${escaped}[A-Za-z0-9_-]+`).exec(text)
  if (plain && plain[0].length - INVITE_PREFIX.length <= MAX_INVITE_LENGTH) return plain[0]
  const link = new RegExp(`${scheme}://join/[A-Za-z0-9_-]+`, 'i').exec(text)
  if (!link) return null
  const parsed = parseJoinLink(link[0], scheme)
  return parsed.ok ? parsed.invite : null
}

/** The join link for an invite (the inverse of `parseJoinLink`). */
export function joinLinkFor(invite: string, scheme: string): string {
  return `${scheme}://join/${invite.slice(INVITE_PREFIX.length)}`
}

/** The first argument that looks like a link for `scheme` (Windows passes it as an argument). */
export function findDeepLinkArgument(argv: readonly string[], scheme: string): string | null {
  const prefix = `${scheme}://`
  return argv.find((arg) => arg.slice(0, prefix.length).toLowerCase() === prefix) ?? null
}
