import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * A new note starts as human-only. Someone who never uses Ostler AI still
 * attaches their notes to tasks, so a person may attach a human-only item;
 * no agent, Ostler AI draft or automation call is ever given one.
 */

const tempDir = useTempDir('ostler-attach-human-')
const PROJECT = 'project-one'
const human = { kind: 'human' as const }
let library: LibraryService
let planning: PlanningService

beforeEach(async () => {
  const dbPath = await createMigratedDatabase(tempDir())
  library = new LibraryService(dbPath, tempDir())
  planning = new PlanningService(dbPath, () => [PROJECT])
})

afterEach(() => {
  library.close()
  planning.close()
})

describe('attaching a human-only item', () => {
  it('lets a person attach it, and never gives it to an agent', () => {
    const task = planning.createWorkItem(PROJECT, { title: 'Book the venue' }, human)
    const note = library.createItem(PROJECT, { kind: 'note', title: 'Venue ideas' })
    expect(note.aiAccess).toBe('human-only')

    library.attachToWorkItem(PROJECT, task.id, note.id, 'human')
    expect(library.listWorkItemAttachments(PROJECT, task.id).map((e) => e.item.id)).toEqual([
      note.id
    ])
    expect(library.agentAttachments(PROJECT, task.id).given).toEqual([])
  })

  it('refuses it from Ostler AI and automation', () => {
    const task = planning.createWorkItem(PROJECT, { title: 'Book the venue' }, human)
    const note = library.createItem(PROJECT, { kind: 'note', title: 'Venue ideas' })
    expect(() => library.attachToWorkItem(PROJECT, task.id, note.id, 'ostler-ai')).toThrow()
    expect(() => library.attachToWorkItem(PROJECT, task.id, note.id, 'automation')).toThrow()
    expect(library.listWorkItemAttachments(PROJECT, task.id)).toEqual([])
  })

  it('still refuses an archived item, even from a person', () => {
    const task = planning.createWorkItem(PROJECT, { title: 'Book the venue' }, human)
    const note = library.createItem(PROJECT, { kind: 'note', title: 'Old plan' })
    library.archiveItem(PROJECT, note.id)
    expect(() => library.attachToWorkItem(PROJECT, task.id, note.id, 'human')).toThrow()
  })
})
