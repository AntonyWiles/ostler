import { describe, expect, it, vi } from 'vitest'
import { importFromClipboard } from '../../electron/services/library-clipboard'
import type { LibraryService } from '../../electron/services/library-service'

/** Just the Library calls a clipboard import makes, each answering with what it was given. */
function fakeLibrary() {
  const item = (fields: object) => ({ item: { id: 'i1', ...fields } })
  const library = {
    importFiles: vi.fn(async (_projectId: string, files: { fileName: string }[]) =>
      files.map((file) => item({ title: file.fileName }))
    ),
    importPaths: vi.fn(async (_projectId: string, paths: string[]) =>
      paths.map((file) => item({ title: file }))
    ),
    createItem: vi.fn((_projectId: string, input: object) => ({ id: 'i1', ...input }))
  }
  return { library, service: library as unknown as LibraryService }
}

const nothing = { image: null, filePath: null, text: '' }

describe('Import from clipboard (MOP-7)', () => {
  it('keeps a picture as a PNG named for today', async () => {
    const { library, service } = fakeLibrary()
    await importFromClipboard(service, 'p1', { ...nothing, image: Buffer.from([1, 2]) })
    const [[, files]] = library.importFiles.mock.calls
    expect(files[0]).toMatchObject({ mimeType: 'image/png' })
    expect(files[0].fileName).toMatch(/^Pasted picture .+\.png$/)
  })

  it('keeps a file copied in File Explorer as that file', async () => {
    const { library, service } = fakeLibrary()
    await importFromClipboard(service, 'p1', { ...nothing, filePath: 'D:/Work/plan.pdf' })
    expect(library.importPaths).toHaveBeenCalledWith('p1', ['D:/Work/plan.pdf'])
  })

  it('keeps a web address as a link titled by its site and path', async () => {
    const { library, service } = fakeLibrary()
    await importFromClipboard(service, 'p1', {
      ...nothing,
      text: ' https://example.com/docs/start \n'
    })
    expect(library.createItem).toHaveBeenCalledWith('p1', {
      kind: 'link',
      title: 'example.com/docs/start',
      url: 'https://example.com/docs/start'
    })
  })

  it('keeps other text as a note titled by its first line', async () => {
    const { library, service } = fakeLibrary()
    const long = 'x'.repeat(100)
    await importFromClipboard(service, 'p1', { ...nothing, text: `Shopping\nmilk\neggs` })
    await importFromClipboard(service, 'p1', { ...nothing, text: long })
    expect(library.createItem.mock.calls[0][1]).toEqual({
      kind: 'note',
      title: 'Shopping',
      body: 'Shopping\nmilk\neggs'
    })
    expect((library.createItem.mock.calls[1][1] as { title: string }).title).toHaveLength(80)
  })

  it('keeps nothing from an empty clipboard, and only a picture for Paste picture', async () => {
    const { library, service } = fakeLibrary()
    expect(await importFromClipboard(service, 'p1', nothing)).toBeNull()
    expect(
      await importFromClipboard(service, 'p1', { ...nothing, text: 'words' }, { only: 'image' })
    ).toBeNull()
    expect(library.createItem).not.toHaveBeenCalled()
  })
})
