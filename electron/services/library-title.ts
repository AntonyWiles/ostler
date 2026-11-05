import { t } from '@shared/i18n'

/** The longest a Library item's title may be. */
export const MAX_TITLE_CHARS = 200

/**
 * A Library item's title, trimmed: refused when empty or too long. The one rule for every kind,
 * shared by `LibraryService` and `WhiteboardService`.
 */
export function cleanTitle(title: unknown): string {
  const value = typeof title === 'string' ? title.trim() : ''
  if (!value) throw new Error(t('errors:libraryService.libraryItemNeedsTitle'))
  if (value.length > MAX_TITLE_CHARS) {
    throw new Error(t('errors:libraryService.titleLongerThanCharacters', { MAX_TITLE_CHARS }))
  }
  return value
}

/** The most tags one Library item carries; a task carries at most 20 labels too. */
export const MAX_LIBRARY_TAGS = 20
/** A tag is a project label, so it may be as long as one. */
export const MAX_LIBRARY_TAG_CHARS = 80

/**
 * A Library item's tags, which are the project's labels: trimmed, inner spaces collapsed, each
 * once, refused when too many or too long. Shared by the PC's `LibraryService` and the phone.
 */
export function cleanLibraryTags(tags: unknown): string[] {
  if (tags === undefined || tags === null) return []
  if (!Array.isArray(tags)) throw new Error('Tags must be a list')
  const clean = [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
    )
  ]
  if (clean.length > MAX_LIBRARY_TAGS)
    throw new Error(t('errors:libraryService.mostTags', { MAX_TAGS: MAX_LIBRARY_TAGS }))
  if (clean.some((tag) => tag.length > MAX_LIBRARY_TAG_CHARS)) {
    throw new Error(
      t('errors:libraryService.tagLongerThanCharacters', { MAX_TAG_CHARS: MAX_LIBRARY_TAG_CHARS })
    )
  }
  return clean
}
