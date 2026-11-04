/**
 * Sound files a Library item can hold, such as a voice memo recorded on the phone. They are kept
 * as documents with no text of their own; a memo's transcript, when there is one, is the item's
 * body.
 */
export const AUDIO_MIME: Readonly<Record<string, string>> = {
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac'
}

/** The sound type of a file name's extension, or null when it is not a sound file. */
export function audioMimeFor(fileName: string): string | null {
  const match = /\.([a-z0-9]{1,10})$/i.exec(fileName)
  return match ? (AUDIO_MIME[match[1].toLowerCase()] ?? null) : null
}

/** Whether a stored file is a sound file, by its type. */
export function isAudioMime(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('audio/')
}

/** A length in milliseconds as `m:ss` (or `h:mm:ss`), for a recording's duration. */
export function formatAudioDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
