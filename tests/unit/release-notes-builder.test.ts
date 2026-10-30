import { describe, expect, it } from 'vitest'
import type { PlanningIteration, PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import type { PlanningTaskType } from '@shared/ostler-api/task-type-types'
import {
  buildReleaseNotes,
  escapeMarkdown,
  firstSentence,
  missingTaskTitles,
  type ReleaseNotesOptions,
  type ReleaseNotesSource
} from '@shared/release-notes'
import { makeWorkItem } from '../renderer/fixtures/planning-records'

const milestone: PlanningMilestone = {
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Version 1.2',
  outcome: '',
  targetDate: null,
  successCriteria: [],
  status: 'active',
  createdAt: 0,
  updatedAt: 0
}
const source: ReleaseNotesSource = { kind: 'milestone', milestone }

function type(id: string, name: string, position: number): PlanningTaskType {
  return {
    id,
    projectId: 'p1',
    name,
    icon: 'bug',
    color: '#000000',
    position,
    createdAt: 0,
    updatedAt: 0
  }
}
const types = [type('feature', 'Feature', 1), type('bug', 'Bug', 0), type('chore', 'Chore', 2)]

function done(id: string, overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return makeWorkItem(id, { milestoneId: 'm1', status: 'done', title: `Task ${id}`, ...overrides })
}

const options = (overrides: Partial<ReleaseNotesOptions> = {}): ReleaseNotesOptions => ({
  groupBy: 'none',
  descriptions: false,
  subtasks: false,
  ...overrides
})

function build(items: PlanningWorkItem[], overrides: Partial<ReleaseNotesOptions> = {}) {
  return buildReleaseNotes(
    { source, items, taskTypes: types, today: '2026-10-16' },
    options(overrides)
  )
}

describe('release notes', () => {
  it('writes a title, the day, a count and a bullet per finished task', () => {
    const notes = build([done('a'), done('b')])
    expect(notes.title).toBe('Release notes: Version 1.2')
    const lines = notes.markdown.split('\n')
    expect(lines[0]).toBe('# Release notes: Version 1.2')
    expect(lines[2]).toContain('2026')
    expect(lines[4]).toBe('2 tasks finished')
    expect(notes.markdown).toContain('- Task a\n- Task b\n')
  })

  it('uses the day a complete milestone was reached', () => {
    const reached = new Date(2026, 2, 5).getTime()
    const notes = buildReleaseNotes(
      {
        source: {
          kind: 'milestone',
          milestone: { ...milestone, status: 'complete', updatedAt: reached }
        },
        items: [],
        taskTypes: [],
        today: '2026-10-16'
      },
      options()
    )
    expect(notes.markdown).toMatch(/March 2026|2026.*3|5.*2026/)
    expect(notes.markdown).toContain('0 tasks finished')
  })

  it('keeps archived done tasks and leaves out binned, won’t-do, open and other milestones’ tasks', () => {
    const notes = build([
      done('kept'),
      done('archived', { archivedAt: 5 }),
      done('binned', { deletedAt: 5 }),
      done('wont', { resolution: 'wont-do', archivedAt: 5 }),
      done('open', { status: 'active' }),
      done('elsewhere', { milestoneId: 'm2' })
    ])
    expect(notes.taskTitles).toEqual(['Task kept', 'Task archived'])
  })

  it('groups by type in the project’s order, then Other', () => {
    const notes = build(
      [
        done('a', { typeId: 'feature' }),
        done('b'),
        done('c', { typeId: 'bug' }),
        done('d', { typeId: 'gone' })
      ],
      { groupBy: 'type' }
    )
    const headings = notes.markdown.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toEqual(['## Bug', '## Feature', '## Other'])
    expect(notes.markdown).toContain('## Other\n\n- Task b\n- Task d\n')
  })

  it('groups by first label, in name order, with unlabelled tasks under Other', () => {
    const notes = build(
      [done('a', { labels: ['ui', 'api'] }), done('b', { labels: ['api'] }), done('c')],
      { groupBy: 'label' }
    )
    expect(notes.markdown).toContain(
      '## api\n\n- Task b\n\n## ui\n\n- Task a\n\n## Other\n\n- Task c\n'
    )
  })

  it('adds first sentences when asked', () => {
    const items = [done('a', { description: 'Adds dark mode. Also tidies the menu.' })]
    expect(build(items).markdown).toContain('- Task a\n')
    expect(build(items, { descriptions: true }).markdown).toContain('- Task a: Adds dark mode.\n')
  })

  it('leaves subtasks out by default and lists them under their parent when asked', () => {
    const items = [
      done('parent'),
      done('child', { parentWorkItemId: 'parent' }),
      done('grandchild', { parentWorkItemId: 'child' }),
      done('orphan', { parentWorkItemId: 'open-parent' })
    ]
    expect(build(items).taskTitles).toEqual(['Task parent'])
    const notes = build(items, { subtasks: true })
    expect(notes.markdown).toContain(
      '- Task parent\n  - Task child\n    - Task grandchild\n- Task orphan\n'
    )
    expect(notes.markdown).toContain('4 tasks finished')
  })

  it('escapes Markdown characters in titles so they cannot break the note', () => {
    const notes = build([
      done('a', { title: '1. Fix *all* [links](x) # <b>' }),
      done('b', { title: '- dash' })
    ])
    expect(notes.markdown).toContain('- 1\\. Fix \\*all\\* \\[links\\]\\(x\\) \\# \\<b\\>\n')
    expect(notes.markdown).toContain('- \\- dash\n')
    expect(escapeMarkdown('a_b|c')).toBe('a\\_b\\|c')
  })

  it('builds for an iteration from its tasks', () => {
    const iteration: PlanningIteration = {
      id: 'i1',
      projectId: 'p1',
      name: 'Sprint 4',
      startDate: '2026-10-01',
      endDate: '2026-10-14',
      goal: '',
      status: 'active',
      summary: null,
      finishedAt: null,
      createdAt: 0,
      updatedAt: 0
    }
    const notes = buildReleaseNotes(
      {
        source: { kind: 'iteration', iteration },
        items: [done('a', { iterationId: 'i1' }), done('b')],
        taskTypes: [],
        today: '2026-10-16'
      },
      options()
    )
    expect(notes.title).toBe('Release notes: Sprint 4')
    expect(notes.taskTitles).toEqual(['Task a'])
  })

  it('stays quick for 500 tasks', () => {
    const items = Array.from({ length: 500 }, (_, index) =>
      done(`t${index}`, { typeId: index % 2 ? 'bug' : null, description: 'One. Two.' })
    )
    const started = performance.now()
    const notes = build(items, { groupBy: 'type', descriptions: true })
    expect(performance.now() - started).toBeLessThan(200)
    expect(notes.taskTitles).toHaveLength(500)
  })
})

describe('firstSentence', () => {
  it('takes the first sentence of the first paragraph on one line', () => {
    expect(firstSentence('\n\nFirst line\nwraps here! Then more.')).toBe('First line wraps here!')
    expect(firstSentence('No full stop')).toBe('No full stop')
    expect(firstSentence('v1.2 ships. Next')).toBe('v1.2 ships.')
    expect(firstSentence('x'.repeat(400))).toHaveLength(240)
  })
})

describe('missingTaskTitles', () => {
  it('names the titles a polished draft left out, ignoring case and escapes', () => {
    expect(
      missingTaskTitles(
        ['Fix *all* links', 'Dark mode', 'Gone'],
        'We **fix \\*ALL\\* links** and added dark   mode.'
      )
    ).toEqual(['Gone'])
  })
})
