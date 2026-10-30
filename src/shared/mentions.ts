import { LEGACY_NAMES } from './legacy-names'

/**
 * @mentions in comments (overview D7). A mention is ordinary Markdown,
 * `[@Ana](<scheme>://person/<personId>)`: old versions and exports show the
 * readable "@Ana", and no schema holds it. Ostler draws the chip from the
 * person id, never from the link's words. Mentioning someone grants nothing.
 */

const PERSON_ID = '[A-Za-z0-9-]{1,100}'

function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function schemeAlternatives(scheme: string): string {
  return [scheme, LEGACY_NAMES.urlScheme].map(escapeRegExp).join('|')
}

/** `](url)` and `<url>` carrying a person link of this scheme (or the pre-rename one). */
function mentionPattern(scheme: string): RegExp {
  return new RegExp(
    `(?:\\]\\(\\s*|<)(?:${schemeAlternatives(scheme)})://person/(${PERSON_ID})(?![A-Za-z0-9/?#-])`,
    'gi'
  )
}

/** The person a mention URL points at, or null when it is not a `<scheme>://person/<id>` URL. */
export function mentionPersonId(url: string, scheme: string): string | null {
  const match = new RegExp(`^(?:${schemeAlternatives(scheme)})://person/(${PERSON_ID})$`, 'i').exec(
    url.trim()
  )
  return match ? match[1] : null
}

/** Whether `url` is a mention's person link. */
export function isMentionUrl(url: string, scheme: string): boolean {
  return mentionPersonId(url, scheme) !== null
}

/** The Markdown for a mention of `person`. Brackets in the name are removed so the link stays a link. */
export function mentionLink(person: { id: string; name: string }, scheme: string): string {
  const name = person.name.replace(/[[\]\\()<>\r\n]/g, '').trim() || '?'
  return `[@${name}](${scheme}://person/${person.id})`
}

/** The people a Markdown text mentions: ids, once each, in the order they first appear. */
export function mentionsIn(body: string, scheme: string): string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(mentionPattern(scheme))) found.add(match[1])
  return [...found]
}
