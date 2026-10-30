import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardObject,
  isWhiteboardObjectId,
  type ConnectorEnd,
  type WhiteboardObjectInput
} from './model'
import { isPictureMime } from './paste-rules'

/**
 * The whiteboard file, as pure rules (plan `docs/plans/whiteboards/`,
 * decision D15): a whiteboard exported as `<title>.whiteboard.json` with its
 * pictures embedded as base64, and read back to make a new whiteboard. Also
 * the one rule for giving copied objects fresh ids, used by the file's
 * import, copy and paste, Duplicate and templates.
 *
 * The format id is a fixed literal, not built from `BRAND`: a file format id
 * must never change, even if the product is renamed again, or files already
 * written would stop opening. This follows `PROJECT_PACKAGE_FORMAT` in
 * `src/shared/project-package.ts`. Whiteboards are new, so there is no legacy
 * name to accept.
 *
 * Shared by main and the renderer, so it stays pure: base64 stays a string
 * here; callers encode and decode it.
 */

/** Fixed forever: see the comment above. */
export const WHITEBOARD_FILE_FORMAT = 'ostler-whiteboard'
export const WHITEBOARD_FILE_VERSION = 1
export const WHITEBOARD_FILE_EXTENSION = 'whiteboard.json'
export const WHITEBOARD_FILE_MAX_BYTES = 100 * 1024 * 1024
export const WHITEBOARD_FILE_MAX_PICTURES = 200
export const WHITEBOARD_TITLE_MAX = 200

/** One embedded picture, keyed by the Library item id its image objects name. */
export interface WhiteboardFilePicture {
  id: string
  fileName: string
  mimeType: string
  base64: string
}

export interface WhiteboardFile {
  format: typeof WHITEBOARD_FILE_FORMAT
  version: number
  title: string
  exportedAt: string
  objects: WhiteboardObjectInput[]
  pictures: WhiteboardFilePicture[]
}

export type WhiteboardFileProblem =
  'too-large' | 'not-json' | 'not-whiteboard' | 'newer-version' | 'invalid'

export type ParsedWhiteboardFile =
  { ok: true; file: WhiteboardFile } | { ok: false; problem: WhiteboardFileProblem }

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const FILE_NAME_MAX = 255

/** A deep copy of a JSON-safe value. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The file for a whiteboard. An image whose picture is not in `pictures`
 * gets `imageItemId: null`. Objects and pictures are copied, not shared.
 */
export function buildWhiteboardFile(
  title: string,
  objects: readonly WhiteboardObjectInput[],
  pictures: readonly WhiteboardFilePicture[],
  now: Date = new Date()
): WhiteboardFile {
  const pictureIds = new Set(pictures.map((picture) => picture.id))
  return {
    format: WHITEBOARD_FILE_FORMAT,
    version: WHITEBOARD_FILE_VERSION,
    title,
    exportedAt: now.toISOString(),
    objects: objects.map((object) => {
      const copied = copy(object)
      if (
        copied.kind === 'image' &&
        copied.data.imageItemId !== null &&
        !pictureIds.has(copied.data.imageItemId)
      ) {
        copied.data.imageItemId = null
      }
      return copied
    }),
    pictures: pictures.map((picture) => ({ ...picture }))
  }
}

export function serializeWhiteboardFile(file: WhiteboardFile): string {
  return JSON.stringify(file, null, 2)
}

function cleanPicture(value: unknown): WhiteboardFilePicture | null {
  if (!isRecord(value)) return null
  const { id, fileName, mimeType, base64 } = value
  if (!isWhiteboardObjectId(id)) return null
  if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > FILE_NAME_MAX) {
    return null
  }
  if (typeof mimeType !== 'string' || !isPictureMime(mimeType)) return null
  if (typeof base64 !== 'string' || !BASE64.test(base64)) return null
  return { id, fileName, mimeType, base64 }
}

/** Reads a whiteboard file, naming the first problem found (see the plan's prompt 02d for the order). */
export function parseWhiteboardFile(text: string): ParsedWhiteboardFile {
  const invalid = { ok: false, problem: 'invalid' } as const
  if (text.length > WHITEBOARD_FILE_MAX_BYTES) return { ok: false, problem: 'too-large' }
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'not-json' }
  }
  if (!isRecord(root) || root.format !== WHITEBOARD_FILE_FORMAT) {
    return { ok: false, problem: 'not-whiteboard' }
  }
  const version = root.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return invalid
  if (version > WHITEBOARD_FILE_VERSION) return { ok: false, problem: 'newer-version' }

  if (!Array.isArray(root.objects) || root.objects.length > WHITEBOARD_LIMITS.objects) {
    return invalid
  }
  const objects: WhiteboardObjectInput[] = []
  const objectIds = new Set<string>()
  for (const value of root.objects) {
    let object: WhiteboardObjectInput
    try {
      object = cleanWhiteboardObject(value)
    } catch {
      return invalid
    }
    if (objectIds.has(object.id)) return invalid
    objectIds.add(object.id)
    objects.push(object)
  }

  if (!Array.isArray(root.pictures) || root.pictures.length > WHITEBOARD_FILE_MAX_PICTURES) {
    return invalid
  }
  const pictures: WhiteboardFilePicture[] = []
  const pictureIds = new Set<string>()
  for (const value of root.pictures) {
    const picture = cleanPicture(value)
    if (!picture || pictureIds.has(picture.id)) return invalid
    pictureIds.add(picture.id)
    pictures.push(picture)
  }

  let title = ''
  if (root.title !== undefined && root.title !== null) {
    if (typeof root.title !== 'string') return invalid
    title = root.title.trim().slice(0, WHITEBOARD_TITLE_MAX)
  }
  const exportedAt = typeof root.exportedAt === 'string' ? root.exportedAt : ''

  return {
    ok: true,
    file: { format: WHITEBOARD_FILE_FORMAT, version, title, exportedAt, objects, pictures }
  }
}

/**
 * Copies of `objects` with fresh ids, for import, paste, Duplicate and
 * templates. Each old group gets one new group id. Connector ends and mind-map
 * parents inside the set follow their object to its new id; outside it, a
 * connector end comes loose where it was drawn and a mind-map node becomes a
 * central idea. With `pictureIds`, each image's picture id is looked up there
 * (missing gives null); without it, the picture id is kept.
 */
export function remapWhiteboardIds(
  objects: readonly WhiteboardObjectInput[],
  newId: () => string,
  pictureIds?: ReadonlyMap<string, string>
): WhiteboardObjectInput[] {
  const ids = new Map<string, string>()
  for (const object of objects) ids.set(object.id, newId())
  const groups = new Map<string, string>()
  const groupId = (old: string | null): string | null => {
    if (old === null) return null
    let fresh = groups.get(old)
    if (fresh === undefined) {
      fresh = newId()
      groups.set(old, fresh)
    }
    return fresh
  }
  const end = (old: ConnectorEnd): ConnectorEnd => {
    const objectId = old.objectId === null ? null : (ids.get(old.objectId) ?? null)
    return objectId !== null && old.node
      ? { objectId, x: old.x, y: old.y, node: old.node }
      : { objectId, x: old.x, y: old.y }
  }

  return objects.map((original) => {
    const object = copy(original)
    object.id = ids.get(original.id) as string
    object.groupId = groupId(original.groupId)
    switch (object.kind) {
      case 'connector':
        object.data.from = end(object.data.from)
        object.data.to = end(object.data.to)
        break
      case 'mindmap':
        object.data.parentId =
          object.data.parentId === null ? null : (ids.get(object.data.parentId) ?? null)
        break
      case 'image':
        if (pictureIds && object.data.imageItemId !== null) {
          object.data.imageItemId = pictureIds.get(object.data.imageItemId) ?? null
        }
        break
    }
    return object
  })
}
