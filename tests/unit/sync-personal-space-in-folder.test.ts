import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { personalSpaceIn } from '../../electron/services/sync/personal-space'
import { useTempDir } from '../helpers/temp-dir'

const root = useTempDir('space-in-folder-')

/** A personal space at `parent/name`: its `Personal/share.json` in the given format version. */
function space(parent: string, name: string, formatVersion = 1): string {
  const folder = path.join(parent, name)
  fs.mkdirSync(path.join(folder, 'Personal'), { recursive: true })
  fs.writeFileSync(
    path.join(folder, 'Personal', 'share.json'),
    JSON.stringify({ formatVersion, shareId: 'share', projectId: '~personal' })
  )
  return folder
}

describe('personalSpaceIn', () => {
  it('takes the space folder itself, whatever it is called', () => {
    const folder = space(root(), 'Renamed')
    expect(personalSpaceIn(folder)).toEqual({ kind: 'found', folder })
  })

  it('takes the space when the person picks its Personal folder', () => {
    const folder = space(root(), 'Ostler')
    expect(personalSpaceIn(path.join(folder, 'Personal'))).toEqual({ kind: 'found', folder })
  })

  it('finds the space below the folder the person picks', () => {
    const folder = space(path.join(root(), 'Dropbox', 'Apps'), 'Ostler')
    expect(personalSpaceIn(path.join(root(), 'Dropbox'))).toEqual({ kind: 'found', folder })
  })

  it('says when there is no space in the folder', () => {
    fs.mkdirSync(path.join(root(), 'Empty', 'Ostler'), { recursive: true })
    expect(personalSpaceIn(path.join(root(), 'Empty'))).toEqual({ kind: 'none' })
  })

  it('says when the space was made by a newer version', () => {
    const folder = space(root(), 'Ostler', 99)
    expect(personalSpaceIn(folder)).toEqual({ kind: 'newer' })
  })
})
