import { describe, expect, it } from 'vitest'
import type {
  PlanningDecision,
  PlanningMilestone,
  PlanningWorkItem,
  ReportKeyNumbers
} from '../../src/shared/ostler-api'
import {
  buildShareReport,
  normalizeShareReportOptions,
  SHARE_REPORT_CSP,
  type ShareReportInput
} from '../../src/shared/export/share-report'
import { renderShareMarkdown } from '../../electron/services/share-report-markdown'

function task(fields: Partial<PlanningWorkItem>): PlanningWorkItem {
  return {
    id: 't1',
    projectId: 'p',
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

const milestone: PlanningMilestone = {
  id: 'm1',
  projectId: 'p',
  goalId: null,
  name: 'Launch',
  outcome: '',
  targetDate: '2026-11-20',
  successCriteria: [],
  status: 'active',
  createdAt: 1,
  updatedAt: 1
}

const decision: PlanningDecision = {
  id: 'd1',
  projectId: 'p',
  title: 'Use the hall',
  context: 'Rain is likely',
  decision: 'Book the **hall**',
  alternativesConsidered: '',
  consequences: '',
  date: '2026-10-01',
  linkedWorkItemIds: [],
  origin: 'human',
  createdAt: 1,
  updatedAt: 1
}

const keyNumbers: ReportKeyNumbers = {
  open: 2,
  doneInRange: 1,
  overdueNow: 0,
  dueNext7Days: 1,
  cycleTimeMedianMs: null,
  cycleTimeP85Ms: null,
  cycleTimeSampleSize: 0,
  leadTimeMedianMs: null,
  leadTimeSampleSize: 0
}

const hostileDescription = [
  'Plain <b onclick="x()">bold</b> <script>alert(2)</script> <iframe src="https://evil.example"></iframe>',
  '',
  '[a link](https://example.com/page) and [javascript](javascript:alert(3))',
  '',
  '![a picture](ostler-library://item/abc.png) ![remote](http://example.com/x.png)',
  '',
  '**Strong words**'
].join('\n')

function build(options: ShareReportInput['options'] = {}) {
  return buildShareReport({
    project: { name: 'Party <&> "plans"' },
    keyNumbers,
    tasks: [
      task({
        id: 'a',
        title: '<script>alert(1)</script>',
        description: hostileDescription,
        assigneeId: 'p1',
        milestoneId: 'm1',
        targetDate: '2026-11-04'
      }),
      task({ id: 'b', title: 'Send invites', status: 'done', milestoneId: 'm1' })
    ],
    milestones: [milestone],
    decisions: [decision],
    personName: (id) => (id === 'p1' ? 'Sam Smith' : null),
    options,
    now: Date.UTC(2026, 9, 13),
    renderMarkdown: renderShareMarkdown
  })
}

const everything = () =>
  build({ descriptions: true, decisions: true, finished: true, people: true })

describe('shareable report', () => {
  it('stands alone: no scripts, no URLs, a strict Content Security Policy', () => {
    for (const html of [build(), everything(), build({ groupBy: 'milestone' })]) {
      expect(html.toLowerCase()).not.toContain('<script')
      expect(html).not.toMatch(/https?:/i)
      expect(html).not.toContain('ostler-library:')
      expect(html).not.toContain('javascript:')
      expect(html).not.toMatch(/\son[a-z]+=/i)
      expect(html).not.toMatch(/<(iframe|link|img|object|embed)\b/i)
      expect(html).toContain(
        `<meta http-equiv="Content-Security-Policy" content="${SHARE_REPORT_CSP}">`
      )
      expect(html).toContain('<style>')
    }
    expect(SHARE_REPORT_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:")
  })

  it('escapes hostile titles and names', () => {
    const html = build()
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<title>Party &lt;&amp;&gt; &quot;plans&quot;</title>')
  })

  it('sanitises descriptions like the app, keeping only link and image text', () => {
    const html = everything()
    expect(html).toContain('<strong>Strong words</strong>')
    expect(html).toContain('a link')
    expect(html).toContain('[a picture]')
    expect(html).not.toContain('alert(2)</script>')
    expect(html).not.toContain('onclick')
  })

  it('leaves descriptions and the decisions log out by default', () => {
    const html = build()
    expect(html).not.toContain('Strong words')
    expect(html).not.toContain('Use the hall')
    const all = everything()
    expect(all).toContain('Use the hall')
    expect(all).toContain('Book the <strong>hall</strong>')
  })

  it('includes finished tasks unless told not to', () => {
    expect(build()).toContain('Send invites')
    expect(build({ finished: false })).not.toContain('Send invites')
  })

  it("includes people's names unless told not to", () => {
    expect(build()).toContain('Sam Smith')
    const without = build({ people: false })
    expect(without).not.toContain('Sam Smith')
    expect(without).not.toContain('Assignee')
  })

  it('shows key numbers and milestone progress', () => {
    const html = build()
    expect(html).toContain('Done in the last 30 days')
    expect(html).toContain('1 of 2 tasks done')
    expect(html).toContain('<svg class="bar"')
  })

  it('groups by status or by milestone', () => {
    const byStatus = build()
    expect(byStatus).toMatch(/<h3>Ready /)
    expect(byStatus).toMatch(/<h3>Done /)
    const byMilestone = build({ groupBy: 'milestone' })
    expect(byMilestone).toMatch(/<h3>Launch /)
    expect(byMilestone).not.toMatch(/<h3>Ready /)
  })

  it('reads unknown options as the defaults', () => {
    expect(normalizeShareReportOptions({ finished: 'yes', groupBy: 'owner' })).toEqual({
      descriptions: false,
      decisions: false,
      finished: true,
      people: true,
      groupBy: 'status'
    })
  })
})
