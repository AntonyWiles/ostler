import { beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  copyReportPictures,
  imageTypeOf,
  readReportPicture,
  sessionPicturesDir,
  sweepReportPictures,
  withCopiedPictures
} from '../../electron/services/harness/report-pictures'
import { HarnessContextImpl } from '../../electron/services/harness/context'
import { emptyState } from '../../electron/services/harness/types'
import { useTempDir } from '../helpers/temp-dir'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = Buffer.from('GIF89a......')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'

const root = useTempDir('ostler-report-pictures-')
let copy: string
let projectDir: string

beforeEach(() => {
  copy = path.join(root(), 'copy')
  projectDir = path.join(root(), 'harness', 'project')
  fs.mkdirSync(path.join(copy, '.ostler-pictures'), { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })
})

function write(relative: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(path.join(copy, relative)), { recursive: true })
  fs.writeFileSync(path.join(copy, relative), bytes)
}

describe('imageTypeOf', () => {
  it('knows PNG, JPEG, GIF and WebP by their first bytes only', () => {
    expect(imageTypeOf(PNG)).toBe('png')
    expect(imageTypeOf(JPEG)).toBe('jpg')
    expect(imageTypeOf(GIF)).toBe('gif')
    expect(imageTypeOf(WEBP)).toBe('webp')
    expect(imageTypeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(imageTypeOf(Buffer.alloc(0))).toBeNull()
  })
})

describe('copyReportPictures', () => {
  it('copies images from inside the copy, named by number and real type', () => {
    write('.ostler-pictures/Home screen.png', PNG)
    // The name says PNG; the bytes say JPEG, and the bytes win.
    write('shots/after.png', JPEG)
    const { pictures, leftOut } = copyReportPictures(copy, projectDir, SESSION, [
      { path: '.ostler-pictures/Home screen.png', caption: 'Home' },
      { path: 'shots\\after.png' }
    ])
    expect(leftOut).toEqual([])
    expect(pictures).toEqual([
      {
        name: '1-Home-screen.png',
        path: '.ostler-pictures/Home screen.png',
        caption: 'Home',
        size: PNG.length
      },
      { name: '2-after.jpg', path: 'shots/after.png', size: JPEG.length }
    ])
    const stored = readReportPicture(projectDir, SESSION, '2-after.jpg')
    expect(stored?.mimeType).toBe('image/jpeg')
    expect(stored?.bytes.equals(JPEG)).toBe(true)
  })

  it('refuses paths that climb out, absolute paths and links that point out', () => {
    const outside = path.join(root(), 'secret.png')
    fs.writeFileSync(outside, PNG)
    let linked = true
    try {
      fs.symlinkSync(outside, path.join(copy, 'link.png'), 'file')
    } catch {
      // Windows without the right to make symbolic links: a junction to a folder instead.
      linked = false
    }
    fs.mkdirSync(path.join(root(), 'elsewhere'))
    fs.writeFileSync(path.join(root(), 'elsewhere', 'x.png'), PNG)
    fs.symlinkSync(path.join(root(), 'elsewhere'), path.join(copy, 'door'), 'junction')
    const { pictures, leftOut } = copyReportPictures(copy, projectDir, SESSION, [
      { path: '../secret.png' },
      { path: outside },
      { path: 'door/x.png' },
      ...(linked ? [{ path: 'link.png' }] : [])
    ])
    expect(pictures).toEqual([])
    expect(leftOut.map((entry) => entry.reason)).toEqual(Array(linked ? 4 : 3).fill('outside-copy'))
  })

  it('lists what is not an image, missing, too large or beyond ten', () => {
    write('notes.txt', Buffer.from('hello'))
    write('big.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))
    for (let i = 0; i < 11; i++) write(`p${i}.png`, PNG)
    const { pictures, leftOut } = copyReportPictures(copy, projectDir, SESSION, [
      { path: 'notes.txt' },
      { path: 'missing.png' },
      { path: 'big.png' },
      ...Array.from({ length: 11 }, (_, i) => ({ path: `p${i}.png` }))
    ])
    expect(pictures).toHaveLength(10)
    expect(leftOut).toEqual([
      { path: 'notes.txt', reason: 'not-image' },
      { path: 'missing.png', reason: 'not-found' },
      { path: 'big.png', reason: 'too-large' },
      { path: 'p10.png', reason: 'too-many' }
    ])
  })

  it('numbers on from earlier reports of the same session', () => {
    write('a.png', PNG)
    copyReportPictures(copy, projectDir, SESSION, [{ path: 'a.png' }])
    const second = copyReportPictures(copy, projectDir, SESSION, [{ path: 'a.png' }])
    expect(second.pictures[0].name).toBe('2-a.png')
  })

  it('stores names, never bytes, and drops the requests from the report', () => {
    write('a.png', PNG)
    const report = withCopiedPictures(
      {
        summary: 's',
        filesChanged: [],
        submittedAt: 'now',
        pictureRequests: [{ path: 'a.png' }, { path: 'b.txt' }]
      },
      copy,
      projectDir,
      SESSION
    )
    expect(report).toEqual({
      summary: 's',
      filesChanged: [],
      submittedAt: 'now',
      pictures: [{ name: '1-a.png', path: 'a.png', size: PNG.length }],
      picturesLeftOut: [{ path: 'b.txt', reason: 'not-found' }]
    })
  })
})

describe('reading and deleting', () => {
  it('reads only names it wrote, and deletes a session with its record', () => {
    write('a.png', PNG)
    copyReportPictures(copy, projectDir, SESSION, [{ path: 'a.png' }])
    expect(readReportPicture(projectDir, SESSION, '../state.json')).toBeNull()
    expect(readReportPicture(projectDir, '..', '1-a.png')).toBeNull()
    expect(readReportPicture(projectDir, SESSION, '1-a.png')).not.toBeNull()

    sweepReportPictures(projectDir, [SESSION])
    expect(fs.existsSync(sessionPicturesDir(projectDir, SESSION)!)).toBe(true)
    sweepReportPictures(projectDir, [])
    expect(fs.existsSync(sessionPicturesDir(projectDir, SESSION)!)).toBe(false)
  })
})

describe('the harness state', () => {
  it("deletes a session's pictures when its record leaves the state", () => {
    const ctx = new HarnessContextImpl(
      root(),
      {} as never,
      () => ({}) as never,
      () => ({}) as never
    )
    const dir = ctx.projectDir('p')
    const state = { ...emptyState(), sessions: [{ id: SESSION } as never] }
    write('a.png', PNG)
    copyReportPictures(copy, dir, SESSION, [{ path: 'a.png' }])
    ctx.saveState('p', state)
    expect(fs.existsSync(sessionPicturesDir(dir, SESSION)!)).toBe(true)
    ctx.saveState('p', { ...state, sessions: [] })
    expect(fs.existsSync(sessionPicturesDir(dir, SESSION)!)).toBe(false)
  })
})
