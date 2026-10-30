/**
 * Reads CHANGELOG.md (Keep a Changelog form). The one parser for both readers:
 * the app's What's new (`src/renderer/help/guide.ts`) and the release notes
 * the release pipeline writes (`scripts/release-notes.cjs`, P10.1), so the two
 * cannot disagree about what a version's notes are.
 *
 * No imports: release-notes.cjs loads this file by transpiling it.
 */

/** The body of the `## [name]` section, link definitions removed and trimmed; null when absent or empty. */
export function changelogVersionNotes(changelog: string, name: string): string | null {
  const sections = [
    ...changelog.matchAll(/^## \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm)
  ]
  const section = sections.find((entry) => entry[1].toLowerCase() === name.toLowerCase())
  if (!section) return null
  const body = section[2].replace(/^\[[^\]]+\]:.*$/gm, '').trim()
  return body || null
}
