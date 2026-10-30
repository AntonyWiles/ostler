import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectNotesService } from '../../electron/services/project-notes-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { makeWatchedProject } from '../helpers/projects'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function project(): WatchedProject {
  return makeWatchedProject({
    id: 'muse-project',
    name: 'Muse',
    path: 'C:/projects/muse',
    addedAt: Date.now()
  })
}

describe('ProjectNotesService', () => {
  it('appends approved status notes beneath Ostler user data, never the watched project', () => {
    const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'ostler-notes-'))
    tempDirs.push(dataDir)
    const result = new ProjectNotesService(dataDir).saveStatusNote(
      project(),
      '## Current status\nOn track.'
    )

    // The service resolves the real path; on a runner os.tmpdir() can be an 8.3 short name.
    expect(result).toBe(
      join(fs.realpathSync.native(dataDir), 'ai', 'project-notes', 'muse-project', 'status.md')
    )
    expect(fs.readFileSync(result, 'utf8')).toContain('On track.')
    expect(fs.existsSync(join('C:/projects/muse', 'status.md'))).toBe(false)
  })

  it('rejects an empty status note', () => {
    const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'ostler-notes-'))
    tempDirs.push(dataDir)
    expect(() => new ProjectNotesService(dataDir).saveStatusNote(project(), '   ')).toThrow(
      'cannot be empty'
    )
  })

  it('rejects project identifiers that could select a different storage location', () => {
    const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'ostler-notes-'))
    tempDirs.push(dataDir)
    const unsafeProject = { ...project(), id: '../harness' }

    expect(() => new ProjectNotesService(dataDir).saveStatusNote(unsafeProject, 'status')).toThrow(
      'Invalid project identifier'
    )
    expect(fs.existsSync(join(dataDir, 'harness'))).toBe(false)
  })
})
