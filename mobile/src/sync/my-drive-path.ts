/**
 * A PC that shares through Google Drive for desktop writes invites whose place is a folder on disk
 * (`G:\My Drive\Ostler\Projects\Testing (fe401535)`). The phone has no such folder, but the same
 * folder is in the person's My Drive, so a path inside My Drive is read as a Drive place: the first
 * folder is found in the root of My Drive, and the rest becomes the place's path. A personal-space
 * entry names its folder relative to the root that holds the space, which for a phone is My Drive.
 */
import type { DriveFile } from '../../../electron/services/sync/drive-client'
import { driveLocation, isDriveLocation } from '../../../electron/services/sync/drive-transport'

/** The folders below My Drive in a Drive for desktop path (Windows or macOS), or null for any other path. */
export function myDriveSegments(path: string): string[] | null {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '')
  const at = parts.lastIndexOf('My Drive')
  if (at < 0) return null
  const below = parts.slice(at + 1)
  if (
    below.length === 0 ||
    below.some((part) => part === '.' || part === '..' || part.includes(':'))
  ) {
    return null
  }
  return below
}

/**
 * The Drive place of a folder below the root of My Drive, given as its folder names from the top;
 * null when the top folder is not in My Drive. Of several same-named folders the oldest wins, as
 * everywhere else in Drive sync.
 */
export async function myDriveFolder(
  segments: string[],
  findInRoot: (name: string) => Promise<DriveFile[]>
): Promise<string | null> {
  const [top, ...rest] = segments
  if (top === undefined) return null
  const folders = await findInRoot(top)
  const oldest = [...folders].sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0]
  return oldest ? driveLocation(oldest.id, rest.join('/')) : null
}

/**
 * The Drive place for `place`: unchanged when it already is one, the matching My Drive folder for a
 * Drive for desktop path, or null when it is neither or the top folder is not in My Drive.
 */
export async function drivePlaceFor(
  place: string,
  findInRoot: (name: string) => Promise<DriveFile[]>
): Promise<string | null> {
  if (isDriveLocation(place)) return place
  const segments = myDriveSegments(place)
  return segments ? myDriveFolder(segments, findInRoot) : null
}
