import { LIBRARY_MAX_TASK_ATTACHMENTS } from '@shared/ostler-api'
import type { AIDraftSource, LibraryAiContext } from '@shared/ostler-api'
import type { AIContentPart } from './ai-provider'
import type { LibraryService } from './library-service'

/**
 * What Ostler AI may use of the Library: the one gate and the one builder.
 * Every AI path takes this, never the repository, so there is no second
 * selector.
 */
export type LibraryAiReader = Pick<LibraryService, 'aiVisibleItem' | 'buildLibraryAiContext'>

const MAX_CAPTION_CHARS = 500

/** True when the context has anything to say: items, listings or images. */
export function libraryContextHasContent(context: LibraryAiContext): boolean {
  return (
    context.included.length > 0 ||
    context.listed.length > 0 ||
    context.images.length > 0 ||
    context.imagesDropped > 0
  )
}

/**
 * The context's images as message parts, each labelled so the model can tie
 * it to its section, and each carrying the title, summary and caption that
 * replace it when the model cannot read images.
 */
export function libraryImageParts(
  library: LibraryAiReader,
  projectId: string,
  context: LibraryAiContext
): AIContentPart[] {
  return context.images.flatMap((image): AIContentPart[] => {
    const item = library.aiVisibleItem(projectId, image.itemId)
    const caption = item?.body.replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION_CHARS)
    const description = [
      `"${image.title}" (library id ${image.itemId})`,
      item?.summary ? `Summary: ${item.summary}` : '',
      caption ? `Caption: ${caption}` : ''
    ]
      .filter(Boolean)
      .join('. ')
    return [
      { type: 'text', text: `Library image "${image.title}" (id ${image.itemId}):` },
      { type: 'image', mimeType: image.mimeType, base64: image.base64, description }
    ]
  })
}

/** The text followed by the images; a plain string when there are no images. */
export function contentWithImages(
  text: string,
  imageParts: AIContentPart[]
): string | AIContentPart[] {
  return imageParts.length > 0 ? [{ type: 'text', text }, ...imageParts] : text
}

/**
 * Which items, at which revisions, a context fed into a request: every
 * included section, plus any attached image whose section fell outside the
 * text budget.
 */
export function librarySources(
  library: LibraryAiReader,
  projectId: string,
  context: LibraryAiContext
): AIDraftSource[] {
  const sources: AIDraftSource[] = context.included.map((entry) => ({
    libraryItemId: entry.id,
    revision: entry.revision,
    title: entry.title
  }))
  for (const image of context.images) {
    if (sources.some((source) => source.libraryItemId === image.itemId)) continue
    const item = library.aiVisibleItem(projectId, image.itemId)
    if (item) sources.push({ libraryItemId: item.id, revision: item.revision, title: item.title })
  }
  return sources
}

const MAX_SELECTED_ITEMS = 50

/**
 * Selected library item ids as they arrive over IPC: strings only, capped.
 * Each id is still checked by `aiVisibleItem` before anything is read.
 */
export function libraryItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string').slice(0, MAX_SELECTED_ITEMS)
}

/** Every library item id a context put in front of the model: sections, listings and images. */
export function libraryContextItemIds(context: LibraryAiContext | null): Set<string> {
  if (!context) return new Set()
  return new Set([
    ...context.included.map((entry) => entry.id),
    ...context.listed.map((entry) => entry.id),
    ...context.images.map((image) => image.itemId)
  ])
}

/**
 * The attachments a planning draft named for one task, as the model wrote
 * them: only ids from the context it was given, each passed through
 * `aiVisibleItem`, deduplicated and capped at LIBRARY_MAX_TASK_ATTACHMENTS.
 * Anything else is dropped.
 */
export function draftAttachmentIds(
  library: LibraryAiReader | null,
  projectId: string,
  contextIds: ReadonlySet<string>,
  value: unknown
): string[] {
  if (!library || !Array.isArray(value)) return []
  const ids: string[] = []
  for (const entry of value) {
    if (ids.length >= LIBRARY_MAX_TASK_ATTACHMENTS) break
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (ids.includes(id) || !contextIds.has(id)) continue
    if (library.aiVisibleItem(projectId, id)) ids.push(id)
  }
  return ids
}

/**
 * The attachments a human approved for one drafted task: the ids they left
 * ticked, limited to what the draft itself proposed so an approval can only
 * remove Ostler AI's attachments, never add new ones under its name. An
 * approval that says nothing keeps the draft's proposal.
 */
export function approvedAttachmentIds(proposed: string[] | undefined, approved: unknown): string[] {
  const allowed = Array.isArray(proposed) ? proposed : []
  if (approved === undefined) return allowed.slice(0, LIBRARY_MAX_TASK_ATTACHMENTS)
  if (!Array.isArray(approved)) return []
  return allowed.filter((id) => approved.includes(id)).slice(0, LIBRARY_MAX_TASK_ATTACHMENTS)
}
