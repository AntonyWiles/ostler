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
