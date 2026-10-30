import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PACKAGE_TASKS,
  packageCreationOrder,
  relativePackageDate,
  resolvePackageDate,
  validateProjectPackage
} from '../../src/shared/project-package'
import { BUILT_IN_TEMPLATES } from '../../src/shared/templates'

function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'ostler-project-package',
    version: 1,
    project: { name: 'Party' },
    milestones: [{ ref: 'm1', name: 'Booked' }],
    tasks: [
      { ref: 't1', title: 'Book the hall', milestoneRef: 'm1' },
      { ref: 't2', title: 'Send invites', dependsOnRefs: ['t1'] }
    ],
    ...extra
  }
}

function refusal(json: unknown): string {
  const result = validateProjectPackage(json)
  if (result.ok) throw new Error('Expected the package to be refused')
  return result.error
}

describe('validateProjectPackage', () => {
  it('accepts a small package and fills in the optional fields', () => {
    const result = validateProjectPackage(base())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tasks[0]).toMatchObject({
      status: 'backlog',
      priority: 'medium',
      labels: [],
      checklist: [],
      parentRef: null,
      recurrence: null
    })
    expect(result.value.people).toEqual([])
    expect(result.value.project.estimateUnit).toBe('points')
  })

  it('refuses unknown fields, with their path', () => {
    expect(refusal(base({ extra: 1 }))).toBe('package.extra is not a field this format has')
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[1].colour = 'red'
    expect(refusal(json)).toBe('tasks[1].colour is not a field this format has')
  })

  it('refuses a ref that does not resolve', () => {
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[0].milestoneRef = 'm9'
    expect(refusal(json)).toBe("tasks[0].milestoneRef 'm9' does not match any milestone")
    const deps = base()
    ;(deps.tasks as Record<string, unknown>[])[1].dependsOnRefs = ['t7']
    expect(refusal(deps)).toBe("tasks[1].dependsOnRefs[0] 't7' does not match any task")
    expect(refusal(base({ milestones: [{ ref: 'm1', name: 'Booked', goalRef: 'g1' }] }))).toBe(
      "milestones[0].goalRef 'g1' does not match any goal"
    )
    const assignee = base()
    ;(assignee.tasks as Record<string, unknown>[])[0].assigneeRef = 'p1'
    expect(refusal(assignee)).toBe("tasks[0].assigneeRef 'p1' does not match any person")
    expect(
      refusal(base({ decisions: [{ title: 'Venue', decision: 'Hall', taskRefs: ['t3'] }] }))
    ).toBe("decisions[0].taskRefs[0] 't3' does not match any task")
  })

  it('refuses a ref used twice', () => {
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[1].ref = 't1'
    expect(refusal(json)).toBe("tasks[1].ref 't1' is used twice")
  })

  it('refuses dependency and subtask loops', () => {
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[0].dependsOnRefs = ['t2']
    expect(refusal(json)).toMatch(/is part of a dependency loop$/)
    const parents = base({
      tasks: [
        { ref: 'a', title: 'A', parentRef: 'b' },
        { ref: 'b', title: 'B', parentRef: 'a' }
      ]
    })
    expect(refusal(parents)).toMatch(/is part of a subtask loop$/)
  })

  it('refuses unknown statuses and priorities', () => {
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[0].status = 'doing'
    expect(refusal(json)).toBe(
      "tasks[0].status 'doing' is not one of backlog, ready, active, blocked, review, done"
    )
    const priority = base()
    ;(priority.tasks as Record<string, unknown>[])[0].priority = 'urgent'
    expect(refusal(priority)).toBe(
      "tasks[0].priority 'urgent' is not one of low, medium, high, critical"
    )
    expect(refusal(base({ milestones: [{ ref: 'm1', name: 'Booked', status: 'late' }] }))).toBe(
      "milestones[0].status 'late' is not one of planned, active, complete, archived"
    )
  })

  it('refuses a package over the size caps', () => {
    const many = Array.from({ length: MAX_PACKAGE_TASKS + 1 }, (_, i) => ({
      ref: `t${i}`,
      title: 'x'
    }))
    expect(refusal(base({ milestones: [], tasks: many }))).toBe(
      `The package has ${MAX_PACKAGE_TASKS + 1} tasks; a package may hold at most ${MAX_PACKAGE_TASKS}`
    )
    const long = Array.from({ length: 150 }, (_, i) => ({
      ref: `t${i}`,
      title: 'x',
      description: 'y'.repeat(7000)
    }))
    expect(refusal(base({ milestones: [], tasks: long }))).toBe(
      'The package is larger than the 1 MB of text a package may hold'
    )
  })

  it('refuses the wrong format or version, bad dates and bad colours', () => {
    expect(refusal(base({ format: 'trello' }))).toBe(
      "package.format must be 'ostler-project-package'"
    )
    expect(refusal(base({ version: 2 }))).toMatch(/^package.version 2 is not supported/)
    const dated = base()
    ;(dated.tasks as Record<string, unknown>[])[0].dueDate = 'next week'
    expect(refusal(dated)).toBe(
      "tasks[0].dueDate 'next week' must be a date like 2026-10-20, or relative like +14d or +2w"
    )
    expect(refusal(base({ labels: [{ name: 'a', color: 'red' }] }))).toBe(
      "labels[0].color 'red' must be a colour like #3b82f6"
    )
    expect(refusal(null)).toBe('The package must be an object')
  })

  it('refuses a subtask depending on a task outside its parent', () => {
    const json = base({
      tasks: [
        { ref: 'p', title: 'Parent' },
        { ref: 'o', title: 'Other' },
        { ref: 'c', title: 'Child', parentRef: 'p', dependsOnRefs: ['o'] }
      ]
    })
    expect(refusal(json)).toBe("tasks[2].dependsOnRefs[0] 'o' must be a subtask of the same parent")
  })

  it('refuses a repeat without a due date, and a bad repeat rule', () => {
    const json = base()
    ;(json.tasks as Record<string, unknown>[])[0].recurrence = {
      rule: { every: 'week', interval: 1 }
    }
    expect(refusal(json)).toBe('tasks[0].recurrence needs the task to have a dueDate')
    const rule = base()
    ;(rule.tasks as Record<string, unknown>[])[0].dueDate = '+1d'
    ;(rule.tasks as Record<string, unknown>[])[0].recurrence = { rule: { every: 'hour' } }
    expect(refusal(rule)).toBe(
      'tasks[0].recurrence: A repeat rule needs every: day, week, month or year'
    )
  })
})

describe('relative dates', () => {
  const today = '2026-10-09'

  it('resolves days and weeks, forward and back, from a given day', () => {
    expect(resolvePackageDate('+14d', today)).toBe('2026-10-23')
    expect(resolvePackageDate('-3d', today)).toBe('2026-10-06')
    expect(resolvePackageDate('+2w', today)).toBe('2026-10-23')
    expect(resolvePackageDate('+0d', today)).toBe('2026-10-09')
    expect(resolvePackageDate('+30d', '2026-12-15')).toBe('2027-01-14')
    expect(resolvePackageDate('2026-11-01', today)).toBe('2026-11-01')
    expect(resolvePackageDate(null, today)).toBeNull()
  })

  it('turns a day into an offset that resolves back to it', () => {
    expect(relativePackageDate('2026-10-23', today)).toBe('+14d')
    expect(relativePackageDate('2026-10-06', today)).toBe('-3d')
    expect(relativePackageDate('2026-10-09', today)).toBe('+0d')
    expect(resolvePackageDate(relativePackageDate('2027-03-01', today), today)).toBe('2027-03-01')
  })
})

describe('packageCreationOrder', () => {
  it('puts parents and dependencies before the tasks that name them', () => {
    const result = validateProjectPackage(
      base({
        milestones: [],
        tasks: [
          { ref: 'c', title: 'C', dependsOnRefs: ['b'] },
          { ref: 'b', title: 'B', parentRef: 'a' },
          { ref: 'a', title: 'A' }
        ]
      })
    )
    if (!result.ok) throw new Error(result.error)
    expect(packageCreationOrder(result.value.tasks).map((task) => task.ref)).toEqual([
      'a',
      'b',
      'c'
    ])
  })
})

describe('built-in templates', () => {
  const folder = path.resolve(__dirname, '../../src/shared/templates')
  const files = fs.readdirSync(folder).filter((file) => file.endsWith('.json'))

  it('ships every template the brief lists, and the two demo projects', () => {
    expect(files.map((file) => file.replace('.json', '')).sort()).toEqual(
      [...BUILT_IN_TEMPLATES.map((entry) => entry.id)].sort()
    )
    expect(files).toHaveLength(11)
  })

  // As the app reads them: the demo projects' money only has a currency then.
  it.each(BUILT_IN_TEMPLATES.map((entry) => entry.id))(
    '%s is a valid package with a description and icon',
    (id) => {
      const result = validateProjectPackage(
        BUILT_IN_TEMPLATES.find((entry) => entry.id === id)!.json
      )
      if (!result.ok) throw new Error(`${id}: ${result.error}`)
      expect(result.value.template?.description).toBeTruthy()
      expect(result.value.template?.icon).toBeTruthy()
    }
  )
})
