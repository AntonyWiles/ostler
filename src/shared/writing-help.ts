/**
 * Writing help and summaries (N8.2). Improve writing sends one text box's
 * text (or the part selected) with a style and gets one rewrite back, shown
 * beside the text until the person accepts it. Summarise comments sends one
 * task's comments and gets a short summary back, stored only if the person
 * adds it as a comment. Limits, types, links and the word diff live here so
 * main, the renderer and the tests share one rule.
 */

export const WRITING_STYLES = ['clearer', 'shorter', 'friendlier', 'spelling', 'list'] as const
export type WritingStyle = (typeof WRITING_STYLES)[number]

/** The longest text Improve writing sends; a longer one asks the person to select a part. */
export const WRITING_HELP_MAX_CHARS = 20_000
/** Summarise shows from this many comments. */
export const COMMENT_SUMMARY_MIN_COMMENTS = 8
/** Summarise sends at most the latest this many comments, and says so. */
export const COMMENT_SUMMARY_MAX_COMMENTS = 200

/** Which text box the text came from; main checks it exists and may be sent. */
export type WritingTarget =
  /** `itemId` null: a new item not saved yet, which has no Human only setting yet. */
  | { kind: 'library'; itemId: string | null }
  | { kind: 'task'; workItemId: string }
  | { kind: 'decision'; decisionId: string }

export interface ImproveWritingRequest {
  target: WritingTarget
  style: WritingStyle
  /** The text as it is in the editor (or the selected part), not as saved. */
  text: string
}

export interface ImprovedWriting {
  style: WritingStyle
  original: string
  suggestion: string
  /** Links in the original that the suggestion lost. */
  missingLinks: string[]
}

export interface CommentSummary {
  workItemId: string
  summary: string
  /** The first and last comment summarised (ms). */
  from: number
  to: number
  /** Comments summarised, and the task's comments in all. */
  count: number
  total: number
}

export function isWritingStyle(value: unknown): value is WritingStyle {
  return typeof value === 'string' && (WRITING_STYLES as readonly string[]).includes(value)
}

const LINK_PATTERNS = [
  /\[\[[^\]\n]+\]\]/g, // [[wiki links]]
  /\]\([^)\s]+(?:\s+"[^"]*")?\)/g, // the target of a Markdown link
  /<https?:\/\/[^>\s]+>/g, // autolinks
  /(?<![(<])\bhttps?:\/\/[^\s)<>\]]+/g // bare URLs
]

/** Every link in a text: `[[links]]`, Markdown link targets and URLs, once each. */
export function findLinks(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of LINK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0]
      found.add(raw.startsWith('](') ? raw.slice(2, -1).split(/\s+/)[0] : raw.replace(/^<|>$/g, ''))
    }
  }
  return [...found]
}

/** The links in `original` the `suggestion` no longer holds. */
export function missingLinks(original: string, suggestion: string): string[] {
  return findLinks(original).filter((link) => !suggestion.includes(link))
}

/** `text` with `start..end` replaced: the selection replaced, or the whole when nothing is selected. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string
): string {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  if (from === to) return replacement
  return text.slice(0, from) + replacement + text.slice(to)
}

export interface DiffPart {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/** Above this many token pairs the diff gives up and shows old removed, new added. */
const DIFF_MAX_CELLS = 2_000_000

/** Words added and removed between two texts (whitespace kept with each word). */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(/\s*\S+|\s+$/g) ?? []
  const b = after.match(/\s*\S+|\s+$/g) ?? []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  push('same', a.slice(0, head).join(''))
  if (midA.length * midB.length > DIFF_MAX_CELLS) {
    push('removed', midA.join(''))
    push('added', midB.join(''))
  } else {
    const n = midA.length
    const m = midB.length
    const lcs = new Uint32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * (m + 1) + j + 1] + 1
            : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('same', midA[i])
        i++
        j++
      } else if (lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) {
        push('removed', midA[i++])
      } else {
        push('added', midB[j++])
      }
    }
    while (i < n) push('removed', midA[i++])
    while (j < m) push('added', midB[j++])
  }
  push('same', a.slice(a.length - tail).join(''))
  return parts
}
