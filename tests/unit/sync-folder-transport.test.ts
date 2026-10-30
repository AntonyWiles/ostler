import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { canWriteIn, FolderTransport } from '../../electron/services/sync/folder-transport'
import { useTempDir } from '../helpers/temp-dir'

describe('sync/folder-transport.ts', () => {
  const root = useTempDir('ostler-test-sync-folder-')
  let transport: FolderTransport

  beforeEach(() => {
    transport = new FolderTransport(root())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a file once, reads it back, lists it, and leaves no temp file', async () => {
    const bytes = Buffer.from('first')
    await transport.writeOnce('changes/dev-a/000001.ostlerchanges', bytes)

    expect(await transport.read('changes/dev-a/000001.ostlerchanges')).toEqual(bytes)
    expect(await transport.list('')).toEqual(['changes/dev-a/000001.ostlerchanges'])
    expect(await transport.list('changes')).toEqual(['changes/dev-a/000001.ostlerchanges'])
    expect(fs.readdirSync(path.join(root(), 'changes', 'dev-a'))).toEqual(['000001.ostlerchanges'])
  })

  it('refuses to overwrite an existing file and keeps the first bytes', async () => {
    await transport.writeOnce('changes/dev-a/000001.ostlerchanges', Buffer.from('first'))

    await expect(
      transport.writeOnce('changes/dev-a/000001.ostlerchanges', Buffer.from('second'))
    ).rejects.toMatchObject({ reason: 'exists' })
    expect(await transport.read('changes/dev-a/000001.ostlerchanges')).toEqual(Buffer.from('first'))
  })

  it('refuses unsafe relative paths', async () => {
    for (const unsafe of ['../x', 'a\\b', '/abs', 'C:/x', 'a//b', '']) {
      await expect(transport.read(unsafe)).rejects.toMatchObject({ reason: 'bad-path' })
      await expect(transport.writeOnce(unsafe, Buffer.from('x'))).rejects.toMatchObject({
        reason: 'bad-path'
      })
    }
    await expect(transport.writeOnce('changes/.hidden', Buffer.from('x'))).rejects.toMatchObject({
      reason: 'bad-path'
    })
  })

  it('lists only visible files, skipping hidden and temp names and folders', async () => {
    await transport.writeOnce('changes/dev-a/000001.ostlerchanges', Buffer.from('a'))
    fs.writeFileSync(path.join(root(), 'changes', 'dev-a', '.hidden-file'), 'h')
    fs.writeFileSync(path.join(root(), 'changes', 'dev-a', 'partial.tmp'), 't')
    fs.mkdirSync(path.join(root(), 'changes', '.hidden-folder'), { recursive: true })
    fs.writeFileSync(path.join(root(), 'changes', '.hidden-folder', '000002.ostlerchanges'), 'b')

    expect(await transport.list('')).toEqual(['changes/dev-a/000001.ostlerchanges'])
    expect(await transport.list('missing')).toEqual([])
  })

  it('calls watch listeners on the timer path and never after stop', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const stop = new FolderTransport(root(), { scanIntervalMs: 1000 }).watch(onChange)

    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(1)

    stop()
    stop()
    vi.advanceTimersByTime(5000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('tells whether a folder can hold files, makes it when missing, and leaves nothing', async () => {
    const fresh = path.join(root(), 'Shared', 'House (abcd1234)')
    expect(await canWriteIn(fresh)).toBe(true)
    expect(fs.readdirSync(fresh)).toEqual([])
    expect(await canWriteIn(root())).toBe(true)
    expect(fs.readdirSync(root())).toEqual(['Shared'])

    // A folder that can't be made: its parent is a file.
    fs.writeFileSync(path.join(root(), 'a-file'), 'x')
    expect(await canWriteIn(path.join(root(), 'a-file', 'inside'))).toBe(false)
  })
})
