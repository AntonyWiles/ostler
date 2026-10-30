import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { isWithinRoot } from '../paths'
import { READ_FENCE_TAG } from '@shared/chat-proposals'
import { matchesIgnorePattern } from './file-watcher'
import {
  buildRepositoryOutline,
  SKIPPED_DIRECTORIES,
  type RepositoryOutline
} from './repository-outline'

/**
 * How Ostler AI reads a project's folder: the one module that lists and reads
 * its files. Read-only throughout. Coding agents never come through here; they
 * see only their own copy of the project.
 *
 * File contents are data, never instructions: every caller puts them inside
 * the evidence it sends, under a heading that says so.
 */

/** The context a model is assumed to have, in tokens, unless Settings › Advanced lowers it. */
export const DEFAULT_AI_CONTEXT_TOKENS = 100_000
/** The smallest "AI context size" Settings accepts. */
export const MIN_AI_CONTEXT_TOKENS = 8_000
/** The share of the context files may take; the rest is for records, the conversation and the reply. */
const FILE_SHARE = 0.6
/** A rough, provider-neutral token size. */
const CHARS_PER_TOKEN = 4
/** A single file larger than this is never read whole. */
const MAX_FILE_BYTES = 512 * 1024
const MAX_LISTED_PATH_LENGTH = 300

/** How many characters of file text one request may carry. */
export function projectFileBudgetChars(contextTokens: number | undefined): number {
  const tokens =
    typeof contextTokens === 'number' && Number.isFinite(contextTokens)
      ? Math.max(MIN_AI_CONTEXT_TOKENS, Math.round(contextTokens))
      : DEFAULT_AI_CONTEXT_TOKENS
  return Math.floor(tokens * FILE_SHARE * CHARS_PER_TOKEN)
}

function cleanListedPath(entry: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return entry.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/**
 * Every file in the folder that is not ignored, repo-relative with forward
 * slashes, sorted. In a folder with version history this is Git's own list
 * (`--cached --others --exclude-standard`), which respects `.gitignore` and
 * includes new files. A folder without it is walked, skipping dependency and
 * build folders, hidden folders and the project's own ignore patterns.
 */
export async function listProjectFiles(
  root: string,
  ignorePatterns: string[] = []
): Promise<string[]> {
  let listed: string[] | null = null
  try {
    if (fs.existsSync(path.join(root, '.git'))) {
      const raw = await simpleGit(root).raw([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z'
      ])
      listed = raw.split('\0')
    }
  } catch {
    listed = null
  }
  const files = (listed ?? walkFolder(root))
    .map(cleanListedPath)
    .filter((entry) => entry && entry.length <= MAX_LISTED_PATH_LENGTH)
    .filter((entry) => !ignorePatterns.some((pattern) => matchesIgnorePattern(entry, pattern)))
  return [...new Set(files)].sort()
}

function walkFolder(root: string, limit = 20_000): string[] {
  const found: string[] = []
  const visit = (relative: string) => {
    if (found.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= limit) return
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        visit(child)
      } else if (entry.isFile()) {
        found.push(child)
      }
    }
  }
  visit('')
  return found
}

export interface ProjectFile {
  path: string
  content: string
}

/**
 * One text file, or null when it is missing, a folder, binary (a NUL byte in
 * its first 8000 bytes, the check `code-workspace-service.ts` makes) or too
 * large. A path outside the folder is refused outright.
 */
export function readProjectFile(root: string, relativePath: string): ProjectFile | null {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '')
  const target = path.resolve(root, normalized)
  if (!isWithinRoot(target, root)) throw new Error('That path is outside the project folder.')
  let stat: fs.Stats
  try {
    stat = fs.statSync(target)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
  const buffer = fs.readFileSync(target)
  if (buffer.subarray(0, 8000).includes(0)) return null
  return { path: path.relative(root, target).replace(/\\/g, '/'), content: buffer.toString('utf8') }
}

export interface ProjectFolderRead {
  files: ProjectFile[]
  /** Paths that were asked for but not sent: over the budget, binary or unreadable. */
  omitted: string[]
  /** A sentence naming what was left out, or '' when nothing was. */
  note: string
}

/**
 * Reads the given paths in order, where a path naming a folder stands for
 * every listed file under it, until the budget is used. What did not fit is
 * named in the note so the model knows it saw only part.
 */
export function readProjectPaths(
  root: string,
  requested: string[],
  listing: string[],
  budgetChars: number
): ProjectFolderRead {
  const wanted: string[] = []
  for (const raw of requested) {
    const request = raw
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
    if (!request) continue
    if (listing.includes(request)) {
      wanted.push(request)
      continue
    }
    const prefix = `${request}/`
    wanted.push(...listing.filter((entry) => entry.startsWith(prefix)))
  }
  const files: ProjectFile[] = []
  const omitted: string[] = []
  let used = 0
  for (const entry of [...new Set(wanted)]) {
    let file: ProjectFile | null = null
    try {
      file = readProjectFile(root, entry)
    } catch {
      file = null
    }
    if (!file || used + file.content.length > budgetChars) {
      omitted.push(entry)
      continue
    }
    files.push(file)
    used += file.content.length
  }
  const note = omitted.length
    ? `Left out (over the size limit, binary or unreadable): ${omitted.slice(0, 30).join(', ')}${omitted.length > 30 ? `, and ${omitted.length - 30} more` : ''}.`
    : ''
  return { files, omitted, note }
}

/** A folder's text files in path order until the budget is used. */
export async function readProjectFolder(
  root: string,
  relativeFolder: string,
  budgetChars: number,
  ignorePatterns: string[] = []
): Promise<ProjectFolderRead> {
  const listing = await listProjectFiles(root, ignorePatterns)
  const folder = relativeFolder
    .replace(/\\/g, '/')
    .replace(/^\.?\/?/, '')
    .replace(/\/+$/, '')
  return readProjectPaths(root, folder ? [folder] : listing, listing, budgetChars)
}

/**
 * The listed files and folders a piece of text names, such as
 * `marketing/agents/roles/` or `README.md`, longest first so a folder and a
 * file inside it are not both read.
 */
export function pathsNamedIn(text: string, listing: string[]): string[] {
  const folders = new Set<string>()
  for (const entry of listing) {
    const parts = entry.split('/')
    for (let index = 1; index < parts.length; index += 1)
      folders.add(parts.slice(0, index).join('/'))
  }
  const candidates = text.match(/[\w.@-]+(?:[/\\][\w.@-]+)*[/\\]?/g) ?? []
  const named = new Set<string>()
  for (const raw of candidates) {
    const candidate = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!candidate || candidate.length < 3) continue
    // A bare word names a file only when it looks like one (README.md, not "the").
    if (!candidate.includes('/') && !candidate.includes('.')) continue
    if (listing.includes(candidate)) named.add(candidate)
    else if (candidate.includes('/') && folders.has(candidate)) named.add(candidate)
  }
  const sorted = [...named].sort((a, b) => a.length - b.length)
  return sorted.filter(
    (entry, index) => !sorted.slice(0, index).some((shorter) => entry.startsWith(`${shorter}/`))
  )
}

/** The README and the top-level overview documents, in the order a reader would want them. */
export function overviewFiles(listing: string[]): string[] {
  const readme = listing.filter((entry) => /^readme(\.[a-z]+)?$/i.test(entry))
  const docs = listing.filter(
    (entry) =>
      /^docs\/[^/]+\.(md|txt|rst)$/i.test(entry) &&
      /(readme|overview|architecture|index|intro|getting-started)/i.test(entry)
  )
  const topLevel = listing.filter(
    (entry) =>
      !entry.includes('/') &&
      /\.(md|txt)$/i.test(entry) &&
      /(overview|architecture|contributing|agents|design)/i.test(entry)
  )
  return [...new Set([...readme, ...docs, ...topLevel])]
}

/** The paths a reply asks for in `ostler-read` blocks: one path per line, or a JSON list. */
export function parseReadRequests(reply: string): string[] {
  const requests: string[] = []
  const pattern = new RegExp('```' + READ_FENCE_TAG + '\\s*\\n([\\s\\S]*?)```', 'g')
  for (const match of reply.matchAll(pattern)) {
    const body = match[1].trim()
    try {
      const parsed = JSON.parse(body) as unknown
      const list = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { paths?: unknown }).paths)
          ? (parsed as { paths: unknown[] }).paths
          : []
      requests.push(...list.filter((entry): entry is string => typeof entry === 'string'))
      continue
    } catch {
      // Not JSON: one path per line.
    }
    requests.push(...body.split(/\r?\n/).map((line) => line.trim()))
  }
  return [...new Set(requests.map((entry) => entry.replace(/^[-*]\s+/, '')).filter(Boolean))]
}

/** Removes `ostler-read` blocks from a reply, so the person never sees the request itself. */
export function stripReadRequests(reply: string): string {
  const pattern = new RegExp('```' + READ_FENCE_TAG + '\\s*\\n[\\s\\S]*?```\\s*', 'g')
  return reply.replace(pattern, '').trim()
}

/** Files as a markdown section of the evidence, each in its own fence. */
export function formatProjectFiles(read: ProjectFolderRead): string {
  const sections = read.files.map((file) => {
    const fence = file.content.includes('```') ? '~~~~' : '```'
    return `### ${file.path}\n${fence}\n${file.content}\n${fence}`
  })
  return [...sections, ...(read.note ? [read.note] : [])].join('\n\n')
}

/** Where a project's files are, for a reader that knows only the project id. */
export interface ProjectFolderRef {
  root: string
  ignorePatterns: string[]
}

/** What a request carries about the folder: the list, and the files it reads. */
export interface ProjectFileEvidence {
  folderFiles?: RepositoryOutline
  projectFiles?: ProjectFile[]
  projectFilesNote?: string
}

/**
 * The folder as evidence for one request: always the file list, plus the
 * overview documents when asked, plus the files and folders `namedIn` texts
 * mention, read until the budget is used. Never throws: a folder that cannot
 * be read is simply left out.
 */
export async function buildProjectFileEvidence(
  folder: ProjectFolderRef | null,
  options: { budgetChars: number; overview?: boolean; namedIn?: string[]; paths?: string[] }
): Promise<ProjectFileEvidence> {
  if (!folder) return {}
  try {
    const listing = await listProjectFiles(folder.root, folder.ignorePatterns)
    if (listing.length === 0) return {}
    const requested = [
      ...(options.paths ?? []),
      ...(options.namedIn ?? []).flatMap((text) => pathsNamedIn(text, listing)),
      ...(options.overview ? overviewFiles(listing) : [])
    ]
    const read = requested.length
      ? readProjectPaths(folder.root, requested, listing, options.budgetChars)
      : null
    const outline = buildRepositoryOutline(listing)
    return {
      ...(outline ? { folderFiles: outline } : {}),
      ...(read && read.files.length ? { projectFiles: read.files } : {}),
      ...(read?.note ? { projectFilesNote: read.note } : {})
    }
  } catch {
    return {}
  }
}

/** A registered project's folder for reading, or null when it has none linked. */
export function projectFolderRef(
  project: { path: string | null; customIgnorePatterns?: string[] } | undefined
): ProjectFolderRef | null {
  if (!project?.path) return null
  return { root: project.path, ignorePatterns: project.customIgnorePatterns ?? [] }
}
