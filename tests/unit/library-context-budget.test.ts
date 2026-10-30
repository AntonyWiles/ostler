import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService, libraryContextBudget } from '../../electron/services/library-service'
import {
  LIBRARY_CONTEXT_BUDGET_CHARS,
  LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * How much of the Library goes with one Ostler AI request. The chat sends it
 * with every message, so it has the small budget; a planning action runs once
 * and has the large one. Either way the project's primary brief is sent
 * first and whole, even when it alone is longer than the budget, and the
 * other items fill what is left; what does not fit is named, not sent.
 */

const tempDir = useTempDir('ostler-context-budget-')
let library: LibraryService
const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'

beforeEach(async () => {
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
})

afterEach(() => {
  library.close()
})

const text = (chars: number) => 'x'.repeat(chars)
const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id)

describe('the library context budget', () => {
  it('is 20,000 characters for the chat and 100,000 for a planning action', () => {
    expect(LIBRARY_CONTEXT_BUDGET_CHARS).toBe(20_000)
    expect(LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS).toBe(100_000)
    expect(libraryContextBudget('chat')).toBe(20_000)
    expect(libraryContextBudget('planning')).toBe(100_000)
    expect(library.buildLibraryAiContext(PROJECT).budgetChars).toBe(20_000)
    expect(library.buildLibraryAiContextSummary(PROJECT, [], 'planning').budgetChars).toBe(100_000)
    expect(library.buildLibraryAiContextSummary(PROJECT).budgetChars).toBe(20_000)
  })

  it('sends the primary brief first and whole, then fills what is left', () => {
    const brief = library.createItem(PROJECT, { kind: 'brief', title: 'Brief', body: text(8_000) })
    const guide = library.createItem(PROJECT, { kind: 'guide', title: 'Guide', body: text(9_000) })
    // A note comes after guides, so the order does not hang on the clock.
    const big = library.createItem(PROJECT, {
      kind: 'note',
      title: 'Big note',
      body: text(15_000),
      aiAccess: 'always'
    })
    expect(brief.isPrimaryBrief).toBe(true)

    const chat = library.buildLibraryAiContext(PROJECT)
    expect(ids(chat.included)[0]).toBe(brief.id)
    expect(ids(chat.included)).toContain(guide.id)
    expect(ids(chat.listed)).toContain(big.id)
    expect(chat.overBudget).toBe(true)
    expect(chat.totalChars).toBeLessThanOrEqual(20_000)
    expect(chat.markdown).toContain(text(8_000))

    const planning = library.buildLibraryAiContext(PROJECT, {
      budgetChars: LIBRARY_PLANNING_CONTEXT_BUDGET_CHARS
    })
    expect(ids(planning.included).sort()).toEqual([brief.id, guide.id, big.id].sort())
    expect(planning.overBudget).toBe(false)
  })

  it('sends a brief longer than the whole budget whole, and names the rest', () => {
    const brief = library.createItem(PROJECT, {
      kind: 'brief',
      title: 'Long brief',
      body: text(30_000)
    })
    const guide = library.createItem(PROJECT, { kind: 'guide', title: 'Guide', body: text(100) })

    const chat = library.buildLibraryAiContext(PROJECT)
    expect(ids(chat.included)).toEqual([brief.id])
    expect(chat.markdown).toContain(text(30_000))
    expect(chat.totalChars).toBeGreaterThan(20_000)
    expect(ids(chat.listed)).toEqual([guide.id])
    expect(chat.overBudget).toBe(true)
  })

  it('puts the brief ahead of the items chosen for this request', () => {
    const brief = library.createItem(PROJECT, { kind: 'brief', title: 'Brief', body: text(12_000) })
    const chosen = library.createItem(PROJECT, {
      kind: 'note',
      title: 'Chosen note',
      body: text(12_000),
      aiAccess: 'when-selected'
    })

    const chat = library.buildLibraryAiContext(PROJECT, { selectedItemIds: [chosen.id] })
    expect(ids(chat.included)).toEqual([brief.id])
    expect(ids(chat.listed)).toEqual([chosen.id])
  })

  it('sends another brief by the budget, as any other item', () => {
    const primary = library.createItem(PROJECT, {
      kind: 'brief',
      title: 'Primary',
      body: text(100)
    })
    const other = library.createItem(PROJECT, {
      kind: 'brief',
      title: 'Second brief',
      body: text(25_000)
    })
    expect(other.isPrimaryBrief).toBe(false)

    const chat = library.buildLibraryAiContext(PROJECT)
    expect(ids(chat.included)).toEqual([primary.id])
    expect(ids(chat.listed)).toEqual([other.id])
  })

  it('keeps a brief the person set to Human only out, and fills the budget without it', () => {
    library.createItem(PROJECT, {
      kind: 'brief',
      title: 'Private brief',
      body: text(30_000),
      aiAccess: 'human-only'
    })
    const guide = library.createItem(PROJECT, { kind: 'guide', title: 'Guide', body: text(100) })

    const chat = library.buildLibraryAiContext(PROJECT)
    expect(ids(chat.included)).toEqual([guide.id])
    expect(chat.markdown).not.toContain(text(30_000))
  })
})
