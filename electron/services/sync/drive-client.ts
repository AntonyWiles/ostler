/**
 * A small Google Drive v3 client for the Drive transport. It is platform-neutral: every call goes
 * through an injected `request`, so the Android app can reuse it. It builds URLs and bodies only;
 * signing in, token handling and retries belong to whoever supplies `request`.
 */

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  createdTime: string
}

export interface DriveChange {
  fileId: string
  removed: boolean
  parents: string[]
}

export interface DriveChangesPage {
  changes: DriveChange[]
  newStartPageToken?: string
  nextPageToken?: string
}

export interface DriveClient {
  listChildren(folderId: string): Promise<DriveFile[]>
  createFolder(name: string, parentId: string): Promise<string>
  upload(name: string, parentId: string, bytes: Uint8Array): Promise<string>
  download(fileId: string): Promise<Uint8Array>
  startPageToken(): Promise<string>
  changes(pageToken: string): Promise<DriveChangesPage>
  grantAccess(fileId: string, email: string, role: 'writer' | 'reader'): Promise<void>
  /** Folders named `name` directly in the account's root. */
  findInRoot(name: string): Promise<DriveFile[]>
  /** Moves a file or folder from one folder into another; nothing is copied or deleted. */
  move(fileId: string, fromParentId: string, toParentId: string): Promise<void>
}

export interface DriveRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface DriveResponse {
  status: number
  headers: { get(name: string): string | null }
  bytes: Uint8Array
}

export class DriveError extends Error {
  constructor(readonly status: number) {
    super(`Google Drive answered ${status}`)
    this.name = 'DriveError'
  }
}

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true'
/** Above this size an upload uses the resumable flow. */
export const MULTIPART_LIMIT = 5 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Escapes a value for a single-quoted Drive query string. */
function quoted(value: string): string {
  return `'${value.replace(/[\\']/g, (c) => `\\${c}`)}'`
}

function boundary(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return `ostler-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export class GoogleDriveClient implements DriveClient {
  constructor(private readonly request: (init: DriveRequest) => Promise<DriveResponse>) {}

  async listChildren(folderId: string): Promise<DriveFile[]> {
    return this.listQuery(`${quoted(folderId)} in parents and trashed=false`)
  }

  async findInRoot(name: string): Promise<DriveFile[]> {
    return this.listQuery(
      `'root' in parents and trashed=false and name=${quoted(name)} and mimeType='${DRIVE_FOLDER_MIME}'`
    )
  }

  private async listQuery(q: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const url =
        `${API}/files?q=${encodeURIComponent(q)}` +
        `&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,createdTime)')}` +
        `&pageSize=1000&${ALL_DRIVES}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
      const page = await this.json<{ nextPageToken?: string; files?: DriveFile[] }>({
        method: 'GET',
        url
      })
      for (const file of page.files ?? []) {
        files.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          createdTime: file.createdTime
        })
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    return files
  }

  async createFolder(name: string, parentId: string): Promise<string> {
    const made = await this.json<{ id: string }>({
      method: 'POST',
      url: `${API}/files?fields=id&supportsAllDrives=true`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId] })
    })
    return made.id
  }

  async upload(name: string, parentId: string, bytes: Uint8Array): Promise<string> {
    const metadata = JSON.stringify({ name, parents: [parentId] })
    if (bytes.length <= MULTIPART_LIMIT) {
      const edge = boundary()
      const head = encoder.encode(
        `--${edge}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${edge}\r\nContent-Type: application/octet-stream\r\n\r\n`
      )
      const tail = encoder.encode(`\r\n--${edge}--`)
      const body = new Uint8Array(head.length + bytes.length + tail.length)
      body.set(head, 0)
      body.set(bytes, head.length)
      body.set(tail, head.length + bytes.length)
      const made = await this.json<{ id: string }>({
        method: 'POST',
        url: `${UPLOAD}/files?uploadType=multipart&fields=id&supportsAllDrives=true`,
        headers: { 'Content-Type': `multipart/related; boundary=${edge}` },
        body
      })
      return made.id
    }
    const start = await this.send({
      method: 'POST',
      url: `${UPLOAD}/files?uploadType=resumable&fields=id&supportsAllDrives=true`,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(bytes.length)
      },
      body: metadata
    })
    const location = start.headers.get('Location')
    if (!location) throw new DriveError(start.status)
    const done = await this.send({
      method: 'PUT',
      url: location,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes
    })
    return (JSON.parse(decoder.decode(done.bytes)) as { id: string }).id
  }

  async download(fileId: string): Promise<Uint8Array> {
    const answer = await this.send({
      method: 'GET',
      url: `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
    })
    return answer.bytes
  }

  async startPageToken(): Promise<string> {
    const answer = await this.json<{ startPageToken: string }>({
      method: 'GET',
      url: `${API}/changes/startPageToken?supportsAllDrives=true`
    })
    return answer.startPageToken
  }

  async changes(pageToken: string): Promise<DriveChangesPage> {
    const fields = 'newStartPageToken,nextPageToken,changes(fileId,removed,file(parents))'
    const answer = await this.json<{
      newStartPageToken?: string
      nextPageToken?: string
      changes?: { fileId: string; removed?: boolean; file?: { parents?: string[] } }[]
    }>({
      method: 'GET',
      url:
        `${API}/changes?pageToken=${encodeURIComponent(pageToken)}` +
        `&fields=${encodeURIComponent(fields)}&${ALL_DRIVES}`
    })
    return {
      changes: (answer.changes ?? []).map((c) => ({
        fileId: c.fileId,
        removed: c.removed === true,
        parents: c.file?.parents ?? []
      })),
      newStartPageToken: answer.newStartPageToken,
      nextPageToken: answer.nextPageToken
    }
  }

  async grantAccess(fileId: string, email: string, role: 'writer' | 'reader'): Promise<void> {
    await this.send({
      method: 'POST',
      url:
        `${API}/files/${encodeURIComponent(fileId)}/permissions` +
        `?sendNotificationEmail=true&supportsAllDrives=true`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role, emailAddress: email })
    })
  }

  async move(fileId: string, fromParentId: string, toParentId: string): Promise<void> {
    await this.send({
      method: 'PATCH',
      url:
        `${API}/files/${encodeURIComponent(fileId)}` +
        `?addParents=${encodeURIComponent(toParentId)}` +
        `&removeParents=${encodeURIComponent(fromParentId)}&supportsAllDrives=true`,
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
  }

  private async send(init: DriveRequest): Promise<DriveResponse> {
    const answer = await this.request(init)
    if (answer.status < 200 || answer.status > 299) throw new DriveError(answer.status)
    return answer
  }

  private async json<T>(init: DriveRequest): Promise<T> {
    const answer = await this.send(init)
    return JSON.parse(decoder.decode(answer.bytes)) as T
  }
}
