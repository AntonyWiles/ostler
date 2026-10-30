import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  findShareFolder,
  syncedRoots,
  syncPlaces,
  type FinderFs
} from '../../electron/services/sync/share-folder-finder'
import { useTempDir } from '../helpers/temp-dir'

const SHARE_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_SHARE_ID = '66666666-7777-4888-8999-000000000000'
const PROJECT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const root = useTempDir('share-finder-')

/** A folder under `parent`, with a `share.json` for `shareId` when given. */
function folder(parent: string, name: string, shareId?: string, text?: string): string {
  const dir = path.join(parent, name)
  fs.mkdirSync(dir, { recursive: true })
  if (text !== undefined) fs.writeFileSync(path.join(dir, 'share.json'), text)
  else if (shareId) {
    fs.writeFileSync(
      path.join(dir, 'share.json'),
      JSON.stringify({ formatVersion: 1, shareId, projectId: PROJECT_ID })
    )
  }
  return dir
}

const limits = { maxDepth: 5, maxFolders: 5000, timeoutMs: 20_000, fs: fs as FinderFs }

describe('findShareFolder', () => {
  it('finds the shared folder three levels down', async () => {
    const shared = folder(root(), 'a/b/Shared', SHARE_ID)
    expect(await findShareFolder(SHARE_ID, [root()], limits)).toBe(shared)
  })

  it('does not look beyond maxDepth', async () => {
    folder(root(), 'a/b/c/Shared', SHARE_ID)
    expect(await findShareFolder(SHARE_ID, [root()], { ...limits, maxDepth: 2 })).toBeNull()
  })

  it('does not match a share.json with another shareId', async () => {
    folder(root(), 'Other', OTHER_SHARE_ID)
    expect(await findShareFolder(SHARE_ID, [root()], limits)).toBeNull()
  })

  it('skips hidden and Windows system folders', async () => {
    folder(root(), '.hidden/Shared', SHARE_ID)
    folder(root(), '$RECYCLE.BIN/Shared', SHARE_ID)
    folder(root(), 'System Volume Information/Shared', SHARE_ID)
    expect(await findShareFolder(SHARE_ID, [root()], limits)).toBeNull()
  })

  it('stops after maxFolders', async () => {
    for (let index = 0; index < 20; index++) folder(root(), `plain-${index}`)
    folder(root(), 'zz/Shared', SHARE_ID)
    expect(await findShareFolder(SHARE_ID, [root()], { ...limits, maxFolders: 5 })).toBeNull()
    expect(await findShareFolder(SHARE_ID, [root()], limits)).not.toBeNull()
  })

  it('ignores a share.json that does not parse', async () => {
    folder(root(), 'Broken', undefined, '{ not json')
    folder(
      root(),
      'Wrong version',
      undefined,
      JSON.stringify({ formatVersion: 9, shareId: SHARE_ID, projectId: PROJECT_ID })
    )
    expect(await findShareFolder(SHARE_ID, [root()], limits)).toBeNull()
  })

  it('ignores a share.json that is too large to be one', async () => {
    folder(
      root(),
      'Huge',
      undefined,
      ' '.repeat(70 * 1024) +
        JSON.stringify({ formatVersion: 1, shareId: SHARE_ID, projectId: PROJECT_ID })
    )
    expect(await findShareFolder(SHARE_ID, [root()], limits)).toBeNull()
  })
})

describe('syncedRoots', () => {
  it('lists existing roots, and reads Dropbox folders from info.json', () => {
    const local = path.join(root(), 'local')
    const dropbox = path.join(root(), 'Dropbox')
    fs.mkdirSync(path.join(local, 'Dropbox'), { recursive: true })
    fs.mkdirSync(dropbox)
    fs.writeFileSync(
      path.join(local, 'Dropbox', 'info.json'),
      JSON.stringify({ personal: { path: dropbox } })
    )
    const profile = path.join(root(), 'profile')
    fs.mkdirSync(path.join(profile, 'My Drive'), { recursive: true })

    const roots = syncedRoots({ LOCALAPPDATA: local, USERPROFILE: profile }, fs as FinderFs)

    expect(roots).toContain(dropbox)
    expect(roots).toContain(path.join(profile, 'My Drive'))
    expect(roots).not.toContain(path.join(profile, 'Google Drive'))
  })

  it('ignores a Dropbox info.json that is not valid', () => {
    const local = path.join(root(), 'local')
    fs.mkdirSync(path.join(local, 'Dropbox'), { recursive: true })
    fs.writeFileSync(path.join(local, 'Dropbox', 'info.json'), 'nope')
    // Drive letters may hold a real My Drive on this PC, so only the Dropbox folder is checked.
    expect(
      syncedRoots({ LOCALAPPDATA: local }, fs as FinderFs).some((r) => r.startsWith(local))
    ).toBe(false)
  })
})

describe('syncPlaces', () => {
  it('names each provider, finds OneDrive and Dropbox by their default folders, and lists a folder once', () => {
    const profile = path.join(root(), 'profile')
    for (const name of ['My Drive', 'OneDrive', 'OneDrive - Contoso', 'Dropbox', 'Documents']) {
      fs.mkdirSync(path.join(profile, name), { recursive: true })
    }
    const env = { USERPROFILE: profile, OneDrive: path.join(profile, 'OneDrive') }

    const places = syncPlaces(env, fs as FinderFs).filter((place) =>
      place.folder.startsWith(profile)
    )

    expect(places).toEqual([
      { provider: 'google-drive', folder: path.join(profile, 'My Drive') },
      { provider: 'onedrive', folder: path.join(profile, 'OneDrive') },
      { provider: 'onedrive', folder: path.join(profile, 'OneDrive - Contoso') },
      { provider: 'dropbox', folder: path.join(profile, 'Dropbox') }
    ])
  })
})
