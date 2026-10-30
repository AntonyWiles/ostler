// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LINK_REFRESH_DELAY_MS,
  useWhiteboardDocument,
  WHITEBOARD_SAVE_DELAY_MS
} from '@renderer/components/whiteboard/useWhiteboardDocument'
import type {
  ItemLinkInfo,
  ItemLinkRef,
  LibraryItem,
  ProjectStateUpdate,
  Result,
  ShareState,
  WhiteboardObjectInput,
  WhiteboardSaveInput,
  WhiteboardSaveResult
} from '@shared/ostler-api'
import type { ObjectMap } from '@shared/whiteboard/history'
import { defaultObject } from '@shared/whiteboard/model'
import { installOstlerApi } from '../fixtures/ostler-api'

const item = {
  id: 'wb1',
  projectId: 'p1',
  kind: 'whiteboard',
  title: 'Whiteboard 1',
  summary: '',
  body: '',
  url: null,
  file: null,
  aiAccess: 'full',
  isPrimaryBrief: false,
  tags: [],
  revision: 1,
  createdAt: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:00:00.000Z',
  archivedAt: null
} as unknown as LibraryItem

const note = (id: string, x = 0, text = ''): WhiteboardObjectInput => ({
  ...defaultObject('note', { id, x, y: 0, z: 1 }),
  text
})

const A = note('a', 0, 'Alpha')
const B = note('b', 300, 'Beta')

/** The board's state with these objects changed or added, and these ids gone. */
function changed(
  from: ObjectMap,
  objects: WhiteboardObjectInput[],
  deleted: string[] = []
): ObjectMap {
  const next = new Map(from)
  for (const object of objects) next.set(object.id, object)
  for (const id of deleted) next.delete(id)
  return next
}

interface Fake {
  /** What the store holds; `getWhiteboard` answers with it. */
  stored: WhiteboardObjectInput[]
  saves: WhiteboardSaveInput[]
  /** Replaces how saves answer. */
  answer: (input: WhiteboardSaveInput) => Promise<Result<WhiteboardSaveResult>>
  emit(update: Partial<ProjectStateUpdate>): void
}

function install(
  options: {
    viewer?: boolean
    resolveItemLinks?: (refs: ItemLinkRef[]) => Promise<Result<ItemLinkInfo[]>>
  } = {}
): Fake {
  const listeners = new Set<(update: ProjectStateUpdate) => void>()
  const fake: Fake = {
    stored: [A, B],
    saves: [],
    answer: async () => ({ ok: true, value: { item, savedAt: '' } }),
    emit: (update) => {
      for (const listener of listeners) {
        listener({ projectId: 'p1', field: 'library', data: null, ...update } as ProjectStateUpdate)
      }
    }
  }
  installOstlerApi({
    getWhiteboard: async () => ({
      ok: true,
      value: {
        item,
        objects: fake.stored.map((object) => ({ ...object, createdAt: '', updatedAt: '' }))
      }
    }),
    saveWhiteboard: async (_projectId, _id, input) => {
      fake.saves.push(input)
      return fake.answer(input)
    },
    getShareState: async () => ({
      ok: true,
      value: options.viewer ? ({ myRole: 'viewer' } as ShareState) : null
    }),
    resolveItemLinks: options.resolveItemLinks ?? (async () => ({ ok: true, value: [] })),
    onProjectStateChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  })
  return fake
}

/** Lets resolved promises run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await settle()
}

async function open() {
  const hook = renderHook(() => useWhiteboardDocument('p1', 'wb1'))
  await settle()
  expect(hook.result.current.status).toBe('ready')
  return hook
}

const loaded = (): ObjectMap => new Map([A, B].map((object) => [object.id, object]))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWhiteboardDocument, saving', () => {
  it('saves a change once, 800 ms after it, with only the changed object', async () => {
    const fake = install()
    const { result } = await open()
    const moved = { ...A, x: 40 }

    act(() => result.current.onChange(changed(loaded(), [moved])))
    expect(result.current.saveState).toBe('unsaved')
    await wait(WHITEBOARD_SAVE_DELAY_MS - 1)
    expect(fake.saves).toHaveLength(0)
    await wait(1)

    expect(fake.saves).toEqual([{ upserts: [moved], deletes: [] }])
    expect(result.current.saveState).toBe('saved')
  })

  it('saves three quick changes once', async () => {
    const fake = install()
    const { result } = await open()
    const c = note('c', 600, 'Gamma')

    act(() => result.current.onChange(changed(loaded(), [{ ...A, x: 10 }])))
    await wait(300)
    act(() => result.current.onChange(changed(loaded(), [{ ...A, x: 20 }])))
    await wait(300)
    act(() => result.current.onChange(changed(loaded(), [{ ...A, x: 30 }, c], ['b'])))
    await wait(WHITEBOARD_SAVE_DELAY_MS)

    expect(fake.saves).toEqual([{ upserts: [{ ...A, x: 30 }, c], deletes: ['b'] }])
  })

  it('saves a change made during a save once that save is done', async () => {
    const fake = install()
    let finish: () => void = () => {}
    fake.answer = () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, value: { item, savedAt: '' } })
      })
    const { result } = await open()
    const first = changed(loaded(), [{ ...A, x: 10 }])

    act(() => result.current.onChange(first))
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(fake.saves).toHaveLength(1)
    expect(result.current.saveState).toBe('saving')

    act(() => result.current.onChange(changed(first, [{ ...B, text: 'Beta 2' }])))
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(fake.saves).toHaveLength(1)

    fake.answer = async () => ({ ok: true, value: { item, savedAt: '' } })
    await act(async () => finish())
    await settle()

    expect(fake.saves).toHaveLength(2)
    expect(fake.saves[1]).toEqual({ upserts: [{ ...B, text: 'Beta 2' }], deletes: [] })
    expect(result.current.saveState).toBe('saved')
  })

  it('saves at once on flush', async () => {
    const fake = install()
    const { result } = await open()

    act(() => result.current.onChange(changed(loaded(), [], ['a'])))
    await act(() => result.current.flush())

    expect(fake.saves).toEqual([{ upserts: [], deletes: ['a'] }])
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(fake.saves).toHaveLength(1)
  })

  it('saves what is waiting when the board closes', async () => {
    const fake = install()
    const { result, unmount } = await open()

    act(() => result.current.onChange(changed(loaded(), [{ ...A, x: 5 }])))
    unmount()
    await settle()

    expect(fake.saves).toEqual([{ upserts: [{ ...A, x: 5 }], deletes: [] }])
  })

  it('says a save failed, and tries again on the next change', async () => {
    const fake = install()
    fake.answer = async () => ({ ok: false, error: 'The disk is full.' })
    const { result } = await open()
    const first = changed(loaded(), [{ ...A, x: 10 }])

    act(() => result.current.onChange(first))
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(result.current.saveState).toBe('failed')
    expect(result.current.error).toBe('The disk is full.')

    fake.answer = async () => ({ ok: true, value: { item, savedAt: '' } })
    act(() => result.current.onChange(changed(first, [{ ...B, x: 310 }])))
    expect(result.current.saveState).toBe('failed')
    await wait(WHITEBOARD_SAVE_DELAY_MS)

    expect(fake.saves).toHaveLength(2)
    expect(fake.saves[1]).toEqual({
      upserts: [
        { ...A, x: 10 },
        { ...B, x: 310 }
      ],
      deletes: []
    })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.error).toBeNull()
  })
})

describe('useWhiteboardDocument, changes from elsewhere', () => {
  it('shows an object changed elsewhere, with a new version', async () => {
    const fake = install()
    const { result } = await open()
    const version = result.current.version

    fake.stored = [A, { ...B, text: 'Beta from Cat' }]
    fake.emit({})
    await settle()

    expect(result.current.version).toBe(version + 1)
    expect(result.current.objects.find((object) => object.id === 'b')?.text).toBe('Beta from Cat')
  })

  it('removes an object deleted elsewhere unless it changed here', async () => {
    const fake = install()
    const { result } = await open()

    fake.stored = []
    act(() => result.current.onChange(changed(loaded(), [{ ...A, text: 'Mine' }])))
    fake.emit({})
    await settle()

    expect(result.current.objects.map((object) => object.id)).toEqual(['a'])
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(fake.saves).toEqual([{ upserts: [{ ...A, text: 'Mine' }], deletes: [] }])
  })

  it("keeps the person's own change to an object changed elsewhere, and saves it", async () => {
    const fake = install()
    const { result } = await open()
    const version = result.current.version
    const mine = { ...A, text: 'Alpha, mine' }

    act(() => result.current.onChange(changed(loaded(), [mine])))
    fake.stored = [{ ...A, text: 'Alpha, theirs' }, B]
    fake.emit({})
    await settle()

    expect(result.current.version).toBe(version)
    await wait(WHITEBOARD_SAVE_DELAY_MS)
    expect(fake.saves).toEqual([{ upserts: [mine], deletes: [] }])
  })

  it('changes nothing when nothing differs', async () => {
    const fake = install()
    const { result } = await open()
    const { version, objects } = result.current

    fake.emit({})
    fake.emit({ projectId: 'p2' })
    await settle()

    expect(result.current.version).toBe(version)
    expect(result.current.objects).toBe(objects)
  })
})

describe('useWhiteboardDocument, who can change it', () => {
  it("is read-only on a Viewer's PC", async () => {
    install({ viewer: true })
    const { result } = await open()

    expect(result.current.readOnly).toBe(true)
  })

  it('is editable otherwise', async () => {
    install()
    const { result } = await open()

    expect(result.current.readOnly).toBe(false)
  })
})

describe('useWhiteboardDocument, linked items (prompt 12)', () => {
  const PROJECT = '11111111-2222-4333-8444-555555555555'
  const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const TASK_LINK = `ostler://task/${PROJECT}/${TASK}`

  it('resolves the links again 300 ms after a planning change, so a task done elsewhere shows done', async () => {
    let status: ItemLinkInfo['status'] = 'active'
    const resolve = vi.fn(async (refs: ItemLinkRef[]) => ({
      ok: true as const,
      value: refs.map((ref) => ({ ...ref, exists: true, title: 'Fix the header', status }))
    }))
    const fake = install({ resolveItemLinks: resolve })
    fake.stored = [{ ...A, link: TASK_LINK }, B]
    const { result } = await open()
    await settle()
    const before = resolve.mock.calls.length
    expect(result.current.links.get(TASK_LINK)?.status).toBe('active')

    status = 'done'
    fake.emit({ field: 'planning' })
    fake.emit({ field: 'planning' })
    fake.emit({ field: 'planning', projectId: 'p2' })
    await wait(LINK_REFRESH_DELAY_MS - 1)
    expect(resolve.mock.calls.length).toBe(before)
    await wait(1)

    expect(resolve.mock.calls.length).toBe(before + 1)
    expect(result.current.links.get(TASK_LINK)?.status).toBe('done')
  })
})
