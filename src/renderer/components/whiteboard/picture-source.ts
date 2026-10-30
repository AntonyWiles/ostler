import { snapPoint, type Point } from '@shared/whiteboard/geometry'
import { WHITEBOARD_DEFAULT_SIZES, WHITEBOARD_PICTURE_BOX } from '@shared/whiteboard/model'

/** A Library picture the editor can put on a board (D11). */
export interface PictureRef {
  /** The Library image item. */
  itemId: string
  title: string
  /** The picture's own size in pixels, when the Library knows it. */
  width?: number
  height?: number
  /** A small copy for choosing it (`ostler-library:` thumb), when the host has one. */
  thumbnailUrl?: string
}

/**
 * Where the editor gets pictures (plan `docs/plans/whiteboards/`, prompt 11,
 * D11): the host implements it with the Library IPC, so the editor holds no
 * IPC of its own. Every picture becomes (or is found as) a Library image
 * item; the host reports its own failures and answers with what worked.
 */
export interface WhiteboardPictureSource {
  /** Pictures dropped or pasted, as bytes; a file the project already holds comes back as that item. */
  importFiles(files: File[]): Promise<PictureRef[]>
  /** Main's file picker, offering pictures; empty when cancelled. */
  pickFiles(): Promise<PictureRef[]>
  /** The project's Library pictures, to choose from. */
  listLibraryPictures(): Promise<PictureRef[]>
}

/** Pictures laid side by side are this far apart. */
export const PICTURE_GAP = 20
/** The size a picture of unknown size gets. */
const UNKNOWN_PICTURE = { width: 480, height: 360 }

/** D29: a picture's size on the board, fitted inside 480 × 480 keeping its ratio; never enlarged. */
export function pictureSize(picture: Pick<PictureRef, 'width' | 'height'>): {
  width: number
  height: number
} {
  const { width, height } = picture
  if (!width || !height || width <= 0 || height <= 0) return { ...UNKNOWN_PICTURE }
  const scale = Math.min(1, WHITEBOARD_PICTURE_BOX / width, WHITEBOARD_PICTURE_BOX / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/** Boxes for pictures laid side by side, `PICTURE_GAP` apart, the row centred on `centre`. */
export function pictureBoxes(
  pictures: readonly Pick<PictureRef, 'width' | 'height'>[],
  centre: Point
): { x: number; y: number; width: number; height: number }[] {
  const sizes = pictures.map(pictureSize)
  const total =
    sizes.reduce((sum, size) => sum + size.width, 0) + PICTURE_GAP * Math.max(0, sizes.length - 1)
  let x = Math.round(centre.x - total / 2)
  return sizes.map((size) => {
    const box = { x, y: Math.round(centre.y - size.height / 2), ...size }
    x += size.width + PICTURE_GAP
    return box
  })
}

/** D16: pasted lines go in a grid of this many columns. */
export const LINE_COLUMNS = 5
/** D16: the grid's notes are this far apart, left edge to left edge and top to top. */
export const LINE_PITCH = 220

/** Top-left corners for `count` notes in a grid of five columns, 220 apart, centred on `centre`. */
export function lineGrid(count: number, centre: Point): Point[] {
  const note = WHITEBOARD_DEFAULT_SIZES.note
  const columns = Math.min(LINE_COLUMNS, count)
  const rows = Math.ceil(count / LINE_COLUMNS)
  const width = (columns - 1) * LINE_PITCH + note.width
  const height = (rows - 1) * LINE_PITCH + note.height
  const start = snapPoint({ x: centre.x - width / 2, y: centre.y - height / 2 })
  return Array.from({ length: count }, (_, index) => ({
    x: start.x + (index % LINE_COLUMNS) * LINE_PITCH,
    y: start.y + Math.floor(index / LINE_COLUMNS) * LINE_PITCH
  }))
}
