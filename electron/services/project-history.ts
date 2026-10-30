import { execFile } from 'child_process'
import { LEGACY_NAMES } from '@shared/legacy-names'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import type {
  ProjectHistoryEntry,
  ProjectHistoryEntryKind,
  ProjectHistoryFilter,
  ProjectUndoResult
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

/**
 * The project folder's version history, the way the person sees it (simplify
 * pass §3). Git does the work and the person never needs to know it:
 *
 * - Ostler adds entries only on top of the folder's current line of work, and
 *   only by fast-forwarding to a commit it built from trees. The working tree
 *   moves only when the new entry is ready, so a clash never leaves conflict
 *   markers behind: it is reported and nothing changes.
 * - Before Ostler touches the folder it saves the person's edits as a "Your
 *   edits" entry (§3.4), unless they manage their own history, and it records
 *   a restore point under `refs/ostler/restore/`.
 * - Undo, undo of an undo and "restore to this point" are new entries. History
 *   is never rewritten and nothing is deleted, apart from expired restore
 *   points and discarded work (`refs/ostler/discarded/`), after the retention
 *   period.
 *
 * Every entry Ostler makes carries trailers that say what it is, which is how
 * the History view tells a task from "Your edits" or an undo.
 */

export const ENTRY_TRAILER = 'Ostler-Entry'
export const TASK_TRAILER = 'Ostler-Task'
export const UNDOES_TRAILER = 'Ostler-Undoes'
/** Entries made before the product was renamed carry these instead; read, never written. */
const LEGACY_TRAILERS = ['Nexus-Entry', 'Nexus-Task', 'Nexus-Undoes'] as const

export const RESTORE_REF_PREFIX = 'refs/ostler/restore/'
export const DISCARDED_REF_PREFIX = 'refs/ostler/discarded/'
export const DEFAULT_RETENTION_DAYS = 30

/** The identity Ostler commits with when the folder has none configured. */
const OSTLER_IDENTITY = ['-c', `user.name=${BRAND.name}`, '-c', 'user.email=ostler@localhost']

export interface HistoryOptions {
  /** Save the person's edits as an entry before touching the folder (Settings › Advanced). */
  saveMyEdits: boolean
}

function gitFor(folder: string): SimpleGit {
  return simpleGit(folder)
}

/** True when `folder` is the top of its own repository, not a folder inside someone else's. */
export function hasOwnRepository(folder: string): boolean {
  return fs.existsSync(path.join(folder, '.git'))
}

async function identityArgs(git: SimpleGit): Promise<string[]> {
  try {
    const name = (await git.raw(['config', 'user.name'])).trim()
    const email = (await git.raw(['config', 'user.email'])).trim()
    if (name && email) return []
  } catch {
    // Unset: git exits 1.
  }
  return OSTLER_IDENTITY
}

/**
 * Sets up version history in a folder that has none (§2.1): `git init` plus a
 * first entry holding everything Git is not told to ignore. Silent, and only
 * the first time a copy is prepared.
 */
export async function ensureRepository(folder: string): Promise<void> {
  if (hasOwnRepository(folder)) return
  const git = gitFor(folder)
  await git.raw(['init'])
  await git.raw(['add', '-A'])
  await git.raw([
    ...(await identityArgs(git)),
    'commit',
    '--allow-empty',
    '-m',
    t('projects:history.firstEntry'),
    '-m',
    `${ENTRY_TRAILER}: first`
  ])
}

export interface FolderVersion {
  /** The line of work the folder is on, or null when it is detached. */
  version: string | null
  commit: string | null
}

export async function currentVersion(folder: string): Promise<FolderVersion> {
  const git = gitFor(folder)
  let version: string | null = null
  let commit: string | null = null
  try {
    version = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null
  } catch {
    version = null
  }
  try {
    commit = (await git.raw(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() || null
  } catch {
    commit = null
  }
  return { version, commit }
}

/** Edits Git would save: changed tracked files and new files it is not told to ignore. */
export async function unsavedFiles(folder: string): Promise<string[]> {
  const status = await gitFor(folder).raw([
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ])
  const files: string[] = []
  const entries = status.split('\0')
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    // A rename carries its old path as the next entry.
    if (entry[0] === 'R' || entry[0] === 'C') index++
  }
  return files
}

function stamp(date = new Date()): string {
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Saves the person's edits as one "Your edits" entry, if there are any (§3.4).
 * Files Git is told to ignore are left alone. Returns the new entry, or null
 * when there was nothing to save.
 */
export async function saveYourEdits(folder: string): Promise<string | null> {
  const git = gitFor(folder)
  if ((await unsavedFiles(folder)).length === 0) return null
  await git.raw(['add', '-A'])
  const staged = (await git.raw(['diff', '--cached', '--name-only'])).trim()
  if (!staged) return null
  await git.raw([
    ...(await identityArgs(git)),
    'commit',
    '--no-verify',
    '-m',
    t('projects:history.yourEditsTitle', { when: stamp() }),
    '-m',
    `${ENTRY_TRAILER}: your-edits`
  ])
  return (await git.raw(['rev-parse', 'HEAD'])).trim()
}

/**
 * The step before Ostler changes the folder: the person's edits saved (or, when
 * they manage their own history, a refusal if there are any), and a restore
 * point at the folder's state. Returns the folder's commit after that.
 */
export async function prepareFolderForChange(
  folder: string,
  options: HistoryOptions,
  label: string
): Promise<string> {
  const { version, commit } = await currentVersion(folder)
  if (!version || !commit) throw new Refusal(t('errors:history.folderDetached'))
  if (options.saveMyEdits) {
    await saveYourEdits(folder)
  }
  const head = (await gitFor(folder).raw(['rev-parse', 'HEAD'])).trim()
  await createRestorePoint(folder, head, label)
  return head
}

/** A restore point: a named reference to the folder's state before a change. */
export async function createRestorePoint(
  folder: string,
  commit: string,
  label: string
): Promise<string> {
  const id = `${Date.now()}-${label.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40)}`
  const ref = `${RESTORE_REF_PREFIX}${id}`
  await gitFor(folder).raw(['update-ref', ref, commit])
  return ref
}

/**
 * Moves the folder's line of work forward to `commit`, which must build on
 * its current state. The working tree changes only for the files that commit
 * changes. When the person manages their own history and has unsaved edits in
 * one of those files, Git refuses, and so does Ostler: nothing is overwritten.
 */
async function moveFolderTo(folder: string, commit: string): Promise<void> {
  try {
    await gitFor(folder).raw(['merge', '--ff-only', '--no-edit', commit])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/would be overwritten|untracked working tree files/i.test(message)) {
      throw new Refusal(t('errors:history.unsavedEditsInTheWay'))
    }
    throw error
  }
}

interface MergedTree {
  tree: string | null
  conflicts: string[]
}

/**
 * Git's three-way merge done in memory: the changes from `base` to `theirs`,
 * applied on top of `ours`. Nothing on disk changes.
 */
async function mergeTrees(
  git: SimpleGit,
  base: string,
  ours: string,
  theirs: string
): Promise<MergedTree> {
  const cwd = (await git.revparse(['--show-toplevel'])).trim()
  const { code, stdout } = await runGit(cwd, [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '--no-messages',
    `--merge-base=${base}`,
    ours,
    theirs
  ])
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const tree = /^[0-9a-f]{40,64}$/.exec(lines[0]?.trim() ?? '')?.[0] ?? null
  if (code === 0 && tree) return { tree, conflicts: [] }
  if (code !== 1) throw new Error(`git merge-tree failed (${code})`)
  return { tree: null, conflicts: [...new Set(lines.slice(1).map((line) => line.trim()))] }
}

/** Runs Git and reports its exit code instead of throwing, for commands where 1 is an answer. */
function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (!error) return resolve({ code: 0, stdout })
        const code = (error as { code?: unknown }).code
        if (typeof code === 'number') return resolve({ code, stdout })
        reject(error)
      }
    )
  })
}

async function commitTree(
  git: SimpleGit,
  tree: string,
  parent: string,
  title: string,
  trailers: string[]
): Promise<string> {
  return (
    await git.raw([
      ...(await identityArgs(git)),
      'commit-tree',
      tree,
      '-p',
      parent,
      '-m',
      title,
      ...(trailers.length > 0 ? ['-m', trailers.join('\n')] : [])
    ])
  ).trim()
}

/** One task's finished work: the copy's state where it started and where it finished. */
export interface TaskSegment {
  taskId: string
  title: string
  start: string
  end: string
}

/**
 * Adds a task copy's work to the folder as one entry per task (§3.2 step 4):
 * a squash, so the agent's many small saves become one entry named after the
 * task. The copy must already be up to date with the folder. Returns the new
 * entries, oldest first, or the files that clash and changes nothing.
 */
export async function applyTaskSegments(
  folder: string,
  repositoryGit: SimpleGit,
  segments: TaskSegment[],
  options: HistoryOptions
): Promise<{ entries: string[]; conflicts: string[] }> {
  let tip = await prepareFolderForChange(folder, options, 'apply')
  const entries: string[] = []
  for (const segment of segments) {
    const merged = await mergeTrees(repositoryGit, segment.start, tip, segment.end)
    if (!merged.tree) return { entries: [], conflicts: merged.conflicts }
    const tipTree = (await repositoryGit.raw(['rev-parse', `${tip}^{tree}`])).trim()
    if (merged.tree === tipTree) continue
    tip = await commitTree(repositoryGit, merged.tree, tip, segment.title, [
      `${ENTRY_TRAILER}: task`,
      `${TASK_TRAILER}: ${segment.taskId}`
    ])
    entries.push(tip)
  }
  if (entries.length > 0) await moveFolderTo(folder, tip)
  return { entries, conflicts: [] }
}

const FIELD = '\x1f'
const RECORD = '\x1e'
const LOG_FORMAT = [
  '%H',
  '%P',
  '%at',
  '%s',
  `%(trailers:key=${ENTRY_TRAILER},valueonly,separator=%x2C)`,
  `%(trailers:key=${TASK_TRAILER},valueonly,separator=%x2C)`,
  `%(trailers:key=${UNDOES_TRAILER},valueonly,separator=%x2C)`,
  ...LEGACY_TRAILERS.map((key) => `%(trailers:key=${key},valueonly,separator=%x2C)`)
].join('%x1f')

function entryKind(value: string): ProjectHistoryEntryKind {
  switch (value.trim()) {
    case 'task':
      return 'task'
    case 'your-edits':
      return 'your-edits'
    case 'undo':
      return 'undo'
    case 'restore':
      return 'restore'
    case 'earlier-work':
      return 'task'
    default:
      return 'other'
  }
}

function parseLog(output: string): ProjectHistoryEntry[] {
  const entries: ProjectHistoryEntry[] = []
  for (const record of output.split(RECORD)) {
    const trimmed = record.replace(/^\s+/, '')
    if (!trimmed) continue
    const [header, ...fileLines] = trimmed.split(/\r?\n/)
    const [id, parents, time, title, ...trailers] = header.split(FIELD)
    if (!id) continue
    const trailer = (index: number) => trailers[index]?.trim() || trailers[index + 3]?.trim() || ''
    const [kind, taskId, undoes] = [trailer(0), trailer(1), trailer(2)]
    entries.push({
      id,
      title,
      at: Number(time) * 1000,
      kind: entryKind(kind),
      taskId: taskId || null,
      undoes: undoes
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      files: fileLines.map((line) => line.trim()).filter(Boolean),
      first: (parents ?? '').trim().length === 0,
      undone: false
    })
  }
  return entries
}

/** The folder's history, newest first, one line per entry (§3.5). */
export async function listHistory(
  folder: string,
  filter: ProjectHistoryFilter = {}
): Promise<ProjectHistoryEntry[]> {
  if (!hasOwnRepository(folder)) return []
  const { commit } = await currentVersion(folder)
  if (!commit) return []
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
  const output = await gitFor(folder).raw([
    'log',
    `--format=${RECORD}${LOG_FORMAT}`,
    '--name-only',
    '--no-merges',
    `-n`,
    String(limit * 2),
    'HEAD'
  ])
  const search = filter.search?.trim().toLowerCase() ?? ''
  return markUndone(parseLog(output))
    .filter((entry) => !filter.kind || entry.kind === filter.kind)
    .filter(
      (entry) =>
        !search ||
        entry.title.toLowerCase().includes(search) ||
        entry.files.some((file) => file.toLowerCase().includes(search))
    )
    .slice(0, limit)
}

/**
 * Marks the entries an undo still in force took out, newest first: an undo
 * that was itself undone no longer counts, so its entries are back.
 */
function markUndone(entries: ProjectHistoryEntry[]): ProjectHistoryEntry[] {
  const undone = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === 'undo' && !undone.has(entry.id)) {
      for (const id of entry.undoes) undone.add(id)
    }
  }
  return entries.map((entry) => ({ ...entry, undone: undone.has(entry.id) }))
}

async function readEntry(git: SimpleGit, id: string): Promise<ProjectHistoryEntry> {
  const output = await git.raw([
    'log',
    `--format=${RECORD}${LOG_FORMAT}`,
    '--name-only',
    '-n',
    '1',
    id
  ])
  const entry = parseLog(output)[0]
  if (!entry) throw new Refusal(t('errors:history.entryNotFound'))
  return entry
}

/** Later entries that changed any of `files`, newest first. */
async function laterEntriesTouching(
  git: SimpleGit,
  id: string,
  files: string[]
): Promise<ProjectHistoryEntry[]> {
  if (files.length === 0) return []
  const output = await git.raw([
    'log',
    `--format=${RECORD}${LOG_FORMAT}`,
    '--name-only',
    '--no-merges',
    `${id}..HEAD`,
    '--',
    ...files
  ])
  return parseLog(output)
}

/** "Undo of …", or "Put back …" when what is undone is itself an undo. */
async function undoTitle(git: SimpleGit, entries: ProjectHistoryEntry[]): Promise<string> {
  const quoted = (list: ProjectHistoryEntry[]) => list.map((entry) => `"${entry.title}"`).join(', ')
  if (entries.every((entry) => entry.kind === 'undo')) {
    try {
      const putBack = await Promise.all(
        entries.flatMap((entry) => entry.undoes).map((id) => readEntry(git, id))
      )
      if (putBack.length > 0) return t('projects:history.putBackTitle', { titles: quoted(putBack) })
    } catch {
      // An entry no longer in the history: say what was undone instead.
    }
  }
  return t('projects:history.undoTitle', { titles: quoted(entries) })
}

/**
 * Undoes entries (§3.5): a revert of each, newest first, recorded as one new
 * entry, so an undo can itself be undone. When a later entry changed the same
 * lines, nothing changes and the result names that entry, so the person can
 * undo both or leave it.
 */
export async function undoEntries(
  folder: string,
  ids: string[],
  options: HistoryOptions
): Promise<ProjectUndoResult> {
  if (ids.length === 0) throw new Refusal(t('errors:history.nothingToUndo'))
  const git = gitFor(folder)
  const entries = await Promise.all(ids.map((id) => readEntry(git, id)))
  if (entries.some((entry) => entry.first)) throw new Refusal(t('errors:history.cannotUndoFirst'))
  // Newest first, so each revert lands on the state it expects.
  const ordered = [...entries].sort((a, b) => b.at - a.at)
  const head = await prepareFolderForChange(folder, options, 'undo')

  let working = head
  for (const entry of ordered) {
    const merged = await mergeTrees(git, entry.id, working, `${entry.id}^`)
    if (!merged.tree) {
      const later = (await laterEntriesTouching(git, entry.id, merged.conflicts)).filter(
        (candidate) => !ids.includes(candidate.id)
      )
      return { undone: false, entry: null, laterEntries: later, conflicts: merged.conflicts }
    }
    working = await commitTree(git, merged.tree, working, 'scratch', [])
  }
  const tree = (await git.raw(['rev-parse', `${working}^{tree}`])).trim()
  const commit = await commitTree(git, tree, head, await undoTitle(git, ordered), [
    `${ENTRY_TRAILER}: undo`,
    ...ordered.map((entry) => `${UNDOES_TRAILER}: ${entry.id}`)
  ])
  await moveFolderTo(folder, commit)
  return { undone: true, entry: await readEntry(git, commit), laterEntries: [], conflicts: [] }
}

/**
 * Sets every tracked file back to how it was at an entry, recorded as a new
 * entry (§3.5), so this too can be undone.
 */
export async function restoreToEntry(
  folder: string,
  id: string,
  options: HistoryOptions
): Promise<ProjectHistoryEntry> {
  const git = gitFor(folder)
  const target = await readEntry(git, id)
  const head = await prepareFolderForChange(folder, options, 'restore')
  const tree = (await git.raw(['rev-parse', `${target.id}^{tree}`])).trim()
  const headTree = (await git.raw(['rev-parse', `${head}^{tree}`])).trim()
  if (tree === headTree) throw new Refusal(t('errors:history.alreadyAtPoint'))
  const commit = await commitTree(
    git,
    tree,
    head,
    t('projects:history.restoredTitle', { title: target.title }),
    [`${ENTRY_TRAILER}: restore`]
  )
  await moveFolderTo(folder, commit)
  return readEntry(git, commit)
}

/** Keeps discarded work under `refs/ostler/discarded/<slug>` for the retention period (§3.3). */
export async function keepDiscardedWork(
  repositoryGit: SimpleGit,
  slug: string,
  commit: string
): Promise<string> {
  const ref = `${DISCARDED_REF_PREFIX}${slug}`
  await repositoryGit.raw(['update-ref', ref, commit])
  return ref
}

export async function refExists(git: SimpleGit, ref: string): Promise<boolean> {
  try {
    // --quiet prints nothing and exits non-zero for a missing ref, which
    // simple-git does not turn into an error: read the output.
    return (await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() !== ''
  } catch {
    return false
  }
}

/**
 * Deletes restore points and discarded work older than the retention period
 * (§3.5). Entries in the history itself stay, like any history, and Git
 * clears unreachable data on its own.
 */
export async function pruneExpired(folder: string, retentionDays: number): Promise<number> {
  if (!hasOwnRepository(folder)) return 0
  const git = gitFor(folder)
  const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  let output: string
  try {
    output = await git.raw([
      'for-each-ref',
      '--format=%(refname)%09%(creatordate:unix)',
      RESTORE_REF_PREFIX,
      DISCARDED_REF_PREFIX
    ])
  } catch {
    return 0
  }
  let removed = 0
  for (const line of output.split(/\r?\n/)) {
    const [ref, created] = line.split('\t')
    if (!ref) continue
    // A restore point's name starts with when it was made; discarded work is
    // dated by the reflog-free creator date of what it points at.
    const named = ref.startsWith(RESTORE_REF_PREFIX)
      ? Number(ref.slice(RESTORE_REF_PREFIX.length).split('-')[0])
      : NaN
    const when = Number.isFinite(named) ? named : Number(created) * 1000
    if (!Number.isFinite(when) || when >= cutoff) continue
    try {
      await git.raw(['update-ref', '-d', ref])
      removed++
    } catch {
      // Another process changed it; the next prune tries again.
    }
  }
  return removed
}

/**
 * Moves the restore points and discarded work kept before the product was
 * renamed, under `refs/nexus/`, to the same names under `refs/ostler/`. Only
 * Ostler's own refs are touched, their dates come from their names and
 * commits, so the retention period is unchanged. Returns how many moved.
 */
export async function moveLegacyRefs(folder: string): Promise<number> {
  if (!hasOwnRepository(folder)) return 0
  const git = gitFor(folder)
  const output = await git.raw([
    'for-each-ref',
    '--format=%(refname) %(objectname)',
    LEGACY_NAMES.refsNamespace
  ])
  let moved = 0
  for (const line of output.split(/\r?\n/)) {
    const [ref, commit] = line.trim().split(' ')
    if (!ref || !commit) continue
    const name = ref.slice(LEGACY_NAMES.refsNamespace.length)
    await git.raw(['update-ref', `refs/ostler/${name}`, commit])
    await git.raw(['update-ref', '-d', ref, commit])
    moved++
  }
  return moved
}

/** How many restore points and how much discarded work a folder keeps. */
export async function countKeptReferences(
  folder: string
): Promise<{ restorePoints: number; discarded: number }> {
  if (!hasOwnRepository(folder)) return { restorePoints: 0, discarded: 0 }
  try {
    const output = await gitFor(folder).raw([
      'for-each-ref',
      '--format=%(refname)',
      RESTORE_REF_PREFIX,
      DISCARDED_REF_PREFIX
    ])
    const refs = output.split(/\r?\n/).filter(Boolean)
    return {
      restorePoints: refs.filter((ref) => ref.startsWith(RESTORE_REF_PREFIX)).length,
      discarded: refs.filter((ref) => ref.startsWith(DISCARDED_REF_PREFIX)).length
    }
  } catch {
    return { restorePoints: 0, discarded: 0 }
  }
}
