import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningRuleInput,
  PlanningActor,
  PlanningRule,
  PlanningRuleAction,
  PlanningRuleCondition,
  PlanningRuleDeletion,
  PlanningRulePreview,
  PlanningRuleRunSummary,
  PlanningRuleTrigger,
  PlanningWorkItem,
  UpdatePlanningRuleInput
} from '@shared/ostler-api'
import { MAX_RULES_PER_PROJECT } from '@shared/ostler-api'
import {
  matchingRules,
  parseEnabled,
  parseRuleActions,
  parseRuleConditions,
  parseRuleDefinition,
  parseRuleName,
  parseRuleTrigger,
  planActions,
  planDoesSomething,
  previewRule,
  type RuleChange,
  type RuleTaskPatch
} from '@shared/planning/rules'
import { compareIsoDates, todayIsoDate, toIsoDate } from '@shared/dates'
import { Refusal, isRefusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface RuleRow {
  id: string
  project_id: string
  name: string
  enabled: number
  trigger: string
  conditions: string
  actions: string
  last_run_at: number | null
  run_count: number
  created_at: number
  updated_at: number
}

/** What one rule did to one task: enough to undo it. */
interface RunStep {
  ruleId: string
  ruleName: string
  workItemId: string
  /** The fields it changed, as they were before. */
  before: RuleTaskPatch
  commentIds: string[]
  noticeIds: string[]
  archived: boolean
}

/** A "Notify me" waiting to be shown on the desktop. */
export interface RuleNotice {
  id: string
  projectId: string
  workItemId: string
  ruleName: string
  message: string
  taskTitle: string
  /** False once the task is archived or recycled (a rule can archive it): nothing to open. */
  taskLive: boolean
}

/** What the rules need from the planning service around them; all on its connection. */
export interface PlanningRulesHost {
  requireProject(projectId: string): void
  changed(projectId: string): void
  getWorkItem(workItemId: string): PlanningWorkItem
  /** The task's own write path; with a rule actor it sets off no rules. */
  updateWorkItem(workItemId: string, patch: RuleTaskPatch, actor: PlanningActor): PlanningWorkItem
  addComment(workItemId: string, body: string, actor: PlanningActor): { id: string }
  deleteComment(commentId: string, actor: PlanningActor): void
  archiveWorkItem(workItemId: string, actor: PlanningActor): void
  unarchiveWorkItem(workItemId: string, actor: PlanningActor): void
  /** Runs `operation` with rules off: an undo is not a change of its own. */
  withoutRules<T>(operation: () => T): T
  /** The person exists and can be given work in the project: the address book or its own. */
  personExists(personId: string, projectId: string): boolean
  milestoneInProject(milestoneId: string, projectId: string): boolean
  fieldInProject(fieldId: string, projectId: string): boolean
  /** The project's own column (MOP-26) the rule names, counting as `status`. */
  columnInProject(columnId: string, status: string, projectId: string): boolean
}

/**
 * Rules (R6.2, D45), stored and applied. The planning service owns this and
 * calls `afterChange` inside the transaction of every write a rule can
 * follow, so the app, the automation API and undo see one change; the
 * engine that decides is `src/shared/planning/rules.ts`. What a rule writes
 * goes through the planning service with a `rule` actor, which sets off no
 * further rules. A rule that fails throws, and the whole change rolls back.
 */
export class PlanningRules {
  private noticeListener: ((notice: RuleNotice) => void) | null = null
  private flushScheduled = false

  constructor(
    private readonly db: Database.Database,
    private readonly host: PlanningRulesHost
  ) {}

  // ─── Stored rules ─────────────────────────────────────────────────────────

  /** A project's rules, oldest first: the order they run in. */
  list(projectId: string): PlanningRule[] {
    this.host.requireProject(projectId)
    return this.rows(projectId)
  }

  get(ruleId: string): PlanningRule {
    if (typeof ruleId !== 'string' || !ruleId) throw new Refusal(t('errors:planningRules.notFound'))
    const row = this.db.prepare('SELECT * FROM planning_rules WHERE id = ?').get(ruleId) as
      RuleRow | undefined
    if (!row) throw new Refusal(t('errors:planningRules.notFound'))
    this.host.requireProject(row.project_id)
    return toRule(row)
  }

  /** Refuses an id that is not one of this project's rules. */
  requireInProject(ruleId: string, projectId: string): PlanningRule {
    const rule = this.get(ruleId)
    if (rule.projectId !== projectId) throw new Refusal(t('errors:planningRules.notFound'))
    return rule
  }

  create(projectId: string, input: CreatePlanningRuleInput, now = Date.now()): PlanningRule {
    this.host.requireProject(projectId)
    const count = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM planning_rules WHERE project_id = ?')
        .get(projectId) as { n: number }
    ).n
    if (count >= MAX_RULES_PER_PROJECT)
      throw new Refusal(t('errors:planningRules.tooMany', { max: MAX_RULES_PER_PROJECT }))
    const definition = parseRuleDefinition(input)
    this.checkReferences(projectId, definition.trigger, definition.conditions, definition.actions)
    const rule: PlanningRule = {
      id: uuidv4(),
      projectId,
      ...definition,
      lastRunAt: null,
      runCount: 0,
      createdAt: now,
      updatedAt: now
    }
    this.insert(rule)
    this.host.changed(projectId)
    return rule
  }

  update(ruleId: string, updates: UpdatePlanningRuleInput, now = Date.now()): PlanningRule {
    const current = this.get(ruleId)
    const input = (updates ?? {}) as Record<string, unknown>
    const rule: PlanningRule = {
      ...current,
      name: input.name === undefined ? current.name : parseRuleName(input.name),
      enabled: input.enabled === undefined ? current.enabled : parseEnabled(input.enabled),
      trigger: input.trigger === undefined ? current.trigger : parseRuleTrigger(input.trigger),
      conditions:
        input.conditions === undefined ? current.conditions : parseRuleConditions(input.conditions),
      actions: input.actions === undefined ? current.actions : parseRuleActions(input.actions),
      updatedAt: now
    }
    if (
      input.trigger !== undefined ||
      input.conditions !== undefined ||
      input.actions !== undefined
    )
      this.checkReferences(rule.projectId, rule.trigger, rule.conditions, rule.actions)
    this.db
      .prepare(
        `UPDATE planning_rules SET name = ?, enabled = ?, trigger = ?, conditions = ?, actions = ?,
           updated_at = ? WHERE id = ?`
      )
      .run(
        rule.name,
        rule.enabled ? 1 : 0,
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        rule.updatedAt,
        rule.id
      )
    this.host.changed(rule.projectId)
    return rule
  }

  /** Deletes a rule; what it did stays done. Pass the result to `restore` to undo. */
  delete(ruleId: string): PlanningRuleDeletion {
    const rule = this.get(ruleId)
    this.db.prepare('DELETE FROM planning_rules WHERE id = ?').run(ruleId)
    this.host.changed(rule.projectId)
    return { rule }
  }

  restore(deletion: PlanningRuleDeletion): PlanningRule {
    const saved = deletion?.rule
    if (!saved || typeof saved.id !== 'string' || typeof saved.projectId !== 'string')
      throw new Refusal(t('errors:planningRules.notFound'))
    this.host.requireProject(saved.projectId)
    const exists = this.db.prepare('SELECT 1 FROM planning_rules WHERE id = ?').get(saved.id)
    if (exists) return this.get(saved.id)
    const count = this.rows(saved.projectId).length
    if (count >= MAX_RULES_PER_PROJECT)
      throw new Refusal(t('errors:planningRules.tooMany', { max: MAX_RULES_PER_PROJECT }))
    const definition = parseRuleDefinition(saved)
    this.checkReferences(
      saved.projectId,
      definition.trigger,
      definition.conditions,
      definition.actions
    )
    const rule: PlanningRule = {
      ...definition,
      id: saved.id,
      projectId: saved.projectId,
      lastRunAt: typeof saved.lastRunAt === 'number' ? saved.lastRunAt : null,
      runCount: typeof saved.runCount === 'number' ? saved.runCount : 0,
      createdAt: typeof saved.createdAt === 'number' ? saved.createdAt : Date.now(),
      updatedAt: Date.now()
    }
    this.insert(rule)
    this.host.changed(rule.projectId)
    return rule
  }

  /** "Try it on a task…": what the rule would do to this task, doing nothing. */
  preview(
    projectId: string,
    rule: Pick<CreatePlanningRuleInput, 'conditions' | 'actions'>,
    workItemId: string
  ): PlanningRulePreview {
    this.host.requireProject(projectId)
    const conditions = parseRuleConditions(rule?.conditions ?? [])
    const actions = parseRuleActions(rule?.actions)
    const task = this.host.getWorkItem(workItemId)
    if (task.projectId !== projectId) throw new Refusal(t('errors:planningRules.taskOtherProject'))
    return previewRule({ conditions, actions }, task)
  }

  // ─── Running ──────────────────────────────────────────────────────────────

  /**
   * Applies the rules that `changes` set off, in order, each change's rules
   * oldest first. Call inside the transaction of the write that made the
   * changes. Returns the run, or null when no rule did anything.
   */
  afterChange(changes: RuleChange[], now = Date.now()): PlanningRuleRunSummary | null {
    if (changes.length === 0) return null
    const projectId = changes[0].task.projectId
    const rules = this.rows(projectId).filter((rule) => rule.enabled)
    if (rules.length === 0) return null
    const steps: RunStep[] = []
    for (const change of changes) {
      for (const rule of matchingRules(rules, change)) {
        // Each rule sees what the rules before it did.
        const task = this.host.getWorkItem(change.task.id)
        const step = this.apply(rule, task, now)
        if (step) steps.push(step)
      }
    }
    if (steps.length === 0) return null
    const id = uuidv4()
    this.db
      .prepare(
        `INSERT INTO planning_rule_runs (id, project_id, work_item_id, steps, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, projectId, changes[0].task.id, JSON.stringify(steps), now)
    return { id, ruleNames: [...new Set(steps.map((step) => step.ruleName))] }
  }

  private hasWaitingSignOff(taskId: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM planning_sign_offs WHERE item_kind = 'task' AND item_id = ? AND state = 'waiting' LIMIT 1"
        )
        .get(taskId) !== undefined
    )
  }

  /** One rule on one task. A failure becomes one plain refusal naming the rule. */
  private apply(rule: PlanningRule, task: PlanningWorkItem, now: number): RunStep | null {
    const plan = planActions(task, rule.actions)
    if (!planDoesSomething(plan)) return null
    const actor: PlanningActor = { kind: 'rule', ruleName: rule.name }
    const step: RunStep = {
      ruleId: rule.id,
      ruleName: rule.name,
      workItemId: task.id,
      before: {},
      commentIds: [],
      noticeIds: [],
      archived: false
    }
    // A column deleted since, or now counting as another status: the status's own.
    if (
      plan.patch.columnId &&
      !this.host.columnInProject(plan.patch.columnId, plan.patch.status ?? '', task.projectId)
    )
      plan.patch.columnId = null
    // A task waiting for someone's sign-off cannot be finished (D9): skip just the move to Done
    // and carry on with the rule's other actions, rather than failing the whole change.
    if (plan.patch.status === 'done' && task.status !== 'done' && this.hasWaitingSignOff(task.id)) {
      delete plan.patch.status
      delete plan.patch.columnId
      console.warn(
        `Rule "${rule.name}" did not move task ${task.id} to Done: a sign-off is waiting.`
      )
    }
    try {
      const fields = Object.keys(plan.patch) as (keyof RuleTaskPatch)[]
      if (fields.length > 0) {
        for (const field of fields)
          (step.before as Record<string, unknown>)[field] =
            field === 'assigneeId' || field === 'milestoneId' || field === 'columnId'
              ? (task[field] ?? null)
              : task[field]
        this.host.updateWorkItem(task.id, plan.patch, actor)
      }
      for (const text of plan.comments)
        step.commentIds.push(this.host.addComment(task.id, text, actor).id)
      for (const message of plan.notices) step.noticeIds.push(this.notice(rule, task, message, now))
      if (plan.archive) {
        this.host.archiveWorkItem(task.id, actor)
        step.archived = true
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Refusal(t('errors:planningRules.ruleFailed', { name: rule.name, reason }))
    }
    this.db
      .prepare('UPDATE planning_rules SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?')
      .run(now, rule.id)
    return step
  }

  /**
   * Undoes a run: what its rules did, newest first. Called by the planning
   * service inside the transaction of the person's undoing update.
   */
  undo(runId: string, projectId: string, actor: PlanningActor, now = Date.now()): void {
    if (typeof runId !== 'string' || !runId)
      throw new Refusal(t('errors:planningRules.runNotFound'))
    const run = this.db
      .prepare('SELECT project_id, steps, undone_at FROM planning_rule_runs WHERE id = ?')
      .get(runId) as { project_id: string; steps: string; undone_at: number | null } | undefined
    if (!run || run.project_id !== projectId)
      throw new Refusal(t('errors:planningRules.runNotFound'))
    if (run.undone_at !== null) return
    const steps = JSON.parse(run.steps) as RunStep[]
    this.host.withoutRules(() => {
      for (const step of [...steps].reverse()) {
        if (step.noticeIds.length > 0)
          this.db
            .prepare(
              'DELETE FROM planning_rule_notices WHERE id IN (SELECT value FROM json_each(?))'
            )
            .run(JSON.stringify(step.noticeIds))
        for (const commentId of step.commentIds) this.host.deleteComment(commentId, actor)
        if (step.archived) this.host.unarchiveWorkItem(step.workItemId, actor)
        if (Object.keys(step.before).length > 0)
          this.host.updateWorkItem(step.workItemId, step.before, actor)
      }
    })
    this.db.prepare('UPDATE planning_rule_runs SET undone_at = ? WHERE id = ?').run(now, runId)
  }

  /**
   * The due-date trigger, on the reminder service's schedule: each on rule
   * looks once at each live, unfinished task whose due date has come (today
   * or earlier, but not before the rule was made), each in its own
   * transaction. Returns how many rules did something.
   */
  runDueDates(projectIds: string[], today = todayIsoDate(), now = Date.now()): number {
    let ran = 0
    for (const projectId of projectIds) {
      const rules = this.rows(projectId).filter(
        (rule) => rule.enabled && rule.trigger.kind === 'dueDateReached'
      )
      for (const rule of rules) {
        const since = toIsoDate(new Date(rule.createdAt))
        const due = this.db
          .prepare(
            `SELECT item.id, item.target_date FROM planning_work_items item
             WHERE item.project_id = ? AND item.archived_at IS NULL AND item.deleted_at IS NULL
               AND item.status != 'done' AND item.target_date IS NOT NULL
               AND item.target_date >= ? AND item.target_date <= ?
               AND NOT EXISTS (SELECT 1 FROM planning_rule_due_runs done
                 WHERE done.rule_id = ? AND done.work_item_id = item.id
                   AND done.due_date = item.target_date)`
          )
          .all(projectId, since, today, rule.id) as { id: string; target_date: string }[]
        for (const row of due) {
          if (compareIsoDates(row.target_date, today) > 0) continue
          try {
            this.db.transaction(() => {
              this.db
                .prepare(
                  `INSERT INTO planning_rule_due_runs (rule_id, work_item_id, project_id, due_date, at)
                   VALUES (?, ?, ?, ?, ?)`
                )
                .run(rule.id, row.id, projectId, row.target_date, now)
              const task = this.host.getWorkItem(row.id)
              const [match] = matchingRules([rule], { task, dueDateReached: true })
              if (match && this.apply(match, task, now)) ran += 1
            })()
          } catch (error) {
            // One task's failure leaves the others; it is tried again next time.
            console.error(
              isRefusal(error) ? error.message : `Rule ${rule.id} failed on a due date:`,
              isRefusal(error) ? '' : error
            )
          }
        }
        if (due.length > 0) this.host.changed(projectId)
      }
    }
    return ran
  }

  // ─── Notify me ────────────────────────────────────────────────────────────

  /** Shows each new "Notify me" on the desktop, once its change has been written. */
  setNoticeListener(listener: ((notice: RuleNotice) => void) | null): void {
    this.noticeListener = listener
  }

  private notice(rule: PlanningRule, task: PlanningWorkItem, message: string, now: number): string {
    const id = uuidv4()
    this.db
      .prepare(
        `INSERT INTO planning_rule_notices
           (id, project_id, work_item_id, rule_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, task.projectId, task.id, rule.name, message, now)
    // After the transaction: a change that rolls back leaves no row to show.
    if (this.noticeListener && !this.flushScheduled) {
      this.flushScheduled = true
      setTimeout(() => this.flushNotices(), 0)
    }
    return id
  }

  /** Hands every undelivered notice to the listener and marks it delivered. */
  flushNotices(now = Date.now()): RuleNotice[] {
    this.flushScheduled = false
    // Closing the app can come between the write and the flush.
    if (!this.db.open) return []
    const rows = this.db
      .prepare(
        `SELECT notice.id, notice.project_id, notice.work_item_id, notice.rule_name, notice.message,
                item.title, item.archived_at IS NULL AND item.deleted_at IS NULL AS live
         FROM planning_rule_notices notice
         JOIN planning_work_items item ON item.id = notice.work_item_id
         WHERE notice.delivered_at IS NULL ORDER BY notice.created_at`
      )
      .all() as {
      id: string
      project_id: string
      work_item_id: string
      rule_name: string
      message: string
      title: string
      live: number
    }[]
    if (rows.length === 0) return []
    this.db
      .prepare(
        'UPDATE planning_rule_notices SET delivered_at = ? WHERE id IN (SELECT value FROM json_each(?))'
      )
      .run(now, JSON.stringify(rows.map((row) => row.id)))
    const notices = rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      workItemId: row.work_item_id,
      ruleName: row.rule_name,
      message: row.message,
      taskTitle: row.title,
      taskLive: row.live === 1
    }))
    for (const notice of notices) {
      try {
        this.noticeListener?.(notice)
      } catch (error) {
        console.error('Rule notice listener failed:', error)
      }
    }
    return notices
  }

  // ─── Rows ─────────────────────────────────────────────────────────────────

  private rows(projectId: string): PlanningRule[] {
    const rows = this.db
      .prepare('SELECT * FROM planning_rules WHERE project_id = ? ORDER BY created_at, rowid')
      .all(projectId) as RuleRow[]
    return rows.map(toRule)
  }

  private insert(rule: PlanningRule): void {
    this.db
      .prepare(
        `INSERT INTO planning_rules
           (id, project_id, name, enabled, trigger, conditions, actions, last_run_at, run_count,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rule.id,
        rule.projectId,
        rule.name,
        rule.enabled ? 1 : 0,
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        rule.lastRunAt,
        rule.runCount,
        rule.createdAt,
        rule.updatedAt
      )
  }

  /** The people, milestones, fields and columns a rule names are real and the project's. */
  private checkReferences(
    projectId: string,
    trigger: PlanningRuleTrigger,
    conditions: PlanningRuleCondition[],
    actions: PlanningRuleAction[]
  ): void {
    const person = (id: string | null) => {
      if (id !== null && !this.host.personExists(id, projectId))
        throw new Refusal(t('errors:planningRules.personInvalid'))
    }
    const milestone = (id: string | null) => {
      if (id !== null && !this.host.milestoneInProject(id, projectId))
        throw new Refusal(t('errors:planningRules.milestoneInvalid'))
    }
    const column = (id: string | undefined, status: string) => {
      if (id !== undefined && !this.host.columnInProject(id, status, projectId))
        throw new Refusal(t('errors:planningService.columnNotFound'))
    }
    if (trigger.kind === 'statusChanged') column(trigger.toColumnId, trigger.to)
    for (const condition of conditions) {
      if (condition.kind === 'status') column(condition.columnId, condition.status)
      if (condition.kind === 'assignee') person(condition.personId)
      if (condition.kind === 'milestone') milestone(condition.milestoneId)
      if (condition.kind === 'field' && !this.host.fieldInProject(condition.fieldId, projectId))
        throw new Refusal(t('errors:planningRules.fieldInvalid'))
    }
    for (const action of actions) {
      if (action.kind === 'setStatus') column(action.columnId, action.status)
      if (action.kind === 'setAssignee') person(action.personId)
      if (action.kind === 'setMilestone') milestone(action.milestoneId)
    }
  }
}

function toRule(row: RuleRow): PlanningRule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    enabled: row.enabled === 1,
    trigger: JSON.parse(row.trigger) as PlanningRuleTrigger,
    conditions: JSON.parse(row.conditions) as PlanningRuleCondition[],
    actions: JSON.parse(row.actions) as PlanningRuleAction[],
    lastRunAt: row.last_run_at,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
