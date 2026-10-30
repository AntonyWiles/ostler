import { describe, expect, it } from 'vitest'
import type { PlanningMilestone, PlanningWorkItem } from '../../src/shared/ostler-api'
import { BRAND } from '../../src/shared/brand'
import { deepLinkFor } from '../../src/shared/deep-link'
import {
  buildCalendarFile,
  calendarUid,
  escapeIcsText,
  foldIcsLine,
  type CalendarFileInput
} from '../../src/shared/export/calendar-ics'

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const TASK_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function task(fields: Partial<PlanningWorkItem>): PlanningWorkItem {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    milestoneId: null,
    title: 'Task',
    description: '',
    status: 'ready',
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
    createdAt: 1,
    updatedAt: 1,
    ...fields
  }
}

function milestone(fields: Partial<PlanningMilestone>): PlanningMilestone {
  return {
    id: 'm1',
    projectId: PROJECT_ID,
    goalId: null,
    name: 'Launch',
    outcome: '',
    targetDate: null,
    successCriteria: [],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...fields
  }
}

function build(overrides: Partial<CalendarFileInput>) {
  return buildCalendarFile({
    project: { id: PROJECT_ID, name: 'Party' },
    tasks: [],
    milestones: [],
    personName: (id) => (id === 'p1' ? 'Sam' : null),
    now: Date.UTC(2026, 9, 13, 8, 30, 5),
    ...overrides
  })
}

/** The file's content lines, unfolded. */
const unfold = (text: string) => text.replace(/\r\n /g, '').split('\r\n')

describe('calendar file', () => {
  it('escapes backslashes, semicolons, commas and new lines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
  })

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}${'🎉'.repeat(10)}`
    const folded = foldIcsLine(line)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(1)
    for (const [index, part] of physical.entries()) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75)
      if (index > 0) expect(part.startsWith(' ')).toBe(true)
      // Whole characters only: no replacement characters after a round trip.
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    expect(foldIcsLine('SHORT:line')).toBe('SHORT:line')
  })

  it('writes a valid calendar with CRLF line ends and a DTSTAMP', () => {
    const { text, eventCount } = build({ tasks: [task({ targetDate: '2026-11-04' })] })
    expect(eventCount).toBe(1)
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(unfold(text)).toContain('DTSTAMP:20261013T083005Z')
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('makes an all-day event on the due date with an exclusive end', () => {
    const lines = unfold(build({ tasks: [task({ targetDate: '2026-12-31' })] }).text)
    expect(lines).toContain('DTSTART;VALUE=DATE:20261231')
    expect(lines).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('spans from the start date to the due date', () => {
    const lines = unfold(
      build({ tasks: [task({ startDate: '2026-11-02', targetDate: '2026-11-04' })] }).text
    )
    expect(lines).toContain('DTSTART;VALUE=DATE:20261102')
    expect(lines).toContain('DTEND;VALUE=DATE:20261105')
  })

  it('leaves out tasks without a due date, and finished tasks unless asked', () => {
    const tasks = [
      task({ id: 'a', title: 'Undated' }),
      task({ id: 'b', title: 'Started only', startDate: '2026-11-01' }),
      task({ id: 'c', title: 'Finished', status: 'done', targetDate: '2026-11-01' }),
      task({ id: 'd', title: 'Open', targetDate: '2026-11-01' })
    ]
    const without = build({ tasks })
    expect(without.eventCount).toBe(1)
    expect(without.text).toContain('SUMMARY:Open')
    expect(without.text).not.toContain('Finished')
    const withFinished = build({ tasks, options: { includeFinished: true } })
    expect(withFinished.eventCount).toBe(2)
    expect(withFinished.text).toContain('SUMMARY:Finished')
  })

  it("holds the title, project, status, assignee and the task's deep link", () => {
    const link = deepLinkFor(
      { kind: 'task', projectId: PROJECT_ID, taskId: TASK_ID },
      BRAND.urlScheme
    )
    const lines = unfold(
      build({
        tasks: [task({ title: 'Book; venue, now', targetDate: '2026-11-04', assigneeId: 'p1' })]
      }).text
    )
    expect(lines).toContain('SUMMARY:Book\\; venue\\, now')
    expect(lines).toContain(`URL:${link}`)
    const description = lines.find((line) => line.startsWith('DESCRIPTION:'))!
    expect(description).toBe(`DESCRIPTION:Project: Party\\nStatus: Ready\\nAssignee: Sam\\n${link}`)
  })

  it('gives every event a stable UID from its id', () => {
    const tasks = [task({ targetDate: '2026-11-04' })]
    const first = build({ tasks, now: 0 }).text
    const second = build({ tasks, now: 1_000_000 }).text
    const uid = `UID:${calendarUid('task', TASK_ID)}`
    expect(unfold(first)).toContain(uid)
    expect(unfold(second)).toContain(uid)
    expect(uid).toBe(`UID:task-${TASK_ID}@${BRAND.urlScheme}.local`)
  })

  it('adds dated milestones as all-day events, finished ones only if asked', () => {
    const milestones = [
      milestone({ id: 'm1', name: 'Launch', targetDate: '2026-11-20' }),
      milestone({ id: 'm2', name: 'Undated' }),
      milestone({ id: 'm3', name: 'Shipped', targetDate: '2026-10-01', status: 'complete' })
    ]
    const { text, eventCount } = build({ milestones })
    expect(eventCount).toBe(1)
    const lines = unfold(text)
    expect(lines).toContain(`UID:${calendarUid('milestone', 'm1')}`)
    expect(lines).toContain('SUMMARY:Milestone: Launch')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261120')
    expect(lines).toContain('DTEND;VALUE=DATE:20261121')
    expect(build({ milestones, options: { includeFinished: true } }).eventCount).toBe(2)
  })
})
