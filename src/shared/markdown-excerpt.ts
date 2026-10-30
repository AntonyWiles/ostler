/**
 * A comment or note as one line of plain text, for a short preview (Overview's
 * Recent activity). Markdown marks go and links keep their text. A reply that
 * quotes another comment shows the reply: quoted lines are dropped unless the
 * text is nothing but a quote.
 */
export function markdownExcerpt(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const isQuote = (line: string) => /^\s*>/.test(line)
  const own = lines.filter((line) => !isQuote(line) && line.trim() !== '')
  const kept = own.length > 0 ? own : lines.map((line) => line.replace(/^(\s*>)+\s?/, ''))
  return kept
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
