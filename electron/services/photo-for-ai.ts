import { nativeImage } from 'electron'
import { LIBRARY_VISION_MAX_EDGE } from '@shared/ostler-api'
import { isAcceptedPhoto, type TasksFromTextPhoto } from '@shared/tasks-from-text'
import { t } from '@shared/i18n'
import { resizeToEdge } from './library-service'

/**
 * A photo the person added to "From text or a photo" (N4.1a), checked and
 * re-encoded in the main process. Decoding and writing a new JPEG drops every
 * EXIF field, the location included; `forAi` is also scaled down to what
 * providers accept. A photo Windows cannot decode (some HEIC files without
 * the HEIF extension) is refused with a plain message.
 */
export function preparePhoto(photo: unknown): {
  forAi: { mimeType: string; base64: string }
  /** The full-size copy, without EXIF, for Keep the photo. */
  keep: { fileName: string; mimeType: string; bytes: Uint8Array }
} {
  const value = photo as Partial<TasksFromTextPhoto> | null
  if (
    !value ||
    !(value.bytes instanceof Uint8Array) ||
    typeof value.mimeType !== 'string' ||
    !isAcceptedPhoto({ mimeType: value.mimeType, size: value.bytes.byteLength })
  ) {
    throw new Error(t('errors:tasksFromText.photoNotAccepted'))
  }
  const image = nativeImage.createFromBuffer(Buffer.from(value.bytes))
  if (image.isEmpty()) throw new Error(t('errors:tasksFromText.photoUnreadable'))
  const scaled = resizeToEdge(image, LIBRARY_VISION_MAX_EDGE)
  const base = String(value.fileName ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 80)
  return {
    forAi: { mimeType: 'image/jpeg', base64: scaled.toJPEG(85).toString('base64') },
    keep: {
      fileName: `${base || 'Photo'}.jpg`,
      mimeType: 'image/jpeg',
      bytes: new Uint8Array(image.toJPEG(90))
    }
  }
}
