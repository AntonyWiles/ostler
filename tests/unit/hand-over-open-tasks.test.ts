import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' } as const

/** Removing a person from a shared project hands their open tasks there to someone else. */
describe('handing over open tasks', () => {
  const tempDir = useTempDir('ostler-hand-over-')
  let planning: PlanningService
  let people: PeopleService
  const projectIds = ['garden', 'kitchen']

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => projectIds)
    people = new PeopleService(databasePath, (id) => projectIds.includes(id))
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const task = (projectId: string, title: string, assigneeId: string | null) =>
    planning.createWorkItem(projectId, { title, assigneeId }, human)

  it('moves open tasks in that project only, leaving done tasks and other projects', () => {
    const ben = people.create({ name: 'Ben' })
    const cy = people.create({ name: 'Cy' })
    const open = task('garden', 'Dig', ben.id)
    const finished = task('garden', 'Plant', ben.id)
    planning.updateWorkItem(finished.id, { status: 'done' }, human)
    const elsewhere = task('kitchen', 'Cook', ben.id)

    expect(people.handOverOpenTasks('garden', ben.id, cy.id)).toBe(1)

    expect(planning.getWorkItem(open.id)?.assigneeId).toBe(cy.id)
    expect(planning.getWorkItem(finished.id)?.assigneeId).toBe(ben.id)
    expect(planning.getWorkItem(elsewhere.id)?.assigneeId).toBe(ben.id)
  })

  it('can leave the tasks with nobody, and refuses a taker who cannot take them', () => {
    const ben = people.create({ name: 'Ben' })
    const kitchener = people.create({ name: 'Kitchener', projectId: 'kitchen' })
    const open = task('garden', 'Dig', ben.id)

    expect(() => people.handOverOpenTasks('garden', ben.id, kitchener.id)).toThrow()
    expect(planning.getWorkItem(open.id)?.assigneeId).toBe(ben.id)
    expect(() => people.handOverOpenTasks('garden', ben.id, ben.id)).toThrow()

    expect(people.handOverOpenTasks('garden', ben.id, null)).toBe(1)
    expect(planning.getWorkItem(open.id)?.assigneeId).toBeNull()
  })
})
