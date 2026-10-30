import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import { HomeService } from '../../electron/services/home-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import { triageSource } from '../../electron/services/inbox-sources'
import { closeAsWontDo, markAsDuplicate } from '../../electron/services/planning-deletion'
import {
  acceptAllFromTriage,
  acceptFromTriage,
  moveFromTriage,
  readAcceptFields,
  triageOn,
  undoTriageMove
} from '../../electron/services/triage-service'
import type { HarnessService } from '../../electron/services/harness-service'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import { hiddenQueueRefusal, hiddenReason, isHiddenNow } from '../../src/shared/planning/show-from'
import { matchesFilter, parseTaskFilter } from '../../src/shared/task-filter'
import type { WatchedProject } from '../../src/shared/ostler-api'

const human = { kind: 'human' as const }
const TODAY = '2026-10-07'

function project(id: string, name: string, extra: Partial<WatchedProject> = {}): WatchedProject {
  return {
    id,
    name,
    path: null,
    color: '#336699',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    stage: 'active',
    ...extra
  }
}

describe('the triage migration (N4.3a)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-triage-migration-'))
    dbPath = path.join(tempDir, 'ostler.db')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('adds in_triage and captured_by to a version 44 database, leaving its tasks out of triage', async () => {
    await migrateOstlerDatabase(
      dbPath,
      { backupDir: path.join(tempDir, 'backups'), appVersion: '9.9.9' },
      MIGRATIONS.filter((migration) => migration.version <= 44)
    )
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'backlog', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrateOstlerDatabase(dbPath, {
      backupDir: path.join(tempDir, 'backups'),
      appVersion: '9.9.9'
    })

    expect(result.from).toBe(44)
    expect(result.to).toBeGreaterThanOrEqual(45)
    const db = new Database(dbPath)
    try {
      expect(
        db.prepare('SELECT title, in_triage, captured_by FROM planning_work_items').all()
      ).toEqual([{ title: 'Kept', in_triage: 0, captured_by: null }])
    } finally {
      db.close()
    }
  })
})

describe('the one rule for a task in triage (N4.3a)', () => {
  it('hides it everywhere, ahead of Someday and show-from, with its own refusal', () => {
    expect(isHiddenNow({ inTriage: true }, TODAY)).toBe(true)
    expect(hiddenReason({ inTriage: true, someday: true }, TODAY)).toEqual({ kind: 'triage' })
    expect(hiddenQueueRefusal({ inTriage: true }, TODAY)).toBe('Accept it from To triage first')
    expect(isHiddenNow({ inTriage: false }, TODAY)).toBe(false)
  })

  it('matches the In triage filter, and leaves it out of showFrom is shown', () => {
    const base = {
      id: 't',
      title: 'Task',
      description: '',
      status: 'backlog' as const,
      priority: 'medium' as const,
      labels: [],
      acceptanceCriteria: [],
      checkedCriteria: [],
      milestoneId: null,
      targetDate: null,
      startDate: null,
      assigneeId: null,
      estimate: null,
      createdAt: 0,
      updatedAt: 0
    }
    const context = { today: TODAY, meId: null }
    const inTriage = parseTaskFilter({
      conditions: [{ field: 'inTriage', op: 'is', value: true }]
    })
    expect(matchesFilter({ ...base, inTriage: true }, inTriage, context)).toBe(true)
    expect(matchesFilter({ ...base, inTriage: false }, inTriage, context)).toBe(false)
    expect(matchesFilter(base, inTriage, context)).toBe(false)
    const shown = parseTaskFilter({
      conditions: [{ field: 'showFrom', op: 'is', value: 'shown' }]
    })
    expect(matchesFilter({ ...base, inTriage: true }, shown, context)).toBe(false)
  })

  it('reads the setting as off unless it is true', () => {
    expect(triageOn({})).toBe(false)
    expect(triageOn({ triageCaptures: false })).toBe(false)
    expect(triageOn({ triageCaptures: true })).toBe(true)
  })
})

describe('triage (N4.3a)', () => {
  let tempDir: string
  let dbPath: string
  let planning: PlanningService
  let library: LibraryService
  let projects: WatchedProject[]
  const triaged = new Set<string>()

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-triage-'))
    dbPath = await createMigratedDatabase(tempDir)
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Off')]
    planning = new PlanningService(dbPath, () => projects.map((entry) => entry.id))
    triaged.clear()
    triaged.add('p1')
    planning.setTriageSetting((projectId) => triaged.has(projectId))
    library = new LibraryService(dbPath, tempDir)
  })

  afterEach(() => {
    library.close()
    planning.close()
    vi.useRealTimers()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const capture = (projectId = 'p1', extra: Record<string, unknown> = {}) =>
    planning.createWorkItem(
      projectId,
      { title: 'Call the plumber', capture: 'quick-add', ...extra },
      human
    )

  describe('what lands there', () => {
    it('puts a quick capture in triage only when its project has triage on', () => {
      const waiting = capture('p1')
      expect(waiting).toMatchObject({ inTriage: true, capturedBy: 'quick-add' })
      expect(planning.getWorkItem(waiting.id)).toMatchObject({
        inTriage: true,
        capturedBy: 'quick-add'
      })
      expect(capture('p2')).toMatchObject({ inTriage: false, capturedBy: null })
    })

    it('never puts New task, copies or a capture with an unknown way in triage', () => {
      const plain = planning.createWorkItem('p1', { title: 'New task' }, human)
      expect(plain.inTriage).toBe(false)
      expect(planning.copyWorkItem(plain.id, human).workItem.inTriage).toBe(false)
      expect(() => capture('p1', { capture: 'email' })).toThrow('Invalid capture')
    })

    it('keeps how it was captured: snip, text and the API', () => {
      expect(capture('p1', { capture: 'snip' }).capturedBy).toBe('snip')
      expect(capture('p1', { capture: 'text' }).capturedBy).toBe('text')
      expect(capture('p1', { capture: 'api' }).capturedBy).toBe('api')
    })
  })

  describe('counting nowhere', () => {
    it('lists it in To triage, oldest first, and never with the planned tasks', () => {
      const first = capture('p1', { title: 'First' })
      vi.setSystemTime(new Date(2026, 9, 7, 11, 0))
      const second = capture('p1', { title: 'Second' })
      const planned = planning.createWorkItem('p1', { title: 'Planned' }, human)
      expect(planning.listWorkItems('p1', 'triage').map((item) => item.id)).toEqual([
        first.id,
        second.id
      ])
      expect(planning.listWorkItems('p1', 'planned').map((item) => item.id)).toEqual([planned.id])
      // The live scope (export, project file, the API's default) keeps them all.
      expect(planning.listWorkItems('p1')).toHaveLength(3)
    })

    it('leaves it out of reports and their history', () => {
      const waiting = capture('p1')
      const kept = planning.createWorkItem('p1', { title: 'Kept' }, human)
      expect(planning.listKeptWorkItemsForReports('p1').map((item) => item.id)).toEqual([kept.id])
      expect(
        planning.listProjectStatusTransitions('p1').map((entry) => entry.workItemId)
      ).not.toContain(waiting.id)
    })

    it('leaves it out of Today, Upcoming, My work and Workload', () => {
      const home = new HomeService({
        db: planning.database,
        getProjects: () => projects,
        getMeId: () => 'me',
        agentsOn: () => false,
        agentAttention: () => null
      })
      const due = { targetDate: TODAY, assigneeId: null }
      const waiting = capture('p1', { ...due, title: 'Waiting' })
      planning.createWorkItem('p1', { ...due, title: 'Planned' }, human)
      const titles = home.getMyWork({ today: TODAY }).today.map((task) => task.title)
      expect(titles).toContain('Planned')
      expect(titles).not.toContain('Waiting')
      const workload = home.getWorkloadTasks({ through: '2026-10-31' }).map((task) => task.id)
      expect(workload).not.toContain(waiting.id)
      expect(workload.length).toBeGreaterThan(0)
    })

    it('refuses to queue it for an agent before anything is reserved', () => {
      const waiting = capture('p1', { status: 'ready' })
      const target = project('p1', 'Website', { path: tempDir })
      expect(() =>
        queueWorkItemForHarness(planning, {} as HarnessService, target, waiting.id)
      ).toThrow('Accept it from To triage first')
      expect(planning.getWorkItem(waiting.id).linkedHarnessTaskId).toBeNull()
    })

    it('plans no due reminder until it is accepted', () => {
      const waiting = capture('p1', { targetDate: '2026-10-09' })
      const pending = () =>
        planning.database
          .prepare("SELECT COUNT(*) AS n FROM reminders WHERE work_item_id = ? AND kind = 'due'")
          .get(waiting.id) as { n: number }
      expect(pending().n).toBe(0)
      acceptFromTriage(planning, projects[0], waiting.id, {}, human)
      expect(pending().n).toBeGreaterThan(0)
    })

    it('is still found by search, marked To triage', () => {
      const waiting = capture('p1', { title: 'Plumber visit' })
      const [result] = planning.search.search('plumber')
      expect(result).toMatchObject({ id: waiting.id, inTriage: true })
      acceptFromTriage(planning, projects[0], waiting.id, {}, human)
      expect(planning.search.search('plumber')[0].inTriage).toBeUndefined()
    })
  })

  describe('the decisions', () => {
    it('accepts with the fields set first, into the Backlog by default, and undoes', () => {
      const waiting = capture('p1')
      const accepted = acceptFromTriage(
        planning,
        projects[0],
        waiting.id,
        readAcceptFields({ priority: 'high', labels: ['home'], targetDate: '2026-10-20' }),
        human
      )
      expect(accepted).toMatchObject({
        inTriage: false,
        status: 'backlog',
        priority: 'high',
        labels: ['home'],
        targetDate: '2026-10-20'
      })
      expect(planning.listWorkItems('p1', 'planned').map((item) => item.id)).toEqual([waiting.id])
      // Undo puts it back as it was.
      planning.updateWorkItem(
        waiting.id,
        { priority: 'medium', labels: [], targetDate: null, inTriage: true },
        human
      )
      expect(planning.getWorkItem(waiting.id)).toMatchObject({ inTriage: true, priority: 'medium' })
      const fields = planning.listActivity('p1', waiting.id).entries.map((entry) => entry.field)
      expect(fields.filter((field) => field === 'triage')).toHaveLength(2)
    })

    it('refuses Accept for a task not in triage, and fields Accept does not set', () => {
      const plain = planning.createWorkItem('p1', { title: 'Plain' }, human)
      expect(() => acceptFromTriage(planning, projects[0], plain.id, {}, human)).toThrow(
        'This task is not in To triage'
      )
      expect(() => readAcceptFields({ title: 'Other' })).toThrow('Accept cannot set title')
      expect(() => readAcceptFields([])).toThrow('Accept fields must be an object')
    })

    it('clears the mark when the task goes to Someday', () => {
      const waiting = capture('p1')
      const parked = planning.updateWorkItem(waiting.id, { someday: true }, human)
      expect(parked).toMatchObject({ inTriage: false, someday: true })
      planning.updateWorkItem(waiting.id, { someday: false, inTriage: true }, human)
      expect(planning.getWorkItem(waiting.id)).toMatchObject({ inTriage: true, someday: false })
    })

    it('clears the mark when it is closed as won’t do, or marked as a duplicate', () => {
      const original = planning.createWorkItem('p1', { title: 'Original' }, human)
      const closed = capture('p1')
      const duplicate = capture('p1')
      closeAsWontDo(planning, undefined, projects[0], closed.id, human, { reason: 'No' })
      expect(planning.getWorkItem(closed.id)).toMatchObject({
        inTriage: false,
        resolution: 'wont-do'
      })
      markAsDuplicate(planning, undefined, projects[0], duplicate.id, original.id, human)
      expect(planning.getWorkItem(duplicate.id)).toMatchObject({
        inTriage: false,
        resolution: 'wont-do'
      })
    })

    it('accepts every waiting task into the Backlog when triage is turned off', () => {
      capture('p1')
      capture('p1')
      expect(acceptAllFromTriage(planning, projects[0], human)).toBe(2)
      expect(planning.listWorkItems('p1', 'triage')).toEqual([])
    })
  })

  describe('Move to project', () => {
    it('makes the task again in the other project’s triage and bins the original', async () => {
      // The other project triages new captures, so the task waits there.
      triaged.add('p2')
      planning.createWorkItem('p2', { title: 'Labelled', labels: ['outdoors'] }, human)
      const waiting = capture('p1', {
        title: 'Fix the gate',
        description: 'The latch sticks.',
        acceptanceCriteria: ['Buy a latch'],
        priority: 'high',
        targetDate: '2026-10-12',
        labels: ['outdoors', 'website-only']
      })
      const note = library.createItem('p1', {
        kind: 'note',
        title: 'Gate notes',
        body: 'Measure it first.',
        aiAccess: 'always'
      })
      const file = (
        await library.importFiles('p1', [
          { fileName: 'size.txt', mimeType: 'text/plain', bytes: Buffer.from('90 cm wide') }
        ])
      )[0].item
      library.attachToWorkItem('p1', waiting.id, note.id, 'human')
      library.attachToWorkItem('p1', waiting.id, file.id, 'human')

      const move = await moveFromTriage(
        { planning, library },
        projects[0],
        waiting.id,
        projects[1],
        human
      )

      expect(move.workItem).toMatchObject({
        projectId: 'p2',
        title: 'Fix the gate',
        description: 'The latch sticks.',
        acceptanceCriteria: ['Buy a latch'],
        priority: 'high',
        targetDate: '2026-10-12',
        labels: ['outdoors'],
        inTriage: true,
        capturedBy: 'quick-add'
      })
      expect(planning.getWorkItem(waiting.id).deletedAt).not.toBeNull()
      const copied = library.listWorkItemAttachments('p2', move.workItem.id)
      expect(copied.map((entry) => entry.item.title).sort()).toEqual(['Gate notes', 'size'])
      expect(copied.every((entry) => entry.item.projectId === 'p2')).toBe(true)
      expect(move.copiedItemIds).toHaveLength(2)

      undoTriageMove(
        { planning, library },
        projects[0],
        { ...move, workItemId: move.workItem.id },
        human
      )
      expect(planning.getWorkItem(waiting.id)).toMatchObject({ deletedAt: null, inTriage: true })
      expect(() => planning.getWorkItem(move.workItem.id)).toThrow()
      expect(library.listItems('p2')).toEqual([])
    })

    it('lands as an ordinary Backlog task in a project that does not triage, and undo puts it back', async () => {
      const waiting = capture('p1', { title: 'Weed the beds', priority: 'high' })
      const note = library.createItem('p1', { kind: 'note', title: 'Beds', aiAccess: 'always' })
      library.attachToWorkItem('p1', waiting.id, note.id, 'human')

      const move = await moveFromTriage(
        { planning, library },
        projects[0],
        waiting.id,
        projects[1],
        human
      )

      expect(move.workItem).toMatchObject({
        projectId: 'p2',
        title: 'Weed the beds',
        priority: 'high',
        status: 'backlog',
        inTriage: false,
        capturedBy: null
      })
      expect(planning.listWorkItems('p2', 'triage')).toEqual([])
      expect(planning.listWorkItems('p2', 'planned').map((item) => item.id)).toEqual([
        move.workItem.id
      ])
      expect(library.listWorkItemAttachments('p2', move.workItem.id)).toHaveLength(1)

      undoTriageMove(
        { planning, library },
        projects[0],
        { ...move, workItemId: move.workItem.id },
        human
      )
      expect(planning.getWorkItem(waiting.id)).toMatchObject({ deletedAt: null, inTriage: true })
      expect(() => planning.getWorkItem(move.workItem.id)).toThrow()
      expect(library.listItems('p2')).toEqual([])
    })

    it('does not undo a move once the moved task was changed or accepted', async () => {
      const toBacklog = await moveFromTriage(
        { planning, library },
        projects[0],
        capture('p1', { title: 'Edited later' }).id,
        projects[1],
        human
      )
      vi.setSystemTime(new Date(2026, 9, 7, 10, 5))
      planning.updateWorkItem(toBacklog.workItem.id, { priority: 'low' }, human)
      expect(() =>
        undoTriageMove(
          { planning, library },
          projects[0],
          { ...toBacklog, workItemId: toBacklog.workItem.id },
          human
        )
      ).toThrow('The moved task has been decided on; it cannot be undone')

      triaged.add('p3')
      const toTriage = await moveFromTriage(
        { planning, library },
        projects[0],
        capture('p1', { title: 'Accepted later' }).id,
        projects[2],
        human
      )
      acceptFromTriage(planning, projects[2], toTriage.workItem.id, {}, human)
      expect(() =>
        undoTriageMove(
          { planning, library },
          projects[0],
          { ...toTriage, workItemId: toTriage.workItem.id },
          human
        )
      ).toThrow('The moved task has been decided on; it cannot be undone')
    })

    it('moves nothing when a Library copy fails', async () => {
      const waiting = capture('p1')
      const note = library.createItem('p1', { kind: 'note', title: 'Kept', aiAccess: 'always' })
      library.attachToWorkItem('p1', waiting.id, note.id, 'human')
      const failing = {
        copyAttachmentsTo: async () => {
          throw new Error('Disk full')
        }
      } as unknown as LibraryService
      await expect(
        moveFromTriage({ planning, library: failing }, projects[0], waiting.id, projects[1], human)
      ).rejects.toThrow('Disk full')
      expect(planning.getWorkItem(waiting.id)).toMatchObject({ deletedAt: null, inTriage: true })
      expect(planning.listWorkItems('p2')).toEqual([])
    })

    it('removes the copies when the move itself is refused', async () => {
      const waiting = capture('p1')
      const note = library.createItem('p1', { kind: 'note', title: 'Kept', aiAccess: 'always' })
      library.attachToWorkItem('p1', waiting.id, note.id, 'human')
      const gone = project('p9', 'Unknown')
      await expect(
        moveFromTriage({ planning, library }, projects[0], waiting.id, gone, human)
      ).rejects.toThrow()
      expect(planning.getWorkItem(waiting.id).deletedAt).toBeNull()
    })

    it('refuses a task that is not in triage', async () => {
      const plain = planning.createWorkItem('p1', { title: 'Plain' }, human)
      await expect(
        moveFromTriage({ planning, library }, projects[0], plain.id, projects[1], human)
      ).rejects.toThrow('This task is not in To triage')
    })
  })

  describe('where To triage is offered', () => {
    const waiting = () =>
      Object.entries(planning.listProjectUsage())
        .filter(([, facts]) => facts.includes('triage'))
        .map(([id]) => id)
        .sort()

    it('lists the registered projects with a live task waiting in To triage', () => {
      expect(waiting()).toEqual([])
      capture('p1')
      capture('p1')
      triaged.add('p2')
      const binned = capture('p2')
      planning.createWorkItem('p3', { title: 'Plain' }, human)
      expect(waiting()).toEqual(['p1', 'p2'])
      planning.moveWorkItemToBin(binned.id, human)
      // Turning triage off with nothing waiting leaves nothing to offer.
      triaged.delete('p2')
      expect(waiting()).toEqual(['p1'])
      acceptAllFromTriage(planning, projects[0], human)
      expect(waiting()).toEqual([])
    })

    it('says what else each project holds, for the views that earn a tab', () => {
      expect(planning.listProjectUsage()).toMatchObject({ p1: [], p2: [], p3: [] })
      planning.createWorkItem('p1', { title: 'Dated', startDate: '2026-10-01' }, human)
      planning.createWorkItem('p2', { title: 'Idea', someday: true }, human)
      const usage = planning.listProjectUsage()
      expect(usage.p1).toEqual(['scheduled'])
      expect(usage.p2).toEqual(['someday'])
      expect(usage.p3).toEqual([])
    })
  })

  describe('the Inbox', () => {
    it('shows one item per enabled project with tasks waiting', () => {
      triaged.add('p3')
      capture('p1')
      capture('p1')
      capture('p3')
      projects[2] = { ...projects[2], enabled: false }
      const items = triageSource(planning.database, () => projects)()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        kind: 'triage',
        projectId: 'p1',
        title: '2 to triage · Website',
        taskId: null
      })
    })

    it('makes a new item when another capture arrives, and none once all are decided', () => {
      const first = capture('p1')
      const before = triageSource(planning.database, () => projects)()[0].key
      vi.setSystemTime(new Date(2026, 9, 7, 12, 0))
      capture('p1')
      const after = triageSource(planning.database, () => projects)()[0].key
      expect(after).not.toBe(before)
      acceptAllFromTriage(planning, projects[0], human)
      expect(first.id).toBeTruthy()
      expect(triageSource(planning.database, () => projects)()).toEqual([])
    })
  })
})
