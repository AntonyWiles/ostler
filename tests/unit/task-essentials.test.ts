import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { formatPlanningTaskDetails } from '../../electron/services/task-intake'
import { PROJECT_COLORS } from '../../src/shared/project-colors'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

describe('P5.1 task essentials', () => {
  const tempDir = useTempDir('ostler-essentials-')
  let databasePath: string
  let planning: PlanningService
  let people: PeopleService
  const projectIds = ['project-one', 'project-two']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => projectIds)
    people = new PeopleService(databasePath)
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  describe('people', () => {
    it('creates, renames, recolours and lists people, with initials from the name', () => {
      const ada = people.create({ name: '  Ada Lovelace ' })
      expect(ada).toMatchObject({ name: 'Ada Lovelace', initials: 'AL', isMe: false })
      expect(PROJECT_COLORS).toContain(ada.color)
      // The colour is a stable hash of the id: the same person, the same colour.
      expect(people.get(ada.id).color).toBe(ada.color)

      const renamed = people.update(ada.id, { name: 'Ada King' })
      expect(renamed).toMatchObject({ name: 'Ada King', initials: 'AK' })
      expect(people.update(ada.id, { initials: 'adk' }).initials).toBe('ADK')
      // Set initials survive a rename; "" goes back to the name's.
      expect(people.update(ada.id, { name: 'Ada Byron' }).initials).toBe('ADK')
      expect(people.update(ada.id, { initials: '' }).initials).toBe('AB')
      expect(people.update(ada.id, { color: '#EC4899' }).color).toBe('#ec4899')

      expect(() => people.create({ name: '  ' })).toThrow('A person needs a name')
      expect(() => people.update(ada.id, { color: 'pink' })).toThrow('A colour must look like')
      expect(() => people.update(ada.id, { initials: 'ABCD' })).toThrow('at most 3 letters')
      expect(() => people.update('missing', { name: 'x' })).toThrow('Person not found')
      expect(people.list().map((person) => person.name)).toEqual(['Ada Byron'])
    })

    it('keeps a weekly capacity from 0 to 168 hours and at least one working day (R3.2)', () => {
      const ada = people.create({ name: 'Ada' })
      expect(ada).toMatchObject({ weeklyCapacityHours: null, workingDays: [1, 2, 3, 4, 5] })
      expect(people.update(ada.id, { weeklyCapacityHours: 0 }).weeklyCapacityHours).toBe(0)
      expect(people.update(ada.id, { weeklyCapacityHours: 168 }).weeklyCapacityHours).toBe(168)
      expect(people.update(ada.id, { workingDays: [7, 1, 1] }).workingDays).toEqual([1, 7])
      // Other edits leave both alone.
      expect(people.update(ada.id, { name: 'Ada K' })).toMatchObject({
        weeklyCapacityHours: 168,
        workingDays: [1, 7]
      })
      expect(people.update(ada.id, { weeklyCapacityHours: null }).weeklyCapacityHours).toBeNull()

      for (const bad of [-1, 168.5, Number.NaN, '40'])
        expect(() => people.update(ada.id, { weeklyCapacityHours: bad as number })).toThrow(
          'from 0 to 168'
        )
      for (const bad of [[], [0], [8], [1.5], 'mon'])
        expect(() => people.update(ada.id, { workingDays: bad as number[] })).toThrow(
          'at least one working day'
        )
    })

    it('keeps at most one Me, and ensureMe creates one only when nobody is Me', () => {
      const me = people.ensureMe('jordan')
      expect(me).toMatchObject({ name: 'jordan', isMe: true })
      expect(people.ensureMe('someone else').id).toBe(me.id)

      const bea = people.create({ name: 'Bea' })
      people.setMe(bea.id)
      const all = people.list()
      expect(all.filter((person) => person.isMe).map((person) => person.id)).toEqual([bea.id])
      expect(people.getMe()?.id).toBe(bea.id)
      // Me is listed first.
      expect(all[0].id).toBe(bea.id)
    })

    it('archiving hides a person from the list but keeps their assignments', () => {
      people.ensureMe('me')
      const cy = people.create({ name: 'Cy' })
      const item = planning.createWorkItem(
        'project-one',
        { title: 'Paint', assigneeId: cy.id },
        { kind: 'human' }
      )

      people.archive(cy.id)

      expect(people.list().map((person) => person.name)).toEqual(['me'])
      expect(people.list({ includeArchived: true }).map((person) => person.name)).toContain('Cy')
      expect(planning.getWorkItem(item.id).assigneeId).toBe(cy.id)
      expect(() => people.setMe(cy.id)).toThrow('Bring this person back first')
      expect(people.unarchive(cy.id).archivedAt).toBeNull()
      expect(() => people.archive(people.getMe()!.id)).toThrow(/before archiving yourself/)
    })
  })

  describe('task fields', () => {
    it('sets, clears and refuses an unknown assignee', () => {
      const ada = people.create({ name: 'Ada' })
      const item = planning.createWorkItem(
        'project-one',
        { title: 'Write', assigneeId: ada.id },
        { kind: 'human' }
      )
      expect(item.assigneeId).toBe(ada.id)
      expect(
        planning.updateWorkItem(item.id, { assigneeId: null }, { kind: 'human' }).assigneeId
      ).toBeNull()
      expect(() =>
        planning.updateWorkItem(item.id, { assigneeId: 'nobody' }, { kind: 'human' })
      ).toThrow('That person does not exist')
      expect(() =>
        planning.createWorkItem(
          'project-one',
          { title: 'Other', assigneeId: 'nobody' },
          { kind: 'human' }
        )
      ).toThrow('That person does not exist')
    })

    it('refuses a start date after the due date, on create and on update', () => {
      expect(() =>
        planning.createWorkItem(
          'project-one',
          {
            title: 'Backwards',
            startDate: '2026-10-21',
            targetDate: '2026-10-20'
          },
          { kind: 'human' }
        )
      ).toThrow('The start date is after the due date')

      const item = planning.createWorkItem(
        'project-one',
        {
          title: 'Forwards',
          startDate: '2026-10-20',
          targetDate: '2026-10-20'
        },
        { kind: 'human' }
      )
      expect(item).toMatchObject({ startDate: '2026-10-20', targetDate: '2026-10-20' })
      expect(() =>
        planning.updateWorkItem(item.id, { targetDate: '2026-10-19' }, { kind: 'human' })
      ).toThrow('The start date is after the due date')
      expect(() =>
        planning.updateWorkItem(item.id, { startDate: '2026-02-30' }, { kind: 'human' })
      ).toThrow('Start date is invalid')
      // Clearing the due date lifts the rule.
      expect(
        planning.updateWorkItem(
          item.id,
          { targetDate: null, startDate: '2027-01-01' },
          { kind: 'human' }
        )
      ).toMatchObject({ startDate: '2027-01-01', targetDate: null })
    })

    it('takes an estimate from 0 to 1000', () => {
      const item = planning.createWorkItem(
        'project-one',
        { title: 'Size me', estimate: 0 },
        { kind: 'human' }
      )
      expect(item.estimate).toBe(0)
      expect(planning.updateWorkItem(item.id, { estimate: 1000 }, { kind: 'human' }).estimate).toBe(
        1000
      )
      expect(planning.updateWorkItem(item.id, { estimate: 2.5 }, { kind: 'human' }).estimate).toBe(
        2.5
      )
      expect(
        planning.updateWorkItem(item.id, { estimate: null }, { kind: 'human' }).estimate
      ).toBeNull()
      expect(() => planning.updateWorkItem(item.id, { estimate: 1001 }, { kind: 'human' })).toThrow(
        'The estimate must be from 0 to 1000'
      )
      expect(() => planning.updateWorkItem(item.id, { estimate: -1 }, { kind: 'human' })).toThrow(
        'The estimate must be from 0 to 1000'
      )
      expect(() =>
        planning.updateWorkItem(item.id, { estimate: '3' as unknown as number }, { kind: 'human' })
      ).toThrow('The estimate must be a number')
    })
  })

  describe('checklist', () => {
    it('ticks and unticks items without moving the task', () => {
      const item = planning.createWorkItem(
        'project-one',
        {
          title: 'Ship',
          status: 'done',
          acceptanceCriteria: ['Docs', 'Tests', 'Review']
        },
        { kind: 'human' }
      )
      expect(item.checkedCriteria).toEqual([])

      planning.setChecklistItemChecked(item.id, 'Review', true, { kind: 'human' })
      const ticked = planning.setChecklistItemChecked(item.id, 'Docs', true, { kind: 'human' })
      expect(ticked.checkedCriteria).toEqual(['Docs', 'Review'])
      expect(planning.listWorkItems('project-one')[0].checkedCriteria).toEqual(['Docs', 'Review'])

      const unticked = planning.setChecklistItemChecked(item.id, 'Docs', false, { kind: 'human' })
      expect(unticked.checkedCriteria).toEqual(['Review'])
      expect(unticked.status).toBe('done')
      expect(() =>
        planning.setChecklistItemChecked(item.id, 'Nope', true, { kind: 'human' })
      ).toThrow('not on this task')
    })

    it('deletes the ticks of texts that leave the acceptance criteria', () => {
      const item = planning.createWorkItem(
        'project-one',
        {
          title: 'Ship',
          acceptanceCriteria: ['Docs', 'Tests']
        },
        { kind: 'human' }
      )
      planning.setChecklistItemChecked(item.id, 'Docs', true, { kind: 'human' })
      planning.setChecklistItemChecked(item.id, 'Tests', true, { kind: 'human' })

      // Reordered and one reworded: the kept text keeps its tick.
      const updated = planning.updateWorkItem(
        item.id,
        {
          acceptanceCriteria: ['Unit tests', 'Docs']
        },
        { kind: 'human' }
      )
      expect(updated.checkedCriteria).toEqual(['Docs'])

      // Putting the old text back does not resurrect its tick.
      expect(
        planning.updateWorkItem(
          item.id,
          { acceptanceCriteria: ['Docs', 'Tests'] },
          { kind: 'human' }
        ).checkedCriteria
      ).toEqual(['Docs'])
      expect(planning.getWorkItem(item.id).checkedCriteria).toEqual(['Docs'])
    })

    it('still sends agents every checklist item as an acceptance criterion', () => {
      const item = planning.createWorkItem(
        'project-one',
        {
          title: 'Ship',
          acceptanceCriteria: ['Docs', 'Tests']
        },
        { kind: 'human' }
      )
      const ticked = planning.setChecklistItemChecked(item.id, 'Docs', true, { kind: 'human' })
      const text = formatPlanningTaskDetails(ticked)
      expect(text).toBe(formatPlanningTaskDetails({ ...ticked, checkedCriteria: [] }))
      expect(text).toContain('Docs')
      expect(text).toContain('Tests')
    })
  })

  describe('labels', () => {
    it('lists every label in the project with a stored or default colour', () => {
      planning.createWorkItem(
        'project-one',
        { title: 'A', labels: ['design', 'ux'] },
        { kind: 'human' }
      )
      planning.createWorkItem('project-one', { title: 'B', labels: ['design'] }, { kind: 'human' })
      planning.createWorkItem(
        'project-two',
        { title: 'C', labels: ['elsewhere'] },
        { kind: 'human' }
      )

      const labels = planning.listProjectLabels('project-one')
      expect(labels.map((label) => [label.name, label.taskCount, label.hasColor])).toEqual([
        ['design', 2, false],
        ['ux', 1, false]
      ])
      // The default colour is stable.
      expect(planning.listProjectLabels('project-one')[0].color).toBe(labels[0].color)

      expect(planning.setLabelColor('project-one', 'design', '#EC4899')).toMatchObject({
        color: '#ec4899',
        hasColor: true
      })
      expect(() => planning.setLabelColor('project-one', 'design', 'red')).toThrow(
        'A colour must look like'
      )
    })

    it('renames a label on every task in the project, keeping its colour', () => {
      const a = planning.createWorkItem(
        'project-one',
        { title: 'A', labels: ['ux', 'design'] },
        { kind: 'human' }
      )
      const b = planning.createWorkItem(
        'project-one',
        { title: 'B', labels: ['design'] },
        { kind: 'human' }
      )
      const other = planning.createWorkItem(
        'project-two',
        { title: 'C', labels: ['design'] },
        { kind: 'human' }
      )
      planning.setLabelColor('project-one', 'design', '#ec4899')

      const renamed = planning.renameLabel('project-one', 'design', 'ux', { kind: 'human' })
      expect(renamed).toMatchObject({ name: 'ux', color: '#ec4899', taskCount: 2 })
      // A task that already had the new name keeps one copy.
      expect(planning.getWorkItem(a.id).labels).toEqual(['ux'])
      expect(planning.getWorkItem(b.id).labels).toEqual(['ux'])
      expect(planning.getWorkItem(other.id).labels).toEqual(['design'])
      expect(() => planning.renameLabel('project-one', 'gone', 'x', { kind: 'human' })).toThrow(
        'No task has the label "gone"'
      )
    })

    it('deletes a label from every task, and restores it for undo', () => {
      const a = planning.createWorkItem(
        'project-one',
        { title: 'A', labels: ['design', 'ux'] },
        { kind: 'human' }
      )
      const b = planning.createWorkItem(
        'project-one',
        { title: 'B', labels: ['design'] },
        { kind: 'human' }
      )
      planning.setLabelColor('project-one', 'design', '#ec4899')

      const deletion = planning.deleteLabel('project-one', 'design', { kind: 'human' })
      expect(deletion).toEqual({
        name: 'design',
        color: '#ec4899',
        workItemIds: expect.arrayContaining([a.id, b.id])
      })
      expect(planning.getWorkItem(a.id).labels).toEqual(['ux'])
      expect(planning.getWorkItem(b.id).labels).toEqual([])
      expect(planning.listProjectLabels('project-one').map((label) => label.name)).toEqual(['ux'])

      planning.restoreLabel('project-one', deletion, { kind: 'human' })
      expect(planning.getWorkItem(a.id).labels).toEqual(['ux', 'design'])
      expect(planning.getWorkItem(b.id).labels).toEqual(['design'])
      expect(
        planning.listProjectLabels('project-one').find((label) => label.name === 'design')
      ).toMatchObject({ color: '#ec4899', taskCount: 2 })
    })
  })
})
