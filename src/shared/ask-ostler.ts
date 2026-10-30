/**
 * Ask Ostler's citations (N8.3a): the one rule for what an answer's [n]
 * means, shared by main (which removes citations to sources that do not
 * exist) and the renderer (which turns each into a link to its source).
 */

/** `[3]`, `[1, 2]` or `[1,2,5]`: one or more source numbers in square brackets. */
const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?!\()/g

/** The prefix a citation link's address starts with; the number follows it. */
export const ASK_SOURCE_HREF = '#ask-source-'

/**
 * The answer with every citation kept only for numbers 1..`count`. A
 * bracket left with no valid number is removed with the space before it.
 */
export function removeUnknownCitations(answer: string, count: number): string {
  return answer
    .replace(new RegExp(`\\s?${CITATION.source}`, 'g'), (match: string, list: string) => {
      const kept = list
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((number) => Number.isInteger(number) && number >= 1 && number <= count)
      if (kept.length === 0) return ''
      const lead = /^\s/.test(match) ? match[0] : ''
      return `${lead}[${[...new Set(kept)].join(', ')}]`
    })
    .trim()
}

/** The source numbers an answer cites, in order of first mention. */
export function citedNumbers(answer: string): number[] {
  const seen: number[] = []
  for (const match of answer.matchAll(CITATION)) {
    for (const entry of match[1].split(',')) {
      const number = Number(entry.trim())
      if (!seen.includes(number)) seen.push(number)
    }
  }
  return seen
}

/**
 * The answer's Markdown with each cited number as a link, `[\[3\]](#ask-source-3)`,
 * which the panel renders as a control that opens source 3.
 */
export function linkCitations(answer: string): string {
  return answer.replace(CITATION, (_match: string, list: string) =>
    list
      .split(',')
      .map((entry) => entry.trim())
      .map((number) => `[\\[${number}\\]](${ASK_SOURCE_HREF}${number})`)
      .join('')
  )
}

/** The source number a citation link's address names, or null. */
export function citationNumber(href: string | undefined): number | null {
  const match = href?.match(/ask-source-(\d+)$/)
  return match ? Number(match[1]) : null
}

// ─── Follow-up questions (N8.3b) ────────────────────────────────────────────

/** The most earlier turns a follow-up sends. */
export const ASK_HISTORY_TURNS = 5
/** The most characters of one earlier answer a follow-up sends. */
export const ASK_HISTORY_ANSWER_CHARS = 4000

/**
 * The earlier turns a follow-up sends: the latest five, each answer cut to
 * 4,000 characters, and whether anything was left out or cut. Questions are
 * already capped where they are asked. Main and the renderer share this one
 * rule, so the panel's "older turns left out" line matches what was sent.
 */
export function boundAskHistory(earlier: readonly { question: string; answer: string }[]): {
  turns: { question: string; answer: string }[]
  leftOut: boolean
} {
  const latest = earlier.slice(-ASK_HISTORY_TURNS)
  let leftOut = latest.length < earlier.length
  const turns = latest.map(({ question, answer }) => {
    if (answer.length <= ASK_HISTORY_ANSWER_CHARS) return { question, answer }
    leftOut = true
    return { question, answer: `${answer.slice(0, ASK_HISTORY_ANSWER_CHARS)}…` }
  })
  return { turns, leftOut }
}
