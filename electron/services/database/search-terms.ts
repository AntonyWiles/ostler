/**
 * How a person's search text becomes a query: the one rule for the Library's
 * search and the planning search index (P5.7). Terms are quoted for FTS5, so
 * no input can be read as FTS syntax (AND, NEAR, column filters, a stray
 * quote), and each term matches as a prefix.
 */

const MAX_TERMS = 12

/** The words of a query: split on spaces, quotes removed, at most twelve. */
export function searchTerms(search: string): string[] {
  return (
    search
      .split(/\s+/)
      .map((term) => term.replace(/"/g, '').trim())
      // A term with no letter or digit would quote to an empty phrase.
      .filter((term) => /[\p{L}\p{N}]/u.test(term))
      .slice(0, MAX_TERMS)
  )
}

/** An FTS5 MATCH expression for `terms`: every term, each as a quoted prefix. */
export function ftsMatchExpression(terms: string[]): string {
  return terms.map((term) => `"${term}"*`).join(' ')
}

/** A LIKE pattern that finds `term` anywhere, with `\` as the escape character. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
