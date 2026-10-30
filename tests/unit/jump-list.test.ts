import { describe, expect, it } from 'vitest'
import { buildJumpList, quoteArgument, recentProjects } from '../../electron/app/desktop/jump-list'

const base = {
  program: 'C:/Program Files/Ostler/Ostler.exe',
  baseArgs: [],
  scheme: 'ostler',
  iconPath: 'C:/Program Files/Ostler/resources/icons/icon.ico'
}

describe('buildJumpList', () => {
  it('has New task and Inbox as tasks that start Ostler with a deep link', () => {
    const [tasks] = buildJumpList({ ...base, recentProjects: [] })
    expect(tasks.type).toBe('tasks')
    expect(tasks.items?.map((item) => [item.title, item.args])).toEqual([
      ['New task', 'ostler://quick-add'],
      ['Inbox', 'ostler://inbox']
    ])
    expect(tasks.items?.[0].program).toBe(base.program)
  })

  it('offers Stop timer first while a timer runs, as an argument rather than a link (R2.3)', () => {
    const [tasks] = buildJumpList({ ...base, recentProjects: [], timerRunning: true })
    expect(tasks.items?.map((item) => [item.title, item.args])).toEqual([
      ['Stop timer', '--stop-timer'],
      ['New task', 'ostler://quick-add'],
      ['Inbox', 'ostler://inbox']
    ])
  })

  it('adds Recent projects only when there are some', () => {
    expect(buildJumpList({ ...base, recentProjects: [] })).toHaveLength(1)
    const list = buildJumpList({
      ...base,
      recentProjects: [{ id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Website' }]
    })
    expect(list[1]).toMatchObject({ type: 'custom', name: 'Recent projects' })
    expect(list[1].items?.[0]).toMatchObject({
      title: 'Website',
      args: 'ostler://project/0f8fad5b-d9cb-469f-a165-70867728950e/overview'
    })
  })

  it("puts a development run's app folder and data folder before the link, quoted", () => {
    const [tasks] = buildJumpList({
      ...base,
      baseArgs: ['C:/ostler dashboard', '--ostler-user-data=C:/temp/scratch'],
      recentProjects: []
    })
    expect(tasks.items?.[1].args).toBe(
      '"C:/ostler dashboard" --ostler-user-data=C:/temp/scratch ostler://inbox'
    )
    expect(quoteArgument('plain')).toBe('plain')
  })
})

describe('recentProjects', () => {
  const projects = [
    { id: 'a', name: 'A', enabled: true, addedAt: 1 },
    { id: 'b', name: 'B', enabled: true, addedAt: 3 },
    { id: 'c', name: 'C', enabled: false, addedAt: 4 },
    { id: 'd', name: 'D', enabled: true, addedAt: 2 }
  ]

  it('lists opened projects first, then the newest added, never archived or removed ones', () => {
    expect(recentProjects(projects, ['a', 'gone', 'c']).map((project) => project.id)).toEqual([
      'a',
      'b',
      'd'
    ])
  })
})
