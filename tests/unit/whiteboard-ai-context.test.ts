import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * What Ostler AI reads of a whiteboard (plan `docs/plans/whiteboards/`, prompt 18b): its outline,
 * said to be written from the board's objects, and only when the owner selects it (D23).
 */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'
const OUTLINE_LINE =
  "Whiteboard outline, written from the board's notes, shapes, arrows and mind maps (a drawing; positions and pictures are not included):"

const tempDir = useTempDir('ostler-whiteboard-ai-')
let library: LibraryService

beforeEach(async () => {
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
})

afterEach(() => {
  library.close()
})

const note = (id: string, text: string, x = 0) => ({
  id,
  kind: 'note',
  x,
  y: 0,
  width: 200,
  height: 200,
  z: 0,
  text
})

function board() {
  return library.whiteboards.create(PROJECT, {
    title: 'Garden plan',
    objects: [note('n1', 'Dig the beds'), note('n2', 'Order the seeds', 300)] as never
  }).item
}

describe("Ostler AI's view of a whiteboard", () => {
  it('sends a selected whiteboard with the outline line and its outline', () => {
    const item = board()
    expect(item.body).toContain('Dig the beds')

    const context = library.buildLibraryAiContext(PROJECT, { selectedItemIds: [item.id] })
    expect(context.included.map((entry) => entry.id)).toEqual([item.id])
    expect(context.markdown).toContain(`### [whiteboard] Garden plan`)
    expect(context.markdown).toContain(`${OUTLINE_LINE}\n\n${item.body}`)
  })

  it('lists an unselected whiteboard without sending it (when-selected)', () => {
    const item = board()
    expect(item.aiAccess).toBe('when-selected')

    const context = library.buildLibraryAiContext(PROJECT)
    expect(context.included).toEqual([])
    expect(context.listed.map((entry) => entry.id)).toEqual([item.id])
    expect(context.markdown).toContain(`- [whiteboard] Garden plan (id ${item.id})`)
    expect(context.markdown).not.toContain(OUTLINE_LINE)
    expect(context.markdown).not.toContain('Dig the beds')
  })

  it('renders other kinds as before, without the outline line', () => {
    const guide = library.createItem(PROJECT, { kind: 'guide', title: 'Plain', body: 'Body text' })
    const context = library.buildLibraryAiContext(PROJECT, { selectedItemIds: [guide.id] })
    expect(context.markdown).toContain('### [guide] Plain')
    expect(context.markdown).toContain('\n\nBody text')
    expect(context.markdown).not.toContain(OUTLINE_LINE)
  })
})
