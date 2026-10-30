import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => false
  },
  BrowserWindow: class {}
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { HomeService } = await import('../../electron/services/home-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }

function project(id: string, name: string): WatchedProject {
  return { id, name, color: '#3b82f6', enabled: true } as WatchedProject
}

describe('Checklist items with dates and people (N2.2)', () => {
  const tempDir = useTempDir('ostler-checklist-details-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let meId: string
  let samId: string
  const projects = [project('p1', 'Party'), project('p2', 'Garden')]

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
    samId = people.create({ name: 'Sam' }).id
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const add = (title: string, criteria: string[], extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, acceptanceCriteria: criteria, ...extra }, human)
  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      agentsOn: () => false,
      agentAttention: () => null
    })

  it('sets and clears an item’s date and person, one field at a time', () => {
    const task = add('Party', ['Confirm caterer', 'Send invitations'])
    let item = planning.setChecklistItemDetails(
      task.id,
      'Confirm caterer',
      { dueDate: '2026-10-16', assigneeId: samId },
      human
    )
    expect(item.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: '2026-10-16', assigneeId: samId }
    ])
    // A field left out keeps its value.
    item = planning.setChecklistItemDetails(task.id, 'Confirm caterer', { dueDate: null }, human)
    expect(item.checklistDetails).toEqual([
      { text: 'Confirm caterer', dueDate: null, assigneeId: samId }
    ])
    item = planning.setChecklistItemDetails(task.id, 'Confirm caterer', { assigneeId: null }, human)
    expect(item.checklistDetails).toEqual([])
    expect(planning.listWorkItems('p1')[0]!.checklistDetails).toEqual([])
    expect(
      planning.database.prepare('SELECT COUNT(*) AS n FROM planning_checklist_details').get()
    ).toEqual({ n: 0 })
  })

  it('refuses an item not on the list, a bad date and a person who does not exist', () => {
    const task = add('Party', ['Confirm caterer'])
    expect(() =>
      planning.setChecklistItemDetails(task.id, 'Nope', { dueDate: '2026-10-16' }, human)
    ).toThrow()
    expect(() =>
      planning.setChecklistItemDetails(task.id, 'Confirm caterer', { dueDate: '16/10' }, human)
    ).toThrow()
    expect(() =>
      planning.setChecklistItemDetails(task.id, 'Confirm caterer', { assigneeId: 'ghost' }, human)
    ).toThrow()
  })

  it('reads the details in list order, in the project list and on one task', () => {
    const task = add('Party', ['One', 'Two', 'Three'])
    planning.setChecklistItemDetails(task.id, 'Three', { dueDate: '2026-10-20' }, human)
    planning.setChecklistItemDetails(task.id, 'One', { assigneeId: meId }, human)
    const texts = (item: { checklistDetails?: { text: string }[] }) =>
      (item.checklistDetails ?? []).map((detail) => detail.text)
    expect(texts(planning.getWorkItem(task.id))).toEqual(['One', 'Three'])
    expect(texts(planning.listWorkItems('p1')[0]!)).toEqual(['One', 'Three'])
  })

  it('renaming carries the tick, date and person to the new text', () => {
    const task = add('Party', ['Confirm caterer', 'Send invitations'])
    planning.setChecklistItemChecked(task.id, 'Confirm caterer', true, human)
    planning.setChecklistItemDetails(
      task.id,
      'Confirm caterer',
      { dueDate: '2026-10-16', assigneeId: samId },
      human
    )
    const renamed = planning.renameChecklistItem(
      task.id,
      'Confirm caterer',
      'Confirm the caterer',
      human
    )
    expect(renamed.acceptanceCriteria).toEqual(['Confirm the caterer', 'Send invitations'])
    expect(renamed.checkedCriteria).toEqual(['Confirm the caterer'])
    expect(renamed.checklistDetails).toEqual([
      { text: 'Confirm the caterer', dueDate: '2026-10-16', assigneeId: samId }
    ])
    expect(planning.getWorkItem(task.id).checklistDetails).toEqual(renamed.checklistDetails)
  })

  it('replacing the list drops the state of items whose text is gone', () => {
    const task = add('Party', ['Confirm caterer', 'Send invitations'])
    planning.setChecklistItemDetails(task.id, 'Confirm caterer', { dueDate: '2026-10-16' }, human)
    planning.setChecklistItemDetails(task.id, 'Send invitations', { assigneeId: meId }, human)
    const updated = planning.updateWorkItem(
      task.id,
      { acceptanceCriteria: ['Confirm the caterer', 'Send invitations'] },
      human
    )
    expect(updated.checklistDetails).toEqual([
      { text: 'Send invitations', dueDate: null, assigneeId: meId }
    ])
    expect(planning.getWorkItem(task.id).checklistDetails).toEqual(updated.checklistDetails)
  })

  it('deleting a task removes its items’ details', () => {
    const task = add('Party', ['Confirm caterer'])
    planning.setChecklistItemDetails(task.id, 'Confirm caterer', { dueDate: '2026-10-16' }, human)
    planning.deleteWorkItem(task.id, human)
    expect(
      planning.database.prepare('SELECT COUNT(*) AS n FROM planning_checklist_details').get()
    ).toEqual({ n: 0 })
  })

  it('puts dated items on Home’s Today and Upcoming by the item’s person', () => {
    // The task is Sam's; its items follow their own people.
    const party = add(
      'Party',
      ['Overdue mine', 'Today nobody', 'Today Sam', 'Friday mine', 'Far'],
      {
        assigneeId: samId
      }
    )
    const set = (text: string, dueDate: string, assigneeId: string | null) =>
      planning.setChecklistItemDetails(party.id, text, { dueDate, assigneeId }, human)
    set('Overdue mine', '2026-10-14', meId)
    set('Today nobody', '2026-10-16', null)
    set('Today Sam', '2026-10-16', samId)
    set('Friday mine', '2026-10-23', meId)
    set('Far', '2026-10-24', meId)
    const garden = add('Garden', ['Tomorrow nobody'], {}, 'p2')
    planning.setChecklistItemDetails(garden.id, 'Tomorrow nobody', { dueDate: '2026-10-17' }, human)

    const work = home().getMyWork({ today: '2026-10-16' })
    expect(work.todayItems!.map((item) => [item.text, item.taskTitle, item.overdue])).toEqual([
      ['Overdue mine', 'Party', true],
      ['Today nobody', 'Party', false]
    ])
    // Unassigned items count as mine only on Today, as tasks do.
    expect(work.upcoming).toEqual([
      {
        date: '2026-10-23',
        tasks: [],
        items: [expect.objectContaining({ text: 'Friday mine', projectName: 'Party' })]
      }
    ])
    // Sam's My work lists Sam's item, whoever the task belongs to.
    expect(
      home()
        .getAssignedChecklistItems({ personId: samId, today: '2026-10-16' })
        .map((item) => item.text)
    ).toEqual(['Today Sam'])
    expect(
      home()
        .getAssignedChecklistItems({ personId: meId, today: '2026-10-16' })
        .map((item) => item.text)
    ).toEqual(['Overdue mine', 'Friday mine', 'Far'])
  })

  it('leaves out items of done or hidden tasks, and ticked items', () => {
    const done = add('Done', ['A'])
    const someday = add('Someday', ['B'])
    const later = add('Later', ['C'])
    const open = add('Open', ['D', 'E'])
    for (const [task, text] of [
      [done, 'A'],
      [someday, 'B'],
      [later, 'C'],
      [open, 'D'],
      [open, 'E']
    ] as const)
      planning.setChecklistItemDetails(
        task.id,
        text,
        { dueDate: '2026-10-16', assigneeId: meId },
        human
      )
    planning.updateWorkItem(done.id, { status: 'done' }, human)
    planning.updateWorkItem(someday.id, { someday: true }, human)
    planning.updateWorkItem(later.id, { showFrom: '2026-10-20' }, human)
    planning.setChecklistItemChecked(open.id, 'E', true, human)
    expect(
      home()
        .getMyWork({ today: '2026-10-16' })
        .todayItems!.map((item) => item.text)
    ).toEqual(['D'])
  })

  it('ticking an item from Home ticks it on the task and takes it off Today', () => {
    const task = add('Party', ['Confirm caterer'])
    planning.setChecklistItemDetails(task.id, 'Confirm caterer', { dueDate: '2026-10-16' }, human)
    const [item] = home().getMyWork({ today: '2026-10-16' }).todayItems!
    planning.setChecklistItemChecked(item!.workItemId, item!.text, true, human)
    expect(planning.getWorkItem(task.id).checkedCriteria).toEqual(['Confirm caterer'])
    expect(home().getMyWork({ today: '2026-10-16' }).todayItems).toEqual([])
  })
})
