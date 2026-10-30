import { describe, expect, it } from 'vitest'
import type { DriveFile } from '../../electron/services/sync/drive-client'
import { drivePlaceFor, myDriveFolder, myDriveSegments } from '../../mobile/src/sync/my-drive-path'

const folder = (id: string, createdTime: string): DriveFile => ({
  id,
  name: 'Ostler',
  mimeType: 'application/vnd.google-apps.folder',
  createdTime
})

describe('reading a Drive for desktop path on the phone', () => {
  it('takes the folders below My Drive from a Windows or macOS path', () => {
    expect(myDriveSegments('G:\\My Drive\\Ostler\\Projects\\Testing (fe401535)')).toEqual([
      'Ostler',
      'Projects',
      'Testing (fe401535)'
    ])
    expect(
      myDriveSegments('/Users/ann/Library/CloudStorage/GoogleDrive-ann@x.com/My Drive/Ostler')
    ).toEqual(['Ostler'])
  })

  it('refuses a path outside My Drive, My Drive itself, and dot segments', () => {
    expect(myDriveSegments('C:\\Users\\ann\\Ostler')).toBeNull()
    expect(myDriveSegments('G:\\My Drive')).toBeNull()
    expect(myDriveSegments('G:\\My Drive\\..\\secret')).toBeNull()
  })

  it('finds the top folder in My Drive, the oldest of several', async () => {
    const asked: string[] = []
    const findInRoot = async (name: string) => {
      asked.push(name)
      return [
        folder('newerFolder01', '2026-10-02T00:00:00Z'),
        folder('olderFolder01', '2026-10-01T00:00:00Z')
      ]
    }
    expect(await myDriveFolder(['Ostler', 'Projects', 'Testing (fe401535)'], findInRoot)).toBe(
      'gdrive:olderFolder01/Projects/Testing (fe401535)'
    )
    expect(await myDriveFolder(['Ostler'], findInRoot)).toBe('gdrive:olderFolder01')
    expect(asked).toEqual(['Ostler', 'Ostler'])
  })

  it('gives null when the top folder is not in My Drive', async () => {
    expect(await myDriveFolder(['Ostler'], async () => [])).toBeNull()
    expect(await myDriveFolder([], async () => [])).toBeNull()
  })

  it('keeps a Drive place as it is and refuses any other folder', async () => {
    const none = async () => {
      throw new Error('not asked')
    }
    expect(await drivePlaceFor('gdrive:abcFolder0001/Projects', none)).toBe(
      'gdrive:abcFolder0001/Projects'
    )
    expect(await drivePlaceFor('D:\\Shared\\Ostler', none)).toBeNull()
    expect(
      await drivePlaceFor('G:\\My Drive\\Ostler\\Personal', async () => [
        folder('rootFolder001', '2026-10-01T00:00:00Z')
      ])
    ).toBe('gdrive:rootFolder001/Personal')
  })
})
