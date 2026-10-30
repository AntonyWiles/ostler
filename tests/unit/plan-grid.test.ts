import { describe, expect, it } from 'vitest'
import {
  PLAN_GRID_MAX_DEPTH,
  clampPlanDepths,
  indentPlanRow,
  planBatchRows,
  planGridSummary,
  planRowsToCreate,
  planRowsFromText,
  waitsOnCandidates,
  type PlanRow
} from '../../src/shared/plan-grid'
import type { QuickAddContext } from '../../src/shared/quick-add'

const context: QuickAddContext = {
  today: '2026-10-12',
  locale: 'en-NZ',
  people: [{ id: 'ada', name: 'Ada Lovelace' }],
  labels: ['docs'],
  projects: []
}

/** Ids are the line numbers, so the tests read plainly. */
function parse(text: string): PlanRow[] {
  let next = 0
  return planRowsFromText(text, context, () => `row-${next++}`)
}

function row(overrides: Partial<PlanRow> & Pick<PlanRow, 'id' | 'title'>): PlanRow {
  return {
    depth: 0,
    assigneeId: null,
    startDate: '',
    dueDate: '',
    estimate: null,
    waitsOn: [],
    milestoneId: '',
    labels: '',
    priority: null,
    ...overrides
  }
}

describe('planRowsFromText', () => {
  it('makes one row per line and skips blank lines', () => {
    const rows = parse('Draft the brief\n\n   \nReview the brief')
    expect(rows.map((entry) => entry.title)).toEqual(['Draft the brief', 'Review the brief'])
    expect(rows.every((entry) => entry.depth === 0)).toBe(true)
  })

  it('reads a leading tab, or two spaces, as one level of subtask', () => {
    const rows = parse('Build\n\tWrite the form\n\t\tCheck the labels\n  Test the form\nShip')
    expect(rows.map((entry) => entry.depth)).toEqual([0, 1, 2, 1, 0])
  })

  it('will not indent a line more than one level below the line above', () => {
    const rows = parse('Build\n\t\t\tWay too deep')
    expect(rows[1].depth).toBe(1)
    expect(rows[1].depth).toBeLessThanOrEqual(PLAN_GRID_MAX_DEPTH)
  })

  it('does not treat a first line as a subtask of nothing', () => {
    expect(parse('  Indented first')[0].depth).toBe(0)
  })

  it('reads quick-add tokens on each line: labels, people, priority and dates', () => {
    const [first, second] = parse('Write the copy #docs @ada !high friday\nPublish it on 3/4/27')
    expect(first).toMatchObject({
      title: 'Write the copy',
      labels: 'docs',
      assigneeId: 'ada',
      priority: 'high',
      dueDate: '2026-10-16'
    })
    expect(second).toMatchObject({ title: 'Publish it', dueDate: '2027-04-03' })
  })

  it('keeps a name nobody matches in the title, as quick add does', () => {
    expect(parse('Ask @nobody about it')[0].title).toBe('Ask @nobody about it')
  })

  it('leaves the other cells empty, so the person can fill them in the grid', () => {
    expect(parse('Plain task')[0]).toMatchObject({
      assigneeId: null,
      startDate: '',
      dueDate: '',
      estimate: null,
      waitsOn: [],
      milestoneId: ''
    })
  })
})

describe('indentPlanRow', () => {
  it('makes a row a subtask of the row above, and moves the rows under it with it', () => {
    const rows = [
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: 'B' }),
      row({ id: 'c', title: 'C', depth: 1 }),
      row({ id: 'd', title: 'D' })
    ]
    const next = indentPlanRow(rows, 1, 1)
    expect(next?.map((entry) => entry.depth)).toEqual([0, 1, 2, 0])
  })

  it('refuses to indent the first row, or past the level below the row above', () => {
    const rows = [row({ id: 'a', title: 'A' }), row({ id: 'b', title: 'B' })]
    expect(indentPlanRow(rows, 0, 1)).toBeNull()
    const deeper = [row({ id: 'a', title: 'A' }), row({ id: 'b', title: 'B', depth: 1 })]
    expect(indentPlanRow(deeper, 1, 1)).toBeNull()
  })

  it('refuses to indent a row whose own subtasks would go past the limit', () => {
    const rows = [
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: 'B', depth: 1 }),
      row({ id: 'c', title: 'C', depth: 2 }),
      row({ id: 'd', title: 'D', depth: 1 })
    ]
    expect(indentPlanRow(rows, 3, 1)).not.toBeNull()
    expect(indentPlanRow(rows, 1, 1)).toBeNull()
  })

  it('outdents a row and the rows under it, and never past the top', () => {
    const rows = [
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: 'B', depth: 1 }),
      row({ id: 'c', title: 'C', depth: 2 })
    ]
    expect(indentPlanRow(rows, 1, -1)?.map((entry) => entry.depth)).toEqual([0, 0, 1])
    expect(indentPlanRow(rows, 0, -1)).toBeNull()
  })
})

describe('planBatchRows', () => {
  it('names the rows of the plan so the service links subtasks and dependencies', () => {
    const rows: PlanRow[] = [
      row({ id: 'design', title: 'Design', dueDate: '2026-10-20' }),
      row({
        id: 'build',
        title: 'Build',
        waitsOn: [{ kind: 'row', rowId: 'design' }],
        estimate: 5,
        labels: 'web, api'
      }),
      row({ id: 'tests', title: 'Tests', depth: 1 })
    ]
    const batch = planBatchRows(rows)
    expect(batch[0]).toMatchObject({ title: 'Design', targetDate: '2026-10-20', estimate: null })
    expect(batch[1]).toMatchObject({
      title: 'Build',
      dependencyRefs: [batch[0].ref],
      estimate: 5,
      labels: ['web', 'api']
    })
    expect(batch[2]).toMatchObject({ title: 'Tests', parentRef: batch[1].ref })
    expect(new Set(batch.map((entry) => entry.ref)).size).toBe(3)
  })

  it("sends existing tasks as dependency ids, and leaves a blank milestone unset so a subtask can take its parent's", () => {
    const rows: PlanRow[] = [
      row({
        id: 'a',
        title: 'A',
        milestoneId: 'launch',
        waitsOn: [{ kind: 'task', taskId: 'existing-1' }]
      }),
      row({ id: 'b', title: 'B', depth: 1 })
    ]
    const [first, second] = planBatchRows(rows)
    expect(first).toMatchObject({ milestoneId: 'launch', dependencyIds: ['existing-1'] })
    expect(second).not.toHaveProperty('milestoneId')
  })
})

describe('planGridSummary', () => {
  it('counts tasks, subtasks and dependencies', () => {
    const rows: PlanRow[] = [
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: 'B', depth: 1, waitsOn: [{ kind: 'row', rowId: 'a' }] }),
      row({
        id: 'c',
        title: 'C',
        waitsOn: [
          { kind: 'row', rowId: 'a' },
          { kind: 'task', taskId: 'x' }
        ]
      })
    ]
    expect(planGridSummary(rows)).toEqual({ tasks: 2, subtasks: 1, dependencies: 3 })
  })
})

describe('planRowsToCreate', () => {
  it('leaves out a blank row and does not count a wait on it', () => {
    const rows = planRowsToCreate([
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: ' ' }),
      row({ id: 'c', title: 'C', waitsOn: [{ kind: 'row', rowId: 'b' }] })
    ])
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(planGridSummary(rows).dependencies).toBe(0)
  })

  it('keeps a blank row with titled subtasks, so its subtasks stay under it', () => {
    const rows = planRowsToCreate([
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: '' }),
      row({ id: 'c', title: 'C', depth: 1 })
    ])
    expect(rows.map((entry) => [entry.id, entry.depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1]
    ])
    expect(planBatchRows(rows)[2].parentRef).toBe('r1')
  })
})

describe('waitsOnCandidates', () => {
  it('offers the rows above for a task, and only its earlier siblings for a subtask', () => {
    const rows = [
      row({ id: 'a', title: 'A' }),
      row({ id: 'b', title: 'B', depth: 1 }),
      row({ id: 'c', title: 'C', depth: 1 }),
      row({ id: 'd', title: 'D' })
    ]
    expect(waitsOnCandidates(rows, 1).map((entry) => entry.id)).toEqual([])
    expect(waitsOnCandidates(rows, 2).map((entry) => entry.id)).toEqual(['b'])
    expect(waitsOnCandidates(rows, 3).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('clampPlanDepths', () => {
  it('keeps the first row a task and no row more than one level below the one above', () => {
    const rows = [
      row({ id: 'a', title: 'A', depth: 2 }),
      row({ id: 'b', title: 'B', depth: 2 }),
      row({ id: 'c', title: 'C', depth: 0 }),
      row({ id: 'd', title: 'D', depth: 1 })
    ]
    expect(clampPlanDepths(rows).map((entry) => entry.depth)).toEqual([0, 1, 0, 1])
  })

  it('leaves a tree that already follows the rules as it is', () => {
    const rows = [row({ id: 'a', title: 'A' }), row({ id: 'b', title: 'B', depth: 1 })]
    expect(clampPlanDepths(rows)).toBe(rows)
  })
})
