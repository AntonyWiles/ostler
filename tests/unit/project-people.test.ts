import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { DaysOffService } from '../../electron/services/days-off-service'
import { PERSONAL_TABLES } from '../../electron/services/sync/synced-tables'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' } as const

/**
 * People in two places (migration 78): the address book, offered in every
 * project, and a project's own people, offered only there. And deleting a
 * person, with their work handed on or left unassigned.
 */
describe('project people and deleting people', () => {
  const tempDir = useTempDir('ostler-project-people-')
  let databasePath: string
  let planning: PlanningService
  let people: PeopleService
  const projectIds = ['garden', 'kitchen']

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => projectIds)
    people = new PeopleService(databasePath, (id) => projectIds.includes(id))
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const task = (projectId: string, title: string, assigneeId: string | null = null) =>
    planning.createWorkItem(projectId, { title, assigneeId }, human)

  describe('where people live', () => {
    it('keeps a project person to their project, and the address book everywhere', () => {
      const ada = people.create({ name: 'Ada' })
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      expect(ada.projectId).toBeNull()
      expect(gardener.projectId).toBe('garden')

      expect(task('garden', 'Dig', gardener.id).assigneeId).toBe(gardener.id)
      expect(task('kitchen', 'Cook', ada.id).assigneeId).toBe(ada.id)
      expect(() => task('kitchen', 'Weed', gardener.id)).toThrow(
        'That person belongs to another project'
      )
      const cook = task('kitchen', 'Bake')
      expect(() => planning.updateWorkItem(cook.id, { assigneeId: gardener.id }, human)).toThrow(
        'That person belongs to another project'
      )
      expect(() =>
        planning.setRecurrence(
          cook.id,
          { rule: { every: 'week', interval: 1 }, rotation: [ada.id, gardener.id] },
          human
        )
      ).toThrow('That person belongs to another project')

      expect(people.offeredIn('garden').map((person) => person.name)).toEqual(['Ada', 'Gardener'])
      expect(people.offeredIn('kitchen').map((person) => person.name)).toEqual(['Ada'])
    })

    it('refuses a project that does not exist, and a project person as Me', () => {
      expect(() => people.create({ name: 'Nobody', projectId: 'attic' })).toThrow(
        'Project not found'
      )
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      expect(() => people.setMe(gardener.id)).toThrow('Only someone in Settings › People')
    })

    it('sends only the address book to your other PCs, without project_id', () => {
      expect(PERSONAL_TABLES.people.skipRow).toContain('project_id IS NOT NULL')
      expect(PERSONAL_TABLES.people.omitColumns).toContain('project_id')
    })

    it('gives days off only to people in the address book', () => {
      const ada = people.create({ name: 'Ada' })
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      const daysOff = new DaysOffService(databasePath, {
        personExists: (id) => people.inAddressBook(id),
        today: () => '2026-10-16'
      })
      try {
        expect(
          daysOff.create({ firstDate: '2026-12-01', name: 'Leave', personId: ada.id }).personId
        ).toBe(ada.id)
        expect(() =>
          daysOff.create({ firstDate: '2026-12-02', name: 'Leave', personId: gardener.id })
        ).toThrow()
      } finally {
        daysOff.close()
      }
    })
  })

  describe('deleting a person', () => {
    it('says where their work is, by project', () => {
      const sam = people.create({ name: 'Sam' })
      task('garden', 'Dig', sam.id)
      task('garden', 'Weed', sam.id)
      const party = task('kitchen', 'Party')
      planning.updateWorkItem(party.id, { acceptanceCriteria: ['Cake'] }, human)
      planning.setChecklistItemDetails(party.id, 'Cake', { assigneeId: sam.id }, human)
      expect(people.usage(sam.id)).toEqual({
        projects: [
          { projectId: 'garden', tasks: 2 },
          { projectId: 'kitchen', tasks: 1 }
        ],
        rules: 0,
        isMe: false,
        sharedMember: false
      })
    })

    it('gives their tasks, checklist items, turns and rules to someone else', () => {
      const me = people.ensureMe('Me')
      const sam = people.create({ name: 'Sam' })
      const jo = people.create({ name: 'Jo' })
      const dig = task('garden', 'Dig', sam.id)
      planning.updateWorkItem(dig.id, { acceptanceCriteria: ['Spade'] }, human)
      planning.setChecklistItemDetails(dig.id, 'Spade', { assigneeId: sam.id }, human)
      const bins = task('garden', 'Bins')
      planning.setRecurrence(
        bins.id,
        { rule: { every: 'week', interval: 1 }, rotation: [jo.id, sam.id], nextIndex: 1 },
        human
      )
      const rule = planning.rules.create('garden', {
        name: 'Hand over',
        enabled: true,
        trigger: { kind: 'statusChanged', to: 'review' },
        conditions: [],
        actions: [{ kind: 'setAssignee', personId: sam.id }]
      })

      people.delete(sam.id, { giveTasksTo: me.id })

      expect(planning.getWorkItem(dig.id).assigneeId).toBe(me.id)
      expect(planning.getWorkItem(dig.id).checklistDetails).toEqual([
        expect.objectContaining({ text: 'Spade', assigneeId: me.id })
      ])
      expect(planning.getRecurrence(bins.id)).toMatchObject({
        rotation: [jo.id, me.id],
        nextIndex: 1
      })
      expect(planning.rules.get(rule.id)).toMatchObject({
        enabled: true,
        actions: [{ kind: 'setAssignee', personId: me.id }]
      })
      expect(people.exists(sam.id)).toBe(false)
    })

    it('leaves their tasks unassigned, takes them out of turns and turns rules off', () => {
      const sam = people.create({ name: 'Sam' })
      const jo = people.create({ name: 'Jo' })
      const dig = task('garden', 'Dig', sam.id)
      const bins = task('garden', 'Bins')
      planning.setRecurrence(
        bins.id,
        { rule: { every: 'week', interval: 1 }, rotation: [sam.id, jo.id], nextIndex: 1 },
        human
      )
      const rule = planning.rules.create('garden', {
        name: 'Sam’s',
        enabled: true,
        trigger: { kind: 'statusChanged', to: 'review' },
        conditions: [{ kind: 'assignee', op: 'is', personId: sam.id }],
        actions: [{ kind: 'addComment', text: 'Done?' }]
      })
      expect(people.usage(sam.id).rules).toBe(1)

      people.delete(sam.id, { giveTasksTo: null })

      expect(planning.getWorkItem(dig.id).assigneeId).toBeNull()
      // Jo was next, and still is.
      expect(planning.getRecurrence(bins.id)).toMatchObject({ rotation: [jo.id], nextIndex: 0 })
      expect(planning.rules.get(rule.id).enabled).toBe(false)
    })

    it('removes their days off', () => {
      const sam = people.create({ name: 'Sam' })
      const daysOff = new DaysOffService(databasePath, {
        personExists: (id) => people.exists(id),
        today: () => '2026-10-16'
      })
      try {
        daysOff.create({ firstDate: '2026-12-01', name: 'Leave', personId: sam.id })
        people.delete(sam.id, { giveTasksTo: null })
        expect(daysOff.list({})).toEqual([])
      } finally {
        daysOff.close()
      }
    })

    it('refuses Me, a member of a shared project, and a taker who cannot take the work', () => {
      const me = people.ensureMe('Me')
      expect(() => people.delete(me.id, { giveTasksTo: null })).toThrow(
        'You can’t delete yourself'.replace('’', "'")
      )

      const ann = people.create({ name: 'Ann' })
      const db = new Database(databasePath)
      try {
        db.prepare(
          `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, joined_at)
           VALUES ('share', 'member', ?, 'Ann', 'key', 0)`
        ).run(ann.id)
        expect(people.usage(ann.id).sharedMember).toBe(true)
        expect(() => people.delete(ann.id, { giveTasksTo: null })).toThrow('shared project')
        // Removed from the share, Ann can go.
        db.prepare('UPDATE sync_members SET removed_at = 1 WHERE person_id = ?').run(ann.id)
      } finally {
        db.close()
      }
      people.delete(ann.id, { giveTasksTo: null })
      expect(people.exists(ann.id)).toBe(false)

      const sam = people.create({ name: 'Sam' })
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      task('garden', 'Dig', sam.id)
      task('kitchen', 'Cook', sam.id)
      expect(() => people.delete(sam.id, { giveTasksTo: gardener.id })).toThrow('Gardener can')
      expect(() => people.delete(sam.id, { giveTasksTo: sam.id })).toThrow('someone else')
      expect(people.exists(sam.id)).toBe(true)
    })

    it('lets a project person take a project person’s work in the same project', () => {
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      const helper = people.create({ name: 'Helper', projectId: 'garden' })
      const dig = task('garden', 'Dig', gardener.id)
      people.delete(gardener.id, { giveTasksTo: helper.id })
      expect(planning.getWorkItem(dig.id).assigneeId).toBe(helper.id)
    })
  })
})
