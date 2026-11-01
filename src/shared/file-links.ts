import { isEntityId } from './deep-link'

/**
 * Links to files in a project's linked folder, written in texts as
 * `<scheme>://file/<projectId>/<path>` (`ostler://file/<projectId>/docs/plan.md`),
 * with each part of the path percent-encoded where it needs to be. Ostler
 * opens them itself, from a click in the app; they are never taken from
 * other programs. The path is always relative to the folder: no drive, no
 * leading slash, no `.` or `..` parts and no backslashes, so a link can only
 * ever name something inside it.
 */

/** Longer than any path a person would link to. */
const MAX_PATH_LENGTH = 1000

export interface FileLinkTarget {
  projectId: string
  /** Relative to the project's folder, with forward slashes. */
  path: string
}

/** A relative path as a link may carry it, or null when it could leave the folder. */
export function cleanProjectPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) return null
  if (/[\\\0:*?"<>|]/.test(raw)) return null
  const parts = raw.replace(/^\.\//, '').split('/')
  // A trailing slash names a folder; the parts before it are what count.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return parts.join('/')
}

/** The file a link points at, or null when it is not a file link of this scheme. */
export function fileLinkTarget(url: string, scheme: string): FileLinkTarget | null {
  const prefix = `${scheme}://file/`
  if (url.slice(0, prefix.length).toLowerCase() !== prefix) return null
  const rest = url.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const projectId = rest.slice(0, slash)
  if (!isEntityId(projectId)) return null
  let decoded: string
  try {
    decoded = rest
      .slice(slash + 1)
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/')
  } catch {
    return null
  }
  const path = cleanProjectPath(decoded)
  return path ? { projectId, path } : null
}

/** The link for a file in a project's folder (the inverse of `fileLinkTarget`). */
export function fileLinkUrl(target: FileLinkTarget, scheme: string): string {
  const path = target.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `${scheme}://file/${target.projectId}/${path}`
}

/**
 * A link's target written as a path relative to the project (`docs/plan.md`,
 * `./notes/a.txt`), as people and agents often write them: the path, or null
 * for anything else (a web address, another scheme, `/risk`, `#heading`).
 */
export function relativeFileHref(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null
  let decoded: string
  try {
    decoded = decodeURI(href.split('#')[0]!.split('?')[0]!)
  } catch {
    return null
  }
  return cleanProjectPath(decoded)
}

/**
 * Files opened in the program Windows has for them. Anything else (programs,
 * scripts, shortcuts, unknown types) is shown in Explorer instead, never run.
 */
const OPENABLE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'log',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'csv',
  'tsv',
  'ts',
  'tsx',
  'css',
  'scss',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf'
])

/** Whether a file of this name is opened in its program (true) or shown in Explorer (false). */
export function isOpenableFile(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return OPENABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}
