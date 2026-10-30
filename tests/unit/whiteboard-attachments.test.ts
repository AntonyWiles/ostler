import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import {
  renderAttachmentMarkdown,
  resolveTaskAttachments,
  type TaskAttachmentReader
} from '../../electron/services/task-attachments'
import type { LibraryItem } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * A whiteboard attached to a task reaches a coding agent as one Markdown file: its outline, said
 * to be written from the board's objects (plan `docs/plans/whiteboards/`, prompt 18b).
 */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'
const WHITEBOARD_LINE =
  "Whiteboard: this outline is written from the board's notes, shapes, arrows and mind maps."

const tempDir = useTempDir('ostler-whiteboard-attachments-')
let library: LibraryService

beforeEach(async () => {
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
})

afterEach(() => {
  library.close()
})

function board(): LibraryItem {
  return library.whiteboards.create(PROJECT, {
    title: 'Release flow',
    objects: [
      { id: 'n1', kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, text: 'Tag the build' }
    ] as never
  }).item
}

function readerFor(item: LibraryItem): TaskAttachmentReader {
  return {
    agentAttachments: () => ({
      given: [{ item, attachedBy: 'human', revisionAtAttach: 1, currentRevision: 1 }],
      skipped: []
    }),
    originalFilePath: () => {
      throw new Error('a whiteboard has no file')
    },
    getItemText: () => item.body
  } as unknown as TaskAttachmentReader
}

describe('whiteboards for coding agents', () => {
  it('says a whiteboard is an outline written from its objects', () => {
    const item = board()
    expect(renderAttachmentMarkdown(item)).toBe(
      `# Release flow\n\nRevision 1\n\n${WHITEBOARD_LINE}\n\n${item.body}\n`
    )
    expect(item.body).toContain('Tag the build')
  })

  it('renders a note exactly as before', () => {
    const note = library.createItem(PROJECT, {
      kind: 'note',
      title: 'Plain',
      summary: 'Short',
      body: 'Body text'
    })
    expect(renderAttachmentMarkdown(note)).toBe(
      '# Plain\n\nRevision 1\n\nSummary: Short\n\nBody text\n'
    )
  })

  it('gives an attached whiteboard as one Markdown file', () => {
    const item = board()
    const log: string[] = []
    const resolved = resolveTaskAttachments(
      readerFor(item),
      PROJECT,
      { planningWorkItemId: 'w' },
      (message) => log.push(message)
    )
    expect(log).toEqual([])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].given.kind).toBe('whiteboard')
    expect(resolved[0].files).toHaveLength(1)
    const [file] = resolved[0].files
    expect(file.form).toBe('markdown')
    expect(file.extension).toBe('md')
    expect(file.read().toString('utf8')).toBe(renderAttachmentMarkdown(item))
  })
})
