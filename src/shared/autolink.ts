/**
 * Bare links in Markdown: a web address or an item link (`ostler://task/…`) pasted as plain text
 * becomes a link, as `<url>`, so the PC and the phone both draw it as one. Text inside code
 * (fenced blocks and inline code) and links already written as Markdown are left alone.
 */
import { BRAND } from './brand'
import { LEGACY_NAMES } from './legacy-names'

/** The schemes are plain words (and `https?`), so they go into the pattern as they are. */
const SCHEMES = ['https?', BRAND.urlScheme, LEGACY_NAMES.urlScheme].join('|')

/** A URL at the start of a line or after a space; the part after it is trimmed below. */
const BARE = new RegExp(`(^|\\s)((?:${SCHEMES})://[^\\s<>]+)`, 'gi')

/** Punctuation that ends a sentence rather than the address. */
const TRAILING = /[.,;:!?'"*_]+$/

function trimUrl(url: string): { url: string; rest: string } {
  let end = url.replace(TRAILING, '')
  // A closing bracket belongs to the address only when it opened one: "(see https://x/a)".
  while (end.endsWith(')') && (end.match(/\(/g)?.length ?? 0) < (end.match(/\)/g)?.length ?? 0)) {
    end = end.slice(0, -1).replace(TRAILING, '')
  }
  return { url: end, rest: url.slice(end.length) }
}

function linkPlain(text: string): string {
  return text.replace(BARE, (_match, before: string, raw: string) => {
    const { url, rest } = trimUrl(raw)
    return `${before}<${url}>${rest}`
  })
}

/** Wraps a text's bare links in `<…>`, outside code. */
export function autolinkBareUrls(markdown: string): string {
  if (!markdown.includes('://')) return markdown
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    // Odd pieces of a split on backticks are inline code.
    out.push(
      line
        .split(/(`[^`]*`)/)
        .map((piece, index) => (index % 2 === 1 ? piece : linkPlain(piece)))
        .join('')
    )
  }
  return out.join('\n')
}
