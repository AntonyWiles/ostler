import {
  DRIVE_FOLDER_MIME,
  DriveError,
  type DriveChangesPage,
  type DriveClient,
  type DriveFile
} from '../../electron/services/sync/drive-client'

interface Entry extends DriveFile {
  parent: string
  bytes: Uint8Array | null
}

/**
 * An in-memory Drive, shared by as many transports (or SyncServices) as a test likes. Like the real
 * one it lets two folders or files share a name; `seedFolder` and `seedFile` make that on demand.
 * Every create adds a line to `changeLog`, which `changes()` serves by page token.
 */
export class FakeDrive implements DriveClient {
  readonly entries = new Map<string, Entry>()
  readonly changeLog: { fileId: string; parent: string }[] = []
  readonly grants: { fileId: string; email: string; role: string }[] = []
  readonly calls: string[] = []
  private counter = 0
  private clock = 0

  constructor(readonly rootFolderId = 'rootFolder0001') {
    this.entries.set(rootFolderId, {
      id: rootFolderId,
      name: 'share',
      mimeType: DRIVE_FOLDER_MIME,
      createdTime: this.tick(),
      parent: 'root',
      bytes: null
    })
  }

  private tick(): string {
    this.clock += 1
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString()
  }

  private add(
    name: string,
    parent: string,
    mimeType: string,
    bytes: Uint8Array | null,
    createdTime?: string
  ): string {
    if (!this.entries.has(parent)) throw new DriveError(404)
    this.counter += 1
    const id = `fake-${String(this.counter).padStart(8, '0')}`
    this.entries.set(id, {
      id,
      name,
      mimeType,
      createdTime: createdTime ?? this.tick(),
      parent,
      bytes
    })
    this.changeLog.push({ fileId: id, parent })
    return id
  }

  /** Makes a folder even when one with that name exists. */
  seedFolder(name: string, parent: string, createdTime?: string): string {
    return this.add(name, parent, DRIVE_FOLDER_MIME, null, createdTime)
  }

  /** Makes a file even when one with that name exists. */
  seedFile(
    name: string,
    parent: string,
    bytes: Uint8Array,
    createdTime?: string,
    mimeType = 'application/octet-stream'
  ): string {
    return this.add(name, parent, mimeType, bytes, createdTime)
  }

  async listChildren(folderId: string): Promise<DriveFile[]> {
    this.calls.push(`list ${folderId}`)
    if (!this.entries.has(folderId)) throw new DriveError(404)
    return [...this.entries.values()]
      .filter((e) => e.parent === folderId)
      .map(({ id, name, mimeType, createdTime }) => ({ id, name, mimeType, createdTime }))
  }

  async findInRoot(name: string): Promise<DriveFile[]> {
    return [...this.entries.values()]
      .filter((e) => e.parent === 'root' && e.name === name && e.mimeType === DRIVE_FOLDER_MIME)
      .map(({ id, name: n, mimeType, createdTime }) => ({ id, name: n, mimeType, createdTime }))
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    this.calls.push(`createFolder ${name}`)
    return this.seedFolder(name, parentId)
  }

  async upload(name: string, parentId: string, bytes: Uint8Array): Promise<string> {
    this.calls.push(`upload ${name}`)
    return this.seedFile(name, parentId, new Uint8Array(bytes))
  }

  async download(fileId: string): Promise<Uint8Array> {
    const entry = this.entries.get(fileId)
    if (!entry?.bytes) throw new DriveError(404)
    return entry.bytes
  }

  async startPageToken(): Promise<string> {
    return String(this.changeLog.length)
  }

  async changes(pageToken: string): Promise<DriveChangesPage> {
    const from = Number(pageToken)
    return {
      changes: this.changeLog
        .slice(from)
        .map((c) => ({ fileId: c.fileId, removed: false, parents: [c.parent] })),
      newStartPageToken: String(this.changeLog.length)
    }
  }

  async grantAccess(fileId: string, email: string, role: 'writer' | 'reader'): Promise<void> {
    this.grants.push({ fileId, email, role })
  }

  async move(fileId: string, fromParentId: string, toParentId: string): Promise<void> {
    this.calls.push(`move ${fileId}`)
    const entry = this.entries.get(fileId)
    if (!entry || entry.parent !== fromParentId || !this.entries.has(toParentId)) {
      throw new DriveError(404)
    }
    entry.parent = toParentId
    this.changeLog.push({ fileId, parent: toParentId })
  }
}
