/**
 * Runs sync for every shared project on this PC (docs/plans/integrations/shared-folder-sync.md,
 * "Watching the folder", S9a).
 *
 * For each `sync_shares` row it opens the folder, watches it, and pulls (after
 * reading the member files) whenever it may have changed. Changes made here are
 * pushed a few seconds after they reach the outbox, Library files with them, and
 * a snapshot is written every 500 pushed changes or once a day. Work on one share
 * runs one step at a time. Its state (`up-to-date`, `catching-up`,
 * `cannot-reach-folder` or `problems`) is kept for the renderer, which never
 * sees keys, invites or file contents.
 *
 * With the personal space on (prompt 11, D17), every project is shared into `Ostler/Projects/`,
 * each share gets an entry in the personal share, and the entries are how the other devices of the
 * person join the same shares (`followEntries`); a project deleted or left here is marked removed.
 */
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { userInfo } from 'node:os'
import type {
  ShareMember,
  ShareProblem,
  ShareRole,
  ShareState,
  MembershipEvent,
  ShareStatus
} from '@shared/ostler-api/sharing-types'
import { Refusal } from '@shared/refusal'
import { ROLE_CAPABILITIES } from '@shared/share-roles'
import { canWriteIn, FolderTransport, type SyncTransport } from './folder-transport'
import { isDriveLocation } from './drive-transport'
import { retryWaiting, type ArrivedBlocker } from './apply'
import { pullLibraryFiles, pushLibraryFiles, type LibraryFileStore } from './library-files'
import { pullRecords, pushRecords } from './records'
import {
  answerPersonLink,
  PersonLinkError,
  unlinkedLookalikes,
  type PersonLinkCandidate
} from './person-links'
import { attachSyncCapture } from './capture'
import {
  forgetShare,
  forgetUnfinishedShares,
  inviteFor,
  isServerLocation,
  isSharedPlace,
  joinPlace,
  joinShare,
  parentPlace,
  memberPersonId,
  refreshMembers,
  shareProject,
  SharingError,
  type JoinResult,
  type MePerson
} from './sharing'
import { type SnapshotProject } from './snapshot-file'
import { refreshKeys, removeMember, rotateKey, RemoveMemberError } from './rotation'
import {
  assertOwner,
  ensureRoleFiles,
  myRoleOf,
  recordedRole,
  refreshRoles,
  roleOf,
  writeRoleChange
} from './roles'
import { membershipHistory } from './membership-history'
import { latestSnapshot, writeSnapshot } from './snapshots'
import { SyncTransportError } from './transport-paths'
import { refreshCapabilities, sharedCapabilities, writeMyCapabilities } from './capabilities'
import { refreshLeft, writeLeftNote } from './leaving'
import {
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring
} from './sync-keys'
import {
  pullChanges,
  pushChanges,
  type AssignedToMe,
  type ChangedTaskByOther,
  type MentionedMe,
  type SignOffArrived
} from './sync-runner'
import { pullSettings, pushSettings, type SettingsStore } from './settings-sync'
import { PERSONAL_PROJECT_ID } from './synced-tables'
import {
  folderRelativeTo,
  holdsShare,
  inviteShareId,
  pickProjectFolder,
  projectFolderName,
  PROJECTS_FOLDER,
  readShareEntries,
  rememberJoinedInvite,
  writeShareEntry,
  type ShareEntry,
  type ShareToPublish
} from './personal-shares'
import { findShareFolder, JOIN_FOLDER_LIMITS } from './share-folder-finder'
import {
  allowDevice,
  applyRevocations,
  completePairing,
  createPersonalSpace,
  createPersonalSpaceAt,
  devicesOf,
  pairingCodeInSpace,
  DEVICES_FOLDER,
  pendingRequests,
  removeDevice,
  requestPairing,
  type PendingRequest,
  type PersonalDevice
} from './personal-space'

/** How often each share checks its outbox. */
const PUSH_CHECK_MS = 3_000
/** A snapshot after this many pushed changes… */
const SNAPSHOT_EVERY_CHANGES = 500
/** …or this long after the last one. */
const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000
/** A pull at least this often, even when the folder sends no events. */
const PULL_EVERY_MS = 60_000
/** A setting changed here goes to the other devices this long after the last change (settings follow the person). */
const SETTINGS_PUSH_DELAY_MS = 5_000

export interface SyncServiceOptions {
  databasePath: string
  library: LibraryFileStore
  /** The project's own settings from the config store, for snapshots; null when it is gone. */
  projectSettings(projectId: string): SnapshotProject | null
  /** Another PC changed the project's own settings: put them in the config store. */
  applyProjectSettings?(projectId: string, project: SnapshotProject): void
  /** Rows of the project changed through sync: the renderer reloads them. */
  onProjectChanged(projectId: string): void
  /**
   * A pull changed a blocker or a task's status in the project (an answer from a phone, say):
   * the PC looks at agent dispatch again, as it does after the same change made on the PC.
   */
  onDispatchInputsChanged?(projectId: string): void
  /** A blocker was reported or resolved on another device: the PC says so as it does for its own. */
  onBlockerArrived?(blocker: ArrivedBlocker): void
  /** The share state of a project changed. */
  onStateChanged(projectId: string): void
  /** Another PC assigned a task to this PC's Me: the person is told once per assignment (D11). */
  onAssigned?(event: AssignedToMe): void
  /** Another PC wrote a comment that mentions this PC's Me: the person is told once per comment. */
  onMentioned?(event: MentionedMe): void
  /** A sign-off was asked of this PC's Me by another PC (prompt 17). */
  onSignOffRequested?(event: SignOffArrived): void
  /** A sign-off Me asked for was answered on another PC (prompt 17). */
  onSignOffAnswered?(event: SignOffArrived): void
  /** Another person changed or commented on a task in a pull, and no assigned or mention notice covers it (prompt 15). */
  onTaskChanged?(event: ChangedTaskByOther): void
  /** A device asked to join this PC's personal share: the notice says its name and code. */
  onPairingRequest?(request: PendingRequest): void
  /** Lets every device that asks in without the person allowing it (development builds). */
  allowDevicesAutomatically?: boolean
  /** Every project this PC has, by id: each one that has no share yet is shared into the personal space (D17). */
  projectIds?(): string[]
  /** A joined share's project is made in the config store (registerJoinedProject), by the caller. */
  registerJoinedProject?(joined: JoinResult): void
  /** Another device of this person removed the project, so this PC left its share and keeps its copy. */
  onLeftShare?(projectId: string): void
  /** Someone else left a shared project on their own, with every device they had in it: they are told once. */
  onMemberLeft?(event: { projectId: string; name: string }): void
  /** The synced roots a share may be found in when its entry has no usable folder (share-folder-finder.ts). */
  syncedRoots?(): string[]
  /** The settings that follow the person (settings-sync.ts): the config store. */
  settings?: SettingsStore
  /** The name this PC's member shows to the others. */
  memberName?(): string
  /** This PC's Me person, sent with its member file; null when there is none. */
  me?(): MePerson | null
  logError(message: string, error: unknown): void
  /** A share kept on a sync server (phase 7): its space, signed in. */
  openServer?(location: string): SyncTransport
  /** A share kept in a Google Drive folder (`gdrive:<folderId>`), through this PC's Drive account. */
  openDrive?(place: string): SyncTransport
  /** This PC wrote change files to the share at `folder` (Drive shares ask Drive what changed sooner). */
  onPushed?(folder: string): void
  /** Tests: the folder transport, and timer lengths. */
  openTransport?(folder: string): SyncTransport
  pushCheckMs?: number
  scanIntervalMs?: number
}

interface ShareRow {
  project_id: string
  share_id: string
  folder: string
  member_id: string
  kind: 'project' | 'personal'
}

interface Running {
  projectId: string
  shareId: string
  folder: string
  transport: SyncTransport
  status: ShareStatus
  problems: ShareProblem[]
  /** One step at a time. */
  queue: Promise<void>
  stopWatch: () => void
  pushedSinceSnapshot: number
  lastSnapshotAt: number
  /** Another member removed this PC: it stops sending. */
  removed: boolean
  /** The personal share: no records, library files or project notices. */
  personal: boolean
  /** The personal share's settings are sent only after its first pull, so a new device never sends its defaults over the person's settings. */
  settingsPulled: boolean
  /** The personal share has been pulled once in full on this run: a joining PC's welcome waits for it. */
  pulledOnce: boolean
  /** This PC's capabilities note for the current version is in the folder. */
  capabilitiesWritten?: boolean
}

export class SyncService {
  private readonly db: Database.Database
  private readonly running = new Map<string, Running>()
  private pushTimer: ReturnType<typeof setInterval> | null = null
  private pullTimer: ReturnType<typeof setInterval> | null = null
  private stopPairingWatch: () => void = () => undefined
  private settingsTimer: ReturnType<typeof setTimeout> | null = null
  /** Pairing requests already announced, by device id, so each is announced once. */
  private readonly announcedRequests = new Set<string>()
  private stopped = false

  constructor(private readonly options: SyncServiceOptions) {
    this.db = new Database(options.databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    // Merging people ("Is this Bob?") writes rows a user chose, which must be captured and sent.
    // Applied changes are written under withSyncApplying, so they stay uncaptured.
    attachSyncCapture(this.db)
  }

  /** Starts every share this PC has, the pairing watch, and the push check. */
  start(): void {
    // A share that stopped partway (before this PC's member was written) can never sync.
    for (const projectId of forgetUnfinishedShares(this.db)) {
      this.options.logError('Forgot a share that never finished:', projectId)
    }
    for (const share of this.shares()) this.open(share)
    this.watchPairingRequests()
    void this.shareUnsharedProjects()
    this.pushTimer = setInterval(() => this.pushAll(), this.options.pushCheckMs ?? PUSH_CHECK_MS)
    this.pullTimer = setInterval(() => {
      for (const running of this.running.values()) {
        // People and settings change without rows changing: they go out with this.
        void this.enqueue(running, () => this.pushStep(running))
        this.schedulePull(running)
      }
    }, PULL_EVERY_MS)
  }

  /** Stops watching and waits for the work in hand; then closes the database. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.pushTimer) clearInterval(this.pushTimer)
    if (this.pullTimer) clearInterval(this.pullTimer)
    if (this.settingsTimer) clearTimeout(this.settingsTimer)
    this.stopPairingWatch()
    const pending = [...this.running.values()].map((running) => {
      running.stopWatch()
      return running.queue
    })
    this.running.clear()
    await Promise.allSettled(pending)
    this.db.close()
  }

  isShared(projectId: string): boolean {
    return this.shareRow(projectId) !== null
  }

  /** This PC's role in a shared project; null when it isn't shared. */
  myRole(projectId: string): ShareRole | null {
    if (!this.shareRow(projectId)) return null
    return myRoleOf(this.db, projectId) ?? 'owner'
  }

  /** The state the renderer shows; null for a project that isn't shared. */
  stateOf(projectId: string): ShareState | null {
    const share = this.shareRow(projectId)
    if (!share) return null
    const running = this.running.get(projectId)
    const members = this.peopleOf(share)
    const count = (sql: string, id: string) => (this.db.prepare(sql).get({ id }) as { n: number }).n
    const lastSyncedAt = (
      this.db
        .prepare('SELECT last_synced_at FROM sync_shares WHERE project_id = @projectId')
        .get({ projectId }) as { last_synced_at: number | null }
    ).last_synced_at
    return {
      projectId,
      status: running?.status ?? 'cannot-reach-folder',
      folder: share.folder,
      members,
      lastSyncedAt,
      waitingToSend: count(
        'SELECT COUNT(*) AS n FROM sync_outbox WHERE project_id = @id',
        projectId
      ),
      waitingToApply: count(
        'SELECT COUNT(*) AS n FROM sync_pending WHERE share_id = @id',
        share.share_id
      ),
      problems: running?.problems ?? [],
      removed: running?.removed ?? false,
      myRole: myRoleOf(this.db, projectId) ?? 'owner',
      inPersonalSpace: this.personalSpaceFolder() !== null,
      sharedCapabilities: sharedCapabilities(this.db, share.share_id),
      ...this.invitesResetOf(share.share_id)
    }
  }

  private invitesResetOf(shareId: string): { invitesResetAt?: number } {
    const row = this.db
      .prepare('SELECT invites_reset_at AS at FROM sync_shares WHERE share_id = @shareId')
      .get({ shareId }) as { at: number | null } | undefined
    return row?.at != null ? { invitesResetAt: row.at } : {}
  }

  /** The project's membership history, newest first; empty when it is not shared. */
  membershipHistory(projectId: string): MembershipEvent[] {
    const share = this.shareRow(projectId)
    return share ? membershipHistory(this.db, share.share_id) : []
  }

  /** Starts sharing a project through `folder`. The invite is read with `invite`. */
  async share(projectId: string, folder: string): Promise<void> {
    const project = this.options.projectSettings(projectId)
    if (!project) throw new Error('Project not found')
    // Refused before anything is kept: some folders a sync app shows can't hold files.
    if (!isSharedPlace(folder) && !(await canWriteIn(folder))) {
      throw new SharingError('cannot-write-folder')
    }
    const transport = this.transportFor(folder)
    await shareProject(this.db, transport, projectId, {
      folder,
      memberName: this.memberName(),
      project,
      me: this.options.me?.() ?? null
    })
    const share = this.shareRow(projectId)
    if (share) this.open(share, transport)
    this.options.onStateChanged(projectId)
    void this.publishShares()
  }

  /**
   * The invite for a shared project, giving the joiner `role` (an Editor by
   * default). An Owner or an Editor may invite (D1, D13). A secret: main puts it on the
   * clipboard; never log it.
   */
  invite(projectId: string, role: 'editor' | 'contributor' | 'viewer' = 'editor'): string | null {
    const share = this.shareRow(projectId)
    const myRole = share
      ? recordedRole(this.db, share.share_id, personKeys(this.db).publicKey)
      : null
    if (!ROLE_CAPABILITIES[myRole ?? 'viewer'].invite) throw new Refusal('not-an-owner')
    // An older Ostler would leave an Editor's grant unread for ever and make the joiner a Viewer.
    if (
      myRole === 'editor' &&
      !this.stateOf(projectId)?.sharedCapabilities.includes('editor-invites')
    ) {
      throw new Refusal('editors-not-everyone-supports')
    }
    this.assertEveryoneSupports(projectId, role)
    return inviteFor(this.db, projectId, role)
  }

  /**
   * An older Ostler refuses a Contributor role file for good and gives a Contributor grant the
   * Viewer role, so Contributor is offered only when every member's PC says it understands it.
   */
  private assertEveryoneSupports(projectId: string, role: ShareRole): void {
    if (role !== 'contributor') return
    if (!this.stateOf(projectId)?.sharedCapabilities.includes('contributor-role')) {
      throw new Refusal('not-everyone-supports')
    }
  }

  /** Changes a person's role in a shared project. Only an Owner may (D1, D7). */
  async setRole(projectId: string, personKey: string, role: ShareRole): Promise<void> {
    assertOwner(this.db, projectId)
    this.assertEveryoneSupports(projectId, role)
    const running = this.running.get(projectId)
    if (!running) throw new Error('Project is not shared')
    let failure: unknown = null
    await this.enqueue(running, async () => {
      try {
        await writeRoleChange(this.db, running.transport, projectId, personKey, role)
      } catch (error) {
        failure = error
      }
    })
    if (failure) throw failure
    this.options.onStateChanged(projectId)
  }

  /**
   * Joins a shared project from an invite through `folder`. The caller makes the
   * project's entry in the config store from what this returns, before the
   * project shows anywhere.
   */
  async join(invite: string, folder: string): Promise<JoinResult> {
    const transport = this.transportFor(folder)
    const result = await joinShare(this.db, transport, invite, {
      folder,
      memberName: this.memberName(),
      me: this.options.me?.() ?? null
    })
    // The invite is kept (sealed) so the entry for this share can be written for the other devices.
    rememberJoinedInvite(this.db, result.projectId, invite)
    const share = this.shareRow(result.projectId)
    if (share) this.open(share, transport)
    this.options.registerJoinedProject?.(result)
    this.options.onProjectChanged(result.projectId)
    void this.publishShares()
    return result
  }

  /**
   * Removes another member from a shared project: the share moves to a new key
   * they never get, and a snapshot with it is written so a PC joining later
   * needs nothing from them. They keep what they already had.
   */
  async removeMember(projectId: string, memberId: string): Promise<void> {
    assertOwner(this.db, projectId)
    const running = this.running.get(projectId)
    if (!running) throw new Error('Project is not shared')
    let failure: unknown = null
    await this.enqueue(running, async () => {
      try {
        await removeMember(this.db, running.transport, projectId, memberId)
        const keys = this.keysFor(projectId)
        if (keys) {
          await writeSnapshot(
            this.db,
            running.transport,
            projectId,
            keys,
            this.options.projectSettings(projectId) ?? undefined
          )
          running.pushedSinceSnapshot = 0
          running.lastSnapshotAt = Date.now()
        }
      } catch (error) {
        failure = error
      }
    })
    if (failure) throw failure
    this.options.onStateChanged(projectId)
  }

  /**
   * Stops every invite sent so far (D12): a new project key for everyone in the project, no one
   * removed. Only an Owner, and only once every PC understands a key change that removes no one.
   */
  async stopOldInvites(projectId: string): Promise<void> {
    assertOwner(this.db, projectId)
    if (!this.stateOf(projectId)?.sharedCapabilities.includes('invite-reset')) {
      throw new Refusal('invite-reset-not-everyone-supports')
    }
    const running = this.running.get(projectId)
    if (!running) throw new Error('Project is not shared')
    let failure: unknown = null
    await this.enqueue(running, async () => {
      try {
        await rotateKey(this.db, running.transport, projectId, null)
        const keys = this.keysFor(projectId)
        if (keys) {
          await writeSnapshot(
            this.db,
            running.transport,
            projectId,
            keys,
            this.options.projectSettings(projectId) ?? undefined
          )
          running.pushedSinceSnapshot = 0
          running.lastSnapshotAt = Date.now()
        }
      } catch (error) {
        failure = error
      }
    })
    if (failure) throw failure
    this.options.onStateChanged(projectId)
  }

  /**
   * Removes a person from a shared project: each of their devices is removed in
   * turn (one key rotation per device). Refuses this person (this PC's own).
   */
  async removePerson(
    projectId: string,
    personKey: string,
    /** Runs after the checks and before any key rotation, with the person's id (open tasks handed on). */
    beforeRemoving?: (personId: string) => void
  ): Promise<void> {
    assertOwner(this.db, projectId)
    const share = this.shareRow(projectId)
    if (!share) throw new RemoveMemberError('not-shared')
    const person = this.peopleOf(share).find((candidate) => candidate.personKey === personKey)
    if (!person) throw new RemoveMemberError('not-a-member')
    if (person.isMe) throw new RemoveMemberError('this-pc')
    beforeRemoving?.(person.personId ?? memberPersonId(personKey))
    for (const device of person.devices) await this.removeMember(projectId, device.memberId)
  }

  /** The "Is this Bob?" candidates in a shared project (none when it is not shared). */
  personLinks(projectId: string): PersonLinkCandidate[] {
    if (!this.shareRow(projectId)) return []
    return unlinkedLookalikes(this.db, projectId)
  }

  /** Records the owner's Yes or No to a candidate; Yes merges the two people. */
  answerPersonLink(
    projectId: string,
    personKey: string,
    candidatePersonId: string,
    answer: 'yes' | 'no'
  ): PersonLinkCandidate[] {
    if (!this.shareRow(projectId)) throw new PersonLinkError('not-shared')
    answerPersonLink(this.db, projectId, personKey, candidatePersonId, answer)
    if (answer === 'yes') this.options.onProjectChanged(projectId)
    this.options.onStateChanged(projectId)
    return this.personLinks(projectId)
  }

  /**
   * Stops sharing the project on this PC: it stays here as an ordinary project
   * with everything it has, and nothing more is sent or received. The others
   * keep the share (S7d rotates the key when someone leaves).
   */
  async leave(projectId: string): Promise<void> {
    if (!this.shareRow(projectId)) {
      // A project the personal space lists but this PC never joined: take it off the list, so no
      // device keeps trying to join it.
      if (await this.listedInPersonalSpace(projectId)) await this.markRemoved(projectId)
      return
    }
    // The others are told this PC left, so it shows as left in their member list.
    await this.writeLeft(projectId)
    // The person's other devices leave the share too, and keep their copies (prompt 11).
    await this.markRemoved(projectId)
    await this.leaveShare(projectId)
  }

  /**
   * Writes this device's left note to the project's shared folder, while it still syncs there.
   * Best effort: a folder out of reach doesn't stop anyone leaving; the others just aren't told.
   */
  private async writeLeft(projectId: string): Promise<void> {
    const share = this.shareRow(projectId)
    const running = this.running.get(projectId)
    const keys = this.keysFor(projectId)
    if (share?.kind !== 'project' || !running || running.removed || !keys) return
    await this.enqueue(running, () =>
      writeLeftNote(running.transport, { shareId: share.share_id, memberId: share.member_id }, keys)
    )
  }

  /** Whether the personal share has an entry for the project that is not already removed. */
  private async listedInPersonalSpace(projectId: string): Promise<boolean> {
    const personal = this.running.get(PERSONAL_PROJECT_ID)
    if (!personal) return false
    const { entries } = await readShareEntries(this.db, personal.transport)
    return entries.some((entry) => entry.projectId === projectId && !entry.removed)
  }

  /** Writes the personal share's removed marker for a project this PC leaves or has deleted. */
  private async markRemoved(projectId: string): Promise<void> {
    const personal = this.running.get(PERSONAL_PROJECT_ID)
    if (!personal) return
    await this.enqueue(personal, () =>
      writeShareEntry(
        this.db,
        personal.transport,
        { projectId, folderRelativeToRoot: null, location: null },
        undefined,
        { removed: true }
      ).then(() => undefined)
    )
  }

  /** Stops this PC's share of a project and forgets it; the project itself stays here. */
  private async leaveShare(projectId: string): Promise<void> {
    const share = this.shareRow(projectId)
    if (!share) return
    const running = this.running.get(projectId)
    if (running) {
      running.stopWatch()
      this.running.delete(projectId)
      await running.queue.catch(() => undefined)
    }
    forgetShare(this.db, projectId)
    this.options.onStateChanged(projectId)
  }

  /** Pushes and pulls a project now (the Sync now action). */
  async syncNow(projectId: string): Promise<void> {
    const running = this.running.get(projectId)
    if (!running) return
    this.enqueue(running, () => this.pushStep(running))
    await this.enqueue(running, () => this.pullStep(running))
  }

  // ─── Every project on every device (prompt 11, D17) ─────────────────────

  /**
   * A project was added, changed or deleted on this PC. A new one is shared into the personal space;
   * a deleted one is removed from its share, and the others are told (their copy is kept).
   */
  projectsChanged(projectId: string): void {
    if (this.stopped || !this.options.projectIds) return
    if (this.options.projectIds().includes(projectId)) {
      void this.shareUnsharedProjects().catch((error) =>
        this.options.logError('Projects could not be shared:', error)
      )
    } else if (this.shareRow(projectId)?.kind === 'project') {
      void this.leave(projectId).catch((error) =>
        this.options.logError('A deleted project could not leave its share:', error)
      )
    }
  }

  /**
   * Shares every project of this PC that has no share yet, into `Ostler/Projects/` (a folder named
   * after the project and the first eight characters of its id), then writes the entries. Does
   * nothing without a personal space.
   */
  shareUnsharedProjects(): Promise<void> {
    // One run at a time: two runs would both see a project as unshared and share it twice.
    this.unsharedRun = this.unsharedRun.then(() => this.shareUnshared())
    return this.unsharedRun
  }

  private unsharedRun: Promise<void> = Promise.resolve()

  private async shareUnshared(): Promise<void> {
    const space = this.personalSpaceFolder()
    if (!space || !this.options.projectIds || this.stopped) return
    for (const projectId of this.options.projectIds()) {
      if (this.shareRow(projectId)) continue
      const project = this.options.projectSettings(projectId)
      if (!project) continue
      const projectsFolder = joinPlace(space, PROJECTS_FOLDER)
      try {
        if (isDriveLocation(space)) {
          // In Drive the folder is made when the first file is written; the id keeps the name unique.
          await this.share(
            projectId,
            joinPlace(projectsFolder, projectFolderName(project.name, projectId))
          )
        } else {
          fs.mkdirSync(projectsFolder, { recursive: true })
          await this.share(projectId, pickProjectFolder(projectsFolder, project.name, projectId))
        }
      } catch (error) {
        this.options.logError('A project could not be shared into the personal space:', error)
      }
    }
    await this.publishShares()
  }

  /** Writes this PC's entry for each share it has, when the entry is not already the newest (prompt 11). */
  async publishShares(): Promise<void> {
    const personal = this.running.get(PERSONAL_PROJECT_ID)
    if (!personal) return
    await this.enqueue(personal, () => this.writeEntries(personal.transport))
  }

  /** The entries of every share on this PC, written to the personal share. Runs inside a personal step. */
  private async writeEntries(transport: SyncTransport): Promise<void> {
    const { entries } = await readShareEntries(this.db, transport)
    for (const share of this.shares()) {
      if (share.kind !== 'project') continue
      await writeShareEntry(
        this.db,
        transport,
        this.publishable(share),
        entries.find((entry) => entry.projectId === share.project_id)
      )
    }
  }

  /** What a share's entry says about it: its folder relative to the space's root, or its server address. */
  private publishable(share: ShareRow): ShareToPublish {
    const location = isSharedPlace(share.folder) ? share.folder : null
    const root = this.spaceRoot()
    return {
      projectId: share.project_id,
      folderRelativeToRoot: location || root === null ? null : folderRelativeTo(root, share.folder),
      location
    }
  }

  /**
   * Reads the personal share's entries: a share that this PC does not have is joined, one that the
   * person removed (`removed`) is left and its project kept. Returns the problems to show for the
   * personal share (a folder that has not arrived yet). Runs inside a personal pull.
   */
  private async followEntries(running: Running): Promise<ShareProblem[]> {
    const { entries, problems } = await readShareEntries(this.db, running.transport)
    for (const problem of problems) {
      this.options.logError('A shared project entry could not be read:', problem.reason)
    }
    const waiting: ShareProblem[] = []
    for (const entry of entries) {
      const share = this.shareRow(entry.projectId)
      if (entry.removed) {
        if (share?.kind === 'project') {
          await this.writeLeft(entry.projectId)
          await this.leaveShare(entry.projectId)
          this.options.onLeftShare?.(entry.projectId)
        }
        continue
      }
      if (share) continue
      try {
        if (!(await this.joinFromEntry(entry))) waiting.push({ kind: 'folder', reason: 'waiting' })
      } catch (error) {
        this.options.logError('A shared project could not be joined:', error)
      }
    }
    return waiting
  }

  /** Joins the share an entry names, from the folder it is in on this PC. False while the folder is not here yet. */
  private async joinFromEntry(entry: ShareEntry): Promise<boolean> {
    const shareId = inviteShareId(entry.invite)
    if (!shareId) return true // A bad entry is reported when it is read; it is not waiting for anything.
    const folder = await this.findEntryFolder(entry, shareId)
    if (!folder) return false
    await this.join(entry.invite, folder)
    return true
  }

  /** The share's folder on this PC: its server address, the hinted folder, or one found under the synced roots. */
  private async findEntryFolder(entry: ShareEntry, shareId: string): Promise<string | null> {
    if (entry.location) return entry.location
    const root = this.spaceRoot()
    if (root && entry.folderRelativeToRoot) {
      const hint = path.join(root, ...entry.folderRelativeToRoot.split('/'))
      if (holdsShare(hint, shareId)) return hint
    }
    const roots = this.options.syncedRoots?.() ?? (root ? [root] : [])
    return findShareFolder(shareId, roots, { ...JOIN_FOLDER_LIMITS, fs })
  }

  /** The root that holds the personal space (`<root>/Ostler`'s parent); null without a personal space. */
  private spaceRoot(): string | null {
    const space = this.personalSpaceFolder()
    // A personal space in Drive has no folder on this PC.
    return space && !isDriveLocation(space) ? path.dirname(space) : null
  }

  // ─── Personal space (prompt 09) ─────────────────────────────────────────

  /** The space folder (the Ostler folder) of this PC's personal share; null when it has none. */
  /** Every project share's place on this PC (folders, Drive and server places alike). */
  shareFolders(): string[] {
    return (
      this.db.prepare("SELECT folder FROM sync_shares WHERE kind = 'project'").all() as {
        folder: string
      }[]
    ).map((row) => row.folder)
  }

  personalSpaceFolder(): string | null {
    const row = this.shareRow(PERSONAL_PROJECT_ID)
    return row ? parentPlace(row.folder) : null
  }

  /** Makes this PC's personal share in `root` and starts running it. */
  async createPersonalSpace(root: string, deviceName: string): Promise<void> {
    await createPersonalSpace(this.db, root, deviceName, this.opener)
    this.openPersonal()
  }

  /** Makes this PC's personal share in the space folder itself (after the old one was set aside). */
  async createPersonalSpaceAt(spaceFolder: string, deviceName: string): Promise<void> {
    await createPersonalSpaceAt(this.db, spaceFolder, deviceName, this.opener)
    this.openPersonal()
  }

  /** Asks the personal share in `spaceFolder` to let this PC join; returns the device id. */
  requestPairing(spaceFolder: string, deviceName: string): Promise<string> {
    return requestPairing(this.db, spaceFolder, deviceName, this.opener)
  }

  /** The devices asking to join, with their codes (this PC must already be paired). */
  pendingPairingRequests(spaceFolder: string): Promise<PendingRequest[]> {
    return pendingRequests(this.db, spaceFolder, this.opener)
  }

  /** Lets a requesting device in (this PC must already be paired). */
  allowDevice(spaceFolder: string, deviceId: string): Promise<void> {
    return allowDevice(this.db, spaceFolder, deviceId, this.opener)
  }

  /** The six-digit code this PC shows while it waits to join the space in `spaceFolder`; null until the space holds a certificate. */
  joinCodeFor(spaceFolder: string): Promise<string | null> {
    return pairingCodeInSpace(this.db, spaceFolder, this.opener)
  }

  /** Whether the personal share has been pulled once in full on this run. */
  personalPulled(): boolean {
    return this.running.get(PERSONAL_PROJECT_ID)?.pulledOnce ?? false
  }

  /** This PC's side of pairing: `'paired'` once it has joined the personal share. */
  async completePairing(spaceFolder: string): Promise<'waiting' | 'paired'> {
    const result = await completePairing(this.db, spaceFolder, this.opener)
    if (result === 'paired') this.openPersonal()
    return result
  }

  /** The devices of this person, as the personal share knows them. */
  personalDevices(): PersonalDevice[] {
    return devicesOf(this.db)
  }

  /**
   * Removes one of this person's devices from the personal share and every project share
   * it is in (D20), then writes a snapshot of the personal share for the PCs that join later.
   */
  async removePersonalDevice(spaceFolder: string, deviceId: string): Promise<void> {
    const running = this.running.get(PERSONAL_PROJECT_ID)
    if (!running) throw new Error('The personal space is not running')
    let failure: unknown = null
    await this.enqueue(running, async () => {
      try {
        await removeDevice(this.db, spaceFolder, deviceId, this.opener)
        const keys = this.keysFor(PERSONAL_PROJECT_ID)
        if (keys) await writeSnapshot(this.db, running.transport, PERSONAL_PROJECT_ID, keys)
      } catch (error) {
        // A snapshot is named by its latest stamp: one already there holds the same rows.
        if (error instanceof SyncTransportError && error.reason === 'exists') return
        failure = error
      }
    })
    if (failure) throw failure
  }

  /**
   * A setting changed on this PC: the personal share sends it to the other devices a few seconds
   * after the last change. Nothing is sent when the setting is the same as the one already sent.
   */
  settingsChanged(): void {
    const running = this.running.get(PERSONAL_PROJECT_ID)
    if (!running || this.stopped) return
    if (this.settingsTimer) clearTimeout(this.settingsTimer)
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null
      void this.enqueue(running, () => this.pushStep(running))
    }, SETTINGS_PUSH_DELAY_MS)
  }

  /** Starts the personal share, once this PC has one (after creating or pairing). */
  openPersonal(): void {
    const share = this.shareRow(PERSONAL_PROJECT_ID)
    if (!share) return
    this.open(share)
    this.watchPairingRequests()
    void this.shareUnsharedProjects()
  }

  /** Announces each new pairing request in the personal space, now and as the folder changes. */
  private watchPairingRequests(): void {
    this.stopPairingWatch()
    this.stopPairingWatch = () => undefined
    const space = this.personalSpaceFolder()
    if (!space || this.stopped) return
    const devices = this.transportFor(joinPlace(space, DEVICES_FOLDER))
    const check = (): void => {
      void pendingRequests(this.db, space, this.opener)
        .then((requests) => {
          for (const request of requests) {
            if (this.announcedRequests.has(request.deviceId)) continue
            this.announcedRequests.add(request.deviceId)
            if (this.options.allowDevicesAutomatically) {
              void allowDevice(this.db, space, request.deviceId, this.opener).catch((error) => {
                this.announcedRequests.delete(request.deviceId)
                this.options.logError('A device could not be let in:', error)
              })
              continue
            }
            this.options.onPairingRequest?.(request)
          }
        })
        .catch((error) => this.options.logError('Pairing requests could not be read:', error))
    }
    try {
      this.stopPairingWatch = devices.watch(check)
    } catch (error) {
      this.options.logError('Could not watch the pairing folder:', error)
    }
    check()
  }

  // ─── Running shares ─────────────────────────────────────────────────────

  private open(share: ShareRow, transport = this.transportFor(share.folder)): void {
    if (this.stopped || this.running.has(share.project_id)) return
    const running: Running = {
      projectId: share.project_id,
      shareId: share.share_id,
      folder: share.folder,
      transport,
      status: 'catching-up',
      problems: [],
      queue: Promise.resolve(),
      stopWatch: () => undefined,
      pushedSinceSnapshot: 0,
      lastSnapshotAt: 0,
      removed: false,
      personal: share.kind === 'personal',
      settingsPulled: false,
      pulledOnce: false
    }
    this.running.set(share.project_id, running)
    try {
      running.stopWatch = transport.watch(() => this.schedulePull(running))
    } catch (error) {
      this.setStatus(running, 'cannot-reach-folder', [])
      this.options.logError('Could not watch a shared folder:', error)
    }
    this.enqueue(running, async () => {
      running.lastSnapshotAt = await this.lastOwnSnapshotAt(running)
    })
    this.schedulePull(running)
  }

  private schedulePull(running: Running): void {
    void this.enqueue(running, () => this.pullStep(running))
  }

  private pushAll(): void {
    for (const running of this.running.values()) {
      const waiting = (
        this.db
          .prepare('SELECT COUNT(*) AS n FROM sync_outbox WHERE project_id = @projectId')
          .get({ projectId: running.projectId }) as { n: number }
      ).n
      if (waiting > 0) void this.enqueue(running, () => this.pushStep(running))
    }
  }

  private enqueue(running: Running, step: () => Promise<void>): Promise<void> {
    running.queue = running.queue.then(async () => {
      if (this.stopped || this.running.get(running.projectId) !== running) return
      try {
        await step()
      } catch (error) {
        this.setStatus(running, 'cannot-reach-folder', [])
        this.options.logError('Shared folder sync failed:', error)
      }
    })
    return running.queue
  }

  private async pushStep(running: Running): Promise<void> {
    const keys = this.keysFor(running.projectId)
    if (!keys || running.removed) return
    // People and settings first, so the changes that name them find them. The personal share has
    // no records and no library files: its rows are its changes.
    if (!running.personal) {
      await pushRecords(
        this.db,
        running.transport,
        running.projectId,
        keys,
        this.options.projectSettings(running.projectId)
      )
    } else if (this.options.settings && running.settingsPulled) {
      await pushSettings(this.db, running.transport, keys, this.options.settings.getOwn())
    }
    let pushed = 0
    for (;;) {
      const result = await pushChanges(this.db, running.transport, running.projectId, keys)
      pushed += result.written
      if (result.written === 0) break
    }
    const files = running.personal
      ? null
      : await pushLibraryFiles(
          this.db,
          running.transport,
          running.projectId,
          keys,
          this.options.library
        )
    running.pushedSinceSnapshot += pushed
    const now = Date.now()
    if (
      running.pushedSinceSnapshot >= SNAPSHOT_EVERY_CHANGES ||
      now - running.lastSnapshotAt >= SNAPSHOT_EVERY_MS
    ) {
      await writeSnapshot(
        this.db,
        running.transport,
        running.projectId,
        keys,
        this.options.projectSettings(running.projectId) ?? undefined
      )
      running.pushedSinceSnapshot = 0
      running.lastSnapshotAt = now
    }
    if (files && files.problems.length > 0) {
      const problems = files.problems.map((problem): ShareProblem => ({
        kind: 'library',
        reason: problem.reason
      }))
      this.setStatus(running, 'problems', [...running.problems, ...problems])
    }
    if (pushed > 0) this.options.onPushed?.(running.folder)
    if (pushed > 0 && !running.personal) this.options.onStateChanged(running.projectId)
  }

  private async pullStep(running: Running): Promise<void> {
    if (!this.keysFor(running.projectId)) return
    this.setStatus(running, 'catching-up', running.problems)
    // Key changes first: they can bring a new key and members from before them.
    const keyChanges = await refreshKeys(this.db, running.transport, running.projectId)
    if (keyChanges.removed) {
      running.removed = true
      this.setStatus(running, 'problems', [])
      return
    }
    const keys = { projectKey: projectKeyring(this.db, running.projectId) }
    const members = await refreshMembers(
      this.db,
      running.transport,
      running.shareId,
      keys.projectKey
    )
    if (running.personal) {
      // A revoked device's member is removed here too, whichever PC wrote the revocation.
      await applyRevocations(this.db, parentPlace(running.folder), this.opener)
      // Projects this person has on another device are joined here; one removed there is left (prompt 11).
      const folderProblems = await this.followEntries(running)
      // Personal rows that waited for a parent in a project just joined (a reminder on its task) apply now.
      retryWaiting(this.db, running.shareId)
      await this.writeEntries(running.transport)
      if (this.options.settings) {
        const settings = await pullSettings(this.db, running.transport, keys, this.options.settings)
        for (const problem of settings.problems) {
          this.options.logError('A shared setting could not be read:', problem.reason)
        }
        if (!running.settingsPulled) {
          // This PC's own settings go out after the first read, once the others' are in.
          running.settingsPulled = true
          void this.enqueue(running, () => this.pushStep(running))
        }
      }
      const pulled = await pullChanges(this.db, running.transport, running.projectId, keys)
      const problems: ShareProblem[] = [
        ...keyChanges.problems.map((problem) => ({ kind: 'key' as const, reason: problem.reason })),
        ...members.problems.map((problem) => ({ kind: 'member' as const, reason: problem.reason })),
        ...pulled.problems.map((problem) => ({ kind: 'change' as const, reason: problem.reason })),
        ...folderProblems
      ]
      this.setStatus(running, problems.length > 0 ? 'problems' : 'up-to-date', problems)
      running.pulledOnce = true
      return
    }
    // Roles after members (they name the signers) and before changes (they decide what a change may do).
    const roles = await refreshRoles(this.db, running.transport, running.shareId, keys.projectKey)
    const left = await refreshLeft(this.db, running.transport, running.shareId, keys.projectKey)
    for (const person of left.newlyLeft) {
      this.options.onMemberLeft?.({ projectId: running.projectId, name: person.name })
    }
    if (left.newlyLeft.length > 0) this.options.onStateChanged(running.projectId)
    // What each PC understands: this PC's note goes out once per version, then everyone's is read.
    const myKeys = this.keysFor(running.projectId)
    if (myKeys && !running.capabilitiesWritten) {
      try {
        await writeMyCapabilities(this.db, running.transport, running.shareId, myKeys)
        running.capabilitiesWritten = true
      } catch (error) {
        this.options.logError("Could not write this PC's capabilities:", error)
      }
    }
    const capabilities = await refreshCapabilities(
      this.db,
      running.transport,
      running.shareId,
      keys.projectKey
    )
    if (capabilities.read > 0) this.options.onStateChanged(running.projectId)
    // A share from before roles: the first Owner to pull writes its role files (roles.ts).
    await ensureRoleFiles(this.db, running.transport, running.projectId)
    const records = await pullRecords(this.db, running.transport, running.projectId, keys)
    if (records.project) this.options.applyProjectSettings?.(running.projectId, records.project)
    if (records.people > 0) retryWaiting(this.db, running.shareId)
    const pulled = await pullChanges(this.db, running.transport, running.projectId, keys)
    for (const event of pulled.assignedToMe) this.options.onAssigned?.(event)
    for (const event of pulled.mentionedMe) this.options.onMentioned?.(event)
    for (const event of pulled.signOffRequestsForMe) this.options.onSignOffRequested?.(event)
    for (const event of pulled.signOffAnswersForMe) this.options.onSignOffAnswered?.(event)
    const announced = new Set([...pulled.assignedToMe, ...pulled.mentionedMe].map((e) => e.taskId))
    for (const event of pulled.changedTasks) {
      if (!announced.has(event.taskId)) this.options.onTaskChanged?.(event)
    }
    const files = await pullLibraryFiles(
      this.db,
      running.transport,
      running.projectId,
      keys,
      this.options.library
    )
    const problems: ShareProblem[] = [
      ...keyChanges.problems.map((problem) => ({ kind: 'key' as const, reason: problem.reason })),
      ...members.problems.map((problem) => ({ kind: 'member' as const, reason: problem.reason })),
      ...left.problems.map((problem) => ({ kind: 'member' as const, reason: problem.reason })),
      ...capabilities.problems.map((problem) => ({
        kind: 'member' as const,
        reason: problem.reason
      })),
      ...roles.problems.map((problem) => ({ kind: 'role' as const, reason: problem.reason })),
      ...records.problems.map((problem) => ({ kind: 'record' as const, reason: problem.reason })),
      ...pulled.problems.map((problem) => ({ kind: 'change' as const, reason: problem.reason })),
      ...files.problems.map((problem) => ({ kind: 'library' as const, reason: problem.reason }))
    ]
    this.setStatus(running, problems.length > 0 ? 'problems' : 'up-to-date', problems)
    if (keyChanges.read > 0) this.options.onStateChanged(running.projectId)
    if (pulled.files > 0 || files.files > 0 || records.people > 0 || records.project) {
      this.options.onProjectChanged(running.projectId)
    }
    for (const blocker of pulled.blockers) this.options.onBlockerArrived?.(blocker)
    if (pulled.dispatchInputs) this.options.onDispatchInputsChanged?.(running.projectId)
  }

  private setStatus(running: Running, status: ShareStatus, problems: ShareProblem[]): void {
    const changed =
      running.status !== status || JSON.stringify(problems) !== JSON.stringify(running.problems)
    running.status = status
    running.problems = problems
    if (changed && !running.personal) this.options.onStateChanged(running.projectId)
  }

  private async lastOwnSnapshotAt(running: Running): Promise<number> {
    const latest = await latestSnapshot(running.transport)
    if (!latest) return 0
    const wall = Number(latest.split('/').pop()?.slice(0, 15))
    return Number.isFinite(wall) ? wall : 0
  }

  /** The current key and its generation, for sealing; null when the project has none. */
  private keysFor(
    projectId: string
  ): { projectKey: Buffer; keyGeneration: number; privateKey: string } | null {
    const projectKey = projectKeyFor(this.db, projectId)
    if (!projectKey) return null
    return {
      projectKey,
      keyGeneration: keyGenerationOf(this.db, projectId),
      privateKey: identityKeys(this.db).privateKey
    }
  }

  private shares(): ShareRow[] {
    return this.db
      .prepare('SELECT project_id, share_id, folder, member_id, kind FROM sync_shares')
      .all() as ShareRow[]
  }

  private shareRow(projectId: string): ShareRow | null {
    return (
      (this.db
        .prepare(
          'SELECT project_id, share_id, folder, member_id, kind FROM sync_shares WHERE project_id = @projectId'
        )
        .get({ projectId }) as ShareRow | undefined) ?? null
    )
  }

  /** Opens any place (folder, Drive or server) the way this service does; handed to the personal space. */
  private readonly opener = (place: string): SyncTransport => this.transportFor(place)

  private transportFor(folder: string): SyncTransport {
    const opened = this.options.openTransport?.(folder)
    if (opened) return opened
    if (isDriveLocation(folder)) {
      if (!this.options.openDrive) throw new SharingError('no-drive-account')
      return this.options.openDrive(folder)
    }
    if (isServerLocation(folder)) {
      if (!this.options.openServer) throw new SharingError('no-sync-server')
      return this.options.openServer(folder)
    }
    return new FolderTransport(folder, { scanIntervalMs: this.options.scanIntervalMs })
  }

  /**
   * The people in a share: members grouped by person key (their device key when
   * they have no certificate). Each person's name is the newest Me name among
   * their devices, else their newest device's name.
   */
  private peopleOf(share: ShareRow): ShareMember[] {
    const rows = this.db
      .prepare(
        `SELECT member_id, name, joined_at, me, left_at, person_id, COALESCE(person_public_key, public_key) AS person_key
         FROM sync_members WHERE share_id = @shareId AND removed_at IS NULL ORDER BY joined_at, name`
      )
      .all({ shareId: share.share_id }) as {
      member_id: string
      name: string
      joined_at: number
      me: string | null
      left_at: number | null
      person_id: string | null
      person_key: string
    }[]
    const byPerson = new Map<string, typeof rows>()
    for (const row of rows) {
      byPerson.set(row.person_key, [...(byPerson.get(row.person_key) ?? []), row])
    }
    const people = [...byPerson].map(([personKey, devices]): ShareMember => {
      // Rows are oldest first, so the newest device is last.
      const named = [...devices]
        .reverse()
        .map((device) => meName(device.me))
        .find(Boolean)
      const personId =
        devices.find((device) => device.person_id)?.person_id ?? memberPersonId(personKey)
      const openTasks = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM planning_work_items
             WHERE project_id = @projectId AND assignee_id = @personId AND status <> 'done'
               AND deleted_at IS NULL AND archived_at IS NULL`
          )
          .get({ projectId: share.project_id, personId }) as { n: number }
      ).n
      return {
        personKey,
        personId,
        openTasks,
        name: named ?? devices[devices.length - 1].name,
        role: roleOf(this.db, share.share_id, personKey),
        devices: devices.map((device) => ({
          memberId: device.member_id,
          name: device.name,
          isThisPc: device.member_id === share.member_id,
          joinedAt: device.joined_at
        })),
        isMe: devices.some((device) => device.member_id === share.member_id),
        joinedAt: Math.min(...devices.map((device) => device.joined_at)),
        // Left only once every device they had here has left; one that joined again counts.
        ...(devices.every((device) => device.left_at !== null)
          ? { leftAt: Math.max(...devices.map((device) => device.left_at as number)) }
          : {})
      }
    })
    // The people still here first, then those who left.
    return people.sort(
      (a, b) =>
        Number(a.leftAt !== undefined) - Number(b.leftAt !== undefined) ||
        a.joinedAt - b.joinedAt ||
        a.name.localeCompare(b.name)
    )
  }

  private memberName(): string {
    const named = this.options.memberName?.().trim()
    if (named) return named
    try {
      return userInfo().username || 'Ostler user'
    } catch {
      return 'Ostler user'
    }
  }
}

/** The name on a stored Me card (JSON), or null. */
function meName(me: string | null): string | null {
  if (!me) return null
  try {
    const { name } = JSON.parse(me) as { name?: unknown }
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}
