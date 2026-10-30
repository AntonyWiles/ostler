import * as path from 'path'
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import type { HarnessAttachmentGiven } from '@shared/ostler-api'
import {
  ATTACHMENTS_NOTICE,
  attachmentIndexFields,
  resolveTaskAttachments,
  type ResolvedTaskAttachment,
  type TaskAttachmentReader
} from '../task-attachments'

export type { TaskAttachmentReader } from '../task-attachments'

export interface DeliveredAttachment {
  given: HarnessAttachmentGiven
  resolved: ResolvedTaskAttachment
  /** Absolute paths of the files written for this item. */
  paths: string[]
}

export const TASK_ATTACHMENTS_FILE = 'OSTLER_TASK_ATTACHMENTS.md'

/**
 * The one folder an embedded agent may read attachments from. It sits in the
 * slot's runtime home, outside the worktree, so the rescue commit can never
 * sweep these files into the session branch.
 */
export function taskAttachmentsDir(runtimeHome: string): string {
  return path.join(runtimeHome, 'attachments')
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'item'
}

function writeReadOnly(filePath: string, content: Buffer): void {
  // A copy an earlier task left behind is read-only and cannot be overwritten as-is.
  if (existsSync(filePath)) chmodSync(filePath, 0o644)
  writeFileSync(filePath, content)
  try {
    chmodSync(filePath, 0o444)
  } catch {
    // The plugin's read-only fence is the real guard; the attribute is a backstop.
  }
}

/**
 * Empties `dir`, keeping the folder itself. Removing the folder failed with
 * EPERM on Windows whenever anything (antivirus, the indexer) still had a
 * handle in it, and that one failure skipped every attachment for the session.
 * Retries cover the brief handles; a file that still cannot go is logged and
 * left, and is overwritten below if this task gives the same attachment.
 */
function clearDirectory(dir: string, log: (message: string) => void): void {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    try {
      // Copies are written read-only, and the Node inside Electron refuses to
      // delete a read-only file on Windows (EPERM on every retry).
      chmodSync(path.join(dir, entry), 0o644)
      rmSync(path.join(dir, entry), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    } catch (error) {
      log(`could not clear previous attachment ${entry}: ${String(error)}`)
    }
  }
}

/**
 * Clears `<runtimeHome>/attachments/` and copies every form
 * `resolveTaskAttachments` gives for the task into it, as
 * `<slug>-<id8>.<extension>`: an image or document's original, a document's
 * `.extracted.txt`, a brief, guide, note or link's `.md`. An item whose files
 * cannot be written is logged and left out.
 */
export function materializeTaskAttachments(
  reader: TaskAttachmentReader,
  projectId: string,
  workItemId: string | null,
  runtimeHome: string,
  log: (message: string) => void
): DeliveredAttachment[] {
  const dir = taskAttachmentsDir(runtimeHome)
  // Always cleared: the slot is reused, and the last task's files are not this one's.
  clearDirectory(dir, log)

  const delivered: DeliveredAttachment[] = []
  for (const resolved of resolveTaskAttachments(
    reader,
    projectId,
    { planningWorkItemId: workItemId },
    log
  )) {
    const base = `${slugify(resolved.given.title)}-${resolved.given.libraryItemId.slice(0, 8)}`
    const paths: string[] = []
    try {
      for (const file of resolved.files) {
        const target = path.join(dir, `${base}.${file.extension}`)
        writeReadOnly(target, file.read())
        paths.push(target)
      }
    } catch (error) {
      const { libraryItemId, title } = resolved.given
      log(`skipped attachment ${libraryItemId} ("${title}"): ${String(error)}`)
      continue
    }
    delivered.push({ given: resolved.given, resolved, paths })
  }
  return delivered
}

/** The index the session's instructions load: one entry per attachment, with absolute paths. */
export function generateTaskAttachmentsMd(delivered: DeliveredAttachment[]): string {
  const entries = delivered.map(({ given, resolved, paths }) =>
    [
      `## ${given.title}`,
      ...attachmentIndexFields(resolved).map(({ label, value }) => `- ${label}: ${value}`),
      ...paths.map((filePath) => `- Path: ${filePath.replace(/\\/g, '/')}`)
    ].join('\n')
  )
  return ['# Task attachments', ...entries, ATTACHMENTS_NOTICE].join('\n\n')
}
