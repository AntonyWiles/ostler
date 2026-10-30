import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeCsv, decodeCsv } from '../../src/shared/import/csv-import'
import { detectCsvPreset } from '../../src/shared/import/csv-presets'
import type { ImportTaskDraft } from '../../src/shared/import/import-plan'

/** R4.2: presets for other tools' CSV exports, detected from the header. */

const known = { milestones: [], people: [] }
const read = (name: string) =>
  decodeCsv(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'import', name))))

function analyze(name: string, options = {}, locale = 'en-GB') {
  const result = analyzeCsv(read(name), options, known, locale)
  const byTitle = (title: string): ImportTaskDraft => {
    const task = result.plan.tasks.find((entry) => entry.title === title)
    if (!task) throw new Error(`No task ${title}`)
    return task
  }
  const lineOf = (title: string) => byTitle(title).line
  const warningsOf = (title: string) =>
    result.preview.rows.find((row) => row.title === title)?.warnings.map((issue) => issue.field)
  return { ...result, byTitle, lineOf, warningsOf }
}

/** Every task comes after its parent and what it waits on. */
function expectCreatableOrder(tasks: ImportTaskDraft[]) {
  const seen = new Set<number>()
  for (const task of tasks) {
    if (task.parentLine !== undefined) expect(seen.has(task.parentLine)).toBe(true)
    for (const line of task.waitsOnLines ?? []) expect(seen.has(line)).toBe(true)
    seen.add(task.line)
  }
}

describe('Asana', () => {
  it('is detected and imports statuses, dates, people, subtasks, dependencies and tags', () => {
    const { preview, plan, byTitle, lineOf, warningsOf } = analyze('asana-export.csv')
    expect(preview.preset).toBe('asana')
    expect(preview.detectedPreset).toBe('asana')
    expect(preview.dateFormat).toBe('iso')
    expect(byTitle('Plan the fair')).toMatchObject({
      status: 'backlog',
      priority: 'high',
      assigneeName: 'Alex Chen',
      startDate: '2026-10-01',
      dueDate: '2026-10-20',
      labels: ['planning', 'fair'],
      description: 'Kick-off with the committee'
    })
    // "Completed At" wins over the section.
    expect(byTitle('Book the venue')).toMatchObject({ status: 'done', priority: 'medium' })
    expect(byTitle('Print the posters').status).toBe('active')
    expect(byTitle('Write the running order').parentLine).toBe(lineOf('Plan the fair'))
    // Named on both sides (Blocking and Blocked By): one link.
    expect(byTitle('Send the invitations').waitsOnLines).toEqual([lineOf('Book the venue')])
    // A dependency outside the file is a problem on its row, not dropped silently.
    expect(byTitle('Print the posters').waitsOnLines).toBeUndefined()
    expect(warningsOf('Print the posters')).toEqual(['waitsOn'])
    expect(preview.subtaskCount).toBe(1)
    expect(preview.dependencyCount).toBe(1)
    expect(preview.newPeople).toEqual(['Alex Chen', 'Sam Lee'])
    expectCreatableOrder(plan.tasks)
  })
})

describe('Jira', () => {
  it('is detected and imports statuses, priorities, dates, sprints, subtasks and links', () => {
    const { preview, plan, byTitle, lineOf, warningsOf } = analyze('jira-export.csv')
    expect(preview.preset).toBe('jira')
    expect(byTitle('Set up the build')).toMatchObject({
      status: 'active',
      priority: 'high',
      assigneeName: 'Alex Chen',
      dueDate: '2026-10-20',
      labels: ['backend', 'ci'],
      milestoneName: 'Sprint 1',
      estimate: 3,
      description: 'Pipeline for every branch'
    })
    expect(byTitle('Deploy to staging')).toMatchObject({ status: 'backlog', priority: 'critical' })
    expect(byTitle('Fix the flaky test')).toMatchObject({
      status: 'ready',
      priority: 'low',
      dueDate: '2026-11-03'
    })
    // "Parent id" names the numeric issue id.
    expect(byTitle('Write the build script')).toMatchObject({
      status: 'done',
      parentLine: lineOf('Set up the build')
    })
    // Outward "Blocks" on NEX-1 and inward on NEX-2 are the same link.
    expect(byTitle('Deploy to staging').waitsOnLines).toEqual([lineOf('Set up the build')])
    expect(warningsOf('Fix the flaky test')).toEqual(['waitsOn'])
    expectCreatableOrder(plan.tasks)
  })
})

describe('Linear', () => {
  it('is detected and imports statuses, priorities, milestones, sub-issues and labels', () => {
    const { preview, plan, byTitle, lineOf } = analyze('linear-export.csv')
    expect(preview.preset).toBe('linear')
    expect(byTitle('Ship the onboarding')).toMatchObject({
      status: 'active',
      priority: 'high',
      assigneeName: 'Alex Chen',
      labels: ['Feature', 'Frontend'],
      dueDate: '2026-10-30',
      estimate: 3,
      milestoneName: 'Beta'
    })
    expect(byTitle('Add the welcome screen')).toMatchObject({
      status: 'ready',
      priority: 'critical',
      parentLine: lineOf('Ship the onboarding')
    })
    expect(byTitle('Remove the old flow')).toMatchObject({ status: 'done', priority: 'medium' })
    expect(byTitle('Write the help page')).toMatchObject({ status: 'done', priority: 'low' })
    expectCreatableOrder(plan.tasks)
  })
})

describe('Microsoft Planner', () => {
  it('is detected and imports progress, priorities, buckets, checklists and US dates', () => {
    const { preview, byTitle, warningsOf } = analyze('planner-export.csv', {}, 'en-US')
    expect(preview.preset).toBe('planner')
    expect(byTitle('Order the chairs')).toMatchObject({
      status: 'active',
      priority: 'high',
      assigneeName: 'Alex Chen',
      milestoneName: 'Venue',
      startDate: '2026-10-01',
      dueDate: '2026-10-15',
      labels: ['Pink', 'Blue'],
      checklist: [
        { text: 'Count the guests', checked: false },
        { text: 'Ask for a quote', checked: false }
      ]
    })
    // Two people assigned: the first is kept, with a warning.
    expect(warningsOf('Order the chairs')).toEqual(['assignee'])
    expect(byTitle('Book the band')).toMatchObject({ status: 'done', priority: 'critical' })
    expect(byTitle('Choose the songs')).toMatchObject({ status: 'backlog', priority: 'low' })
    expect(preview.newMilestones).toEqual(['Venue', 'Music'])
  })
})

describe('Todoist', () => {
  it('is detected and imports sections, priorities, indents, labels and people', () => {
    const { preview, plan, byTitle, lineOf, warningsOf } = analyze('todoist-export.csv')
    expect(preview.preset).toBe('todoist')
    // Sections and notes are not tasks.
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Paint the hallway',
      'Pick a colour',
      'Ask for samples',
      'Compare the samples',
      'Fix the shelf'
    ])
    expect(byTitle('Paint the hallway')).toMatchObject({
      line: 3,
      status: 'backlog',
      priority: 'critical',
      labels: ['home', 'weekend'],
      assigneeName: 'Evan',
      dueDate: '2026-10-20',
      description: 'Matte white'
    })
    expect(byTitle('Pick a colour').parentLine).toBe(lineOf('Paint the hallway'))
    expect(byTitle('Ask for samples').parentLine).toBe(lineOf('Pick a colour'))
    // A fourth level comes in on its own, with a warning.
    expect(byTitle('Compare the samples').parentLine).toBeUndefined()
    expect(warningsOf('Compare the samples')).toEqual(['parent'])
    expect(byTitle('Fix the shelf')).toMatchObject({
      line: 9,
      status: 'active',
      priority: 'high',
      assigneeName: 'Mia',
      dueDate: null
    })
    // "every day" is a repeat, not a date.
    expect(warningsOf('Fix the shelf')).toEqual(['due'])
    expect(preview.subtaskCount).toBe(2)
  })
})

describe('detection and choice', () => {
  it('a CSV that matches no preset is mapped as before', () => {
    const { preview } = analyzeCsv(
      { text: 'Title,Status,Parent\nA,Doing,\nB,Done,A\n', encoding: 'utf-8' },
      {},
      known,
      'en-GB'
    )
    expect(preview.preset).toBeNull()
    expect(preview.detectedPreset).toBeNull()
    expect(preview.columns.parent).toBeNull()
    expect(preview.subtaskCount).toBe(0)
    expect(preview.customColumns.map((column) => column.header)).toEqual(['Parent'])
  })

  it('"Map columns myself" turns a detected preset off, and every mapping still changes', () => {
    const off = analyze('asana-export.csv', { preset: 'none' })
    expect(off.preview.preset).toBeNull()
    expect(off.preview.detectedPreset).toBe('asana')
    expect(off.preview.columns.parent).toBeNull()
    const changed = analyze('asana-export.csv', {
      columns: { parent: null },
      statusMap: { 'To do': 'ready' }
    })
    expect(changed.byTitle('Write the running order')).toMatchObject({ status: 'ready' })
    expect(changed.byTitle('Write the running order').parentLine).toBeUndefined()
  })

  it('a plain CSV can map its own parent and dependency columns', () => {
    const { plan } = analyzeCsv(
      { text: 'Title,Parent,After\nA,,\nB,A,\nC,A,B\nD,,C\n', encoding: 'utf-8' },
      { columns: { parent: 1, waitsOn: 2 } },
      known,
      'en-GB'
    )
    const line = (title: string) => plan.tasks.find((task) => task.title === title)!
    expect(line('B').parentLine).toBe(2)
    expect(line('C')).toMatchObject({ parentLine: 2, waitsOnLines: [3] })
    // D is not under A, but a task of its own may wait on anything.
    expect(line('D').waitsOnLines).toEqual([4])
  })

  it('refuses links that would loop or reach outside a subtask’s parent', () => {
    const { plan, preview } = analyzeCsv(
      {
        text: 'Title,Parent,After\nA,,B\nB,,A\nC,A,\nD,,\nE,D,C\n',
        encoding: 'utf-8'
      },
      { columns: { parent: 1, waitsOn: 2 } },
      known,
      'en-GB'
    )
    const task = (title: string) => plan.tasks.find((entry) => entry.title === title)!
    expect(task('A').waitsOnLines).toEqual([3])
    expect(task('B').waitsOnLines).toBeUndefined()
    expect(task('E').waitsOnLines).toBeUndefined()
    const warned = preview.rows.filter((row) => row.warnings.length > 0).map((row) => row.title)
    expect(warned).toEqual(['B', 'E'])
    expectCreatableOrder(plan.tasks)
  })

  it('detects each fixture as its own tool', () => {
    for (const [file, id] of [
      ['asana-export.csv', 'asana'],
      ['jira-export.csv', 'jira'],
      ['linear-export.csv', 'linear'],
      ['planner-export.csv', 'planner'],
      ['todoist-export.csv', 'todoist']
    ]) {
      const headers = read(file).text.split('\n')[0].split(',')
      expect(detectCsvPreset(headers)?.id).toBe(id)
    }
  })
})
