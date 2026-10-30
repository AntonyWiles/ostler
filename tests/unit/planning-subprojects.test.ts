import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ Notification: class {}, BrowserWindow: class {} }))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { ChangeHistoryService } =
  await import('../../electron/services/change-history/history-service')
const { recordChanges } = await import('../../electron/services/change-history/context')
const { createMigratedDatabase } = await import('../helpers/database')

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P2 = '1f8fad5b-d9cb-469f-a165-70867728950e'
const human = { kind: 'human' } as const

/** Sub-projects (shown as workstreams) as the planning service keeps them. */
describe('PlanningService sub-projects', () => {
  const tempDir = useTempDir('ostler-subprojects-')
  let dbPath: string
  let service: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>

  beforeEach(async () => {
    dbPath = await createMigratedDatabase(tempDir())
    service = new PlanningService(dbPath, () => [P1, P2])
    people = new PeopleService(dbPath)
  })

  afterEach(() => {
    people.close()
    service.close()
  })

  it('creates workstreams in order, trimming names and filling defaults', () => {
    const web = service.subprojects.create(P1, { name: '  Web  ', color: '#EF4444' })
    const api = service.subprojects.create(P1, { name: 'API' })
    expect(web).toMatchObject({
      name: 'Web',
      color: '#ef4444',
      position: 0,
      status: 'active',
      memberIds: [],
      leadId: null,
      archivedAt: null
    })
    expect(api.position).toBe(1)
    expect(api.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(service.subprojects.list(P1).map((item) => item.name)).toEqual(['Web', 'API'])
    expect(service.subprojects.list(P2)).toEqual([])
    expect(() => service.subprojects.create(P1, { name: '   ' })).toThrow()
    expect(() => service.subprojects.create(P1, { name: 'x'.repeat(81) })).toThrow(/80/)
    expect(() => service.subprojects.create(P1, { name: 'Bad', color: 'red' })).toThrow()
  })

  it('keeps only known people, once each, as lead and members', () => {
    const sam = people.create({ name: 'Sam' }).id
    const kim = people.create({ name: 'Kim' }).id
    const made = service.subprojects.create(P1, {
      name: 'Web',
      leadId: sam,
      memberIds: [sam, kim, sam]
    })
    expect(made.leadId).toBe(sam)
    expect(service.subprojects.get(made.id).memberIds).toEqual([sam, kim])
    expect(() => service.subprojects.create(P1, { name: 'X', memberIds: ['nobody'] })).toThrow()
    expect(() => service.subprojects.update(made.id, { leadId: 'nobody' })).toThrow()
  })

  it('updates, moves and archives', () => {
    const a = service.subprojects.create(P1, { name: 'A' })
    const b = service.subprojects.create(P1, { name: 'B' })
    const c = service.subprojects.create(P1, { name: 'C' })
    expect(service.subprojects.update(a.id, { name: 'Alpha', status: 'on_hold' })).toMatchObject({
      name: 'Alpha',
      status: 'on_hold'
    })
    expect(() => service.subprojects.update(a.id, { status: 'nope' as never })).toThrow()
    const names = (list: { name: string }[]) => list.map((item) => item.name)
    expect(names(service.subprojects.move(c.id, -1))).toEqual(['Alpha', 'C', 'B'])
    expect(names(service.subprojects.move(c.id, 1))).toEqual(['Alpha', 'B', 'C'])
    // At either end, a move changes nothing.
    expect(names(service.subprojects.move(a.id, -1))).toEqual(['Alpha', 'B', 'C'])
    expect(names(service.subprojects.move(c.id, 1))).toEqual(['Alpha', 'B', 'C'])

    expect(service.subprojects.archive(b.id, true, 5000).archivedAt).toBe(5000)
    // Archived ones stay in the list, in place.
    expect(names(service.subprojects.list(P1))).toEqual(['Alpha', 'B', 'C'])
    expect(service.subprojects.archive(b.id, false).archivedAt).toBeNull()
    expect(service.subprojects.get(b.id).archivedAt).toBeNull()
  })

  it('puts tasks and milestones in a workstream of the same project only', () => {
    const web = service.subprojects.create(P1, { name: 'Web' })
    const other = service.subprojects.create(P2, { name: 'Elsewhere' })
    const task = service.createWorkItem(P1, { title: 'Paint', subprojectId: web.id }, human)
    expect(task.subprojectId).toBe(web.id)
    expect(service.getWorkItem(task.id).subprojectId).toBe(web.id)
    expect(service.createWorkItem(P1, { title: 'Plain' }, human).subprojectId).toBeNull()

    const message = /not in this project/
    expect(() =>
      service.createWorkItem(P1, { title: 'Nope', subprojectId: other.id }, human)
    ).toThrow(message)
    expect(() => service.updateWorkItem(task.id, { subprojectId: other.id }, human)).toThrow(
      message
    )
    expect(service.updateWorkItem(task.id, { subprojectId: null }, human).subprojectId).toBeNull()

    const milestone = service.createMilestone(P1, { name: 'Launch', subprojectId: web.id })
    expect(milestone.subprojectId).toBe(web.id)
    expect(() => service.createMilestone(P1, { name: 'Bad', subprojectId: other.id })).toThrow(
      message
    )
    expect(() => service.updateMilestone(milestone.id, { subprojectId: other.id })).toThrow(message)
    expect(service.listMilestones(P1)[0].subprojectId).toBe(web.id)
  })

  it("puts a subtask in its parent's workstream unless it is given one", () => {
    const web = service.subprojects.create(P1, { name: 'Web' })
    const api = service.subprojects.create(P1, { name: 'API' })
    const parent = service.createWorkItem(P1, { title: 'Site', subprojectId: web.id }, human)
    const child = (input: { subprojectId?: string | null }) =>
      service.createWorkItem(
        P1,
        { title: 'Part', parentWorkItemId: parent.id, subtaskPhaseNumber: 1, ...input },
        human
      ).subprojectId
    expect(child({})).toBe(web.id)
    expect(child({ subprojectId: api.id })).toBe(api.id)
    expect(child({ subprojectId: null })).toBeNull()
  })

  it('deleting a workstream moves its tasks and milestones to the top level', () => {
    const web = service.subprojects.create(P1, { name: 'Web' })
    const keep = service.subprojects.create(P1, { name: 'Keep' })
    const task = service.createWorkItem(P1, { title: 'Paint', subprojectId: web.id }, human)
    const kept = service.createWorkItem(P1, { title: 'Stay', subprojectId: keep.id }, human)
    const milestone = service.createMilestone(P1, { name: 'Launch', subprojectId: web.id })
    const before = service.getWorkItem(task.id).updatedAt

    service.subprojects.delete(web.id)

    expect(service.subprojects.list(P1).map((item) => item.id)).toEqual([keep.id])
    expect(service.getWorkItem(task.id).subprojectId).toBeNull()
    expect(service.getWorkItem(task.id).updatedAt).toBe(before)
    expect(service.getWorkItem(kept.id).subprojectId).toBe(keep.id)
    expect(
      service.listMilestones(P1).find((item) => item.id === milestone.id)?.subprojectId
    ).toBeNull()
    expect(() => service.subprojects.get(web.id)).toThrow(/not found/)
  })

  it('undoes a rename of a workstream', async () => {
    const history = new ChangeHistoryService(dbPath, {
      getProjectIds: () => [P1, P2],
      keepDays: () => 30,
      afterUndo: () => {},
      changed: () => {},
      now: () => Date.now()
    })
    try {
      const web = await recordChanges('create', async () =>
        service.subprojects.create(P1, { name: 'Web' })
      )
      await recordChanges('rename', async () =>
        service.subprojects.update(web.id, { name: 'Website' })
      )
      const rename = history
        .list()
        .entries.find((entry) => entry.subjects[0].fields.includes('name'))!
      expect(rename.subjects[0]).toMatchObject({ kind: 'subproject', id: web.id })
      expect(rename.subjects[0].fields).toContain('name')

      await recordChanges('undo', async () => history.undo(rename.id))
      expect(service.subprojects.get(web.id).name).toBe('Web')
    } finally {
      history.close()
    }
  })
})
