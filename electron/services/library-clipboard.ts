import type { ImportLibraryResult } from '@shared/ostler-api'
import { formatIsoDateShort, todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import type { ClipboardContents } from '../app/clipboard'
import type { LibraryService } from './library-service'

/** A note's title from its first line, cut to this many characters. */
const TITLE_LENGTH = 80

export interface ClipboardImportOptions {
  /** Only a picture: a task's Paste picture. */
  only?: 'image'
}

/**
 * Keeps what the clipboard holds in a project's Library (Paste in the
 * Library, Paste picture on a task): a picture as an image, a file copied in
 * File Explorer as that file, a web address as a link, and other text as a
 * note titled by its first line. Null when there is nothing it can keep.
 */
export async function importFromClipboard(
  library: LibraryService,
  projectId: string,
  contents: ClipboardContents,
  options: ClipboardImportOptions = {}
): Promise<ImportLibraryResult | null> {
  if (contents.image) {
    const [result] = await library.importFiles(projectId, [
      {
        fileName: `${t('library:clipboard.pictureName', { date: formatIsoDateShort(todayIsoDate()) })}.png`,
        mimeType: 'image/png',
        bytes: new Uint8Array(contents.image)
      }
    ])
    return result ?? null
  }
  if (options.only === 'image') return null
  if (contents.filePath) {
    const [result] = await library.importPaths(projectId, [contents.filePath])
    return result ?? null
  }
  const text = contents.text.trim()
  if (!text) return null
  if (/^https?:\/\/\S+$/i.test(text)) {
    return {
      item: library.createItem(projectId, { kind: 'link', title: linkTitle(text), url: text })
    }
  }
  const firstLine = text.split(/\r?\n/, 1)[0].trim()
  const title =
    firstLine.length > TITLE_LENGTH
      ? `${firstLine.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
      : firstLine
  return { item: library.createItem(projectId, { kind: 'note', title, body: text }) }
}

/** A link's title: its site and path, without the scheme. */
function linkTitle(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}`.slice(0, TITLE_LENGTH)
  } catch {
    return url.slice(0, TITLE_LENGTH)
  }
}
