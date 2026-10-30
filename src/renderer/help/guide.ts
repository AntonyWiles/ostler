import changelogText from '../../../CHANGELOG.md?raw'
import { changelogVersionNotes } from '@shared/changelog'
import { t } from '@shared/i18n'

/**
 * The user guide and the changelog, bundled into the app (P8.1). The pages
 * are the markdown files in `docs/user-guide/`, the same files the
 * repository shows, so there is one source for both. A file's name gives its
 * order and its path in the app: `03-tasks.md` is the third page, at
 * `/help/tasks`. Its first `# ` heading is its title.
 */
const PAGE_FILES = import.meta.glob('../../../docs/user-guide/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

export interface GuidePage {
  /** Its path in the app: `/help/:slug`. */
  slug: string
  title: string
  /** The markdown, without its title heading (the viewer shows the title itself). */
  body: string
}

/** `docs/user-guide/03-tasks.md` → order 3, slug `tasks`; null for a file without an order. */
export function parseGuideFileName(path: string): { order: number; slug: string } | null {
  const match = /(?:^|\/)(\d+)-([a-z0-9-]+)\.md$/.exec(path)
  return match ? { order: Number(match[1]), slug: match[2] } : null
}

/** Splits the first `# ` heading off a page. */
export function splitTitle(markdown: string, fallback: string): { title: string; body: string } {
  const match = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(markdown)
  if (!match) return { title: fallback, body: markdown }
  return { title: match[1], body: markdown.slice(match[0].length).replace(/^\s+/, '') }
}

/** The pages from a set of files, in order. */
export function buildGuide(files: Record<string, string>): GuidePage[] {
  return Object.entries(files)
    .map(([path, text]) => ({ name: parseGuideFileName(path), text }))
    .filter((entry): entry is { name: { order: number; slug: string }; text: string } =>
      Boolean(entry.name)
    )
    .sort((a, b) => a.name.order - b.name.order)
    .map(({ name, text }) => ({ slug: name.slug, ...splitTitle(text, name.slug) }))
}

export const GUIDE_PAGES: GuidePage[] = buildGuide(PAGE_FILES)

export function findGuidePage(slug: string | undefined): GuidePage | undefined {
  return GUIDE_PAGES.find((page) => page.slug === slug)
}

/** Where a link in a page goes: another page, a bundled image, or the web. */
export function resolveGuideLink(
  href: string
): { kind: 'page'; slug: string; hash: string } | { kind: 'external'; url: string } | null {
  if (/^https?:\/\//i.test(href)) return { kind: 'external', url: href }
  const page = /^(?:\.\/)?(?:\d+-)?([a-z0-9-]+)\.md(#[\w-]*)?$/.exec(href)
  if (page) return { kind: 'page', slug: page[1], hash: page[2] ?? '' }
  if (href.startsWith('#')) return { kind: 'page', slug: '', hash: href }
  return null
}

/**
 * What's new for `version`: its section of CHANGELOG.md (Keep a Changelog
 * form), or the Unreleased section while the version has none. Null when
 * neither has anything in it.
 */
export function changelogSection(
  changelog: string,
  version: string
): { heading: string; body: string } | null {
  const body =
    changelogVersionNotes(changelog, version) ?? changelogVersionNotes(changelog, 'Unreleased')
  return body ? { heading: t('help:guide.version', { version }), body } : null
}

export function whatsNew(version: string): { heading: string; body: string } | null {
  return changelogSection(changelogText, version)
}
