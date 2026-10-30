import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRefusal } from '../../src/shared/refusal'
import {
  WHITEBOARD_FILE_FORMAT,
  parseWhiteboardFile
} from '../../src/shared/whiteboard/file-format'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Library images get their thumbnails from Electron; under Vitest it cannot decode.
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) } }))

const { LibraryService } = await import('../../electron/services/library-service')
const { importWhiteboardText, whiteboardFileText } =
  await import('../../electron/services/whiteboard-file')

/**
 * The whiteboard file (plan `docs/plans/whiteboards/`, prompt 16, D15): a stored board exports
 * with its pictures embedded, and a file imports as a new whiteboard with fresh ids, its
 * pictures in the Library. Every problem with a file is a translated refusal.
 */

const PROJECT = 'project-one'
const OTHER = 'project-two'

// A real 1x1 PNG, so the Library classifies it as an image.
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)

const tempDir = useTempDir('ostler-whiteboard-file-')
let library: InstanceType<typeof LibraryService>

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

const connector = (id: string, from: string, to: string) => ({
  id,
  kind: 'connector',
  x: 200,
  y: 100,
  width: 100,
  height: 1,
  z: 2,
  data: { from: { objectId: from, x: 200, y: 100 }, to: { objectId: to, x: 300, y: 100 } }
})

const image = (id: string, imageItemId: string) => ({
  id,
  kind: 'image',
  x: 0,
  y: 400,
  width: 100,
  height: 100,
  z: 1,
  data: { imageItemId }
})

async function importPicture(projectId = PROJECT) {
  const [result] = await library.importFiles(projectId, [
    { fileName: 'Floor plan.png', mimeType: 'image/png', bytes: PNG }
  ])
  return result.item
}

/** A board with two notes, a connector between them and a picture. */
async function makeBoard(title = 'Launch plan') {
  const picture = await importPicture()
  const { item } = library.whiteboards.create(PROJECT, {
    title,
    objects: [
      note('n1', 'Plan'),
      note('n2', 'Ship', 300),
      connector('c1', 'n1', 'n2'),
      image('i1', picture.id)
    ] as never
  })
  return { board: item, picture }
}

async function refusalOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error) {
    expect(isRefusal(error)).toBe(true)
    return (error as Error).message
  }
  throw new Error('Expected a refusal')
}

describe('whiteboardFileText', () => {
  it('exports the board with its one picture embedded', async () => {
    const { board, picture } = await makeBoard()
    const { title, text, missingPictures } = whiteboardFileText(library, PROJECT, board.id)
    expect(title).toBe('Launch plan')
    expect(missingPictures).toBe(0)
    const parsed = parseWhiteboardFile(text)
    if (!parsed.ok) throw new Error(parsed.problem)
    expect(parsed.file.format).toBe(WHITEBOARD_FILE_FORMAT)
    expect(parsed.file.objects).toHaveLength(4)
    expect(parsed.file.pictures).toHaveLength(1)
    expect(parsed.file.pictures[0]).toMatchObject({
      id: picture.id,
      fileName: 'Floor plan.png',
      mimeType: 'image/png'
    })
    expect(Buffer.from(parsed.file.pictures[0].base64, 'base64').equals(Buffer.from(PNG))).toBe(
      true
    )
  })

  it('counts a picture whose file is gone and leaves it out', async () => {
    const { board, picture } = await makeBoard()
    fs.rmSync(path.join(tempDir(), 'library', PROJECT, picture.id), {
      recursive: true,
      force: true
    })
    const { text, missingPictures } = whiteboardFileText(library, PROJECT, board.id)
    expect(missingPictures).toBe(1)
    const parsed = parseWhiteboardFile(text)
    if (!parsed.ok) throw new Error(parsed.problem)
    expect(parsed.file.pictures).toHaveLength(0)
    const drawn = parsed.file.objects.find((object) => object.kind === 'image')
    expect(drawn?.kind === 'image' && drawn.data.imageItemId).toBeNull()
  })
})

describe('importWhiteboardText', () => {
  it('makes a new whiteboard in another project with new ids, the connector stuck and the picture imported', async () => {
    const { board } = await makeBoard()
    const { text } = whiteboardFileText(library, PROJECT, board.id)

    const imported = await importWhiteboardText(library, OTHER, text, 'Launch plan.whiteboard.json')
    expect(imported.kind).toBe('whiteboard')
    expect(imported.projectId).toBe(OTHER)
    expect(imported.title).toBe('Launch plan')

    const { objects } = library.whiteboards.get(OTHER, imported.id)
    expect(objects).toHaveLength(4)
    for (const object of objects) expect(['n1', 'n2', 'c1', 'i1']).not.toContain(object.id)
    const notes = objects.filter((object) => object.kind === 'note')
    const line = objects.find((object) => object.kind === 'connector')
    if (line?.kind !== 'connector') throw new Error('expected a connector')
    expect(notes.map((object) => object.id)).toContain(line.data.from.objectId)
    expect(notes.map((object) => object.id)).toContain(line.data.to.objectId)

    const drawn = objects.find((object) => object.kind === 'image')
    if (drawn?.kind !== 'image' || drawn.data.imageItemId === null) {
      throw new Error('expected a picture')
    }
    const picture = library.getItem(OTHER, drawn.data.imageItemId)
    expect(picture.kind).toBe('image')
    expect(picture.projectId).toBe(OTHER)
  })

  it('reuses a picture the project already holds', async () => {
    const { board, picture } = await makeBoard()
    const { text } = whiteboardFileText(library, PROJECT, board.id)
    const imported = await importWhiteboardText(library, PROJECT, text, 'Copy.whiteboard.json')
    const drawn = library.whiteboards
      .get(PROJECT, imported.id)
      .objects.find((object) => object.kind === 'image')
    expect(drawn?.kind === 'image' && drawn.data.imageItemId).toBe(picture.id)
  })

  it('takes the title from the file name when the file has none', async () => {
    const text = JSON.stringify({
      format: WHITEBOARD_FILE_FORMAT,
      version: 1,
      title: '  ',
      objects: [note('n1', 'Hello')],
      pictures: []
    })
    const imported = await importWhiteboardText(library, OTHER, text, 'Ideas.whiteboard.json')
    expect(imported.title).toBe('Ideas')
  })

  it('refuses each problem with its own message and makes nothing', async () => {
    const cases: [string, string][] = [
      ['not json', 'errors:whiteboard.file.not-json'],
      ['{"format":"something-else"}', 'errors:whiteboard.file.not-whiteboard'],
      [
        JSON.stringify({ format: WHITEBOARD_FILE_FORMAT, version: 99, objects: [], pictures: [] }),
        'errors:whiteboard.file.newer-version'
      ],
      [
        JSON.stringify({ format: WHITEBOARD_FILE_FORMAT, version: 1, objects: 'x', pictures: [] }),
        'errors:whiteboard.file.invalid'
      ],
      [
        // A picture whose bytes are not the PNG it claims to be.
        JSON.stringify({
          format: WHITEBOARD_FILE_FORMAT,
          version: 1,
          objects: [],
          pictures: [
            {
              id: 'p1',
              fileName: 'x.png',
              mimeType: 'image/png',
              base64: Buffer.from('hello').toString('base64')
            }
          ]
        }),
        'errors:whiteboard.file.invalid'
      ]
    ]
    const { t } = await import('../../src/shared/i18n')
    for (const [text, key] of cases) {
      expect(await refusalOf(() => importWhiteboardText(library, OTHER, text, 'a.json'))).toBe(
        t(key)
      )
    }
    expect(library.listItems(OTHER, {})).toHaveLength(0)
  })

  it('refuses a file that is too large', async () => {
    const { WHITEBOARD_FILE_MAX_BYTES } = await import('../../src/shared/whiteboard/file-format')
    const text = ' '.repeat(WHITEBOARD_FILE_MAX_BYTES + 1)
    const { t } = await import('../../src/shared/i18n')
    expect(await refusalOf(() => importWhiteboardText(library, OTHER, text, 'a.json'))).toBe(
      t('errors:whiteboard.file.too-large')
    )
  })
})
