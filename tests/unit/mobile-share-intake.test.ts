import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIBRARY_MAX_TASK_ATTACHMENTS } from '@shared/ostler-api'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const share = await import('../../mobile/src/data/share-intake')
const attachments = await import('../../mobile/src/data/task-attachments')
const { addLibraryNote, libraryItems } = await import('../../mobile/src/data/library')
const { addVoiceMemo, newVoiceMemoId } = await import('../../mobile/src/data/voice-memos')

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const SHA = 'b'.repeat(64)

const kept = (name: string, kind: 'image' | 'document' = 'image') => ({
  itemId: newVoiceMemoId(),
  kind,
  fileName: name,
  mimeType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
  sizeBytes: 2048,
  sha256: SHA
})

describe('share payloads', () => {
  it('finds the address in shared words and titles from the words around it', () => {
    const payload = share.sharePayload({
      text: '  Tile ideas https://tiles.example.com/range?id=4. \nfor the bathroom ',
      files: null
    })!
    expect(payload.url).toBe('https://tiles.example.com/range?id=4')
    expect(share.shareTitle(payload)).toBe('Tile ideas')
    expect(share.shareDescription(payload)).toContain('for the bathroom')
  })

  it('prefers the sharing app subject, then file names, then the site', () => {
    expect(
      share.shareTitle(share.sharePayload({ text: 'body', meta: { title: 'Page title' } })!)
    ).toBe('Page title')
    expect(
      share.shareTitle(
        share.sharePayload({ files: [{ path: 'file:///c/IMG_0042.jpg', mimeType: 'image/jpeg' }] })!
      )
    ).toBe('IMG_0042')
    const link = share.sharePayload({ webUrl: 'https://www.example.com/a' })!
    expect(share.shareTitle(link)).toBe('example.com')
    expect(share.shareDescription(link)).toBe('https://www.example.com/a')
  })

  it('ignores an empty share', () => {
    expect(share.sharePayload({ text: '  ', files: [] })).toBeNull()
  })

  it('picks the project used last while it is still there', () => {
    expect(share.defaultShareProject(['a', 'b'], 'b')).toBe('b')
    expect(share.defaultShareProject(['a', 'b'], 'gone')).toBe('a')
    expect(share.defaultShareProject([], null)).toBeNull()
  })
})

describe('shares and attachments in the database', () => {
  const tempDir = useTempDir('ostler-mobile-share-')
  let db: Database.Database
  let taskId: string

  beforeEach(async () => {
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    taskId = planning.createWorkItem(PROJECT, { title: 'Fit sink' }, human).id
    planning.close()
    db = new Database(path)
  })

  afterEach(() => db.close())

  const phone = () => db as unknown as EditDb & QueryDb

  it('attaches a photo to a task, lists it apart from voice memos, and takes it off', () => {
    const photo = kept('sink.jpg')
    attachments.attachFileToTask(phone(), taskId, photo)
    addVoiceMemo(phone(), taskId, {
      itemId: newVoiceMemoId(),
      title: 'Memo',
      fileName: 'memo.m4a',
      mimeType: 'audio/mp4',
      sizeBytes: 10,
      sha256: SHA,
      durationMs: 1000,
      transcript: ''
    })
    expect(attachments.taskAttachments(phone(), taskId)).toMatchObject([
      { itemId: photo.itemId, kind: 'image', title: 'sink', fileName: 'sink.jpg' }
    ])
    attachments.detachTaskAttachment(phone(), taskId, photo.itemId)
    expect(attachments.taskAttachments(phone(), taskId)).toEqual([])
    // The item stays in the Library.
    expect(libraryItems(phone(), PROJECT).some((item) => item.id === photo.itemId)).toBe(true)
  })

  it('attaches an existing Library item once', () => {
    const note = addLibraryNote(phone(), PROJECT, { title: 'Plan', body: 'Steps' })
    attachments.attachLibraryItem(phone(), taskId, note.id)
    attachments.attachLibraryItem(phone(), taskId, note.id)
    expect(attachments.taskAttachments(phone(), taskId)).toHaveLength(1)
  })

  it('refuses a file when the task is full, and writes nothing', () => {
    for (let n = 0; n < LIBRARY_MAX_TASK_ATTACHMENTS; n++) {
      attachments.attachFileToTask(phone(), taskId, kept(`p${n}.jpg`))
    }
    const before = libraryItems(phone(), PROJECT).length
    expect(() => attachments.attachFileToTask(phone(), taskId, kept('extra.jpg'))).toThrow(
      /at most/
    )
    expect(libraryItems(phone(), PROJECT)).toHaveLength(before)
  })

  it('makes a new task from a share with its files attached', () => {
    const payload = share.sharePayload({
      text: 'Quote for the boiler https://quotes.example.com/77',
      files: [{ path: 'file:///c/quote.pdf', fileName: 'quote.pdf' }]
    })!
    const id = share.shareAsTask(phone(), PROJECT, payload, share.shareTitle(payload), [
      kept('quote.pdf', 'document')
    ])
    const task = db
      .prepare('SELECT title, description FROM planning_work_items WHERE id = ?')
      .get(id) as { title: string; description: string }
    expect(task.title).toBe('Quote for the boiler')
    expect(task.description).toContain('https://quotes.example.com/77')
    expect(attachments.taskAttachments(phone(), id)).toMatchObject([
      { kind: 'document', fileName: 'quote.pdf' }
    ])
  })

  it('adds a shared link to the Library with its words and tags', () => {
    const payload = share.sharePayload({ text: 'Nice taps https://taps.example.com/x' })!
    const [item] = share.shareToLibrary(
      phone(),
      PROJECT,
      payload,
      { title: '', tags: ['kitchen'] },
      []
    )
    expect(item).toMatchObject({
      kind: 'link',
      url: 'https://taps.example.com/x',
      body: 'Nice taps',
      title: 'taps.example.com',
      tags: ['kitchen']
    })
  })

  it('adds shared words as a note and a single shared file under the title given', () => {
    const note = share.shareToLibrary(
      phone(),
      PROJECT,
      share.sharePayload({ text: 'Measure twice\ncut once' })!,
      { title: '', tags: [] },
      []
    )
    expect(note).toMatchObject([{ kind: 'note', title: 'Measure twice' }])
    const files = share.shareToLibrary(
      phone(),
      PROJECT,
      share.sharePayload({ files: [{ path: 'file:///c/a.jpg' }] })!,
      { title: 'Front door', tags: [] },
      [kept('a.jpg')]
    )
    expect(files).toMatchObject([{ kind: 'image', title: 'Front door' }])
  })
})
