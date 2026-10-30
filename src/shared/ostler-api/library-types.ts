// ─── Project Library Types ──────────────────────────────────────────────────
//
// The Library holds a project's briefs, guides, references, documents, links
// and notes. Ostler's own AI reads it; coding agents do not, except for items
// explicitly attached to their work item.

export type LibraryItemKind =
  'brief' | 'guide' | 'note' | 'document' | 'image' | 'link' | 'whiteboard'

/** Who may read an item: every AI request, only when selected, or never an AI. */
export type LibraryAiAccess = 'always' | 'when-selected' | 'human-only'

export type LibraryAttachedBy = 'human' | 'ostler-ai' | 'automation'

export const DEFAULT_AI_ACCESS: Record<LibraryItemKind, LibraryAiAccess> = {
  brief: 'always',
  guide: 'always',
  image: 'when-selected',
  document: 'when-selected',
  link: 'when-selected',
  note: 'human-only',
  whiteboard: 'when-selected'
}

/** A note started as meeting notes: When selected, so Find actions works on it at once. */
export const MEETING_NOTES_AI_ACCESS: LibraryAiAccess = 'when-selected'

/** A picture from Snip to task: When selected, attached to its task through the usual gate. */
export const SNIP_AI_ACCESS: LibraryAiAccess = 'when-selected'

/**
 * Text budget for the full sections of one Ostler AI chat message's library
 * context: it goes with every message, so it stays small. The project's
 * primary brief is always sent whole, first, even when it alone is longer;
 * the other items fill what is left.
 */
export const LIBRARY_CONTEXT_BUDGET_CHARS = 20_000
/**
 * The same budget for a planning action (plans, task splits and the other
 * drafts made from the Library), which runs once and needs the guides whole.
 */
export const LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS = 100_000
/** Which budget a library context is made for. */
export type LibraryContextUse = 'chat' | 'planning'
/** Images from 'always' items included in one request. */
export const LIBRARY_MAX_ALWAYS_IMAGES = 4
/** Images of any access level included in one request. */
export const LIBRARY_MAX_IMAGES_PER_REQUEST = 8
/** Library items attached for one work item's agent. */
export const LIBRARY_MAX_TASK_ATTACHMENTS = 6
export const LIBRARY_MAX_FILE_BYTES = 25 * 1024 * 1024
export const LIBRARY_MAX_EXTRACTED_CHARS = 120000
/**
 * The version of the text reader (N4.5). A file read by an older one, or
 * before readers had versions, is read again once in the background.
 */
export const LIBRARY_TEXT_READER_VERSION = 1
/** Office files: at most this much unzipped XML is read from one file. */
export const LIBRARY_MAX_UNZIPPED_BYTES = 100 * 1024 * 1024
/** Office files: a zip with more entries than this is not read. */
export const LIBRARY_MAX_ZIP_ENTRIES = 10_000
/** Office files: XML nested deeper than this is not read. */
export const LIBRARY_MAX_XML_DEPTH = 256
/** Starts each page, slide or sheet after the first in a file's extracted text. */
export const LIBRARY_SECTION_BREAK = ''

/** The background pass reading files for search (N4.5): files read so far, of all to read. */
export interface LibraryTextProgress {
  done: number
  total: number
}

/** Where in a file a passage is: a PDF's page, a slide, or a sheet. */
export interface LibraryTextLocation {
  kind: 'page' | 'slide' | 'sheet'
  /** The page or slide number, or the sheet's name. */
  label: string
}

/**
 * How a file's extracted text is divided: `LIBRARY_SECTION_BREAK` starts each
 * section after the first. Pages and slides are numbered from 1; sheets are
 * named by `labels`.
 */
export interface LibraryTextSections {
  kind: LibraryTextLocation['kind']
  labels?: string[]
}
/** Long edge of the vision copy, the only file ever sent to an AI provider. */
export const LIBRARY_VISION_MAX_EDGE = 1568

export interface LibraryFileInfo {
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  width?: number
  height?: number
  pageCount?: number
  extractedChars?: number
  /** Which text reader read the file (`LIBRARY_TEXT_READER_VERSION`); absent before N4.5. */
  textReader?: number
  /** The reader could not read the file's text: the file is kept, with no text. */
  textUnreadable?: boolean
  /** Pages, slides or sheets in the extracted text. */
  textSections?: LibraryTextSections
  hasThumbnail: boolean
  hasVisionCopy: boolean
}

export interface LibraryItem {
  id: string
  projectId: string
  kind: LibraryItemKind
  title: string
  /** The one line "what should Ostler AI take from this". */
  summary: string
  /**
   * Markdown for brief, guide and note; the caption or notes for image and link. A whiteboard's
   * body is its outline, written by the service from its objects on every save, never typed.
   */
  body: string
  /** Links only. */
  url: string | null
  file: LibraryFileInfo | null
  aiAccess: LibraryAiAccess
  isPrimaryBrief: boolean
  tags: string[]
  revision: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface CreateLibraryItemInput {
  /** Files arrive through import, so only these kinds are created directly. */
  kind: 'brief' | 'guide' | 'note' | 'link'
  title: string
  summary?: string
  body?: string
  url?: string
  aiAccess?: LibraryAiAccess
  tags?: string[]
  isPrimaryBrief?: boolean
}

export interface UpdateLibraryItemInput {
  title?: string
  summary?: string
  body?: string
  url?: string
  aiAccess?: LibraryAiAccess
  tags?: string[]
}

export interface ImportLibraryFileInput {
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export interface ImportLibraryResult {
  item: LibraryItem
  /** Set when the project already held this exact file; `item` is that existing item. */
  duplicateOf?: string
}

export interface LibraryQuery {
  kind?: LibraryItemKind
  tag?: string
  access?: LibraryAiAccess
  includeArchived?: boolean
  search?: string
}

export interface LibraryRevision {
  itemId: string
  revision: number
  title: string
  summary: string
  body: string
  createdAt: string
}

export interface WorkItemSource {
  item: LibraryItem
  revisionAtLink: number
  currentRevision: number
  changedSince: boolean
}

export interface WorkItemAttachment {
  item: LibraryItem
  attachedBy: LibraryAttachedBy
  revisionAtAttach: number
  currentRevision: number
  changedSince: boolean
  attachedAt: string
}

/** A work item an item is a source of, seen from the item. */
export interface LibraryItemSourceLink {
  workItemId: string
  workItemTitle: string
  revisionAtLink: number
  currentRevision: number
  changedSince: boolean
  linkedAt: string
}

/** A work item an item is attached to, seen from the item. */
export interface LibraryItemAttachmentLink {
  workItemId: string
  workItemTitle: string
  /** The plan task code ("B4.1"); empty for items not from an agent plan. */
  workItemCode: string
  attachedBy: LibraryAttachedBy
  revisionAtAttach: number
  currentRevision: number
  changedSince: boolean
  attachedAt: string
}

/** A library item, at the revision Ostler AI read, that fed one AI draft. */
export interface AIDraftSource {
  libraryItemId: string
  revision: number
  title: string
}

/** What a library context contains, without its content. Safe to send to the renderer. */
export interface LibraryAiContextSummary {
  included: { id: string; title: string; revision: number; chars: number }[]
  listed: { id: string; kind: LibraryItemKind; title: string; summary: string }[]
  totalChars: number
  budgetChars: number
  imageCount: number
  maxImages: number
  overBudget: boolean
  imagesDropped: number
}

/**
 * The full context for one Ostler AI request. Main process only: it carries
 * image data and must never cross IPC.
 */
export interface LibraryAiContext extends LibraryAiContextSummary {
  markdown: string
  images: { itemId: string; title: string; mimeType: string; base64: string }[]
}
