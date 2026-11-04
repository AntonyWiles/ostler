import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { createMigratedDatabase } = await import('../helpers/database')
const edits = await import('../../mobile/src/data/edits')
const needs = await import('../../mobile/src/data/needs-you')

// "Needs you" on the phone: what waits on the person across projects, and the answers to it, each
// checked against the desktop's own `PlanningService` call on an identical copy of one database.

const human = { kind: 'human' as const }
const agent = { kind: 'automation' as const }
const PROJECT = 'p1'
const OTHER = 'p2'
const HOUR = 60 * 60 * 1000
/** The PC writes a person's comment as Me; the phone does the same. */
const asMe = { kind: 'human' as const, personId: '' }
const NOW = new Date(2026, 9, 16, 8, 0)

const TABLES = [
  'planning_work_items',
  'planning_status_history',
  'planning_comments',
  'planning_field_changes',
  'planning_blockers',
  'reminders'
]

function dump(db: Database.Database): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    result[table] = rows
      .map((row) => {
        const copy: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) {
          // A comment's id and the history's sequence are generated per copy.
          if (table === 'planning_comments' && key === 'id') continue
          if (key === 'sequence') continue
          copy[key] = value
        }
        return JSON.stringify(copy, Object.keys(copy).sort())
      })
      .sort()
  }
  return result
}

describe('Needs you on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-needs-you-')
  let desktopPath: string
  let phonePath: string
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW.getTime() - 10 * HOUR)
    const seedPath = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(seedPath, () => [PROJECT, OTHER])
    const people = new PeopleService(seedPath)
    const me = people.create({ name: 'Robin Example' }).id
    asMe.personId = me

    // Started, then sent for review with an ask.
    ids.review = planning.createWorkItem(PROJECT, { title: 'Write the welcome email' }, human).id
    planning.updateWorkItem(ids.review, { status: 'active' }, human)
    planning.updateWorkItem(ids.review, { status: 'review' }, agent)
    vi.setSystemTime(NOW.getTime() - 9 * HOUR)
    planning.addComment(ids.review, 'Merged into main locally, approving is yours.', agent)

    // Reviewed without ever starting.
    ids.quickReview = planning.createWorkItem(
      PROJECT,
      { title: 'Fix a typo', status: 'review' },
      agent
    ).id

    // Blocked on the person, with an ask that needs the PC.
    vi.setSystemTime(NOW.getTime() - 8 * HOUR)
    ids.pc = planning.createWorkItem(PROJECT, { title: 'Turn on the mailer' }, human).id
    planning.updateWorkItem(ids.pc, { status: 'blocked' }, agent)
    planning.addComment(ids.pc, 'Needs you: put MAIL_KEY in `.env` on the PC.', agent)

    // Blocked with a plain question.
    vi.setSystemTime(NOW.getTime() - 7 * HOUR)
    ids.question = planning.createWorkItem(PROJECT, { title: 'Pick a launch day' }, human).id
    planning.updateWorkItem(ids.question, { status: 'blocked' }, agent)
    planning.addComment(ids.question, 'Needs your decision: Monday or Tuesday?', agent)

    // Blocked only because it waits on an open task.
    ids.first = planning.createWorkItem(PROJECT, { title: 'Draft the plan' }, human).id
    ids.waiting = planning.createWorkItem(
      PROJECT,
      { title: 'Share the plan', dependencyIds: [ids.first] },
      human
    ).id
    planning.updateWorkItem(ids.waiting, { status: 'blocked' }, human)

    // An open blocker with options, on a task in progress in another project.
    vi.setSystemTime(NOW.getTime() - 6 * HOUR)
    ids.decide = planning.createWorkItem(OTHER, { title: 'Go live', status: 'active' }, human).id
    ids.blocker = planning.reportBlocker(ids.decide, 'Ready to go live?', 'agent', [
      'The owner decides to go live',
      'Wait a week'
    ]).id
    ids.plainBlocker = planning.reportBlocker(ids.decide, 'Check the copy', 'agent').id

    // To triage, and a sign-off asked of the person.
    ids.idea = planning.createWorkItem(OTHER, { title: 'Idea from the road' }, human).id
    ids.signed = planning.createWorkItem(OTHER, { title: 'Pricing page' }, human).id
    planning.close()
    people.close()

    const raw = new Database(seedPath)
    raw.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(me)
    raw.prepare('UPDATE planning_work_items SET in_triage = 1 WHERE id = ?').run(ids.idea)
    raw
      .prepare(
        `INSERT INTO planning_sign_offs (id, project_id, item_kind, item_id, approver_person_id,
           requested_by_person_id, state, note, requested_at, answered_at, updated_at)
         VALUES ('so1', ?, 'task', ?, ?, NULL, 'waiting', '', ?, NULL, ?)`
      )
      .run(OTHER, ids.signed, me, NOW.getTime() - 5 * HOUR, NOW.getTime() - 5 * HOUR)
    raw.close()

    vi.setSystemTime(NOW)
    desktopPath = path.join(tempDir(), 'desktop.db')
    phonePath = path.join(tempDir(), 'phone.db')
    fs.copyFileSync(seedPath, desktopPath)
    fs.copyFileSync(seedPath, phonePath)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function both(
    desktop: (planning: InstanceType<typeof PlanningService>) => void,
    phone: (db: EditDb) => void
  ): void {
    const planning = new PlanningService(desktopPath, () => [PROJECT, OTHER])
    desktop(planning)
    planning.close()
    const phoneDb = new Database(phonePath)
    phone(phoneDb as unknown as EditDb)
    const desktopDb = new Database(desktopPath)
    const fromDesktop = dump(desktopDb)
    const fromPhone = dump(phoneDb)
    desktopDb.close()
    phoneDb.close()
    for (const table of TABLES) expect(fromPhone[table], table).toEqual(fromDesktop[table])
  }

  function read<T>(run: (db: QueryDb & EditDb) => T): T {
    const raw = new Database(phonePath)
    try {
      return run(raw as unknown as QueryDb & EditDb)
    } finally {
      raw.close()
    }
  }

  it('lists every ask across projects, newest first, with the latest comment', () => {
    const result = read((db) => needs.needsYou(db, '2026-10-16'))
    const byKey = new Map(result.items.map((item) => [item.key, item]))
    expect(result.items.map((item) => item.key)).toEqual(
      [
        'sign-off:so1',
        `blocker:${ids.blocker}`,
        `blocker:${ids.plainBlocker}`,
        `task:${ids.question}`,
        `task:${ids.waiting}`,
        `task:${ids.pc}`,
        `task:${ids.quickReview}`,
        `task:${ids.review}`
      ].sort((a, b) => byKey.get(b)!.askedAt - byKey.get(a)!.askedAt || a.localeCompare(b))
    )

    const review = byKey.get(`task:${ids.review}`)!
    expect(review.kind).toBe('review')
    expect(review.latestComment?.body).toBe('Merged into main locally, approving is yours.')
    expect(review.latestComment?.byPerson).toBe(false)
    expect(review.askedAt).toBe(NOW.getTime() - 9 * HOUR)

    const pc = byKey.get(`task:${ids.pc}`)!
    expect(pc.kind).toBe('blocked')
    expect(pc.onPc).toBe(true)
    expect(needs.needsYouGroup(pc)).toBe('pc')

    const question = byKey.get(`task:${ids.question}`)!
    expect(question.onPc).toBe(false)
    expect(needs.needsYouGroup(question)).toBe('blocked')

    const waiting = byKey.get(`task:${ids.waiting}`)!
    expect(waiting.kind).toBe('waiting')
    expect(waiting.waitsOn).toBe(1)

    const decide = byKey.get(`blocker:${ids.blocker}`)!
    expect(decide.kind).toBe('decide')
    expect(decide.projectId).toBe(OTHER)
    expect(decide.blocker?.options).toEqual(['The owner decides to go live', 'Wait a week'])
    expect(byKey.get(`blocker:${ids.plainBlocker}`)!.blocker?.options).toEqual([])

    const signOff = byKey.get('sign-off:so1')!
    expect(signOff.taskId).toBe(ids.signed)
    expect(signOff.title).toBe('Pricing page')

    expect(result.triage).toEqual([{ projectId: OTHER, count: 1 }])
    expect(result.count).toBe(result.items.length - 1)
    expect(needs.needsYouCounts(result).get(PROJECT)).toEqual({ blocked: 2, review: 2 })
    expect(needs.needsYouCounts(result).get(OTHER)).toEqual({ blocked: 2, review: 0 })
  })

  it('a reply after a task waiting on others is blocked makes it an ask again', () => {
    read((db) => {
      vi.setSystemTime(NOW.getTime() + HOUR)
      edits.addTaskComment(db, ids.waiting, 'Can I share a draft instead?')
      const item = needs.needsYou(db, '2026-10-16').items.find((i) => i.taskId === ids.waiting)
      expect(item?.kind).toBe('blocked')
    })
  })

  it('reads an ask as needing the PC from its words', () => {
    expect(needs.looksLikePcAsk('Add the API key for the mailer')).toBe(true)
    expect(needs.looksLikePcAsk('Sign in to Search Console and verify')).toBe(true)
    expect(needs.looksLikePcAsk('Run `npm run build` again')).toBe(true)
    expect(needs.looksLikePcAsk('The file is in C:\\work\\notes.txt')).toBe(true)
    expect(needs.looksLikePcAsk('Open the Agents panel')).toBe(true)
    expect(needs.looksLikePcAsk('Which colour do you prefer?')).toBe(false)
    expect(needs.looksLikePcAsk(null, undefined, '')).toBe(false)
  })

  it('resolves a blocker with the rows PlanningService.resolveBlocker writes', () => {
    both(
      (planning) =>
        void planning.resolveBlocker(ids.blocker, 'The owner decides to go live', ' Go ', 'human'),
      (db) => needs.resolveTaskBlocker(db, ids.blocker, 'The owner decides to go live', ' Go ')
    )
  })

  it('resolves a blocker without options as the PC does ("resolved", no note)', () => {
    both(
      (planning) => void planning.resolveBlocker(ids.plainBlocker, 'resolved', '', 'human'),
      (db) => needs.resolveTaskBlocker(db, ids.plainBlocker, 'resolved')
    )
  })

  it("resolves a task's open blockers when it is marked Done, as the PC does", () => {
    both(
      (planning) => void planning.updateWorkItem(ids.decide, { status: 'done' }, human),
      (db) => edits.setTaskStatus(db, ids.decide, 'done')
    )
    read((db) => {
      const rows = db
        .prepare('SELECT status, resolution_choice FROM planning_blockers WHERE work_item_id = ?')
        .all(ids.decide)
      expect(rows).toEqual([
        { status: 'resolved', resolution_choice: 'Task done' },
        { status: 'resolved', resolution_choice: 'Task done' }
      ])
      const keys = needs.needsYou(db, '2026-06-01').items.map((item) => item.key)
      expect(keys.some((key) => key.startsWith('blocker:'))).toBe(false)
    })
  })

  it('does not list a blocker left open on a task that is already Done', () => {
    const raw = new Database(phonePath)
    raw.prepare("UPDATE planning_work_items SET status = 'done' WHERE id = ?").run(ids.decide)
    raw.close()
    read((db) => {
      const keys = needs.needsYou(db, '2026-06-01').items.map((item) => item.key)
      expect(keys).not.toContain(`blocker:${ids.blocker}`)
      expect(keys).not.toContain(`blocker:${ids.plainBlocker}`)
    })
  })

  it('approves a review: Done and the note as a comment', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.review, { status: 'done' }, human)
        planning.addComment(ids.review, 'Looks good.', asMe)
      },
      (db) => void needs.approveReview(db, ids.review, 'Looks good.')
    )
  })

  it('approves a review without a note: Done only', () => {
    both(
      (planning) => void planning.updateWorkItem(ids.review, { status: 'done' }, human),
      (db) => void needs.approveReview(db, ids.review)
    )
  })

  it('sends a started task back to In progress, and an unstarted one to Ready', () => {
    both(
      (planning) => {
        planning.updateWorkItem(ids.review, { status: 'active' }, human)
        planning.addComment(ids.review, 'Shorter subject line, please.', asMe)
        planning.updateWorkItem(ids.quickReview, { status: 'ready' }, human)
        planning.addComment(ids.quickReview, 'Wrong page.', asMe)
      },
      (db) => {
        expect(needs.sendBackTask(db, ids.review, 'Shorter subject line, please.').status).toBe(
          'active'
        )
        expect(needs.sendBackTask(db, ids.quickReview, 'Wrong page.').status).toBe('ready')
      }
    )
  })

  it('unblocks a task with a reply, and replies without moving it', () => {
    both(
      (planning) => {
        planning.addComment(ids.question, 'Tuesday.', asMe)
        planning.updateWorkItem(ids.question, { status: 'ready' }, human)
        planning.addComment(ids.pc, 'Done, the key is in.', asMe)
      },
      (db) => {
        needs.unblockTask(db, ids.question, 'Tuesday.', 'ready')
        needs.replyOnTask(db, ids.pc, 'Done, the key is in.')
      }
    )
  })

  it('undoes an answer: the status goes back and the comment is deleted', () => {
    read((db) => {
      const answer = needs.unblockTask(db, ids.question, 'Tuesday.', 'active')
      needs.undoTaskAnswer(db, answer)
      const row = db
        .prepare('SELECT status FROM planning_work_items WHERE id = ?')
        .get(ids.question) as { status: string }
      expect(row.status).toBe('blocked')
      const comment = db
        .prepare('SELECT deleted_at FROM planning_comments WHERE id = ?')
        .get(answer.commentId) as { deleted_at: number | null }
      expect(comment.deleted_at).not.toBeNull()
      expect(needs.needsYou(db, '2026-10-16').items.some((i) => i.taskId === ids.question)).toBe(
        true
      )
    })
  })

  it('refuses what it should, and writes nothing', () => {
    const planning = new PlanningService(phonePath, () => [PROJECT, OTHER])
    planning.setRecurrence(ids.review, { rule: { every: 'week', interval: 1 } }, human)
    planning.close()
    read((db) => {
      const raw = db as unknown as Database.Database
      const before = JSON.stringify(dump(raw))
      const reason = (run: () => unknown) => {
        try {
          run()
        } catch (error) {
          return error instanceof edits.EditRefused ? error.reason : String(error)
        }
        return 'none'
      }
      expect(reason(() => needs.approveReview(db, ids.review, 'Fine'))).toBe('recurring')
      expect(reason(() => needs.approveReview(db, ids.question))).toBe('not-waiting')
      expect(reason(() => needs.sendBackTask(db, ids.quickReview, '  '))).toBe('comment-required')
      expect(reason(() => needs.unblockTask(db, ids.review, 'Go', 'ready'))).toBe('not-waiting')
      expect(reason(() => needs.resolveTaskBlocker(db, ids.blocker, ' '))).toBe('choice-required')
      expect(reason(() => needs.resolveTaskBlocker(db, 'missing', 'x'))).toBe('not-found')
      expect(JSON.stringify(dump(raw))).toBe(before)
      needs.resolveTaskBlocker(db, ids.blocker, 'Wait a week')
      expect(reason(() => needs.resolveTaskBlocker(db, ids.blocker, 'Wait a week'))).toBe(
        'already-resolved'
      )
    })
  })

  it('lists a task its open blockers for the task screen', () => {
    const blockers = read((db) => needs.openBlockers(db, ids.decide))
    expect(blockers.map((blocker) => blocker.id)).toEqual([ids.blocker, ids.plainBlocker])
  })
})
