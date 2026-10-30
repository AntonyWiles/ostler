import { describe, expect, it } from 'vitest'
import { SCALE, buildScalePlan } from '../../electron/app/dev-seed/scale-plan'
import { calendarText } from '../../electron/app/dev-seed/seed-scale'
import { readIcsCalendar } from '../../src/shared/import/ics-read'

describe('the scale dataset plan (P9.1)', () => {
  const plan = buildScalePlan()

  it('holds what the brief asks for', () => {
    const tasks = plan.projects.flatMap((project) => project.tasks)
    expect(plan.projects).toHaveLength(50)
    expect(plan.projects.filter((project) => project.withFolder)).toHaveLength(5)
    expect(plan.projects[0].tasks).toHaveLength(5_000)
    expect(plan.projects[1].tasks).toHaveLength(500)
    expect(tasks.reduce((sum, task) => sum + task.path.length, 0)).toBe(SCALE.statusChanges)
    expect(plan.comments).toHaveLength(3_000)
    expect(plan.libraryItems).toHaveLength(300)
    expect(plan.savedViews).toHaveLength(40)
    for (const kind of ['labels', 'checklist', 'dependsOn'] as const) {
      expect(tasks.some((task) => task[kind].length > 0)).toBe(true)
    }
    expect(tasks.some((task) => task.parent !== null)).toBe(true)
    expect(tasks.some((task) => task.assignee !== null && task.dueOffset !== null)).toBe(true)
  })

  it('holds what later work added, so perf measures it too', () => {
    const { extras } = plan
    const tasks = plan.projects.flatMap((project) => project.tasks)
    // About seven in ten tasks have a type, some with values for its fields.
    expect(extras.typed.size / tasks.length).toBeGreaterThan(0.6)
    expect(extras.typed.size / tasks.length).toBeLessThan(0.8)
    expect([...extras.typed.values()].some((typed) => typed.values.size > 0)).toBe(true)
    for (const typed of extras.typed.values()) {
      for (const [field, value] of typed.values) {
        // Only the type's own fields, with a value the field accepts.
        expect(extras.taskTypes[typed.type].fields).toContain(field)
        if (extras.fields[field].type === 'choice')
          expect(value).toBeLessThan(extras.fields[field].options.length)
      }
    }
    expect(extras.checklistDates.length).toBeGreaterThan(1_000)
    for (const [projectIndex, taskIndex, item] of extras.checklistDates) {
      const task = plan.projects[projectIndex].tasks[taskIndex]
      // Unticked items only: a dated item is one still to do.
      expect(item).toBeGreaterThanOrEqual(task.checked)
      expect(item).toBeLessThan(task.checklist.length)
    }
    expect(extras.links).toHaveLength(SCALE.taskLinks)
    expect(new Set(extras.links.map((link) => link[3]))).toEqual(
      new Set(['relates', 'duplicates', 'copied-from'])
    )
    const pairs = new Set<string>()
    for (const [projectIndex, from, to] of extras.links) {
      expect(from).not.toBe(to)
      const pair = `${projectIndex}:${Math.min(from, to)}:${Math.max(from, to)}`
      expect(pairs.has(pair)).toBe(false)
      pairs.add(pair)
    }
    expect(extras.timeBlocks).toHaveLength(SCALE.timeBlocks)
    for (const [, , , start, length] of extras.timeBlocks) {
      expect(start % 15).toBe(0)
      expect(length % 15).toBe(0)
      expect(start + length).toBeLessThanOrEqual(24 * 60)
    }
    expect(extras.costs).toHaveLength(SCALE.costs)
    expect(extras.budgets.length).toBeGreaterThan(0)
    expect(extras.calendarEvents).toHaveLength(SCALE.calendarEvents)
    expect(extras.calendarEvents.some((event) => event.weekdays)).toBe(true)
    expect(extras.pins).toHaveLength(SCALE.sidebarPins)
    for (const [projectIndex, taskIndex] of extras.pins) {
      // A countdown needs a due date ahead.
      expect(plan.projects[projectIndex].tasks[taskIndex].dueOffset).toBeGreaterThan(0)
    }
  })

  it('writes the outside calendar as .ics text Ostler reads, the stand-up repeating', () => {
    const text = calendarText(plan.extras.calendarEvents, '2026-10-19')
    const read = readIcsCalendar(text, { timeZone: 'Europe/London' })
    expect(read.events).toHaveLength(SCALE.calendarEvents)
    expect(read.skippedCount).toBe(0)
    expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
  })

  it('leaves the first plan as it was, so older numbers still compare', () => {
    // The extras draw from a random stream of their own: the tasks the first
    // plan made are unchanged by them.
    const first = plan.projects[1].tasks.slice(0, 3).map((task) => task.title)
    expect(first).toEqual([
      'Update hiring brief #1',
      'Write press kit #2',
      'Check the budget report #3'
    ])
  })

  it('is the same every time, so runs compare', () => {
    expect(buildScalePlan()).toEqual(plan)
  })

  it('links only earlier, top-level tasks, which the services accept', () => {
    for (const project of plan.projects) {
      for (const task of project.tasks) {
        if (task.parent !== null) {
          expect(task.parent).toBeLessThan(task.index)
          expect(project.tasks[task.parent].parent).toBeNull()
          expect(task.dependsOn).toEqual([])
        }
        for (const dependency of task.dependsOn) {
          expect(dependency).toBeLessThan(task.index)
          expect(project.tasks[dependency].parent).toBeNull()
        }
        expect(task.checked).toBeLessThanOrEqual(task.checklist.length)
      }
    }
  })
})
