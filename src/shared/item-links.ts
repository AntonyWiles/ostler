import { parseDeepLink } from './deep-link'
import { LEGACY_NAMES } from './legacy-names'

/**
 * Links between items in texts (N4.4a, N34). A link is ordinary Markdown,
 * `[words](<scheme>://task/<projectId>/<id>)`, readable in any editor; Ostler
 * shows it with the item's current title, whatever the words say, and keeps
 * an index of what links to what so every item can say what links to it.
 *
 * This file is the one reader of those links: the link index, the project
 * file's import and the Markdown component all go through it.
 */

/** What a link can point at. */
export const LINK_TARGET_KINDS = ['task', 'milestone', 'decision', 'library'] as const
export type LinkTargetKind = (typeof LINK_TARGET_KINDS)[number]

/** Which text a link was written in: a task's description, a comment, a decision, a Library item. */
export const LINK_SOURCE_KINDS = ['task', 'comment', 'decision', 'library'] as const
export type LinkSourceKind = (typeof LINK_SOURCE_KINDS)[number]

/** One item a text links to. */
export interface ItemLinkRef {
  kind: LinkTargetKind
  projectId: string
  id: string
}

/** Never a view link: texts link to items only. */
const noViews = () => false

/** The item a link's URL points at, or null when it is not an item link of this scheme. */
export function itemLinkTarget(url: string, scheme: string): ItemLinkRef | null {
  let parsed = parseDeepLink(url, scheme, noViews)
  // Texts written before the rename link with the old scheme (legacy-names.ts).
  if (!parsed.ok) parsed = parseDeepLink(url, LEGACY_NAMES.urlScheme, noViews)
  if (!parsed.ok) return null
  const request = parsed.request
  switch (request.kind) {
    case 'task':
      return { kind: 'task', projectId: request.projectId, id: request.taskId }
    case 'milestone':
    case 'decision':
    case 'library':
      return { kind: request.kind, projectId: request.projectId, id: request.id }
    default:
      return null
  }
}

/** The URL of a link to an item: the same shape `deepLinkFor` makes. */
export function itemLinkUrl(ref: ItemLinkRef, scheme: string): string {
  return `${scheme}://${ref.kind}/${ref.projectId}/${ref.id}`
}

/** `](url)` and `<url>` in Markdown: the two ways a text carries a link. */
function linkPattern(scheme: string): RegExp {
  const escaped = [scheme, LEGACY_NAMES.urlScheme]
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return new RegExp(`(\\]\\(\\s*|<)((?:${escaped})://[A-Za-z0-9/-]{1,200})`, 'gi')
}

const refKey = (ref: ItemLinkRef) => `${ref.kind}:${ref.id}`

/** Every item a Markdown text links to, once each, in the order they first appear. */
export function extractItemLinks(markdown: string, scheme: string): ItemLinkRef[] {
  const found = new Map<string, ItemLinkRef>()
  for (const match of markdown.matchAll(linkPattern(scheme))) {
    const ref = itemLinkTarget(match[2], scheme)
    if (ref && !found.has(refKey(ref))) found.set(refKey(ref), ref)
  }
  return [...found.values()]
}

/**
 * The Library items a Markdown text shows as pictures (`![alt](url)`), once
 * each: what a pasted picture leaves in a description.
 */
export function extractPictureLinks(markdown: string, scheme: string): ItemLinkRef[] {
  const found = new Map<string, ItemLinkRef>()
  for (const match of markdown.matchAll(/!\[[^\]\n]*\]\(\s*([^)\s]+)\s*\)/g)) {
    const ref = itemLinkTarget(match[1], scheme)
    if (ref?.kind === 'library' && !found.has(refKey(ref))) found.set(refKey(ref), ref)
  }
  return [...found.values()]
}

/** New ids for an imported project's items, by kind (the project file's id maps). */
export interface ItemLinkIdMaps {
  fromProjectId: string
  toProjectId: string
  ids: Partial<Record<LinkTargetKind, ReadonlyMap<string, string>>>
}

/**
 * One link's URL pointed at the new item an import made, when it links to one
 * of the file's own items; any other URL (another project, an item the file
 * did not carry, a web address) is returned unchanged. The one rule for links
 * in texts and on whiteboard objects.
 */
export function rewriteItemLinkUrl(url: string, scheme: string, maps: ItemLinkIdMaps): string {
  const ref = itemLinkTarget(url, scheme)
  if (!ref || ref.projectId !== maps.fromProjectId) return url
  const id = maps.ids[ref.kind]?.get(ref.id)
  if (!id) return url
  return itemLinkUrl({ kind: ref.kind, projectId: maps.toProjectId, id }, scheme)
}

/**
 * A text with its links to the file's own items pointed at the new items an
 * import made. Links to anything else (another project, an item the file did
 * not carry) stay as written; only the URL changes, never the words.
 */
export function rewriteItemLinks(markdown: string, scheme: string, maps: ItemLinkIdMaps): string {
  if (!markdown.includes('://')) return markdown
  return markdown.replace(linkPattern(scheme), (whole, lead: string, url: string) => {
    const next = rewriteItemLinkUrl(url, scheme, maps)
    return next === url ? whole : `${lead}${next}`
  })
}
