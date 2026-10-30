import { describe, expect, it } from 'vitest'
import type { LibraryTextProgress } from '../../src/shared/ostler-api'
import {
  LibraryTextPass,
  type LibraryTextPassLibrary
} from '../../electron/services/library-text-pass'

/** A library whose read state survives "restarts", as `file_json` does. */
function fakeLibrary(ids: string[]) {
  const read = new Set<string>()
  const calls: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const library: LibraryTextPassLibrary = {
    listUnreadDocuments: () =>
      ids.filter((id) => !read.has(id)).map((itemId) => ({ projectId: 'p', itemId })),
    readStoredText: async (_projectId, itemId) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls.push(itemId)
      await Promise.resolve()
      if (itemId === 'bad') {
        inFlight -= 1
        throw new Error('broken file')
      }
      read.add(itemId)
      inFlight -= 1
      return true
    }
  }
  return { library, calls, read, maxInFlight: () => maxInFlight }
}

const noWait = () => Promise.resolve()

describe('LibraryTextPass', () => {
  it('reads one file at a time and reports progress', async () => {
    const fake = fakeLibrary(['a', 'b', 'c'])
    const progress: (LibraryTextProgress | null)[] = []
    const reads: string[] = []
    const pass = new LibraryTextPass({
      library: fake.library,
      isBusy: () => false,
      wait: noWait,
      onProgress: (state) => progress.push(state),
      onRead: (projectId) => reads.push(projectId)
    })
    await pass.start()
    expect(fake.calls).toEqual(['a', 'b', 'c'])
    expect(fake.maxInFlight()).toBe(1)
    expect(progress).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
      null
    ])
    expect(reads).toEqual(['p', 'p', 'p'])
    expect(pass.progress).toBeNull()
  })

  it('waits while the person is busy', async () => {
    const fake = fakeLibrary(['a'])
    let busyChecks = 0
    const waits: number[] = []
    const pass = new LibraryTextPass({
      library: fake.library,
      isBusy: () => ++busyChecks <= 3,
      wait: async (ms) => {
        waits.push(ms)
        expect(fake.calls).toEqual(busyChecks <= 3 ? [] : ['a'])
      }
    })
    await pass.start()
    expect(fake.calls).toEqual(['a'])
    expect(waits.slice(0, 3)).toEqual([1000, 1000, 1000])
  })

  it('carries on after a restart and never reads a file twice', async () => {
    const fake = fakeLibrary(['a', 'b', 'c', 'd'])
    let stopAfter = 2
    const first: LibraryTextPass = new LibraryTextPass({
      library: fake.library,
      isBusy: () => false,
      wait: async () => {
        if (--stopAfter === 0) void first.stop()
      }
    })
    await first.start()
    expect(fake.calls).toEqual(['a', 'b'])

    const second = new LibraryTextPass({ library: fake.library, isBusy: () => false, wait: noWait })
    await second.start()
    const third = new LibraryTextPass({ library: fake.library, isBusy: () => false, wait: noWait })
    await third.start()
    expect(fake.calls).toEqual(['a', 'b', 'c', 'd'])
  })

  it('goes on past a file that fails, and runs once however often it is started', async () => {
    const fake = fakeLibrary(['a', 'bad', 'c'])
    const errors: string[] = []
    const pass = new LibraryTextPass({
      library: fake.library,
      isBusy: () => false,
      wait: noWait,
      logError: (message) => errors.push(message)
    })
    const run = pass.start()
    expect(pass.start()).toBe(run)
    await run
    expect(fake.calls).toEqual(['a', 'bad', 'c'])
    expect(errors).toEqual(['Could not read Library item bad'])
  })
})
