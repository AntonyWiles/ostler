import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { resolveDataDir } from '../../electron/app/data-dir'
import { BRAND } from '../../src/shared/brand'

describe('resolveDataDir', () => {
  const appData = 'C:\\Users\\someone\\AppData\\Roaming'

  it('uses OSTLER_USER_DATA when it is set', () => {
    expect(resolveDataDir({ OSTLER_USER_DATA: 'C:\\temp\\scratch' }, appData)).toBe(
      'C:\\temp\\scratch'
    )
  })

  it('falls back to the pinned folder under appData when OSTLER_USER_DATA is unset', () => {
    const resolved = resolveDataDir({}, appData)
    expect(resolved).toBe(join(appData, BRAND.dataFolderName))
    // The folder Electron derived from package.json's name before it was pinned.
    expect(resolved).toBe(join(appData, 'ostler'))
  })

  it('treats an empty OSTLER_USER_DATA as unset', () => {
    expect(resolveDataDir({ OSTLER_USER_DATA: '' }, appData)).toBe(join(appData, 'ostler'))
  })

  it("reads --ostler-user-data from a development run's arguments, never a packaged one's", () => {
    const argv = ['electron.exe', '.', '--ostler-user-data=D:/scratch', 'ostler://inbox']
    expect(resolveDataDir({}, appData, argv, false)).toBe('D:/scratch')
    expect(resolveDataDir({}, appData, argv, true)).toBe(join(appData, 'ostler'))
    expect(resolveDataDir({ OSTLER_USER_DATA: 'D:/other' }, appData, argv, false)).toBe('D:/other')
  })
})
