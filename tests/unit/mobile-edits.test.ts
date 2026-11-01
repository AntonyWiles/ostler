import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { attachChangeRecorder } = await import('../../electron/services/change-history/recorder')
const { createMigratedDatabase } = await import('../helpers/database')
const edits = await import('../../mobile/src/data/edits')

// Each phone edit against the desktop's `PlanningService` method for the same edit, on two
// identical copies of one database: the rows of every table the desktop changed must match, apart
// from generated ids (mobile plan, prompt 12). The clock is fixed so timestamps match too.

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const NOW = new Date(2026, 9, 16, 8, 0)

/** The tables the desktop's task edits write to. */
const TABLES = [
  'planning_work_items',
  'planning_field_changes',
  'planning_status_history',
  'planning_comments',
  'planning_checklist_checks',
  'planning_checklist_details',
  'planning_description_versions',
  'planning_milestones',
  'project_task_counters',
  'reminders'
]
/** Generated per row: compared by presence, not by value. */
const GENERATED = new Set(['id'])
const UNGENERATED_ID_TABLES = new Set(['planning_work_items', 'planning_milestones'])

function dump(
  db: Database.Database,
  replace: Record<string, string> = {}
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    result[table] = rows
      .map((row) => {
        const copy: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) {
          if (GENERATED.has(key) && !UNGENERATED_ID_TABLES.has(table)) continue
          copy[key] = typeof value === 'string' && value in replace ? replace[value] : value
        }
        return JSON.stringify(copy, Object.keys(copy).sort())
      })
      .sort()
  }
  return result
}

describe('the phone edits a task the way the desktop does (mobile plan, prompt 12)', () => {
  const tempDir = useTempDir('ostler-mobile-edits-')
  let desktopPath: string
  let phonePath: string
  let anna: string
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const seedPath = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(seedPath, () => [PROJECT])
    const people = new PeopleService(seedPath)
    anna = people.create({ name: 'Anna' }).id
    const milestone = planning.createMilestone(PROJECT, {
      name: 'Handover',
      targetDate: '2026-11-20'
    })
    ids.main = planning.createWorkItem(
      PROJECT,
      {
        title: 'Fit sink',
        status: 'ready',
        targetDate: '2026-11-01',
        milestoneId: milestone.id,
        acceptanceCriteria: ['Pipes tight', 'Taps work']
      },
      human
    ).id
    ids.otherMilestone = planning.createMilestone(PROJECT, { name: 'Snagging' }).id
    planning.createWorkItem(PROJECT, { title: 'Pick tiles', labels: ['Kitchen'] }, human)
    planning.setChecklistItemChecked(ids.main, 'Taps work', true, human)
    planning.close()
    people.close()
    desktopPath = path.join(tempDir(), 'desktop.db')
    phonePath = path.join(tempDir(), 'phone.db')
    fs.copyFileSync(seedPath, desktopPath)
    fs.copyFileSync(seedPath, phonePath)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Runs `desktop` on one copy and `phone` on the other, then compares every table. */
  function both(
    desktop: (planning: InstanceType<typeof PlanningService>) => string | void,
    phone: (db: EditDb) => string | void
  ): void {
    const planning = new PlanningService(desktopPath, () => [PROJECT])
    const desktopNew = desktop(planning)
    planning.close()
    const raw = new Database(phonePath)
    const phoneNew = phone(raw as unknown as EditDb)
    const phoneDb = raw
    const desktopDb = new Database(desktopPath)
    const fromDesktop = dump(desktopDb, desktopNew ? { [desktopNew]: 'NEW' } : {})
    const fromPhone = dump(phoneDb, phoneNew ? { [phoneNew]: 'NEW' } : {})
    desktopDb.close()
    phoneDb.close()
    for (const table of TABLES) expect(fromPhone[table], table).toEqual(fromDesktop[table])
  }

  it('changes a status: the row, the status history and the milestone, as updateWorkItem does', () => {
    both(
      (planning) => void planning.updateWorkItem(ids.main, { status: 'active' }, human),
      (db) => edits.setTaskStatus(db, ids.main, 'active')
    )
  })

  it('finishing a task writes the same rows (history, reminders)', () => {
    both(
      (planning) => void planning.updateWorkItem(ids.main, { status: 'done' }, human),
      (db) => edits.setTaskStatus(db, ids.main, 'done')
    )
  })

  it('renames a task, and two renames in one sitting are one history row', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { title: 'Fit the sink' }, human)
        planning.updateWorkItem(ids.main, { title: '  Fit the new sink ' }, human)
      },
      (db) => {
        edits.renameTask(db, ids.main, 'Fit the sink')
        edits.renameTask(db, ids.main, '  Fit the new sink ')
      }
    )
  })

  it('gives a task to a person, then to nobody', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { assigneeId: anna }, human)
        planning.updateWorkItem(ids.main, { assigneeId: null }, human)
        planning.updateWorkItem(ids.main, { assigneeId: anna }, human)
      },
      (db) => {
        edits.setTaskAssignee(db, ids.main, anna)
        edits.setTaskAssignee(db, ids.main, null)
        edits.setTaskAssignee(db, ids.main, anna)
      }
    )
  })

  it('sets and clears a due date', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { targetDate: '2026-12-24' }, human)
        planning.updateWorkItem(ids.main, { targetDate: null }, human)
      },
      (db) => {
        edits.setTaskDueDate(db, ids.main, '2026-12-24')
        edits.setTaskDueDate(db, ids.main, null)
      }
    )
  })

  it('writes a description, twice in one sitting, then again later: history and versions', () => {
    const later = new Date(NOW.getTime() + 60 * 60 * 1000)
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { description: 'Use the **grey** sealant.' }, human)
        planning.updateWorkItem(ids.main, { description: ' Use the grey sealant. ' }, human)
        vi.setSystemTime(later)
        planning.updateWorkItem(ids.main, { description: '' }, human)
        vi.setSystemTime(NOW)
      },
      (db) => {
        edits.setTaskDescription(db, ids.main, 'Use the **grey** sealant.')
        edits.setTaskDescription(db, ids.main, ' Use the grey sealant. ')
        edits.setTaskDescription(db, ids.main, '', { now: later.getTime() })
      }
    )
  })

  it('sets priority, start date, estimate, milestone and labels', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { priority: 'critical' }, human)
        planning.updateWorkItem(ids.main, { startDate: '2026-10-20' }, human)
        planning.updateWorkItem(ids.main, { estimate: 2.5 }, human)
        planning.updateWorkItem(ids.main, { milestoneId: ids.otherMilestone }, human)
        planning.updateWorkItem(ids.main, { labels: ['Kitchen', ' Plumbing '] }, human)
        planning.updateWorkItem(ids.main, { labels: ['Plumbing'] }, human)
        planning.updateWorkItem(ids.main, { estimate: null, startDate: null }, human)
        planning.updateWorkItem(ids.main, { milestoneId: null }, human)
      },
      (db) => {
        edits.setTaskPriority(db, ids.main, 'critical')
        edits.setTaskStartDate(db, ids.main, '2026-10-20')
        edits.setTaskEstimate(db, ids.main, 2.5)
        edits.setTaskMilestone(db, ids.main, ids.otherMilestone)
        edits.setTaskLabels(db, ids.main, ['Kitchen', ' Plumbing '])
        edits.setTaskLabels(db, ids.main, ['Plumbing'])
        edits.setTaskEstimate(db, ids.main, null)
        edits.setTaskStartDate(db, ids.main, null)
        edits.setTaskMilestone(db, ids.main, null)
      }
    )
  })

  it('refuses a start after the due date, a bad estimate, a milestone of another project', () => {
    const db = new Database(phonePath)
    const phone = db as unknown as EditDb
    const refusal = (edit: () => void) => {
      try {
        edit()
      } catch (error) {
        return (error as InstanceType<typeof edits.EditRefused>).reason
      }
      return null
    }
    expect(refusal(() => edits.setTaskStartDate(phone, ids.main, '2026-11-02'))).toBe(
      'start-after-due'
    )
    expect(refusal(() => edits.setTaskEstimate(phone, ids.main, -1))).toBe('bad-estimate')
    expect(refusal(() => edits.setTaskEstimate(phone, ids.main, Number.NaN))).toBe('bad-estimate')
    expect(refusal(() => edits.setTaskMilestone(phone, ids.main, 'nope'))).toBe('bad-milestone')
    expect(refusal(() => edits.setTaskLabels(phone, ids.main, ['  ']))).toBe('bad-label')
    expect(refusal(() => edits.setTaskDescription(phone, ids.main, 'x'.repeat(8001)))).toBe(
      'description-too-long'
    )
    db.close()
  })

  it('adds, renames (keeping the tick), reorders and removes checklist lines', () => {
    const later = new Date(NOW.getTime() + 60 * 60 * 1000)
    both(
      (planning) => {
        planning.updateWorkItem(
          ids.main,
          { acceptanceCriteria: ['Pipes tight', 'Taps work', 'Seal dry'] },
          human
        )
        vi.setSystemTime(later)
        planning.updateWorkItem(
          ids.main,
          { acceptanceCriteria: ['Pipes tight', 'Both taps work', 'Seal dry'] },
          human,
          { renamedCriteria: new Map([['Taps work', 'Both taps work']]) }
        )
        planning.updateWorkItem(
          ids.main,
          { acceptanceCriteria: ['Seal dry', 'Pipes tight', 'Both taps work'] },
          human
        )
        planning.updateWorkItem(
          ids.main,
          { acceptanceCriteria: ['Seal dry', 'Both taps work'] },
          human
        )
        vi.setSystemTime(NOW)
      },
      (db) => {
        edits.setTaskChecklist(db, ids.main, ['Pipes tight', 'Taps work', ' Seal dry '])
        const at = { now: later.getTime() }
        edits.setTaskChecklist(
          db,
          ids.main,
          ['Pipes tight', 'Both taps work', 'Seal dry'],
          new Map([['Taps work', 'Both taps work']]),
          at
        )
        edits.setTaskChecklist(
          db,
          ids.main,
          ['Seal dry', 'Pipes tight', 'Both taps work'],
          undefined,
          at
        )
        edits.setTaskChecklist(db, ids.main, ['Seal dry', 'Both taps work'], undefined, at)
      }
    )
  })

  it('ticks and unticks checklist items', () => {
    both(
      (planning) => {
        planning.setChecklistItemChecked(ids.main, 'Pipes tight', true, human)
        planning.setChecklistItemChecked(ids.main, 'Taps work', false, human)
      },
      (db) => {
        edits.setChecklistTick(db, ids.main, 'Pipes tight', true)
        edits.setChecklistTick(db, ids.main, 'Taps work', false)
      }
    )
  })

  it('adds a comment', () => {
    both(
      (planning) => {
        planning.addComment(ids.main, '  Plumber booked for Friday. ', human)
      },
      (db) => {
        edits.addTaskComment(db, ids.main, '  Plumber booked for Friday. ')
      }
    )
  })

  it('adds a task: number, order key, status history and the created row', () => {
    both(
      (planning) => planning.createWorkItem(PROJECT, { title: 'Order paint' }, human).id,
      (db) => edits.addTask(db, PROJECT, 'Order paint')
    )
  })

  it('archives a task', () => {
    both(
      (planning) => void planning.archiveWorkItem(ids.main, human),
      (db) => edits.archiveTask(db, ids.main)
    )
  })

  it('moves a task to the recycle bin', () => {
    both(
      (planning) => void planning.moveWorkItemToBin(ids.main, human),
      (db) => edits.moveTaskToBin(db, ids.main)
    )
  })

  it("closes a task as won't do", () => {
    both(
      (planning) =>
        void planning.closeWorkItemsAsWontDo([ids.main], 'Client changed their mind', human),
      (db) => edits.closeTaskAsWontDo(db, ids.main, 'Client changed their mind')
    )
  })

  // Restoring differs only in reminders: the PC plans the due reminder again, the phone plans none.
  it("restores an archived task and reopens a won't-do one, as the PC does", () => {
    const raw = new Database(phonePath)
    const db = raw as unknown as EditDb
    const row = () =>
      raw
        .prepare(
          'SELECT archived_at, resolution, resolution_reason FROM planning_work_items WHERE id = ?'
        )
        .get(ids.main)
    const fields = () =>
      (
        raw
          .prepare('SELECT field FROM planning_field_changes WHERE work_item_id = ? ORDER BY id')
          .all(ids.main) as { field: string }[]
      ).map((change) => change.field)
    edits.archiveTask(db, ids.main)
    edits.unarchiveTask(db, ids.main)
    edits.closeTaskAsWontDo(db, ids.main, 'Not needed')
    edits.unarchiveTask(db, ids.main)
    expect(row()).toEqual({ archived_at: null, resolution: null, resolution_reason: '' })
    expect(fields().slice(-4)).toEqual(['archived', 'unarchived', 'wontDo', 'reopened'])
    raw.close()
  })

  it('moves a task to Someday and brings it back', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.main, { someday: true }, human)
        planning.updateWorkItem(ids.main, { someday: false }, human)
      },
      (db) => {
        edits.setTaskSomeday(db, ids.main, true)
        edits.setTaskSomeday(db, ids.main, false)
      }
    )
  })

  it('adds a task to My day, bringing it back from Someday, and removes it', () => {
    const raw = new Database(phonePath)
    const db = raw as unknown as EditDb
    edits.setTaskSomeday(db, ids.main, true)
    edits.addTaskToMyDay(db, ids.main, '2026-10-16')
    edits.addTaskToMyDay(db, ids.main, '2026-10-16')
    expect(edits.inMyDay(db, ids.main, '2026-10-16')).toBe(true)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM my_day_entries').get() as { n: number }).toEqual({
      n: 1
    })
    expect(
      raw.prepare('SELECT someday FROM planning_work_items WHERE id = ?').get(ids.main)
    ).toEqual({ someday: 0 })
    edits.removeTaskFromMyDay(db, ids.main, '2026-10-16')
    expect(edits.inMyDay(db, ids.main, '2026-10-16')).toBe(false)
    edits.archiveTask(db, ids.main)
    expect(() => edits.addTaskToMyDay(db, ids.main, '2026-10-16')).toThrow(edits.EditRefused)
    raw.close()
  })

  it('refuses what the desktop refuses, and writes nothing', () => {
    const raw = new Database(phonePath)
    const db = raw as unknown as EditDb
    const before = JSON.stringify(dump(raw))
    const reason = (run: () => void) => {
      try {
        run()
      } catch (error) {
        return error instanceof edits.EditRefused ? error.reason : 'other'
      }
      return 'none'
    }
    expect(reason(() => edits.renameTask(db, ids.main, '   '))).toBe('title-required')
    expect(reason(() => edits.addTaskComment(db, ids.main, ''))).toBe('comment-required')
    expect(reason(() => edits.setTaskDueDate(db, ids.main, '2026-02-30'))).toBe('bad-date')
    expect(reason(() => edits.setTaskDueDate(db, ids.main, 'tomorrow'))).toBe('bad-date')
    expect(reason(() => edits.setTaskAssignee(db, ids.main, 'nobody-here'))).toBe('bad-person')
    expect(reason(() => edits.setChecklistTick(db, ids.main, 'Not an item', true))).toBe(
      'bad-checklist-item'
    )
    expect(reason(() => edits.setTaskStatus(db, 'missing', 'done'))).toBe('not-found')
    expect(JSON.stringify(dump(raw))).toBe(before)
    raw.close()
  })

  it('refuses every edit of a project the person can only view (a Viewer)', () => {
    const raw = new Database(phonePath)
    raw
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
         VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
      )
      .run(PROJECT)
    attachChangeRecorder(raw)
    raw.prepare("UPDATE sync_shares SET my_role = 'viewer' WHERE project_id = ?").run(PROJECT)
    const db = raw as unknown as EditDb
    const before = JSON.stringify(dump(raw))
    const refused = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return error instanceof edits.EditRefused && error.reason === 'read-only'
      }
      return false
    }
    expect(refused(() => edits.setTaskStatus(db, ids.main, 'active'))).toBe(true)
    expect(refused(() => edits.renameTask(db, ids.main, 'Other'))).toBe(true)
    expect(refused(() => edits.setTaskAssignee(db, ids.main, anna))).toBe(true)
    expect(refused(() => edits.setTaskDueDate(db, ids.main, '2026-12-01'))).toBe(true)
    expect(refused(() => edits.setChecklistTick(db, ids.main, 'Pipes tight', true))).toBe(true)
    expect(refused(() => edits.addTask(db, PROJECT, 'New'))).toBe(true)
    // Nothing the refused edits started was left behind (each ran in one transaction).
    expect(JSON.stringify(dump(raw))).toBe(before)
    raw.close()
  })
})
