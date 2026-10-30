import path from 'path'

/**
 * Normalizes and resolves an input path to its absolute form.
 */
export function normalizeAndResolve(inputPath: string): string {
  return path.resolve(path.normalize(inputPath))
}

/**
 * Checks if filePath is within rootPath after normalization (prevents path traversal).
 */
export function isWithinRoot(filePath: string, rootPath: string): boolean {
  const resolvedFile = normalizeAndResolve(filePath)
  const resolvedRoot = normalizeAndResolve(rootPath)

  if (resolvedFile === resolvedRoot) {
    return true
  }
  return resolvedFile.startsWith(resolvedRoot + path.sep)
}

/**
 * Checks if the path is within any registered watched project.
 */
export function isWatchedProject(filePath: string, projectPaths: string[]): boolean {
  return projectPaths.some((projectPath) => isWithinRoot(filePath, projectPath))
}

/**
 * Case-folds for comparison on Windows only, because its filesystems are
 * case-insensitive: `C:\Repo` and `c:\repo` are one directory, and treating
 * them as two would let the same folder be registered twice.
 *
 * Deliberately separate from `isWithinRoot`, which stays an exact-match
 * containment check for validating attacker-influenced paths.
 */
function comparablePath(inputPath: string): string {
  const resolved = normalizeAndResolve(inputPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** True when both inputs name the same directory. */
export function pathsEqual(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

/** True when `candidate` sits strictly inside `root` (equal paths are false). */
export function containsPath(root: string, candidate: string): boolean {
  const comparableRoot = comparablePath(root)
  const comparableCandidate = comparablePath(candidate)
  if (comparableRoot === comparableCandidate) return false
  return comparableCandidate.startsWith(comparableRoot + path.sep)
}

/**
 * Removes null bytes and normalizes the path.
 */
export function sanitizePath(inputPath: string): string {
  const noNullBytes = inputPath.replace(/\0/g, '')
  return path.normalize(noNullBytes)
}
