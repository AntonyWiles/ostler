/**
 * Links to this computer in texts: `http://localhost:8513/risk` and the like
 * point at a server that runs only on the machine that wrote them (an
 * agent's dev server, say), so for anyone reading the task later they lead
 * nowhere. Texts written through the automation API keep such an address as
 * inline code, words and all, so it can still be read and copied but is not
 * a link.
 */

/** Hosts that mean "this computer": localhost (and *.localhost), 127.x.x.x, 0.0.0.0 and [::1]. */
const LOCAL_HOST = String.raw`(?:localhost|[a-z0-9-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])`

/** A web address on this computer, with whatever port, path, query or fragment follows. */
const LOCAL_URL = String.raw`https?://${LOCAL_HOST}(?::\d{1,5})?(?!\.?[A-Za-z0-9-])(?:[/?#][^\s)<>\]]*)?`

/** `[words](url)` and `[words](<url>)` with a local address. */
const MARKDOWN_LINK = new RegExp(
  String.raw`\[([^\]\n]*)\]\(\s*<?(${LOCAL_URL})>?(?:\s+"[^"\n]*")?\s*\)`,
  'gi'
)

/** `<url>` with a local address. */
const ANGLE_LINK = new RegExp(String.raw`<(${LOCAL_URL})>`, 'gi')

/** A bare local address at the start of a line or after a space or bracket. */
const BARE_LINK = new RegExp(String.raw`(^|[\s(])(${LOCAL_URL})`, 'gi')

/** Whether a URL is a web address on this computer. */
export function isLocalUrl(url: string): boolean {
  return new RegExp(String.raw`^${LOCAL_URL}$`, 'i').test(url.trim())
}

/** Sentence punctuation after a bare address belongs to the sentence. */
function splitTrailing(url: string): { url: string; rest: string } {
  const match = /[.,;:!?'"]+$/.exec(url)
  return match ? { url: url.slice(0, match.index), rest: match[0] } : { url, rest: '' }
}

function unlinkPlain(text: string): string {
  return text
    .replace(MARKDOWN_LINK, (_whole, words: string, url: string) => {
      const label = words.trim()
      return label && label !== url ? `${label} (\`${url}\`)` : `\`${url}\``
    })
    .replace(ANGLE_LINK, (_whole, url: string) => `\`${url}\``)
    .replace(BARE_LINK, (_whole, before: string, raw: string) => {
      const { url, rest } = splitTrailing(raw)
      return `${before}\`${url}\`${rest}`
    })
}

/**
 * The text with every link to this computer turned into inline code
 * (`[Risk](http://localhost:8513/risk)` becomes ``Risk (`http://localhost:8513/risk`)``).
 * Code (fenced blocks and inline code) is left as it is.
 */
export function localLinksAsText(markdown: string): string {
  if (!/localhost|127\.|0\.0\.0\.0|\[::1\]/i.test(markdown)) return markdown
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
        .map((piece, index) => (index % 2 === 1 ? piece : unlinkPlain(piece)))
        .join('')
    )
  }
  return out.join('\n')
}
