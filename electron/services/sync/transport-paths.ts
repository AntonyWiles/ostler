/**
 * Path rules and the refusal error every sync transport shares. Nothing here touches Node or the
 * file system, so the sync engine's core files (and the phone) can use it.
 */

export type SyncTransportErrorReason = 'bad-path' | 'exists'
export class SyncTransportError extends Error {
  constructor(readonly reason: SyncTransportErrorReason) {
    super(`Sync folder refused: ${reason}`)
  }
}

/** Hidden and temporary files are never listed. */
export function isHiddenOrTemp(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.tmp')
}

/**
 * Splits a relative path into segments. Refuses backslashes, colons, a leading
 * slash, empty segments and `.` or `..` segments. The empty path is only
 * allowed when `allowRoot` is set (the root folder).
 */
export function segmentsOf(relativePath: string, allowRoot: boolean): string[] {
  if (relativePath === '') {
    if (allowRoot) return []
    throw new SyncTransportError('bad-path')
  }
  if (relativePath.includes('\\') || relativePath.includes(':') || relativePath.startsWith('/')) {
    throw new SyncTransportError('bad-path')
  }
  const segments = relativePath.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SyncTransportError('bad-path')
    }
  }
  return segments
}
