import { v4 as uuidv4 } from 'uuid'
import type { LibraryItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { isPictureMime } from '@shared/whiteboard/paste-rules'
import {
  WHITEBOARD_FILE_EXTENSION,
  WHITEBOARD_TITLE_MAX,
  buildWhiteboardFile,
  parseWhiteboardFile,
  remapWhiteboardIds,
  serializeWhiteboardFile,
  type WhiteboardFilePicture
} from '@shared/whiteboard/file-format'
import type { LibraryService } from './library-service'

/** The Library takes at most this many files a call. */
const IMPORT_BATCH = 50

export interface WhiteboardFileText {
  title: string
  text: string
  /** Pictures left out because their file is not on this PC (or is not a picture a file can carry). */
  missingPictures: number
}

/**
 * The whiteboard file of a stored board (plan `docs/plans/whiteboards/`,
 * prompt 16, D15), with no dialogs so it can be tested: the board as saved,
 * each picture read from the Library and embedded. A picture whose file is not
 * on this PC is left out and counted; its objects then draw as a missing
 * picture.
 */
export function whiteboardFileText(
  libraryService: LibraryService,
  projectId: string,
  whiteboardId: string
): WhiteboardFileText {
  const { item, objects } = libraryService.whiteboards.get(projectId, whiteboardId)
  const clean = objects.map((object) => cleanWhiteboardObject(object))
  const pictureIds = new Set<string>()
  for (const object of clean) {
    if (object.kind === 'image' && object.data.imageItemId !== null) {
      pictureIds.add(object.data.imageItemId)
    }
  }
  const pictures: WhiteboardFilePicture[] = []
  let missingPictures = 0
  for (const id of pictureIds) {
    try {
      const picture = libraryService.getItem(projectId, id)
      const { bytes, mimeType } = libraryService.readImage(projectId, id)
      if (!isPictureMime(mimeType)) throw new Error('Not a picture a whiteboard file carries')
      pictures.push({
        id,
        fileName: picture.file?.fileName || `${id}.${mimeType.split('/')[1]}`,
        mimeType,
        base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
      })
    } catch {
      missingPictures += 1
    }
  }
  const file = buildWhiteboardFile(item.title, clean, pictures)
  return { title: item.title, text: serializeWhiteboardFile(file), missingPictures }
}

/** Whether `bytes` start as a file of `mimeType` does (the types `isPictureMime` accepts). */
function looksLike(mimeType: string, bytes: Uint8Array): boolean {
  const starts = (...expected: number[]) => expected.every((value, index) => bytes[index] === value)
  switch (mimeType) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff)
    case 'image/gif':
      return starts(0x47, 0x49, 0x46, 0x38)
    case 'image/webp':
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
    default:
      return false
  }
}

/** The board's title when the file has none: its name without `.whiteboard.json` (or `.json`). */
function titleFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase()
  const suffix = [`.${WHITEBOARD_FILE_EXTENSION}`, '.json'].find((end) => lower.endsWith(end))
  return (suffix ? fileName.slice(0, -suffix.length) : fileName)
    .trim()
    .slice(0, WHITEBOARD_TITLE_MAX)
}

/**
 * A whiteboard file made into a new whiteboard (D15): every problem with the
 * file is a translated refusal and nothing is written; the pictures are
 * imported into the Library (one the project already holds is reused), and
 * the objects get fresh ids, their pictures the Library's.
 */
export async function importWhiteboardText(
  libraryService: LibraryService,
  projectId: string,
  text: string,
  fileName: string
): Promise<LibraryItem> {
  const parsed = parseWhiteboardFile(text)
  if (!parsed.ok) throw new Refusal(t(`errors:whiteboard.file.${parsed.problem}`))
  const { file } = parsed

  const decoded = file.pictures.map((picture) => ({
    picture,
    bytes: new Uint8Array(Buffer.from(picture.base64, 'base64'))
  }))
  if (decoded.some(({ picture, bytes }) => !looksLike(picture.mimeType, bytes))) {
    throw new Refusal(t('errors:whiteboard.file.invalid'))
  }

  const pictureIds = new Map<string, string>()
  for (let start = 0; start < decoded.length; start += IMPORT_BATCH) {
    const batch = decoded.slice(start, start + IMPORT_BATCH)
    const results = await libraryService.importFiles(
      projectId,
      batch.map(({ picture, bytes }) => ({
        fileName: picture.fileName,
        mimeType: picture.mimeType,
        bytes
      }))
    )
    results.forEach((result, index) => {
      if (result.item.kind === 'image') pictureIds.set(batch[index].picture.id, result.item.id)
    })
  }

  const objects: WhiteboardObjectInput[] = remapWhiteboardIds(file.objects, uuidv4, pictureIds)
  const title = file.title || titleFromFileName(fileName) || t('errors:whiteboard.file.untitled')
  return libraryService.whiteboards.create(projectId, { title, objects }).item
}
