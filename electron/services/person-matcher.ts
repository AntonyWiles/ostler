import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { paletteColorFor } from '@shared/project-colors'
import { DEFAULT_WORKING_DAYS } from '@shared/ostler-api'
import { PeopleRepository } from './database/people-repository'

/**
 * Finds the person a package or an import names, or creates them. It knows
 * the people the project can be given work to: the address book and the
 * project's own (D5, migration 78), never another project's. Archived people
 * count, so an import never makes a second "Alex Chen". New people go in the
 * address book, or with `ownPeople` (a demo) in the project itself, so they
 * leave with it. Packages match names exactly; imports ignore case, since
 * other tools write names however they like. `created` lists the people
 * added, so a failed project creation can take them away again.
 */
export class PersonMatcher {
  readonly created: string[] = []
  private readonly repository: PeopleRepository
  private readonly known: { id: string; name: string }[]

  constructor(
    db: Database.Database,
    private readonly ignoreCase: boolean,
    private readonly projectId: string,
    private readonly ownPeople = false
  ) {
    this.repository = new PeopleRepository(db)
    this.known = this.repository
      .list(true)
      .filter((person) =>
        ownPeople
          ? person.projectId === projectId
          : person.projectId === null || person.projectId === projectId
      )
      .map(({ id, name }) => ({ id, name }))
  }

  private same(a: string, b: string): boolean {
    return this.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
  }

  resolve(name: string, initials = '', color: string | null = null): string {
    const match = this.known.find((person) => this.same(person.name, name))
    if (match) return match.id
    const id = uuidv4()
    this.repository.insert({
      id,
      name,
      initials,
      color: color ?? paletteColorFor(id),
      isMe: false,
      weeklyCapacityHours: null,
      workingDays: [...DEFAULT_WORKING_DAYS],
      projectId: this.ownPeople ? this.projectId : null,
      at: Date.now()
    })
    this.known.push({ id, name })
    this.created.push(id)
    return id
  }
}
