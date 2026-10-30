import fs from 'node:fs'
import path from 'node:path'

/**
 * Path safety for every Ostler-owned storage namespace under the data
 * directory (AI drafts, the Library). Callers pass identifiers and fixed
 * segment names, never paths, and every resolved path is checked against the
 * canonical root, so stored or model-adjacent input cannot select a
 * destination outside Ostler user data.
 *
 * `label` only names the namespace in error messages.
 */

export function validateProjectId(projectId: string, label = 'AI storage'): void {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(projectId)) {
    throw new Error(`Invalid project identifier for ${label}`)
  }
}

function isWithinCanonicalRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/** One path segment under `parent`, refusing separators, dot segments and escapes. */
export function resolveWithinRoot(
  root: string,
  parent: string,
  child: string,
  label = 'AI storage'
): string {
  if (!child || child === '.' || child === '..' || path.isAbsolute(child) || /[\\/]/.test(child)) {
    throw new Error(`Invalid ${label} path segment`)
  }
  const resolved = path.resolve(parent, child)
  if (!isWithinCanonicalRoot(root, resolved)) {
    throw new Error(`${label} path escapes Ostler user data`)
  }
  return resolved
}

/** Creates (if needed) and returns root/segments..., refusing symlinks and junctions. */
export function ensureDirectory(root: string, segments: string[], label = 'AI storage'): string {
  let current = root
  for (const segment of segments) {
    current = resolveWithinRoot(root, current, segment, label)
    fs.mkdirSync(current, { recursive: true })
    const stat = fs.lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} directory must not be a symbolic link`)
    }
    if (!isWithinCanonicalRoot(root, fs.realpathSync.native(current))) {
      throw new Error(`${label} path escapes Ostler user data`)
    }
  }
  return current
}

/** The canonical data root: created if missing, symlinks resolved. */
export function canonicalRoot(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true })
  return fs.realpathSync.native(dataDir)
}
