import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const memos = await import('../../mobile/src/data/voice-memos')
const { EditRefused } = await import('../../mobile/src/data/edits')

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const SHA = 'a'.repeat(64)

describe('voice memos on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-voice-')
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

  const phone = () => db as unknown as EditDb
  const input = (overrides: Partial<Parameters<typeof memos.addVoiceMemo>[2]> = {}) => ({
    itemId: memos.newVoiceMemoId(),
    title: 'Voice memo, 5 Nov 2026, 14:02',
    fileName: 'voice-memo-2026-11-05-1402.m4a',
    mimeType: 'audio/mp4',
    sizeBytes: 1200,
    sha256: SHA,
    durationMs: 65_000,
    transcript: '  Check the trap under the sink  ',
    ...overrides
  })

  it('keeps the memo in the Library, attaches it and links it in a comment', () => {
    const memo = input()
    const item = memos.addVoiceMemo(phone(), taskId, memo)
    expect(item).toMatchObject({
      id: memo.itemId,
      kind: 'document',
      body: 'Check the trap under the sink',
      file: { mimeType: 'audio/mp4', sha256: SHA, sizeBytes: 1200 }
    })
    expect(memos.taskVoiceMemos(phone(), taskId)).toMatchObject([
      { itemId: memo.itemId, transcript: 'Check the trap under the sink', mimeType: 'audio/mp4' }
    ])
    const comment = db
      .prepare('SELECT body FROM planning_comments WHERE work_item_id = ?')
      .get(taskId) as { body: string }
    expect(comment.body).toContain(`library/${PROJECT}/${memo.itemId}`)
    expect(comment.body).toContain('1:05')
    expect(comment.body).toContain('Check the trap under the sink')
  })

  it('keeps a memo with no transcript as sound only', () => {
    memos.addVoiceMemo(phone(), taskId, input({ transcript: '' }))
    expect(memos.taskVoiceMemos(phone(), taskId)[0].transcript).toBe('')
    const comment = db
      .prepare('SELECT body FROM planning_comments WHERE work_item_id = ?')
      .get(taskId) as { body: string }
    expect(comment.body).not.toContain('\n')
  })

  it('refuses a file that is not a sound file, and writes nothing', () => {
    expect(() =>
      memos.addVoiceMemo(phone(), taskId, input({ mimeType: 'application/pdf' }))
    ).toThrow(EditRefused)
    expect(() => memos.addVoiceMemo(phone(), taskId, input({ sha256: 'nope' }))).toThrow(
      EditRefused
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM library_items').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_comments').get()).toEqual({ n: 0 })
  })

  it('cuts a very long transcript in the comment, keeping it whole on the item', () => {
    const long = 'word '.repeat(4000).trim()
    const memo = input({ transcript: long })
    memos.addVoiceMemo(phone(), taskId, memo)
    const comment = db
      .prepare('SELECT body FROM planning_comments WHERE work_item_id = ?')
      .get(taskId) as { body: string }
    expect(comment.body.length).toBeLessThanOrEqual(10_000)
    expect(comment.body.endsWith('…')).toBe(true)
    expect(memos.taskVoiceMemos(phone(), taskId)[0].transcript).toBe(long)
  })

  it('records a memo straight into the Library: no task, transcript as body, tags kept', () => {
    const memo = input({ title: '  Ideas for the kitchen  ' })
    const item = memos.addLibraryVoiceMemo(db as unknown as QueryDb, PROJECT, {
      ...memo,
      tags: ['ideas', 'notes']
    })
    expect(item).toMatchObject({
      id: memo.itemId,
      projectId: PROJECT,
      kind: 'document',
      title: 'Ideas for the kitchen',
      body: 'Check the trap under the sink',
      tags: ['ideas', 'notes'],
      file: { fileName: memo.fileName, mimeType: 'audio/mp4', sha256: SHA }
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM library_work_item_attachments').get()).toEqual({
      n: 0
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM planning_comments').get()).toEqual({ n: 0 })
    expect(() =>
      memos.addLibraryVoiceMemo(db as unknown as QueryDb, PROJECT, {
        ...input(),
        mimeType: 'application/pdf'
      })
    ).toThrow(EditRefused)
  })
})
