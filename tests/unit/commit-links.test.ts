import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitCommit } from '../../src/shared/ostler-api'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { EventDatabase } from '../../electron/services/event-database'
import { InboxService } from '../../electron/services/inbox-service'
import { commitFixSource } from '../../electron/services/inbox-sources'
import { deleteWorkItemForever } from '../../electron/services/planning-deletion'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Smart commits (N9.8b): commits link the tasks their messages name, on
 * sync and in the one-time reading, and only new commits that fix an open
 * task offer Mark as done in the Inbox, once each.
 */

const tempDir = useTempDir('ostler-commit-links-')
let store: ConfigStore
let planning: PlanningService
let events: EventDatabase
let projectId: string
let clock = 1_000

const prefixOf = (id: string) => store.getProjects().find((p) => p.id === id)?.taskPrefix ?? null

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  projectId = store.registerProject({ name: 'Shop', folder: null }).id
  store.updateProject(projectId, { taskPrefix: 'SHOP' })
  planning = new PlanningService(
    databasePath,
    () => store.getProjects().map((p) => p.id),
    undefined,
    prefixOf
  )
  events = new EventDatabase(databasePath)
})

afterEach(() => {
  events.close()
  planning.close()
})

const actor = () => planning.humanActor()
const make = (title: string) => planning.createWorkItem(projectId, { title }, actor())

function commit(hash: string, message: string, body = ''): GitCommit {
  clock += 1_000
  return {
    hash: `${hash}-`.padEnd(40, '0'),
    abbreviatedHash: hash.slice(0, 7),
    message,
    body,
    author: 'Ana',
    date: new Date(clock).toISOString(),
    filesChanged: 1,
    insertions: 1,
    deletions: 0
  }
}

/** What the app does when commits arrive: store them, then link them. */
function arrive(commits: GitCommit[], offer: boolean) {
  for (const entry of commits) events.insertGitEvent(projectId, { ...entry, branch: '' })
  const made = planning.commitLinks.link(projectId, commits, { offer })
  planning.commitLinks.linkStoredOnce(projectId)
  return made
}

const commitsOf = (id: string) => planning.commitLinks.listForWorkItem(projectId, id)

function inbox() {
  const service = new InboxService(planning.database)
  service.registerSource(
    'commits',
    commitFixSource(planning.commitLinks, () => store.getProjects())
  )
  return service
}

describe('linking commits to tasks', () => {
  it('links the tasks a commit names, newest first, fixes marked', () => {
    const login = make('Fix the login')
    const cart = make('Cart')
    arrive([commit('aaaaaaa1', 'Start on SHOP-1')], true)
    arrive([commit('bbbbbbb2', 'Fixes shop-1, touches SHOP 2')], true)
    expect(commitsOf(login.id).map((c) => [c.abbreviatedHash, c.subject, c.fixes])).toEqual([
      ['bbbbbbb', 'Fixes shop-1, touches SHOP 2', true],
      ['aaaaaaa', 'Start on SHOP-1', false]
    ])
    expect(commitsOf(cart.id).map((c) => [c.abbreviatedHash, c.fixes, c.author])).toEqual([
      ['bbbbbbb', false, 'Ana']
    ])
  })

  it('ignores IDs of tasks that do not exist or were deleted for good', () => {
    const gone = make('Gone')
    planning.moveWorkItemToBin(gone.id, actor())
    deleteWorkItemForever(planning, store.getProjects()[0], gone.id, actor())
    expect(arrive([commit('ccccccc3', 'Fixes SHOP-1 and SHOP-99')], true)).toBe(0)
    expect(planning.database.prepare('SELECT COUNT(*) AS n FROM task_commit_links').get()).toEqual({
      n: 0
    })
  })

  it('reads the commits stored before this feature once, offering nothing', () => {
    const task = make('Login')
    for (const entry of [commit('d1', 'Fixes SHOP-1'), commit('d2', 'More SHOP-1')])
      events.insertGitEvent(projectId, { ...entry, branch: '' })
    expect(planning.commitLinks.linkStoredOnce(projectId)).toBe(true)
    expect(planning.commitLinks.linkStoredOnce(projectId)).toBe(false)
    expect(commitsOf(task.id)).toHaveLength(2)
    expect(inbox().list().items).toEqual([])
  })

  it('links the first history import without offering anything', () => {
    make('Login')
    const history = Array.from({ length: 500 }, (_, index) =>
      commit(`e${index}`, `Fixes SHOP-1 part ${index}`)
    )
    arrive(history, false)
    expect(commitsOf(planning.listWorkItems(projectId)[0].id)).toHaveLength(500)
    expect(inbox().list().items).toEqual([])
  })

  it('keeps links when the prefix changes, and reads new commits with the new one', () => {
    const task = make('Login')
    arrive([commit('f1', 'SHOP-1 first')], false)
    store.updateProject(projectId, { taskPrefix: 'STORE' })
    arrive([commit('f2', 'SHOP-1 old words'), commit('f3', 'store-1 new words')], false)
    expect(commitsOf(task.id).map((c) => c.subject)).toEqual(['store-1 new words', 'SHOP-1 first'])
  })
})

describe('Mark as done, offered in the Inbox', () => {
  it('offers a new commit that fixes an open task, once', () => {
    const task = make('Fix the login')
    arrive([commit('a1b2c3d4', 'Fixes SHOP-1')], true)
    arrive([commit('a1b2c3d4', 'Fixes SHOP-1')], true)
    const items = inbox().list().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'commit',
      title: 'Commit a1b2c3d says it fixes SHOP-1: Fix the login',
      taskId: task.id,
      projectId,
      fromStatus: 'backlog'
    })
  })

  it('offers nothing for a plain mention, a done task or an Apply entry', () => {
    const done = make('Done already')
    planning.updateWorkItem(done.id, { status: 'done' }, actor())
    make('Agent work SHOP-2 fix')
    arrive(
      [
        commit('g1', 'Mentions SHOP-1 and SHOP-2'),
        commit('g2', 'Fixes SHOP-1'),
        // Apply's History entry is named after its task.
        commit('g3', 'Agent work SHOP-2 fix')
      ],
      true
    )
    expect(inbox().list().items).toEqual([])
  })

  it('leaves once the task is done through the normal path, and comes back on Undo', () => {
    const task = make('Fix the login')
    arrive([commit('h1', 'fixed: SHOP-1')], true)
    const service = inbox()
    expect(service.list().items).toHaveLength(1)
    planning.updateWorkItem(task.id, { status: 'done' }, actor())
    expect(planning.getWorkItem(task.id).status).toBe('done')
    expect(service.list().items).toEqual([])
    planning.updateWorkItem(task.id, { status: 'backlog' }, actor())
    expect(service.list().items).toHaveLength(1)
  })

  it('never changes a status itself', () => {
    const task = make('Fix the login')
    arrive([commit('i1', 'Resolves SHOP-1')], true)
    expect(planning.getWorkItem(task.id).status).toBe('backlog')
  })

  it('Dismiss archives the item and it stays away', () => {
    make('Fix the login')
    arrive([commit('j1', 'Closes SHOP-1')], true)
    const service = inbox()
    const [item] = service.list().items
    service.archive([item.key])
    expect(service.list().items).toEqual([])
    arrive([commit('j1', 'Closes SHOP-1')], true)
    expect(service.list().items).toEqual([])
  })
})
