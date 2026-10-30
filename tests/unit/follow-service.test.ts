import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FollowService } from '../../electron/services/follow-service'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'

/** Following (prompt 15): automatic follows never undo a choice the person made. */
describe('following tasks', () => {
  let tempDir: string
  let follows: FollowService

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-follows-'))
    follows = new FollowService(await createMigratedDatabase(tempDir), () => 1000)
  })

  afterEach(() => {
    follows.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('follows a task automatically once', () => {
    expect(follows.isFollowing('t-1')).toBe(false)
    follows.autoFollow('p-1', 't-1')
    expect(follows.isFollowing('t-1')).toBe(true)
  })

  it('keeps an explicit unfollow: an automatic follow does not bring it back', () => {
    follows.autoFollow('p-1', 't-1')
    follows.unfollow('p-1', 't-1')
    expect(follows.isFollowing('t-1')).toBe(false)
    follows.autoFollow('p-1', 't-1')
    expect(follows.isFollowing('t-1')).toBe(false)
  })

  it('follows again when the person asks', () => {
    follows.unfollow('p-1', 't-1')
    follows.follow('p-1', 't-1')
    expect(follows.isFollowing('t-1')).toBe(true)
  })

  it('unfollowing a task never followed keeps the choice', () => {
    follows.unfollow('p-1', 't-2')
    follows.autoFollow('p-1', 't-2')
    expect(follows.isFollowing('t-2')).toBe(false)
  })

  it('says which of several tasks are followed', () => {
    follows.autoFollow('p-1', 't-1')
    follows.autoFollow('p-1', 't-2')
    follows.unfollow('p-1', 't-2')
    expect([...follows.followedIn(['t-1', 't-2', 't-3'])]).toEqual(['t-1'])
    expect(follows.followedIn([]).size).toBe(0)
  })
})

/** Planning writes the automatic follow itself, on its own connection (prompt 15). */
describe('following tasks from planning', () => {
  let tempDir: string
  let planning: PlanningService
  let follows: FollowService
  const human = { kind: 'human' } as const

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-follows-planning-'))
    const databasePath = await createMigratedDatabase(tempDir)
    planning = new PlanningService(databasePath, () => ['p-1'])
    follows = new FollowService(databasePath)
  })

  afterEach(() => {
    planning.close()
    follows.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('follows a task a person creates, and not one an agent creates', () => {
    const mine = planning.createWorkItem('p-1', { title: 'Paint hall' }, human)
    const agents = planning.createWorkItem('p-1', { title: 'Sand doors' }, { kind: 'agent' })
    expect(follows.isFollowing(mine.id)).toBe(true)
    expect(follows.isFollowing(agents.id)).toBe(false)
  })

  it('follows inside a transaction without waiting on its lock', () => {
    const started = Date.now()
    const ids = planning.database.transaction(() =>
      ['One', 'Two', 'Three'].map((title) => planning.createWorkItem('p-1', { title }, human).id)
    )()
    expect(Date.now() - started).toBeLessThan(1000)
    expect([...follows.followedIn(ids)].sort()).toEqual([...ids].sort())
  })

  it("does not follow a new project's records: a template or demo is nobody's choice", () => {
    const id = planning.createRecordsForNewProject(
      'p-2',
      () => planning.createWorkItem('p-2', { title: 'From the template' }, human).id
    )
    expect(follows.isFollowing(id)).toBe(false)
  })
})
