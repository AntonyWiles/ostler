/**
 * Where the phone keeps the files it adds to the Library (voice memo recordings, picked files and
 * photos): one folder per Library item in the
 * app's documents, `library/<projectId>/<itemId>/original.<ext>`, the same layout the PC uses.
 * `phoneLibraryFiles` hands them to sync (`LibraryFileStore`), which sends each one to the
 * project's share once, sealed with the project key.
 */
import { Buffer } from 'buffer'
import { Directory, File, Paths } from 'expo-file-system'
import { createHash } from '../../../electron/services/sync/platform'
import type { LibraryFileStore } from '../../../electron/services/sync/library-files'
import { classifyLibraryFile, cleanFileName } from './library'

const SAFE_ID = /^[A-Za-z0-9-]{1,80}$/

function itemDirectory(projectId: string, itemId: string): Directory {
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(itemId)) throw new Error('Bad library id')
  return new Directory(Paths.document, 'library', projectId, itemId)
}

function extensionOf(uri: string): string {
  const match = /\.([a-z0-9]{1,10})$/i.exec(uri.split(/[?#]/)[0])
  return match ? match[1].toLowerCase() : 'bin'
}

/** The stored recording of an item, if this phone has it. */
export function storedRecording(projectId: string, itemId: string): File | null {
  try {
    const directory = itemDirectory(projectId, itemId)
    if (!directory.exists) return null
    const original = directory
      .list()
      .find((entry): entry is File => entry instanceof File && entry.name.startsWith('original.'))
    return original ?? null
  } catch {
    return null
  }
}

/** A finished recording, read once to name it by its content. */
export interface RecordingFile {
  uri: string
  extension: string
  sizeBytes: number
  sha256: string
}

/** Reads a recording the recorder left in the cache: its size and hash. Null when it is empty or gone. */
export function readRecording(uri: string): RecordingFile | null {
  const file = new File(uri)
  if (!file.exists) return null
  const bytes = file.bytesSync()
  if (bytes.byteLength === 0) return null
  return {
    uri,
    extension: extensionOf(uri),
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  }
}

/** Moves a recording from the cache to its item's folder. Returns the stored file. */
export async function keepRecording(
  recording: RecordingFile,
  projectId: string,
  itemId: string
): Promise<File> {
  const directory = itemDirectory(projectId, itemId)
  if (!directory.exists) directory.create({ intermediates: true })
  const target = new File(directory, `original.${recording.extension}`)
  await new File(recording.uri).move(target)
  return target
}

/** Removes a stored recording (its memo could not be saved). */
export function forgetRecording(projectId: string, itemId: string): void {
  try {
    const directory = itemDirectory(projectId, itemId)
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to remove.
  }
}

/** Deletes a recording that was not kept (discarded before it was attached). */
export function discardRecording(uri: string): void {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // Already gone.
  }
}

/** The recordings on this phone, for sync to send. Files from other devices are not fetched. */
export const phoneLibraryFiles: LibraryFileStore = {
  syncedOriginal(projectId, itemId) {
    const file = storedRecording(projectId, itemId)
    if (!file) return null
    try {
      return Buffer.from(file.bytesSync()) as unknown as ReturnType<
        LibraryFileStore['syncedOriginal']
      >
    } catch {
      return null
    }
  },
  receiveSyncedOriginal() {
    return Promise.reject(new Error('The phone does not fetch Library files'))
  }
}

/** A file picked or photographed, stored in its item's folder and ready for `addLibraryFile`. */
export interface KeptLibraryFile {
  itemId: string
  kind: 'image' | 'document'
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

/**
 * Copies a picked file (a document, a photo from the gallery or the camera) into a new Library
 * item's folder, named by what its bytes are, and hashes it. Sync then sends it like a recording.
 * Null when the file is empty or gone.
 */
export function keepPickedFile(
  uri: string,
  pickedName: string,
  pickedMime: string | null,
  projectId: string,
  itemId: string
): KeptLibraryFile | null {
  const source = new File(uri)
  if (!source.exists) return null
  const bytes = source.bytesSync()
  if (bytes.byteLength === 0) return null
  const fileName = cleanFileName(pickedName)
  const what = classifyLibraryFile(bytes.subarray(0, 16), fileName, pickedMime)
  const directory = itemDirectory(projectId, itemId)
  if (!directory.exists) directory.create({ intermediates: true })
  source.copy(new File(directory, `original.${what.extension}`))
  return {
    itemId,
    kind: what.kind,
    fileName,
    mimeType: what.mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  }
}
