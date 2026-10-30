import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { createWorkItemBatch } from '../../electron/services/planning-batch'
import { ruleNoticeSource } from '../../electron/services/inbox-sources'
import { ReminderService } from '../../electron/services/reminder-service'
import {
  MAX_RULES_PER_PROJECT,
  PLANNING_RULE_ACTION_KINDS,
  type CreatePlanningRuleInput,
  type CreatePlanningWorkItemInput,
  type PlanningRule,
  type PlanningWorkItem,
  type WatchedProject
} from '../../src/shared/ostler-api'
import {
  conditionHolds,
  matchingRules,
  parseRuleAction,
  planActions,
  previewRule,
  triggerFires
} from '../../src/shared/planning/rules'
import { shiftIsoDate, todayIsoDate } from '../../src/shared/dates'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' } as const

function task(overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return {
    id: 't1',
    projectId: 'p1',
    milestoneId: null,
    title: 'Task',
    description: '',
    status: 'active',
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
    ...overrides
  }
}

function storedRule(overrides: Partial<PlanningRule>): PlanningRule {
  return {
    id: 'r',
    projectId: 'p1',
    name: 'Rule',
    enabled: true,
    trigger: { kind: 'taskCreated' },
    conditions: [],
    actions: [{ kind: 'setPriority', priority: 'critical' }],
    lastRunAt: null,
    runCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

/** The engine (R6.2, D45): pure, so every surface shares one answer. */
describe('rules engine', () => {
  it('fires each trigger only for its own change', () => {
    const done = task({ status: 'done' })
    expect(triggerFires({ kind: 'taskCreated' }, { task: done, created: true })).toBe(true)
    expect(triggerFires({ kind: 'taskCreated' }, { task: done, statusFrom: 'active' })).toBe(false)
    const toDone = { kind: 'statusChanged', to: 'done' } as const
    expect(triggerFires(toDone, { task: done, statusFrom: 'active' })).toBe(true)
    expect(triggerFires(toDone, { task: done, assigneeChanged: true })).toBe(false)
    // A task created in Done did not move there.
    expect(triggerFires(toDone, { task: done, created: true, statusFrom: null })).toBe(false)
    const fromReview = { kind: 'statusChanged', to: 'done', from: 'review' } as const
    expect(triggerFires(fromReview, { task: done, statusFrom: 'active' })).toBe(false)
    expect(triggerFires(fromReview, { task: done, statusFrom: 'review' })).toBe(true)
    expect(triggerFires({ kind: 'assigneeChanged' }, { task: done, assigneeChanged: true })).toBe(
      true
    )
    expect(triggerFires({ kind: 'subtasksDone' }, { task: done, subtasksDone: true })).toBe(true)
    expect(
      triggerFires({ kind: 'checklistComplete' }, { task: done, checklistCompleted: true })
    ).toBe(true)
    expect(triggerFires({ kind: 'dueDateReached' }, { task: done, dueDateReached: true })).toBe(
      true
    )
    expect(triggerFires({ kind: 'dueDateReached' }, { task: done, statusFrom: 'active' })).toBe(
      false
    )
  })

  it('checks every condition, with is and is not', () => {
    const item = task({
      labels: ['Urgent'],
      priority: 'high',
      assigneeId: 'sam',
      milestoneId: 'm1',
      status: 'review',
      fieldValues: { size: 'large', tags: ['a', 'b'], cost: 12, ok: true }
    })
    expect(conditionHolds({ kind: 'label', op: 'is', label: 'urgent' }, item)).toBe(true)
    expect(conditionHolds({ kind: 'label', op: 'isNot', label: 'urgent' }, item)).toBe(false)
    expect(conditionHolds({ kind: 'priority', op: 'is', priority: 'high' }, item)).toBe(true)
    expect(conditionHolds({ kind: 'assignee', op: 'is', personId: 'sam' }, item)).toBe(true)
    expect(conditionHolds({ kind: 'assignee', op: 'is', personId: null }, item)).toBe(false)
    expect(conditionHolds({ kind: 'milestone', op: 'isNot', milestoneId: null }, item)).toBe(true)
    expect(conditionHolds({ kind: 'status', op: 'is', status: 'review' }, item)).toBe(true)
    const field = (fieldId: string, value: string | number | boolean) =>
      conditionHolds({ kind: 'field', op: 'is', fieldId, value }, item)
    expect(field('size', 'large')).toBe(true)
    expect(field('tags', 'b')).toBe(true)
    expect(field('tags', 'c')).toBe(false)
    expect(field('cost', 12)).toBe(true)
    expect(field('ok', true)).toBe(true)
    expect(field('missing', false)).toBe(true)
    expect(field('missing', 'x')).toBe(false)
  })

  it('matches only rules that are on, triggered and whose conditions all hold', () => {
    const rules = [
      storedRule({ id: 'a' }),
      storedRule({ id: 'b', enabled: false }),
      storedRule({ id: 'c', conditions: [{ kind: 'label', op: 'is', label: 'bug' }] }),
      storedRule({ id: 'd', trigger: { kind: 'assigneeChanged' } })
    ]
    expect(matchingRules(rules, { task: task(), created: true }).map((rule) => rule.id)).toEqual([
      'a'
    ])
  })

  it('plans every action, each seeing the ones before it', () => {
    const plan = planActions(task({ labels: ['bug'], acceptanceCriteria: ['One'] }), [
      { kind: 'setStatus', status: 'review' },
      { kind: 'setPriority', priority: 'medium' },
      { kind: 'setAssignee', personId: 'sam' },
      { kind: 'setMilestone', milestoneId: 'm1' },
      { kind: 'addLabel', label: 'urgent' },
      { kind: 'removeLabel', label: 'BUG' },
      { kind: 'addChecklistItems', items: ['One', 'Two'] },
      { kind: 'addComment', text: 'Escalated' },
      { kind: 'notifyMe', message: '' },
      { kind: 'archive' }
    ])
    expect(plan.patch).toEqual({
      status: 'review',
      assigneeId: 'sam',
      milestoneId: 'm1',
      labels: ['urgent'],
      acceptanceCriteria: ['One', 'Two']
    })
    expect(plan.comments).toEqual(['Escalated'])
    expect(plan.notices).toEqual([''])
    expect(plan.archive).toBe(false)
    expect(plan.effects.map((effect) => effect.outcome)).toEqual([
      'change',
      'none',
      'change',
      'change',
      'change',
      'change',
      'change',
      'change',
      'change',
      'notDone'
    ])
    expect(
      planActions(task(), [{ kind: 'setStatus', status: 'done' }, { kind: 'archive' }]).archive
    ).toBe(true)
  })

  it('leaves the status and archive of a task with agent work to the harness', () => {
    const linked = task({ linkedHarnessTaskId: 'h1', status: 'done' })
    const plan = planActions(linked, [{ kind: 'setStatus', status: 'ready' }, { kind: 'archive' }])
    expect(plan.patch).toEqual({})
    expect(plan.effects.map((effect) => effect.outcome)).toEqual(['agentWork', 'agentWork'])
  })

  it('previews a rule against a task, trigger aside', () => {
    const preview = previewRule(
      {
        conditions: [
          { kind: 'label', op: 'is', label: 'urgent' },
          { kind: 'priority', op: 'is', priority: 'high' }
        ],
        actions: [{ kind: 'setPriority', priority: 'critical' }]
      },
      task({ labels: ['urgent'] })
    )
    expect(preview).toMatchObject({ conditions: [true, false], matches: false })
    expect(preview.effects[0].outcome).toBe('change')
  })

  it('has no action that reaches agents, the harness, the Library, AI, deletion or the network', () => {
    expect([...PLANNING_RULE_ACTION_KINDS].sort()).toEqual(
      [
        'addChecklistItems',
        'addComment',
        'addLabel',
        'archive',
        'notifyMe',
        'removeLabel',
        'setAssignee',
        'setMilestone',
        'setPriority',
        'setStatus'
      ].sort()
    )
    for (const kind of [
      'queueForAgents',
      'startRun',
      'stopRun',
      'delete',
      'moveToBin',
      'attachLibraryItem',
      'askOstlerAi',
      'webhook',
      'sendEmail'
    ]) {
      expect(() => parseRuleAction({ kind })).toThrow()
    }
    // Fields beyond an action's own are dropped, so none can carry another write in.
    expect(parseRuleAction({ kind: 'setStatus', status: 'ready', autoQueue: true })).toEqual({
      kind: 'setStatus',
      status: 'ready'
    })
  })
})

/** Rules as the planning service applies them, in the change's own transaction. */
describe('PlanningService rules', () => {
  const tempDir = useTempDir('ostler-rules-')
  let service: PlanningService
  let people: PeopleService
  let databasePath: string

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(tempDir())
    service = new PlanningService(databasePath, () => ['p1', 'p2'])
    people = new PeopleService(databasePath)
  })

  afterEach(() => {
    service.close()
    people.close()
  })

  const rule = (
    input: Partial<CreatePlanningRuleInput> & Pick<CreatePlanningRuleInput, 'trigger'>
  ) =>
    service.rules.create('p1', {
      name: 'Rule',
      actions: [{ kind: 'setPriority', priority: 'critical' }],
      ...input
    })
  const make = (title: string, extra: Partial<CreatePlanningWorkItemInput> = {}) =>
    service.createWorkItem('p1', { title, ...extra }, human)
  const get = (id: string) => service.getWorkItem(id)

  it('acts on a new task and records what it did as by rule', () => {
    rule({ name: 'Triage', trigger: { kind: 'taskCreated' } })
    const created = make('Fix it')
    expect(created.priority).toBe('critical')
    expect(created.ruleRun?.ruleNames).toEqual(['Triage'])
    const entries = service.listActivity('p1', created.id).entries
    const change = entries.find((entry) => entry.field === 'priority')
    expect(change?.summary).toMatch(/by rule “Triage”$/)
    expect(change?.actor).toMatchObject({ kind: 'rule', ruleName: 'Triage' })
    expect(service.rules.list('p1')[0]).toMatchObject({ runCount: 1 })
  })

  it('runs on a status change, optionally from one status', () => {
    rule({
      name: 'Shipped',
      trigger: { kind: 'statusChanged', to: 'done', from: 'review' },
      actions: [
        { kind: 'addLabel', label: 'shipped' },
        { kind: 'setStatus', status: 'review' }
      ]
    })
    const a = make('A', { status: 'active' })
    expect(service.updateWorkItem(a.id, { status: 'done' }, human).labels).toEqual([])
    const b = make('B', { status: 'review' })
    const moved = service.updateWorkItem(b.id, { status: 'done' }, human)
    expect(moved).toMatchObject({ labels: ['shipped'], status: 'review' })
    const status = service
      .listActivity('p1', b.id)
      .entries.find((entry) => entry.kind === 'status' && entry.actor.kind === 'rule')
    expect(status?.summary).toMatch(/by rule “Shipped”$/)
  })

  it('runs on an assignee change, with conditions on label and priority', () => {
    const sam = people.create({ name: 'Sam' })
    rule({
      name: 'Escalate',
      trigger: { kind: 'assigneeChanged' },
      conditions: [
        { kind: 'label', op: 'is', label: 'urgent' },
        { kind: 'priority', op: 'isNot', priority: 'critical' }
      ],
      actions: [
        { kind: 'setPriority', priority: 'critical' },
        { kind: 'addComment', text: 'Escalated by the urgent rule.' }
      ]
    })
    const plain = make('Plain')
    expect(service.updateWorkItem(plain.id, { assigneeId: sam.id }, human).priority).toBe('medium')
    const urgent = make('Urgent', { labels: ['urgent'] })
    const updated = service.updateWorkItem(urgent.id, { assigneeId: sam.id }, human)
    expect(updated.priority).toBe('critical')
    const [comment] = service.listComments(urgent.id)
    expect(comment).toMatchObject({ authorKind: 'rule', ruleName: 'Escalate' })
  })

  it('checks a custom field condition', () => {
    const size = service.createField('p1', {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small' }, { name: 'Large' }]
    })
    const large = size.options[1].id
    rule({
      name: 'Big',
      trigger: { kind: 'taskCreated' },
      conditions: [{ kind: 'field', op: 'is', fieldId: size.id, value: large }]
    })
    expect(make('Small one').priority).toBe('medium')
    expect(make('Large one', { fieldValues: { [size.id]: large } }).priority).toBe('critical')
  })

  it('runs on the parent when its last subtask is done', () => {
    rule({
      name: 'Up',
      trigger: { kind: 'subtasksDone' },
      actions: [{ kind: 'setStatus', status: 'review' }]
    })
    const parent = make('Parent', { status: 'active' })
    const one = make('One', { parentWorkItemId: parent.id })
    const two = make('Two', { parentWorkItemId: parent.id })
    service.updateWorkItem(one.id, { status: 'done' }, human)
    expect(get(parent.id).status).toBe('active')
    service.updateWorkItem(two.id, { status: 'done' }, human)
    expect(get(parent.id).status).toBe('review')
  })

  it('runs when the checklist is complete, by a tick or by an edit', () => {
    rule({
      name: 'Checked',
      trigger: { kind: 'checklistComplete' },
      actions: [{ kind: 'setStatus', status: 'review' }]
    })
    const item = make('List', { acceptanceCriteria: ['One', 'Two'] })
    service.setChecklistItemChecked(item.id, 'One', true, human)
    expect(get(item.id).status).not.toBe('review')
    const ticked = service.setChecklistItemChecked(item.id, 'Two', true, human)
    expect(ticked.status).toBe('review')
    expect(ticked.ruleRun?.ruleNames).toEqual(['Checked'])

    const other = make('Other', { status: 'active', acceptanceCriteria: ['One', 'Two'] })
    service.setChecklistItemChecked(other.id, 'One', true, human)
    expect(service.updateWorkItem(other.id, { acceptanceCriteria: ['One'] }, human).status).toBe(
      'review'
    )
  })

  it('runs every other action: milestone, labels, checklist, notify me and archive', () => {
    const milestone = service.createMilestone('p1', { name: 'Launch' })
    rule({
      name: 'Close out',
      trigger: { kind: 'statusChanged', to: 'done' },
      actions: [
        { kind: 'setMilestone', milestoneId: milestone.id },
        { kind: 'removeLabel', label: 'wip' },
        { kind: 'addChecklistItems', items: ['Tell the team'] },
        { kind: 'notifyMe', message: 'Done and dusted' },
        { kind: 'archive' }
      ]
    })
    const item = make('Ship', { labels: ['wip', 'web'] })
    const listener = vi.fn()
    service.rules.setNoticeListener(listener)
    const done = service.updateWorkItem(item.id, { status: 'done' }, human)
    expect(done).toMatchObject({
      milestoneId: milestone.id,
      labels: ['web'],
      acceptanceCriteria: ['Tell the team']
    })
    expect(done.archivedAt).not.toBeNull()
    const inbox = ruleNoticeSource(service.database, () => [
      { id: 'p1', name: 'Website', enabled: true } as WatchedProject
    ])()
    // The rule archived the task, so the notice opens its project, not a drawer.
    expect(inbox).toEqual([
      expect.objectContaining({ kind: 'rule', title: 'Ship', projectId: 'p1', taskId: null })
    ])
    expect(inbox[0].key).toMatch(/^rule:/)
    expect(inbox[0].body).toContain('Done and dusted')
    expect(
      service.rules.flushNotices().map((notice) => [notice.ruleName, notice.taskLive])
    ).toEqual([['Close out', false]])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(service.rules.flushNotices()).toEqual([])
  })

  it('never chains: a rule’s change sets off no rule', () => {
    rule({
      name: 'First',
      trigger: { kind: 'statusChanged', to: 'review' },
      actions: [{ kind: 'setStatus', status: 'done' }]
    })
    rule({
      name: 'Second',
      trigger: { kind: 'statusChanged', to: 'done' },
      actions: [{ kind: 'addLabel', label: 'chained' }]
    })
    const item = make('Item')
    const moved = service.updateWorkItem(item.id, { status: 'review' }, human)
    expect(moved.status).toBe('done')
    expect(moved.labels).toEqual([])
    expect(moved.ruleRun?.ruleNames).toEqual(['First'])
  })

  it('rolls back the whole change with a plain error when a rule fails', () => {
    const milestone = service.createMilestone('p1', { name: 'Gone soon' })
    rule({
      name: 'Plan it',
      trigger: { kind: 'statusChanged', to: 'ready' },
      actions: [
        { kind: 'addLabel', label: 'planned' },
        { kind: 'setMilestone', milestoneId: milestone.id }
      ]
    })
    // A rule can only fail on a milestone gone from under it (deleting it is refused).
    const db = new Database(databasePath)
    db.prepare('DELETE FROM planning_milestones WHERE id = ?').run(milestone.id)
    db.close()
    const item = make('Item', { status: 'backlog' })
    expect(() => service.updateWorkItem(item.id, { status: 'ready' }, human)).toThrow(
      /The rule “Plan it” couldn’t run, so nothing was changed/
    )
    expect(get(item.id)).toMatchObject({ status: 'backlog', labels: [] })
    expect(
      service.listProjectStatusTransitions('p1').filter((entry) => entry.workItemId === item.id)
    ).toHaveLength(1)
  })

  it('refuses to delete a milestone a rule moves tasks to, so the rule cannot break', () => {
    const milestone = service.createMilestone('p1', { name: 'Kept' })
    const planIt = rule({
      name: 'Plan it',
      trigger: { kind: 'statusChanged', to: 'ready' },
      actions: [{ kind: 'setMilestone', milestoneId: milestone.id }]
    })
    expect(() => service.deleteMilestone(milestone.id)).toThrow(
      /The rule “Plan it” moves tasks to this milestone/
    )
    const item = make('Item', { status: 'backlog' })
    expect(service.updateWorkItem(item.id, { status: 'ready' }, human).milestoneId).toBe(
      milestone.id
    )
    service.rules.delete(planIt.id)
    service.updateWorkItem(item.id, { milestoneId: null }, human)
    service.deleteMilestone(milestone.id)
    expect(service.listMilestones('p1')).toHaveLength(0)
  })

  it('refuses to restore a deleted rule whose milestone is gone', () => {
    const milestone = service.createMilestone('p1', { name: 'Gone' })
    const planIt = rule({
      name: 'Plan it',
      trigger: { kind: 'statusChanged', to: 'ready' },
      actions: [{ kind: 'setMilestone', milestoneId: milestone.id }]
    })
    const deletion = service.rules.delete(planIt.id)
    service.deleteMilestone(milestone.id)
    expect(() => service.rules.restore(deletion)).toThrow()
    expect(service.rules.list('p1')).toHaveLength(0)
  })

  it('undoing a person’s change undoes what the rules did because of it', () => {
    rule({
      name: 'Escalate',
      trigger: { kind: 'statusChanged', to: 'blocked' },
      actions: [
        { kind: 'setPriority', priority: 'critical' },
        { kind: 'addLabel', label: 'stuck' },
        { kind: 'addComment', text: 'Blocked, so critical.' },
        { kind: 'notifyMe', message: '' }
      ]
    })
    rule({
      name: 'Back',
      trigger: { kind: 'statusChanged', to: 'active' },
      actions: [{ kind: 'addLabel', label: 'resumed' }]
    })
    const item = make('Item', { status: 'active' })
    const moved = service.updateWorkItem(item.id, { status: 'blocked' }, human)
    expect(moved).toMatchObject({ priority: 'critical', labels: ['stuck'] })
    const undone = service.updateWorkItem(
      item.id,
      { status: 'active', undoRuleRun: moved.ruleRun!.id },
      human
    )
    // The undo is no change of its own: "Back" does not run.
    expect(undone).toMatchObject({ status: 'active', priority: 'medium', labels: [] })
    expect(undone.ruleRun).toBeUndefined()
    expect(service.listComments(item.id)).toEqual([])
    const notices = service.database
      .prepare('SELECT COUNT(*) AS n FROM planning_rule_notices')
      .get() as { n: number }
    expect(notices.n).toBe(0)
  })

  it('runs the due-date trigger once per task per due date', () => {
    rule({
      name: 'Overdue',
      trigger: { kind: 'dueDateReached' },
      actions: [{ kind: 'addLabel', label: 'late' }]
    })
    const today = todayIsoDate()
    const item = make('Due', { targetDate: today })
    const later = make('Later', { targetDate: shiftIsoDate(today, 30) })
    const finished = make('Finished', { targetDate: today, status: 'done' })
    expect(service.rules.runDueDates(['p1'], today)).toBe(1)
    expect(get(item.id).labels).toEqual(['late'])
    expect(get(later.id).labels).toEqual([])
    expect(get(finished.id).labels).toEqual([])
    // Once: taking the label off does not bring it back for the same due date.
    service.updateWorkItem(item.id, { labels: [] }, human)
    expect(service.rules.runDueDates(['p1'], today)).toBe(0)
    // A new due date is a new one.
    const tomorrow = shiftIsoDate(today, 1)
    service.updateWorkItem(item.id, { targetDate: tomorrow }, human)
    expect(service.rules.runDueDates(['p1'], today)).toBe(0)
    expect(service.rules.runDueDates(['p1'], tomorrow)).toBe(1)
    expect(get(item.id).labels).toEqual(['late'])
  })

  it('runs due-date rules on the reminder service’s schedule', () => {
    const runDueRules = vi.fn()
    const reminders = new ReminderService({
      reminders: service.reminders,
      getProjects: () => [],
      getTask: () => null,
      replanDueReminders: () => undefined,
      runDueRules,
      notify: () => undefined,
      onDelivered: () => undefined
    })
    reminders.start()
    reminders.check()
    reminders.stop()
    expect(runDueRules).toHaveBeenCalledTimes(2)
  })

  it('is set off from every surface: drawer, List, Board move, quick add and plan grid', () => {
    rule({
      name: 'Any',
      trigger: { kind: 'statusChanged', to: 'review' },
      actions: [{ kind: 'addLabel', label: 'ruled' }]
    })
    rule({
      name: 'New',
      trigger: { kind: 'taskCreated' },
      actions: [{ kind: 'addLabel', label: 'new' }]
    })
    // Quick add and New task.
    const quick = make('Quick')
    expect(quick.labels).toEqual(['new'])
    // The drawer and the List: one update.
    expect(service.updateWorkItem(quick.id, { status: 'review' }, human).labels).toEqual([
      'new',
      'ruled'
    ])
    // A Board move.
    const card = make('Card')
    const moved = service.moveWorkItemInOrder(
      card.id,
      { position: 'start', status: 'review' },
      human
    )
    expect(moved.labels).toEqual(['new', 'ruled'])
    expect(moved.ruleRun?.ruleNames).toEqual(['Any'])
    // The plan grid.
    const [planned] = createWorkItemBatch(service, 'p1', [{ title: 'Planned' }], human)
    expect(get(planned.id).labels).toEqual(['new'])
  })

  it('is not set off by imports, templates or while rules are off', () => {
    rule({ name: 'New', trigger: { kind: 'taskCreated' } })
    service.database
      .prepare(
        "INSERT INTO import_batches (id, project_id, source, file_name, created_at, item_count) VALUES ('b1', 'p1', 'csv', 'tasks.csv', 1, 0)"
      )
      .run()
    expect(service.createWorkItem('p1', { title: 'CSV' }, human, 'imported', 'b1').priority).toBe(
      'medium'
    )
    expect(
      service.createWorkItem('p1', { title: 'Template' }, { kind: 'human', template: 'Software' })
        .priority
    ).toBe('medium')
    expect(service.withoutRules(() => make('Package')).priority).toBe('medium')
    expect(make('Typed').priority).toBe('critical')
  })

  it('keeps the limits: at most 50 rules, and only valid ones', () => {
    expect(() =>
      service.rules.create('p1', { name: '', trigger: { kind: 'taskCreated' }, actions: [] })
    ).toThrow()
    expect(() =>
      service.rules.create('p1', {
        name: 'Bad',
        trigger: { kind: 'taskCreated' },
        actions: [{ kind: 'queueForAgents' } as never]
      })
    ).toThrow(/Nothing else/)
    expect(() =>
      service.rules.create('p1', {
        name: 'Nobody',
        trigger: { kind: 'taskCreated' },
        actions: [{ kind: 'setAssignee', personId: 'missing' }]
      })
    ).toThrow(/person/)
    for (let index = 0; index < MAX_RULES_PER_PROJECT; index++)
      rule({ name: `Rule ${index}`, trigger: { kind: 'taskCreated' } })
    expect(() => rule({ trigger: { kind: 'taskCreated' } })).toThrow(/at most 50/)
    // Another project's limit is its own.
    expect(
      service.rules.create('p2', {
        name: 'Elsewhere',
        trigger: { kind: 'taskCreated' },
        actions: [{ kind: 'archive' }]
      }).projectId
    ).toBe('p2')
  })

  it('switches, updates, deletes and restores a rule', () => {
    const made = rule({ name: 'Mine', trigger: { kind: 'taskCreated' } })
    service.rules.update(made.id, { enabled: false })
    expect(make('Off').priority).toBe('medium')
    expect(service.rules.update(made.id, { enabled: true, name: 'Renamed' })).toMatchObject({
      enabled: true,
      name: 'Renamed'
    })
    const deletion = service.rules.delete(made.id)
    expect(service.rules.list('p1')).toEqual([])
    expect(service.rules.restore(deletion).id).toBe(made.id)
    expect(make('Back').priority).toBe('critical')
  })

  it('tries a rule on a task without changing it', () => {
    const item = make('Try me', { labels: ['urgent'] })
    const preview = service.rules.preview(
      'p1',
      {
        conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
        actions: [{ kind: 'setPriority', priority: 'critical' }]
      },
      item.id
    )
    expect(preview).toMatchObject({ matches: true, effects: [{ outcome: 'change' }] })
    expect(get(item.id).priority).toBe('medium')
    expect(() =>
      service.rules.preview('p2', { conditions: [], actions: [{ kind: 'archive' }] }, item.id)
    ).toThrow()
  })
})
