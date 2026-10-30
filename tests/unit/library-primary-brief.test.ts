import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * The Overview shows a project's primary brief. A person who writes their
 * first design brief, from the Library or from the Overview's own "Write a
 * brief", expects to see it there without a second step (found by the GUI
 * monkey: the Overview kept saying "No project brief yet").
 */

const tempDir = useTempDir('ostler-brief-')
let library: LibraryService
const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'

beforeEach(async () => {
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
})

afterEach(() => {
  library.close()
})

describe('the primary brief', () => {
  it("makes a project's first design brief its primary brief", () => {
    const first = library.createItem(PROJECT, { kind: 'brief', title: 'What we are building' })
    expect(first.isPrimaryBrief).toBe(true)
    expect(library.getItem(PROJECT, first.id).isPrimaryBrief).toBe(true)
  })

  it('leaves the primary brief alone when another brief is added', () => {
    const first = library.createItem(PROJECT, { kind: 'brief', title: 'First' })
    const second = library.createItem(PROJECT, { kind: 'brief', title: 'Second' })
    expect(second.isPrimaryBrief).toBe(false)
    expect(library.getItem(PROJECT, first.id).isPrimaryBrief).toBe(true)
  })

  it('keeps an explicit choice either way', () => {
    const declined = library.createItem(PROJECT, {
      kind: 'brief',
      title: 'Not this one',
      isPrimaryBrief: false
    })
    expect(declined.isPrimaryBrief).toBe(false)
    const chosen = library.createItem(PROJECT, {
      kind: 'brief',
      title: 'This one',
      isPrimaryBrief: true
    })
    expect(chosen.isPrimaryBrief).toBe(true)
  })

  it('fills the slot again once the primary brief is archived', () => {
    const first = library.createItem(PROJECT, { kind: 'brief', title: 'Old' })
    library.archiveItem(PROJECT, first.id)
    const next = library.createItem(PROJECT, { kind: 'brief', title: 'New' })
    expect(next.isPrimaryBrief).toBe(true)
  })

  it('never makes a guide or a note the brief', () => {
    expect(
      library.createItem(PROJECT, { kind: 'guide', title: 'How we work' }).isPrimaryBrief
    ).toBe(false)
    expect(library.createItem(PROJECT, { kind: 'note', title: 'Scratch' }).isPrimaryBrief).toBe(
      false
    )
  })
})
