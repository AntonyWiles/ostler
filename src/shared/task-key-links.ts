/**
 * Task IDs in texts (BRI-26): written as plain words, or as a link's target
 * (`[the review](BRI-26)`), they are drawn as links to the task. Only IDs
 * the caller resolved to a task of the text's project are linked; the text
 * itself is never changed. Code, and links and addresses already written,
 * are left alone.
 */

/** A task ID as words: two to five capitals, a dash and a number. */
const BARE_KEY = /(^|[^A-Za-z0-9/_-])([A-Z]{2,5}-\d{1,9})(?![A-Za-z0-9_-])/g

/** A link whose target is a task ID, in any case: `](bri-26)`. */
const HREF_KEY = /\]\(\s*#?([A-Za-z]{2,5}-\d{1,9})\s*\)/g

/** Markdown links and `<…>` addresses on a line: kept as written. */
const LINKS = /(!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>)/

/** Calls `onPlain` for each piece of `markdown` outside code and links, and `onLink` for each link. */
function eachPiece(
  markdown: string,
  onPlain: (text: string) => string,
  onLink: (text: string) => string
): string {
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
    out.push(
      line
        .split(/(`[^`]*`)/)
        .map((piece, index) =>
          index % 2 === 1
            ? piece
            : piece
                .split(LINKS)
                .map((part, inner) => (inner % 2 === 1 ? onLink(part) : onPlain(part)))
                .join('')
        )
        .join('')
    )
  }
  return out.join('\n')
}

/** Every task ID a text names, in capitals, once each. */
export function findTaskKeys(markdown: string): string[] {
  if (!/[A-Za-z]-\d/.test(markdown)) return []
  const found = new Set<string>()
  eachPiece(
    markdown,
    (text) => {
      for (const match of text.matchAll(BARE_KEY)) found.add(match[2]!)
      return text
    },
    (link) => {
      for (const match of link.matchAll(HREF_KEY)) found.add(match[1]!.toUpperCase())
      return link
    }
  )
  return [...found]
}

/**
 * The text with the task IDs in `urls` (by ID in capitals) drawn as links to
 * their tasks: `BRI-26` becomes `[BRI-26](<url>)`, and a link to `BRI-26`
 * points at the task.
 */
export function linkTaskKeys(markdown: string, urls: ReadonlyMap<string, string>): string {
  if (urls.size === 0) return markdown
  return eachPiece(
    markdown,
    (text) =>
      text.replace(BARE_KEY, (whole, before: string, key: string) => {
        const url = urls.get(key)
        return url ? `${before}[${key}](${url})` : whole
      }),
    (link) =>
      link.replace(HREF_KEY, (whole, key: string) => {
        const url = urls.get(key.toUpperCase())
        return url ? `](${url})` : whole
      })
  )
}
