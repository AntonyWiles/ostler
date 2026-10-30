import { describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'
import { csvField, tasksToCsv, TASK_CSV_COLUMNS } from '../../src/shared/export/task-csv'
import { analyzeCsv, decodeCsv } from '../../src/shared/import/csv-import'

function task(fields: Partial<PlanningWorkItem>): PlanningWorkItem {
  return {
    id: 't1',
    projectId: 'p1',
    milestoneId: null,
    title: 'Task',
    description: '',
    status: 'backlog',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    checkedCriteria: [],
    origin: 'human',
    linkedHarnessTaskId: null,
    autoQueue: false,
    parentWorkItemId: null,
    taskCode: '',
    phaseCode: '',
    phaseName: '',
    subtaskPhaseNumber: null,
    subtaskPhaseName: '',
    verificationStatus: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: '',
    createdAt: new Date(2026, 9, 1, 9, 5).getTime(),
    updatedAt: new Date(2026, 9, 2, 14, 30).getTime(),
    archivedAt: null,
    deletedAt: null,
    ...fields
  }
}

const context = {
  personName: (id: string) => (id === 'p-ana' ? 'Ana Lima' : null),
  milestoneName: (id: string) => (id === 'm1' ? 'Beta' : null),
  commentCount: (id: string) => (id === 't1' ? 2 : 0),
  estimateUnit: 'points' as const
}

describe('CSV export', () => {
  it('starts with a BOM and ends every record with CRLF', () => {
    const text = tasksToCsv([task({})], ['title', 'status'], context)
    expect(text.startsWith('\ufeffTitle,Status\r\n')).toBe(true)
    expect(text).toBe('\ufeffTitle,Status\r\nTask,Backlog\r\n')
  })

  it('quotes per RFC 4180: commas, semicolons, quotes and new lines', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('a; b')).toBe('"a; b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField('café')).toBe('café')
  })

  it('never lets a cell run as a spreadsheet formula', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('-3')).toBe('-3')
    expect(csvField('-2+3')).toBe("'-2+3")
  })

  it('writes every column as the List shows it', () => {
    const text = tasksToCsv(
      [
        task({
          title: 'Plan, then do',
          description: 'Line one\nLine two',
          status: 'active',
          priority: 'high',
          assigneeId: 'p-ana',
          startDate: '2026-10-01',
          targetDate: '2026-10-20',
          estimate: 3,
          milestoneId: 'm1',
          labels: ['design', 'web'],
          acceptanceCriteria: ['Draft', 'Review'],
          checkedCriteria: ['Draft']
        })
      ],
      TASK_CSV_COLUMNS,
      context
    )
    const [header, row] = text.slice(1).split('\r\n')
    expect(header).toBe(
      'Title,Description,Status,Priority,Assignee,Start,Due,Estimate (points),Milestone,Labels,Checklist,Comments,Updated,Created'
    )
    expect(row).toBe(
      '"Plan, then do","Line one\nLine two",In progress,High,Ana Lima,2026-10-01,2026-10-20,3,Beta,"design; web","[x] Draft\n[ ] Review",2,2026-10-02 14:30,2026-10-01 09:05'
    )
  })

  it('reads back through the CSV import', () => {
    const text = tasksToCsv(
      [
        task({
          title: 'Café, opening',
          status: 'review',
          priority: 'critical',
          targetDate: '2026-10-20',
          labels: ['a', 'b'],
          acceptanceCriteria: ['One', 'Two'],
          checkedCriteria: ['Two'],
          estimate: 2.5
        })
      ],
      TASK_CSV_COLUMNS,
      context
    )
    const decoded = decodeCsv(new TextEncoder().encode(text))
    const { plan } = analyzeCsv(decoded, {}, { milestones: [], people: [] }, 'en-GB')
    expect(plan.tasks[0]).toMatchObject({
      title: 'Café, opening',
      status: 'review',
      priority: 'critical',
      dueDate: '2026-10-20',
      labels: ['a', 'b'],
      estimate: 2.5,
      checklist: [
        { text: 'One', checked: false },
        { text: 'Two', checked: true }
      ]
    })
  })
})

describe('custom fields in CSV (R2.2)', () => {
  const fields = [
    {
      id: 'f1',
      projectId: 'p1',
      name: 'Size',
      type: 'choice' as const,
      options: [
        { id: 'o1', name: 'Small', color: '#22c55e' },
        { id: 'o2', name: 'Large', color: '#ef4444' }
      ],
      position: 0,
      createdAt: 0
    },
    {
      id: 'f2',
      projectId: 'p1',
      name: 'Teams',
      type: 'choices' as const,
      options: [
        { id: 't1', name: 'Web', color: '#22c55e' },
        { id: 't2', name: 'Data', color: '#ef4444' }
      ],
      position: 1,
      createdAt: 0
    },
    {
      id: 'f3',
      projectId: 'p1',
      name: 'Signed off',
      type: 'checkbox' as const,
      options: [],
      position: 2,
      createdAt: 0
    },
    {
      id: 'f4',
      projectId: 'p1',
      name: 'Cost',
      type: 'number' as const,
      options: [],
      position: 3,
      createdAt: 0
    }
  ]

  it('writes a column per field, headed with its name, and reads it back into the same values', () => {
    const text = tasksToCsv(
      [
        task({
          title: 'Plan',
          fieldValues: { f1: 'o2', f2: ['t1', 't2'], f3: true, f4: 12.5 }
        } as Partial<PlanningWorkItem>),
        task({ title: 'Do' })
      ],
      ['title', 'field:f1', 'field:f2', 'field:f3', 'field:f4'],
      { ...context, fields }
    )
    expect(text).toBe(
      '﻿Title,Size,Teams,Signed off,Cost\r\nPlan,Large,"Web; Data",Yes,12.5\r\nDo,,,,\r\n'
    )

    const { plan } = analyzeCsv(
      decodeCsv(new TextEncoder().encode(text)),
      {},
      { milestones: [], people: [], fields },
      'en-GB'
    )
    expect(plan.tasks[0].fieldTexts).toEqual({
      f1: 'Large',
      f2: 'Web; Data',
      f3: 'Yes',
      f4: '12.5'
    })
    expect(plan.tasks[1].fieldTexts).toBeUndefined()
  })
})

describe('a project’s column names in CSV (R2.4)', () => {
  const columns = { names: { active: 'Doing', ready: 'Up next' }, hidden: ['review' as const] }

  it('export writes the project’s names', () => {
    const text = tasksToCsv(
      [
        task({ id: 't1', title: 'Paint', status: 'active' }),
        task({ id: 't2', title: 'Fix', status: 'done' })
      ],
      ['title', 'status'],
      { ...context, columns }
    )
    expect(text).toBe('﻿Title,Status\r\nPaint,Doing\r\nFix,Done\r\n')
  })

  it('import maps the project’s names and the standard words', () => {
    const { plan, preview } = analyzeCsv(
      {
        text: 'Title,Status\nA,Doing\nB,up next\nC,In progress\nD,In review\nE,Blocked\n',
        encoding: 'utf-8'
      },
      {},
      { milestones: [], people: [], columns },
      'en-GB'
    )
    expect(plan.tasks.map((draft) => draft.status)).toEqual([
      'active',
      'ready',
      'active',
      'review',
      'blocked'
    ])
    expect(preview.statuses.find((entry) => entry.value === 'Doing')?.mapped).toBe('active')
  })
})
