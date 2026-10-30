import {
  LIBRARY_SECTION_BREAK,
  type LibraryTextLocation,
  type LibraryTextSections
} from '@shared/ostler-api'

/**
 * Where in a Library file's text a match is (N4.5): its page, slide or sheet,
 * counted by the section breaks the text reader put between them.
 */

/** The offset of the first place any of `terms` appears in `text`, ignoring case; -1 if none. */
export function firstMatchOffset(text: string, terms: string[]): number {
  const lower = text.toLowerCase()
  let first = -1
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase())
    if (index !== -1 && (first === -1 || index < first)) first = index
  }
  return first
}

/** The page, slide or sheet holding `offset` of a file's text. */
export function locationAt(
  text: string,
  sections: LibraryTextSections,
  offset: number
): LibraryTextLocation | null {
  if (offset < 0) return null
  let index = 0
  for (let at = text.indexOf(LIBRARY_SECTION_BREAK); at !== -1 && at < offset;) {
    index += 1
    at = text.indexOf(LIBRARY_SECTION_BREAK, at + 1)
  }
  if (sections.labels) {
    const label = sections.labels[index]
    return label === undefined ? null : { kind: sections.kind, label }
  }
  return { kind: sections.kind, label: String(index + 1) }
}
