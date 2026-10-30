import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import {
  extractItemLinks,
  itemLinkUrl,
  rewriteItemLinks,
  type ItemLinkRef
} from '../../src/shared/item-links'
import { BRAND } from '../../src/shared/brand'

const S = BRAND.urlScheme
const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const human = { kind: 'human' as const }
const link = (ref: ItemLinkRef, words = 'x') => `[${words}](${itemLinkUrl(ref, S)})`

describe('extractItemLinks and rewriteItemLinks (N4.4a)', () => {
  const a = { kind: 'task' as const, projectId: P1, id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }
  const b = { kind: 'library' as const, projectId: P1, id: '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b' }

  it('finds Markdown links and autolinks once each, and nothing else', () => {
    const text = `See ${link(a)} and <${itemLinkUrl(b, S)}>, again ${link(a, 'y')}.
      Not [this](https://example.com) nor [that](${S}://inbox) nor [bad](${S}://task/${P1}/nope)
      nor [query](${S}://task/${P1}/${a.id}?x=1)`
    expect(extractItemLinks(text, S)).toEqual([a, b])
  })

  it('points links to the file own items at the new ones, words untouched', () => {
    const newId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    const other = { ...a, id: '9a6b1f0e-0000-4000-8000-000000000001' }
    const text = `${link(a, 'Fix it')} and ${link(other, 'Other')} and ${link({ ...a, projectId: P2 }, 'Far')}`
    const out = rewriteItemLinks(text, S, {
      fromProjectId: P1,
      toProjectId: P2,
      ids: { task: new Map([[a.id, newId]]) }
    })
    expect(out).toContain(`[Fix it](${S}://task/${P2}/${newId})`)
    // An item the file did not carry, and another project's item, stay as written.
    expect(out).toContain(link(other, 'Other'))
    expect(out).toContain(link({ ...a, projectId: P2 }, 'Far'))
  })
})

describe('the link index (N4.4a)', () => {
  let tempDir: string
  let dbPath: string
  let planning: PlanningService
  let library: LibraryService

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-item-links-'))
    dbPath = await createMigratedDatabase(tempDir)
    planning = new PlanningService(dbPath, () => [P1, P2])
    library = new LibraryService(dbPath, tempDir)
  })

  afterEach(() => {
    planning.close()
    library.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const task = (title: string, description = '', projectId = P1) =>
    planning.createWorkItem(projectId, { title, description }, human)
  const ref = (kind: ItemLinkRef['kind'], id: string, projectId = P1): ItemLinkRef => ({
    kind,
    projectId,
    id
  })
  const from = (kind: ItemLinkRef['kind'], id: string) =>
    planning.listLinkedFrom(kind, id).map((entry) => [entry.sourceKind, entry.title])

  it('replaces a description rows on every save, and drops them when the task goes', () => {
    const target = task('Fix the header')
    const other = task('Write the guide')
    const source = task('Plan', link(ref('task', target.id)))
    expect(from('task', target.id)).toEqual([['task', 'Plan']])

    planning.updateWorkItem(source.id, { description: link(ref('task', other.id)) }, human)
    expect(from('task', target.id)).toEqual([])
    expect(from('task', other.id)).toEqual([['task', 'Plan']])

    planning.deleteWorkItem(source.id, human)
    expect(from('task', other.id)).toEqual([])
  })

  it('indexes comments, hides deleted ones, and brings them back on restore', () => {
    const target = task('Fix the header')
    const holder = task('Holder')
    const comment = planning.addComment(
      holder.id,
      `Blocked by ${link(ref('task', target.id))}`,
      human
    )
    expect(planning.listLinkedFrom('task', target.id)).toMatchObject([
      { sourceKind: 'comment', sourceId: comment.id, title: 'Holder', workItemId: holder.id }
    ])
    planning.deleteComment(comment.id, human)
    expect(from('task', target.id)).toEqual([])
    planning.restoreComment(comment.id, human)
    expect(from('task', target.id)).toEqual([['comment', 'Holder']])
  })

  it('indexes decisions and Library items, and removes a deleted source', () => {
    const milestone = planning.createMilestone(P1, { name: 'Launch' })
    const decision = planning.createDecision(P1, {
      title: 'Use the new supplier',
      decision: 'Yes',
      consequences: `Moves ${link(ref('milestone', milestone.id))}`
    })
    const note = library.createItem(P1, {
      kind: 'note',
      title: 'Meeting',
      body: link(ref('decision', decision.id))
    })
    expect(from('milestone', milestone.id)).toEqual([['decision', 'Use the new supplier']])
    expect(from('decision', decision.id)).toEqual([['library', 'Meeting']])

    library.updateItem(P1, note.id, { body: link(ref('milestone', milestone.id)) })
    expect(from('decision', decision.id)).toEqual([])
    expect(from('milestone', milestone.id)).toHaveLength(2)

    library.deleteItem(P1, note.id)
    planning.deleteDecision(decision.id)
    expect(from('milestone', milestone.id)).toEqual([])
  })

  it('does not index links to another project item', () => {
    const far = task('Far away', '', P2)
    task('Near', link(ref('task', far.id, P2)))
    expect(from('task', far.id)).toEqual([])
  })

  it('reads current titles in one call, and a gone item as deleted', () => {
    const target = task('Old title')
    const gone = task('Gone')
    planning.updateWorkItem(target.id, { title: 'New title' }, human)
    planning.deleteWorkItem(gone.id, human)
    const resolved = planning.resolveItemLinks([
      ref('task', target.id),
      ref('task', gone.id),
      ref('task', target.id, '5a1d0f3e-0000-4000-8000-000000000009'),
      { kind: 'nope', projectId: P1, id: 'x' }
    ])
    expect(resolved).toEqual([
      { ...ref('task', target.id), exists: true, title: 'New title', status: target.status },
      { ...ref('task', gone.id), exists: false, title: null },
      // A link naming another project than the item's own reads as gone.
      {
        ...ref('task', target.id, '5a1d0f3e-0000-4000-8000-000000000009'),
        exists: false,
        title: null
      }
    ])
  })
})

describe('migration 33 (N4.4a)', () => {
  it('fills the index from the texts that exist already', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-item-links-mig-'))
    const dbPath = path.join(tempDir, 'ostler.db')
    const backupDir = path.join(tempDir, 'backups')
    try {
      await migrateOstlerDatabase(
        dbPath,
        { backupDir, appVersion: 'test' },
        MIGRATIONS.filter((migration) => migration.version <= 32)
      )
      const target = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
      const before = new Database(dbPath)
      const insertTask = before.prepare(
        "INSERT INTO planning_work_items (id, project_id, title, description, status, priority, origin, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', 'medium', 'human', 1, 1)"
      )
      insertTask.run(target, P1, 'Target', '')
      insertTask.run('t2', P1, 'Source', `See ${link(ref(target))}`)
      insertTask.run('t3', P2, 'Elsewhere', `See ${link(ref(target))}`)
      before
        .prepare(
          "INSERT INTO planning_comments (id, project_id, work_item_id, author_kind, body, created_at, updated_at) VALUES ('c1', ?, 't2', 'human', ?, 1, 1)"
        )
        .run(P1, link(ref(target)))
      before.close()

      await migrateOstlerDatabase(dbPath, { backupDir, appVersion: 'test' })

      const db = new Database(dbPath)
      try {
        expect(
          db
            .prepare(
              'SELECT source_kind, source_id, target_kind, target_id FROM item_links ORDER BY source_kind'
            )
            .all()
        ).toEqual([
          { source_kind: 'comment', source_id: 'c1', target_kind: 'task', target_id: target },
          { source_kind: 'task', source_id: 't2', target_kind: 'task', target_id: target }
        ])
      } finally {
        db.close()
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    function ref(id: string): ItemLinkRef {
      return { kind: 'task', projectId: P1, id }
    }
  })
})
