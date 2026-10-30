import { describe, expect, it } from 'vitest'
import {
  FolderRequiredError,
  isFolderRequiredError,
  projectFolder,
  requireProjectFolder
} from '../../src/shared/project-folder'

describe('project folder gate', () => {
  it('returns the linked folder, and null for none or an empty legacy path', () => {
    expect(projectFolder({ path: 'C:\\projects\\site' })).toBe('C:\\projects\\site')
    expect(projectFolder({ path: null })).toBeNull()
    expect(projectFolder({ path: '' })).toBeNull()
    expect(projectFolder({ path: '   ' })).toBeNull()
    expect(projectFolder({ path: undefined })).toBeNull()
  })

  it('requires a folder with a message the user can act on', () => {
    expect(requireProjectFolder({ path: 'C:\\projects\\site' }, 'Starting an agent session')).toBe(
      'C:\\projects\\site'
    )
    let caught: unknown
    try {
      requireProjectFolder({ path: null }, 'Starting an agent session')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(FolderRequiredError)
    expect(isFolderRequiredError(caught)).toBe(true)
    expect((caught as Error).message).toBe(
      "Starting an agent session needs a linked folder. Link one in the project's settings."
    )
    expect(isFolderRequiredError(new Error('other'))).toBe(false)
  })
})
