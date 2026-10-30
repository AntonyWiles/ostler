/**
 * Sharing through Google Drive (docs/plans/mobile/overview.md, phase 3): which Google account
 * this PC syncs through, and where in its Drive a newly shared project goes. One account per PC
 * (D15): the first connected Google account that has `sync.drive`. Everything the app keeps is in
 * one folder named after the brand in the root of My Drive, projects in its `Projects/` folder
 * (D3). Calls go through the connected account, so tokens never leave it.
 */
import { BRAND } from '@shared/brand'
import type { ConnectedAccount } from '@shared/ostler-api'
import type { AccountCall } from '../accounts/connected-accounts-service'
import {
  DRIVE_FOLDER_MIME,
  GoogleDriveClient,
  type DriveClient,
  type DriveFile,
  type DriveRequest,
  type DriveResponse
} from './drive-client'
import { DriveChangesPoller } from './drive-changes'
import {
  driveLocation,
  DriveTransport,
  isDriveLocation,
  parseDriveLocation,
  pollerSubscription
} from './drive-transport'
import { oldSpaceFolderName, SPACE_OWN_FOLDERS } from './pairing'
import { SharingError } from './sharing'

const PROJECTS_FOLDER = 'Projects'
/** Room for a large snapshot; an account call refuses bigger answers. */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

export interface DriveSyncDependencies {
  /** The connected accounts that give `sync.drive`, oldest first. */
  accountsWithDrive(): ConnectedAccount[]
  /** An account call (ConnectedAccountsService.call). Throws on a non-2xx answer. */
  call(
    accountId: string,
    url: string,
    call: AccountCall
  ): Promise<{ status: number; headers: { get(name: string): string | null }; bytes: Uint8Array }>
  /** Tests: a Drive to use instead of the account's. */
  client?: DriveClient
}

export class DriveSyncSettings {
  private readonly client: DriveClient
  /** One poller for the Drive account: a single `changes` call wakes every share that changed. */
  private readonly poller: DriveChangesPoller

  constructor(private readonly deps: DriveSyncDependencies) {
    this.client = deps.client ?? new GoogleDriveClient((init) => this.request(init))
    this.poller = new DriveChangesPoller(this.client)
  }

  /** The Google account this PC syncs through Drive with, or null when none can. */
  accountId(): string | null {
    return (
      this.deps.accountsWithDrive().find((account) => account.provider === 'google')?.id ?? null
    )
  }

  ready(): boolean {
    return this.accountId() !== null
  }

  /** The transport for a Drive place. */
  open(place: string): DriveTransport {
    if (!this.ready()) throw new SharingError('no-drive-account')
    return new DriveTransport(this.client, place, { subscribe: pollerSubscription(this.poller) })
  }

  /** This PC pushed a change to a Drive share: ask Drive what changed soon, so others' answers come quickly. */
  kick(): void {
    this.poller.kick()
  }

  /**
   * Gives `email` access to the Drive folder of a share at `place`; Google emails them a link.
   * Throws `SharingError('not-an-invite')` for a place that is not a Drive folder.
   */
  async grantAccess(place: string, email: string, role: 'writer' | 'reader'): Promise<void> {
    if (!this.ready()) throw new SharingError('no-drive-account')
    if (!isDriveLocation(place)) throw new SharingError('not-an-invite')
    await this.client.grantAccess(parseDriveLocation(place).folderId, email, role)
  }

  /** A new folder for a project in `Projects/`, named after it; its Drive place. */
  async newProjectFolder(projectName: string): Promise<string> {
    if (!this.ready()) throw new SharingError('no-drive-account')
    const root = await this.rootFolder()
    const projects = await this.childFolder(root, PROJECTS_FOLDER)
    const taken = new Set(
      (await this.client.listChildren(projects)).map((file) => file.name.toLowerCase())
    )
    const base = projectName.trim() || PROJECTS_FOLDER
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} (${n})`
    return driveLocation(await this.client.createFolder(name, projects))
  }

  /**
   * The brand's folder in My Drive as a Drive place: where the personal space lives (it holds
   * `Personal/`, `Projects/` and `devices/`). Made when `create` is true; else null when there is none yet.
   */
  async rootPlace(create: boolean): Promise<string | null> {
    if (!this.ready()) throw new SharingError('no-drive-account')
    if (create) return driveLocation(await this.rootFolder())
    const found = oldest(await this.client.findInRoot(BRAND.name))
    return found ? driveLocation(found) : null
  }

  /**
   * Moves the own folders (`Personal/`, `devices/`) of the personal space at the Drive place `space`
   * into a new "Old personal space …" folder inside it, so a new space can start there. Nothing is
   * deleted. Returns that folder's name.
   */
  async setAsideSpace(space: string, now: Date): Promise<string> {
    if (!this.ready()) throw new SharingError('no-drive-account')
    const { folderId, subPath } = parseDriveLocation(space)
    let spaceId = folderId
    for (const segment of subPath.split('/').filter(Boolean)) {
      const child = oldest(
        (await this.client.listChildren(spaceId)).filter(
          (file) => file.name === segment && file.mimeType === DRIVE_FOLDER_MIME
        )
      )
      if (!child) throw new SharingError('not-an-invite')
      spaceId = child
    }
    const children = await this.client.listChildren(spaceId)
    const name = oldSpaceFolderName(now, new Set(children.map((file) => file.name)))
    const own = children.filter(
      (file) =>
        file.mimeType === DRIVE_FOLDER_MIME &&
        (SPACE_OWN_FOLDERS as readonly string[]).includes(file.name)
    )
    if (own.length === 0) return name
    const holder = await this.client.createFolder(name, spaceId)
    for (const folder of own) await this.client.move(folder.id, spaceId, holder)
    return name
  }

  /** The brand's folder in the root of My Drive, made when there is none; the oldest of several. */
  private async rootFolder(): Promise<string> {
    const found = oldest(await this.client.findInRoot(BRAND.name))
    return found ?? (await this.client.createFolder(BRAND.name, 'root'))
  }

  private async childFolder(parentId: string, name: string): Promise<string> {
    const found = oldest(
      (await this.client.listChildren(parentId)).filter(
        (file) => file.name === name && file.mimeType === DRIVE_FOLDER_MIME
      )
    )
    return found ?? (await this.client.createFolder(name, parentId))
  }

  private async request(init: DriveRequest): Promise<DriveResponse> {
    const accountId = this.accountId()
    if (!accountId) throw new SharingError('no-drive-account')
    try {
      return await this.deps.call(accountId, init.url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        maxBytes: MAX_DOWNLOAD_BYTES
      })
    } catch (error) {
      // An answer that came back is handed on, so the Drive client reads its status (a 404 matters).
      const status = (error as { status?: unknown } | null)?.status
      if (typeof status === 'number')
        return { status, headers: NO_HEADERS, bytes: new Uint8Array() }
      throw error
    }
  }
}

const NO_HEADERS = { get: () => null }

function oldest(files: DriveFile[]): string | null {
  const sorted = [...files].sort((a, b) => a.createdTime.localeCompare(b.createdTime))
  return sorted[0]?.id ?? null
}
