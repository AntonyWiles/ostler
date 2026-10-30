import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveChangesPoller } from '../../electron/services/sync/drive-changes'
import { DriveTransport, pollerSubscription } from '../../electron/services/sync/drive-transport'
import { FakeDrive } from '../helpers/fake-drive'

const bytes = (text: string): Buffer => Buffer.from(text)

/** A poller on a fake Drive that records every gap it waits, using the faked global timers. */
function setup(): { drive: FakeDrive; poller: DriveChangesPoller; delays: number[] } {
  const drive = new FakeDrive()
  const delays: number[] = []
  const poller = new DriveChangesPoller(drive, {
    setTimer: (fn, ms) => {
      delays.push(ms)
      return setTimeout(fn, ms)
    },
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now()
  })
  return { drive, poller, delays }
}

describe('DriveChangesPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('serves three subscribers with one changes call per poll', async () => {
    const { drive, poller } = setup()
    const changes = vi.spyOn(drive, 'changes')
    const calls = [vi.fn(), vi.fn(), vi.fn()]
    for (const onChange of calls) poller.subscribe(() => true, onChange)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('1.bin', drive.rootFolderId, bytes('x'))
    drive.seedFile('2.bin', drive.rootFolderId, bytes('x'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changes).toHaveBeenCalledTimes(1)
    for (const onChange of calls) expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('tells only the subscribers interested in the changed folders', async () => {
    const { drive, poller } = setup()
    const mine = drive.seedFolder('mine', drive.rootFolderId)
    const theirs = drive.seedFolder('theirs', drive.rootFolderId)
    const onMine = vi.fn()
    const onTheirs = vi.fn()
    poller.subscribe((parents) => parents.includes(mine), onMine)
    poller.subscribe((parents) => parents.includes(theirs), onTheirs)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('1.bin', mine, bytes('x'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onMine).toHaveBeenCalledTimes(1)
    expect(onTheirs).not.toHaveBeenCalled()
  })

  it('backs off to maxMs when quiet and resets on a change and on kick()', async () => {
    const { drive, poller, delays } = setup()
    poller.subscribe(() => true, vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000_000)
    expect(delays).toContain(120_000)
    expect(delays).toContain(240_000)
    expect(delays.at(-1)).toBe(300_000)
    expect(Math.max(...delays)).toBe(300_000)

    drive.seedFile('1.bin', drive.rootFolderId, bytes('x'))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(delays.at(-1)).toBe(60_000)

    await vi.advanceTimersByTimeAsync(2_000_000)
    expect(delays.at(-1)).toBe(300_000)
    poller.kick()
    expect(delays.at(-1)).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(delays.at(-1)).toBe(60_000)
  })

  it('stops polling when the last subscriber leaves', async () => {
    const { drive, poller } = setup()
    const changes = vi.spyOn(drive, 'changes')
    const stopOne = poller.subscribe(() => true, vi.fn())
    const stopTwo = poller.subscribe(() => true, vi.fn())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changes).toHaveBeenCalledTimes(1)
    stopOne()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changes).toHaveBeenCalledTimes(2)
    stopTwo()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(changes).toHaveBeenCalledTimes(2)
    poller.kick()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a failed call at the next tick without losing the token', async () => {
    const { drive, poller } = setup()
    const onChange = vi.fn()
    poller.subscribe(() => true, onChange)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('1.bin', drive.rootFolderId, bytes('x'))
    const changes = vi.spyOn(drive, 'changes').mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls.map((c) => c[0])).toEqual(['0', '0'])
  })

  it('pages through every page before storing the new token', async () => {
    const { drive, poller } = setup()
    const onChange = vi.fn()
    poller.subscribe((parents) => parents.includes('far'), onChange)
    await vi.advanceTimersByTimeAsync(0)
    const changes = vi
      .spyOn(drive, 'changes')
      .mockResolvedValueOnce({ changes: [], nextPageToken: 'p2' })
      .mockResolvedValueOnce({
        changes: [{ fileId: 'f', removed: false, parents: ['far'] }],
        newStartPageToken: '9'
      })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changes.mock.calls.map((c) => c[0])).toEqual(['0', 'p2', '9'])
  })
})

describe('pollerSubscription', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('wakes a Drive transport only for folders it has resolved', async () => {
    const drive = new FakeDrive()
    const other = drive.seedFolder('other', drive.rootFolderId)
    const poller = new DriveChangesPoller(drive)
    const transport = new DriveTransport(drive, `gdrive:${drive.rootFolderId}/Personal`, {
      subscribe: pollerSubscription(poller)
    })
    await transport.writeOnce('changes/a.bin', bytes('a'))
    const personalId = (await drive.listChildren(drive.rootFolderId)).find(
      (f) => f.name === 'Personal'
    )!.id
    const changesId = (await drive.listChildren(personalId))[0].id
    expect(transport.ownsFolder(drive.rootFolderId)).toBe(true)
    expect(transport.ownsFolder(changesId)).toBe(true)
    expect(transport.ownsFolder(other)).toBe(false)

    const onChange = vi.fn()
    const stop = transport.watch(onChange)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('x.bin', other, bytes('x'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).not.toHaveBeenCalled()
    drive.seedFile('b.bin', changesId, bytes('b'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
