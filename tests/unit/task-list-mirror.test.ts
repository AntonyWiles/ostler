import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectedAccount } from '../../src/shared/ostler-api'
import { TaskListMirror, listTaskLists } from '../../electron/services/accounts/task-list-mirror'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'

const account = (provider: ConnectedAccount['provider']): ConnectedAccount => ({
  id: 'a1',
  provider,
  label: 'ann@example.com',
  server: null,
  capabilities: ['tasks.sync'],
  status: 'connected',
  failure: null,
  createdAt: 1,
  lastUsedAt: null
})

describe('my tasks copied into To Do or Google Tasks (integrations phase 6)', () => {
  const root = useTempDir('ostler-task-mirror-')
  let databasePath: string
  let planning: PlanningService
  let mirror: TaskListMirror
  let meId: string
  /** The remote list: id → completed. */
  let remote: Map<string, { done: boolean; body: Record<string, unknown> }>
  let callJson: ReturnType<typeof vi.fn>
  let call: ReturnType<typeof vi.fn>

  const make = (provider: 'google' | 'microsoft') => {
    let next = 1
    remote = new Map()
    callJson = vi.fn(
      async (_id: string, url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'POST') {
          const id = `r${next++}`
          remote.set(id, { done: false, body: JSON.parse(init.body ?? '{}') })
          return { id }
        }
        if (init?.method === 'PATCH') {
          const id = decodeURIComponent(url.split('/').pop() ?? '')
          const body = JSON.parse(init.body ?? '{}')
          const item = remote.get(id)
          if (item) {
            if (body.status === 'completed') item.done = true
            else item.body = body
          }
          return {}
        }
        const items = [...remote].map(([id, item]) => ({
          id,
          status: item.done ? 'completed' : provider === 'google' ? 'needsAction' : 'notStarted'
        }))
        return provider === 'google' ? { items } : { value: items }
      }
    )
    call = vi.fn(async (_id: string, url: string) => {
      remote.delete(decodeURIComponent(url.split('/').pop() ?? ''))
      return { status: 204, headers: { get: () => null }, text: '' }
    })
    mirror = new TaskListMirror(databasePath, {
      accounts: {
        get: () => account(provider),
        list: () => [account(provider)],
        call,
        callJson
      } as never,
      projects: () => [{ id: P1, name: 'Launch' }],
      meId: () => meId,
      markDone: (id) => planning.updateWorkItem(id, { status: 'done' }, planning.humanActor()),
      now: () => 1000
    })
  }

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(root())
    const db = new Database(databasePath)
    db.prepare(
      "INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at) VALUES ('me', 'Ann', 'A', '#000000', 1, 1, 1)"
    ).run()
    db.close()
    meId = 'me'
    planning = new PlanningService(databasePath, () => [P1])
  })

  afterEach(() => {
    mirror.close()
    planning.close()
  })

  it('copies my open tasks, and ticking one off there marks it done here', async () => {
    make('google')
    const mine = planning.createWorkItem(
      P1,
      { title: 'Book venue', assigneeId: 'me', targetDate: '2026-11-02' },
      planning.humanActor()
    )
    planning.createWorkItem(P1, { title: 'Not mine' }, planning.humanActor())
    await mirror.setTarget({ accountId: 'a1', remoteId: 'list-1', name: 'Ostler' })
    await mirror.sync()
    expect([...remote.values()].map((item) => item.body)).toEqual([
      {
        title: 'Book venue',
        notes: expect.stringContaining('Launch'),
        due: '2026-11-02T00:00:00.000Z'
      }
    ])

    remote.get('r1')!.done = true
    await mirror.sync()
    expect(planning.getWorkItem(mine.id).status).toBe('done')
    expect(mirror.target()).toMatchObject({ syncedAt: 1000, failure: null })
  })

  it('updates a changed task, completes one done here, and removes one reassigned', async () => {
    make('microsoft')
    const a = planning.createWorkItem(P1, { title: 'A', assigneeId: 'me' }, planning.humanActor())
    const b = planning.createWorkItem(P1, { title: 'B', assigneeId: 'me' }, planning.humanActor())
    const c = planning.createWorkItem(P1, { title: 'C', assigneeId: 'me' }, planning.humanActor())
    await mirror.setTarget({ accountId: 'a1', remoteId: 'list-1', name: 'Tasks' })
    await mirror.sync()
    expect(remote.size).toBe(3)
    expect(callJson.mock.calls.find((entry) => entry[2]?.method === 'POST')?.[1]).toBe(
      'https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks'
    )

    planning.updateWorkItem(a.id, { title: 'A2' }, planning.humanActor())
    planning.updateWorkItem(b.id, { status: 'done' }, planning.humanActor())
    planning.updateWorkItem(c.id, { assigneeId: null }, planning.humanActor())
    await mirror.sync()
    const items = [...remote.values()]
    expect(items.map((item) => [item.body.title, item.done])).toEqual([
      ['A2', false],
      ['B', true]
    ])
  })

  it('does not make an item deleted there again until its task changes', async () => {
    make('google')
    const a = planning.createWorkItem(P1, { title: 'A', assigneeId: 'me' }, planning.humanActor())
    await mirror.setTarget({ accountId: 'a1', remoteId: 'list-1', name: 'Ostler' })
    await mirror.sync()
    remote.clear()
    await mirror.sync()
    await mirror.sync()
    expect(remote.size).toBe(0)
    planning.updateWorkItem(a.id, { title: 'A again' }, planning.humanActor())
    await mirror.sync()
    expect([...remote.values()].map((item) => item.body.title)).toEqual(['A again'])
  })

  it('lists Google task lists and Microsoft To Do lists', async () => {
    const google = {
      get: () => account('google'),
      callJson: vi.fn(async () => ({ items: [{ id: 'l1', title: 'My Tasks' }] }))
    }
    expect(await listTaskLists(google as never, 'a1')).toEqual([
      { remoteId: 'l1', name: 'My Tasks' }
    ])
    const microsoft = {
      get: () => account('microsoft'),
      callJson: vi.fn(async () => ({ value: [{ id: 'l2', displayName: 'Tasks' }] }))
    }
    expect(await listTaskLists(microsoft as never, 'a1')).toEqual([
      { remoteId: 'l2', name: 'Tasks' }
    ])
  })
})
