import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PeopleService } from '../../electron/services/people-service'
import { TeamService } from '../../electron/services/team-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Teams (team-leaders plan, D1): named groups of address-book people with an optional lead.
 * They grant nothing; the service only keeps them tidy.
 */
describe('teams', () => {
  const tempDir = useTempDir('ostler-teams-')
  let people: PeopleService
  let teams: TeamService

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    people = new PeopleService(databasePath, (id) => id === 'garden')
    teams = new TeamService(databasePath)
  })

  afterEach(() => {
    teams.close()
    people.close()
  })

  describe('create and edit', () => {
    it('makes a team with a lead and members, in the order made', () => {
      const ada = people.create({ name: 'Ada' })
      const bo = people.create({ name: 'Bo' })
      const design = teams.create({
        name: '  Design ',
        leadPersonId: ada.id,
        memberIds: [ada.id, bo.id, ada.id]
      })
      const site = teams.create({ name: 'Site crew' })

      expect(design).toMatchObject({
        name: 'Design',
        leadPersonId: ada.id,
        memberIds: [ada.id, bo.id],
        archivedAt: null
      })
      expect(design.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(site.memberIds).toEqual([])
      expect(teams.list().map((team) => team.name)).toEqual(['Design', 'Site crew'])
      expect(site.position).toBeGreaterThan(design.position)
    })

    it('renames, recolours, changes and clears the lead', () => {
      const ada = people.create({ name: 'Ada' })
      const team = teams.create({ name: 'Design' })

      expect(teams.update(team.id, { name: 'Studio', color: '#ef4444' })).toMatchObject({
        name: 'Studio',
        color: '#ef4444'
      })
      expect(teams.update(team.id, { leadPersonId: ada.id }).leadPersonId).toBe(ada.id)
      expect(teams.update(team.id, { leadPersonId: null }).leadPersonId).toBeNull()
    })

    it('needs a name and a real colour', () => {
      expect(() => teams.create({ name: '   ' })).toThrow(/name is required/)
      expect(() => teams.create({ name: 'x'.repeat(81) })).toThrow(/at most 80/)
      expect(() => teams.create({ name: 'Design', color: 'blue' })).toThrow(/colour/)
      const team = teams.create({ name: 'Design' })
      expect(() => teams.update(team.id, { name: '' })).toThrow(/name is required/)
      expect(() => teams.update('missing', { name: 'x' })).toThrow(/not found/)
    })
  })

  describe('members', () => {
    it('sets exactly the members given', () => {
      const ada = people.create({ name: 'Ada' })
      const bo = people.create({ name: 'Bo' })
      const cy = people.create({ name: 'Cy' })
      const team = teams.create({ name: 'Design', memberIds: [ada.id, bo.id] })

      expect(teams.setMembers(team.id, [bo.id, cy.id]).memberIds).toEqual([bo.id, cy.id])
      expect(teams.setMembers(team.id, []).memberIds).toEqual([])
    })

    it('lets Me be a member, but not a person who belongs to one project', () => {
      const me = people.create({ name: 'Me' })
      people.setMe(me.id)
      const gardener = people.create({ name: 'Gardener', projectId: 'garden' })
      const team = teams.create({ name: 'Home', memberIds: [me.id] })

      expect(team.memberIds).toEqual([me.id])
      expect(() => teams.setMembers(team.id, [gardener.id])).toThrow(/address book/)
      expect(() => teams.create({ name: 'Crew', leadPersonId: gardener.id })).toThrow(
        /address book/
      )
      expect(() => teams.setMembers(team.id, ['nobody'])).toThrow(/address book/)
    })
  })

  describe('when a person goes', () => {
    it('clears the lead and takes the person out of the team when they are deleted', () => {
      const ada = people.create({ name: 'Ada' })
      const bo = people.create({ name: 'Bo' })
      const team = teams.create({
        name: 'Design',
        leadPersonId: ada.id,
        memberIds: [ada.id, bo.id]
      })

      people.delete(ada.id, { giveTasksTo: null })

      expect(teams.get(team.id)).toMatchObject({ leadPersonId: null, memberIds: [bo.id] })
    })

    it('keeps an archived person in the team', () => {
      const ada = people.create({ name: 'Ada' })
      const team = teams.create({ name: 'Design', leadPersonId: ada.id, memberIds: [ada.id] })

      people.archive(ada.id)

      expect(teams.get(team.id)).toMatchObject({ leadPersonId: ada.id, memberIds: [ada.id] })
    })
  })

  describe('archive and delete', () => {
    it('hides an archived team from the list unless asked, and brings it back', () => {
      const keep = teams.create({ name: 'Keep' })
      const old = teams.create({ name: 'Old' })

      const archived = teams.archive(old.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(teams.list().map((team) => team.id)).toEqual([keep.id])
      expect(teams.list({ includeArchived: true }).map((team) => team.id)).toEqual([
        keep.id,
        old.id
      ])

      expect(teams.restore(old.id).archivedAt).toBeNull()
      expect(teams.list()).toHaveLength(2)
    })

    it('deletes a team and its members, and leaves the people', () => {
      const ada = people.create({ name: 'Ada' })
      const team = teams.create({ name: 'Design', memberIds: [ada.id] })

      teams.delete(team.id)

      expect(teams.list({ includeArchived: true })).toEqual([])
      expect(people.get(ada.id).name).toBe('Ada')
      expect(() => teams.delete(team.id)).toThrow(/not found/)
    })
  })
})
