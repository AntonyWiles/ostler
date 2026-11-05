import type { LibraryAiAccess, LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import type { BadgeTone } from '../../../ui'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'

/** The Library's sections. 'image' is shown to people as References. */
export type LibrarySection = 'all' | LibraryItemKind

export const LIBRARY_SECTIONS: { id: LibrarySection; label: string }[] = [
  {
    id: 'all',
    get label() {
      return t('library:libraryUi.all')
    }
  },
  {
    id: 'brief',
    get label() {
      return t('library:libraryUi.designBriefs')
    }
  },
  {
    id: 'guide',
    get label() {
      return t('library:libraryUi.guides')
    }
  },
  {
    id: 'image',
    get label() {
      return t('library:libraryUi.references')
    }
  },
  {
    id: 'document',
    get label() {
      return t('library:libraryUi.documents')
    }
  },
  {
    id: 'link',
    get label() {
      return t('library:libraryUi.links')
    }
  },
  {
    id: 'note',
    get label() {
      return t('library:libraryUi.notes')
    }
  },
  {
    id: 'whiteboard',
    get label() {
      return t('views:planView.whiteboards.name')
    }
  }
]

export const KIND_LABEL: Record<LibraryItemKind, string> = {
  get brief() {
    return t('library:libraryUi.designBrief')
  },
  get guide() {
    return t('library:libraryUi.kind.guide')
  },
  get image() {
    return t('library:libraryUi.kind.image')
  },
  get document() {
    return t('library:libraryUi.kind.document')
  },
  get link() {
    return t('library:libraryUi.kind.link')
  },
  get note() {
    return t('library:libraryUi.note')
  },
  get whiteboard() {
    return t('library:libraryUi.kind.whiteboard')
  }
}

export const ACCESS_OPTIONS: { id: LibraryAiAccess; label: string }[] = [
  {
    id: 'always',
    get label() {
      return t('library:libraryUi.always')
    }
  },
  {
    id: 'when-selected',
    get label() {
      return t('library:libraryUi.whenSelected')
    }
  },
  {
    id: 'human-only',
    get label() {
      return t('library:libraryUi.humanOnly')
    }
  }
]

export const ACCESS_LABEL: Record<LibraryAiAccess, string> = {
  get always() {
    return t('library:libraryUi.always')
  },
  get 'when-selected'() {
    return t('library:libraryUi.whenSelected')
  },
  get 'human-only'() {
    return t('library:libraryUi.humanOnly')
  }
}

/** The list's badge: says it is about Ostler AI, which a bare "Never" would not. */
export const ACCESS_BADGE: Record<LibraryAiAccess, string> = {
  get always() {
    return t('library:libraryUi.badge.always')
  },
  get 'when-selected'() {
    return t('library:libraryUi.badge.whenSelected')
  },
  get 'human-only'() {
    return t('library:libraryUi.badge.humanOnly')
  }
}

export const ACCESS_TONE: Record<LibraryAiAccess, BadgeTone> = {
  always: 'info',
  'when-selected': 'neutral',
  'human-only': 'warning'
}

/** Briefs, guides and notes are written in Ostler; everything else is captured. */
export function isWrittenKind(kind: LibraryItemKind): kind is 'brief' | 'guide' | 'note' {
  return kind === 'brief' || kind === 'guide' || kind === 'note'
}

/**
 * The URL the main process serves an item's stored bytes on. Ids only; the
 * revision busts the cache after a re-import or restore.
 */
/** The one rule for a Library file's address; `revision` makes a new file a new address. */
export function libraryItemFileUrl(
  projectId: string,
  itemId: string,
  which: 'file' | 'thumb' | `page-${number}`,
  revision?: number
): string {
  const url = `ostler-library://${encodeURIComponent(projectId)}/${encodeURIComponent(itemId)}/${which}`
  return revision === undefined ? url : `${url}?r=${revision}`
}

export function libraryFileUrl(
  item: LibraryItem,
  which: 'file' | 'thumb' | `page-${number}`
): string {
  return libraryItemFileUrl(item.projectId, item.id, which, item.revision)
}

/** "just now", "5 minutes ago", "yesterday", or the date beyond a week. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  return formatRelativeTime(then)
}

/** A bare http(s) URL, as pasted from a browser's address bar. */
export function bareHttpUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function filesToImportInput(
  files: File[]
): Promise<{ fileName: string; mimeType: string; bytes: Uint8Array }[]> {
  return Promise.all(
    files.map(async (file, index) => ({
      fileName: file.name || `pasted-${Date.now()}-${index}.${extensionFor(file.type)}`,
      mimeType: file.type || 'application/octet-stream',
      bytes: new Uint8Array(await file.arrayBuffer())
    }))
  )
}

function extensionFor(mimeType: string): string {
  const sub = mimeType.split('/')[1] ?? 'bin'
  if (sub === 'jpeg') return 'jpg'
  if (sub === 'svg+xml') return 'svg'
  return sub.replace(/[^a-z0-9]/gi, '') || 'bin'
}
