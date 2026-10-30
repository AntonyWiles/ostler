/**
 * A bounded list of the project's own files, given to Ostler AI so it can cite
 * paths that exist instead of guessing them. Built from `listProjectFiles`
 * (`project-files.ts`), which respects `.gitignore` and includes new files.
 * The names come from the repository and are data, never instructions: they
 * travel inside the JSON evidence, stripped of control characters and capped.
 */
export interface RepositoryOutline {
  /** Source-like paths, repo-relative with forward slashes, sorted. */
  paths: string[]
  /** How many source-like files HEAD holds; more than `paths.length` when capped. */
  totalFiles: number
  truncated: boolean
}

export const REPOSITORY_OUTLINE_MAX_FILES = 400
export const REPOSITORY_OUTLINE_MAX_CHARS = 16_000
const MAX_PATH_LENGTH = 200

/** Directories that hold dependencies, build output or tooling rather than the project's own source. */
export const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'bin',
  'obj',
  'packages-cache'
])

/** Binary, generated or bulky files that add nothing a planner can cite usefully. */
const SKIPPED_EXTENSION =
  /\.(png|jpe?g|gif|bmp|ico|webp|avif|tiff?|psd|mp[34]|wav|ogg|webm|mov|avi|zip|gz|tgz|7z|rar|tar|exe|dll|so|dylib|pdb|bin|dat|db|sqlite3?|woff2?|ttf|otf|eot|pdf|lock|map|min\.js|min\.css|snap)$/i
const SKIPPED_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock'])

export function isSourceLikePath(path: string): boolean {
  const segments = path.split('/')
  const name = segments[segments.length - 1] ?? ''
  if (!name || SKIPPED_FILES.has(name) || SKIPPED_EXTENSION.test(name)) return false
  return !segments.slice(0, -1).some((segment) => SKIPPED_DIRECTORIES.has(segment))
}

/** Shapes a file listing (`listProjectFiles`, or NUL-separated text) into a bounded outline. */
export function buildRepositoryOutline(
  raw: string | string[],
  maxFiles = REPOSITORY_OUTLINE_MAX_FILES,
  maxChars = REPOSITORY_OUTLINE_MAX_CHARS
): RepositoryOutline | null {
  const candidates = (typeof raw === 'string' ? raw.split('\0') : raw)
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .map((entry) => entry.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter((entry) => entry && entry.length <= MAX_PATH_LENGTH && isSourceLikePath(entry))
    .sort()
  if (candidates.length === 0) return null
  const paths: string[] = []
  let chars = 0
  for (const path of candidates) {
    if (paths.length >= maxFiles || chars + path.length + 3 > maxChars) break
    paths.push(path)
    chars += path.length + 3
  }
  return { paths, totalFiles: candidates.length, truncated: paths.length < candidates.length }
}
