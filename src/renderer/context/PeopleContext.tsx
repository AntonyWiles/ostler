import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CreatePersonInput, Person } from '@shared/ostler-api'
import { PROJECT_COLORS } from '@shared/project-colors'
import { unwrapResult } from '../utils/unwrap-result'

/**
 * People you assign work to (P5.1), read once for the whole app: the address
 * book and every project's own people, in one list that every project's
 * drawer, cards and filters share. Main pushes `people` whenever the list
 * changes, from the app or the automation API, and the list is read again.
 */
export interface PeopleState {
  /** Everyone, archived people included: a task keeps showing its archived assignee. */
  all: Person[]
  /** Everyone not archived, every project's own people included. Me first. */
  active: Person[]
  /**
   * People to offer in a project's pickers: the address book and that
   * project's own, not archived. Me first. With null, the address book only.
   */
  offered: (projectId: string | null) => Person[]
  me: Person | null
  byId: Map<string, Person>
  loaded: boolean
  refresh: () => Promise<void>
  /** Adds a person and returns them; throws with the reason on failure. */
  createPerson: (input: CreatePersonInput) => Promise<Person>
}

const EMPTY: PeopleState = {
  all: [],
  active: [],
  offered: () => [],
  me: null,
  byId: new Map(),
  loaded: false,
  refresh: async () => {},
  createPerson: async () => {
    throw new Error('People are not available here')
  }
}

const PeopleContext = createContext<PeopleState>(EMPTY)

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = useState<Person[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.getPeople({ includeArchived: true })
    if (result.ok) setAll(result.value)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'people') void refresh()
    })
  }, [refresh])

  const createPerson = useCallback(
    async (input: CreatePersonInput) => {
      const person = unwrapResult(await window.ostlerAPI.createPerson(input))
      await refresh()
      return person
    },
    [refresh]
  )

  const value = useMemo<PeopleState>(() => {
    const active = all.filter((person) => person.archivedAt === null)
    return {
      all,
      active,
      offered: (projectId) => offeredIn(active, projectId),
      me: all.find((person) => person.isMe) ?? null,
      byId: new Map(all.map((person) => [person.id, person])),
      loaded,
      refresh,
      createPerson
    }
  }, [all, loaded, refresh, createPerson])

  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
}

/** Fixed people, for a component rendered on its own (tests, the component gallery). */
export function StaticPeopleProvider({
  people,
  children
}: {
  people: Person[]
  children: ReactNode
}) {
  const value = useMemo<PeopleState>(
    () => ({
      ...EMPTY,
      all: people,
      active: people.filter((person) => person.archivedAt === null),
      offered: (projectId) =>
        offeredIn(
          people.filter((person) => person.archivedAt === null),
          projectId
        ),
      me: people.find((person) => person.isMe) ?? null,
      byId: new Map(people.map((person) => [person.id, person])),
      loaded: true,
      createPerson: async (input) => ({
        id: `new-${input.name}`,
        name: input.name,
        initials: '',
        color: PROJECT_COLORS[0],
        isMe: false,
        archivedAt: null,
        weeklyCapacityHours: null,
        workingDays: [1, 2, 3, 4, 5],
        projectId: input.projectId ?? null,
        createdAt: 0,
        updatedAt: 0
      })
    }),
    [people]
  )
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>
}

/** The address book and `projectId`'s own people: one rule for every project picker. */
export function offeredIn(people: readonly Person[], projectId: string | null): Person[] {
  return people.filter((person) => person.projectId === null || person.projectId === projectId)
}

export function usePeople(): PeopleState {
  return useContext(PeopleContext)
}
