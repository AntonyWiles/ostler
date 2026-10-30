/**
 * Every project on every device (docs/plans/people-and-devices/overview.md, D17; prompt 11).
 *
 * The personal share keeps one sealed entry per shared project, `shares/<projectId>/<stamp>.ostlershare`,
 * with the invite that project is joined with, the project's folder (relative to the synced root that
 * holds the space, a hint only) or a sync server's address, and `removed` when the person deleted the
 * project or left its share. The newest stamp wins, as `records.ts` does. A device of the same person
 * reads the entries after it pulls the personal share and joins each share it does not have yet
 * (`SyncService`), so a project made on one PC is on the others.
 *
 * Every entry is a sealed envelope (`envelope.ts`) under the personal share's key, so only this
 * person's devices can read it. An invite is a secret: it is stored sealed with `sealSecret` in
 * `sync_shares.joined_invite` and never leaves the main process. This module reads and writes the
 * folder and the database only; the service decides which shares to publish, join or leave.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { localStamp } from './capture'
import { sealEnvelope } from './envelope'
import { SyncTransportError, type SyncTransport } from './folder-transport'
import { SHARES_FOLDER, SHARE_ENTRY_FILE, personalShareRow, type ShareEntry } from './pairing'
import { inviteFor, shareFileFrom } from './sharing'
import { PERSONAL_PROJECT_ID } from './synced-tables'
import { identityKeys, keyGenerationOf, projectKeyFor } from './sync-keys'
import { openSecret, sealSecret } from '../../safe-storage'

// Reading the entries is core (the phone does it too); these names stay importable from here.
export {
  SHARES_FOLDER,
  SHARE_ENTRY_FILE,
  ShareEntryError,
  inviteShareId,
  readShareEntries,
  type ShareEntry,
  type ShareEntryProblem
} from './pairing'

/** The folder the projects this person shares are made in, inside the space (`<root>/Ostler/Projects`). */
export const PROJECTS_FOLDER = 'Projects'

/** A share this PC has, as the service describes it for publishing. */
export interface ShareToPublish {
  projectId: string
  /** The share's folder relative to the synced root that holds the space; null when it is elsewhere. */
  folderRelativeToRoot: string | null
  /** The sync server address the share is kept on; null for a folder. */
  location: string | null
}

/**
 * The invite to publish for a share this PC has: a fresh one when this PC's person is an Owner of
 * it (the key may have changed since it was joined), else the invite the share was joined with.
 * Null when neither is known.
 */
export function publishedInvite(db: Database.Database, projectId: string): string | null {
  const fresh = inviteFor(db, projectId, 'editor')
  if (fresh) return fresh
  const row = db
    .prepare('SELECT joined_invite FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { joined_invite: string | null } | undefined
  return row?.joined_invite ? openSecret(row.joined_invite) : null
}

/** Stores the invite a share was joined with, sealed (`sync_shares.joined_invite`). */
export function rememberJoinedInvite(
  db: Database.Database,
  projectId: string,
  invite: string
): void {
  db.prepare(
    "UPDATE sync_shares SET joined_invite = @invite WHERE project_id = @projectId AND kind = 'project'"
  ).run({ invite: sealSecret(invite), projectId })
}

/** The folder relative to `root`, with `/` separators, when `folder` is inside it; else null. */
export function folderRelativeTo(root: string, folder: string): string | null {
  const relative = path.relative(root, folder)
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') return null
  return relative.split(path.sep).join('/')
}

/** The name of a project's folder in `Projects/`: its name and the first eight characters of its id. */
export function projectFolderName(name: string, projectId: string): string {
  const clean =
    name
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim()
      .replace(/[. ]+$/, '') || 'Project'
  return `${clean} (${projectId.slice(0, 8)})`
}

/**
 * A project's folder in `Projects/`: its name and the first eight characters of its id. A folder
 * already there gets " 2", " 3", … after the name, so nothing is ever written into another folder.
 */
export function pickProjectFolder(projectsFolder: string, name: string, projectId: string): string {
  const base = projectFolderName(name, projectId)
  let candidate = path.join(projectsFolder, base)
  for (let copy = 2; fs.existsSync(candidate); copy++) {
    candidate = path.join(projectsFolder, `${base} ${copy}`)
  }
  return candidate
}

/**
 * Writes this PC's entry for a share when it differs from `newest`, the newest entry the folder
 * holds for it (a new stamp, so the others read it as newer). Returns whether a file was written.
 * `removed: true` writes the marker that makes the others leave the share.
 */
export async function writeShareEntry(
  db: Database.Database,
  transport: SyncTransport,
  share: ShareToPublish,
  newest: ShareEntry | undefined,
  options: { removed: boolean; now?: number } = { removed: false }
): Promise<boolean> {
  const personal = personalShareRow(db)
  if (!personal) return false
  const invite = options.removed ? null : publishedInvite(db, share.projectId)
  if (!options.removed && !invite) return false
  const entry: ShareEntry = {
    projectId: share.projectId,
    invite: invite ?? '',
    folderRelativeToRoot: share.location ? null : share.folderRelativeToRoot,
    location: share.location,
    addedAt: options.now ?? Date.now(),
    removed: options.removed
  }
  if (newest && sameEntry(newest, entry)) return false

  const keys = {
    projectKey: projectKeyFor(db, PERSONAL_PROJECT_ID) as Buffer,
    keyGeneration: keyGenerationOf(db, PERSONAL_PROJECT_ID),
    privateKey: identityKeys(db).privateKey
  }
  const stamp = localStamp(personal.device_id)
  const bytes = sealEnvelope(
    SHARE_ENTRY_FILE,
    {
      formatVersion: 1,
      shareId: personal.share_id,
      memberId: personal.member_id,
      projectId: share.projectId,
      stamp
    },
    entry,
    keys
  )
  try {
    await transport.writeOnce(`${SHARES_FOLDER}/${share.projectId}/${stamp}.ostlershare`, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
  return true
}

/** Whether `folder` holds the `share.json` of `shareId`. Reads one small file; never throws. */
export function holdsShare(folder: string, shareId: string): boolean {
  try {
    const text = fs.readFileSync(path.join(folder, 'share.json'), 'utf8')
    return shareFileFrom(text)?.shareId === shareId
  } catch {
    return false
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sameEntry(a: ShareEntry, b: ShareEntry): boolean {
  return (
    a.removed === b.removed &&
    a.invite === b.invite &&
    a.folderRelativeToRoot === b.folderRelativeToRoot &&
    a.location === b.location
  )
}
