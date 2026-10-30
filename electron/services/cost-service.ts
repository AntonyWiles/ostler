import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  COST_STATES,
  defaultCurrency,
  isCurrencyCode,
  MAX_MINOR_UNITS,
  parseCostFields,
  summarizeCosts,
  type Cost,
  type CostInput,
  type CostQuery,
  type CostState,
  type MoneySummary,
  type ProjectBudget
} from '@shared/money'
import { Refusal } from '@shared/refusal'

interface CostRow {
  id: string
  project_id: string
  date: string
  amount: number
  description: string
  category: string
  work_item_id: string | null
  milestone_id: string | null
  state: CostState
  created_at: number
  updated_at: number
}

/** A cost as the project file and a template carry it: links by id, for the caller to map. */
export type StoredCost = Omit<Cost, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>

/**
 * Budgets and costs (N6.3a, N46). The desktop app and the automation API both
 * write through here, on the planning connection, so the Costs view, the
 * Overview's Budget card, the drawer, a milestone's card, the CSV and the
 * project file all see the same money. Amounts are whole minor units.
 */
export class CostService {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[],
    private readonly changed: (projectId: string) => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  /** The project's budget; with none set, no amount and the region's currency. */
  getBudget(projectId: string): ProjectBudget {
    this.requireProject(projectId)
    const row = this.db
      .prepare('SELECT amount, currency FROM project_budgets WHERE project_id = ?')
      .get(projectId) as { amount: number | null; currency: string } | undefined
    return {
      projectId,
      amount: row?.amount ?? null,
      currency: row?.currency ?? defaultCurrency()
    }
  }

  /** Sets the budget's amount (null for none) and currency; a field left out keeps its value. */
  setBudget(projectId: string, input: unknown): ProjectBudget {
    const current = this.getBudget(projectId)
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Refusal('A budget must be an object: { amount, currency }')
    const value = input as Record<string, unknown>
    for (const key of Object.keys(value)) {
      if (key !== 'amount' && key !== 'currency') throw new Refusal(`A budget has no field ${key}`)
    }
    let amount = current.amount
    if (value.amount !== undefined) {
      if (
        value.amount !== null &&
        (typeof value.amount !== 'number' ||
          !Number.isSafeInteger(value.amount) ||
          value.amount < 0 ||
          value.amount > MAX_MINOR_UNITS)
      )
        throw new Refusal('amount must be a whole number of minor units (pence, cents), or null')
      amount = value.amount as number | null
    }
    let currency = current.currency
    if (value.currency !== undefined) {
      if (!isCurrencyCode(value.currency))
        throw new Refusal('currency must be an ISO 4217 code, such as GBP, EUR or USD')
      currency = value.currency
    }
    this.db
      .prepare(
        `INSERT INTO project_budgets (project_id, amount, currency, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET amount = excluded.amount,
           currency = excluded.currency, updated_at = excluded.updated_at`
      )
      .run(projectId, amount, currency, this.now())
    this.changed(projectId)
    return this.getBudget(projectId)
  }

  /** A project's costs, by date, filtered by category, state, task or milestone. */
  list(projectId: string, query: CostQuery = {}): Cost[] {
    this.requireProject(projectId)
    const where = ['project_id = ?']
    const args: unknown[] = [projectId]
    if (query.category !== undefined) {
      where.push('category = ?')
      args.push(query.category)
    }
    if (query.state !== undefined) {
      if (!COST_STATES.includes(query.state)) throw new Refusal('state must be planned or paid')
      where.push('state = ?')
      args.push(query.state)
    }
    if (query.workItemId !== undefined) {
      where.push('work_item_id = ?')
      args.push(query.workItemId)
    }
    if (query.milestoneId !== undefined) {
      where.push('milestone_id = ?')
      args.push(query.milestoneId)
    }
    const rows = this.db
      .prepare(`SELECT * FROM costs WHERE ${where.join(' AND ')} ORDER BY date, created_at, rowid`)
      .all(...args) as CostRow[]
    return rows.map(toCost)
  }

  get(projectId: string, costId: unknown): Cost {
    return toCost(this.row(projectId, costId))
  }

  /**
   * Budget, paid, planned, total and left, by category and by milestone: the
   * Overview's card and a milestone's total, from one grouped query.
   */
  summary(projectId: string): MoneySummary {
    const budget = this.getBudget(projectId)
    const rows = this.db
      .prepare(
        `SELECT state, category, milestone_id AS milestoneId, SUM(amount) AS amount, COUNT(*) AS n
         FROM costs WHERE project_id = ? GROUP BY state, category, milestone_id`
      )
      .all(projectId) as Array<{
      state: CostState
      category: string
      milestoneId: string | null
      amount: number
      n: number
    }>
    const summary = summarizeCosts(rows, budget.amount, budget.currency)
    summary.count = rows.reduce((sum, row) => sum + row.n, 0)
    // The shopping list's unbought estimates (N6.3b), kept apart from planned
    // costs. Unbought as the list reads it: no paid cost behind the item.
    summary.stillToBuy = (
      this.db
        .prepare(
          `SELECT COALESCE(SUM(s.estimate), 0) AS amount FROM shopping_items s
           LEFT JOIN costs k ON k.id = s.cost_id
           WHERE s.project_id = ? AND (k.id IS NULL OR k.state <> 'paid')`
        )
        .get(projectId) as { amount: number }
    ).amount
    return summary
  }

  /** The categories the project has used, most used first: what the category field offers. */
  categories(projectId: string): string[] {
    this.requireProject(projectId)
    return (
      this.db
        .prepare(
          `SELECT category FROM costs WHERE project_id = ? AND category <> ''
           GROUP BY category ORDER BY COUNT(*) DESC, MAX(updated_at) DESC, category`
        )
        .all(projectId) as { category: string }[]
    ).map((row) => row.category)
  }

  create(projectId: string, input: unknown): Cost {
    this.requireProject(projectId)
    const fields = this.parse(input, false)
    this.checkLinks(projectId, fields)
    const id = uuidv4()
    const at = this.now()
    this.db
      .prepare(
        `INSERT INTO costs (id, project_id, date, amount, description, category, work_item_id,
           milestone_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        fields.date,
        fields.amount,
        fields.description,
        fields.category ?? '',
        fields.workItemId ?? null,
        fields.milestoneId ?? null,
        fields.state ?? 'planned',
        at,
        at
      )
    this.changed(projectId)
    return this.get(projectId, id)
  }

  /** Changes the fields given; returns the cost as it was and as it is. */
  update(projectId: string, costId: unknown, input: unknown): { before: Cost; after: Cost } {
    const row = this.row(projectId, costId)
    const fields = this.parse(input, true)
    this.checkLinks(projectId, fields)
    const before = toCost(row)
    const next = { ...before, ...fields }
    this.db
      .prepare(
        `UPDATE costs SET date = ?, amount = ?, description = ?, category = ?, work_item_id = ?,
           milestone_id = ?, state = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        next.date,
        next.amount,
        next.description,
        next.category,
        next.workItemId,
        next.milestoneId,
        next.state,
        this.now(),
        row.id
      )
    this.changed(projectId)
    return { before, after: this.get(projectId, row.id) }
  }

  /** Mark as paid: the state, and the paid date and amount when given. */
  markPaid(projectId: string, costId: unknown, input: unknown = {}): Cost {
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const patch: Record<string, unknown> = { state: 'paid' }
    if (value.date !== undefined) patch.date = value.date
    if (value.amount !== undefined) patch.amount = value.amount
    return this.update(projectId, costId, patch).after
  }

  /**
   * Deletes a cost; `restore` with what it returns puts it back (Undo). A
   * shopping item it recorded (N6.3b) is unticked by the foreign key; what
   * this returns names that item, so Undo ticks it again.
   */
  delete(projectId: string, costId: unknown): Cost {
    const row = this.row(projectId, costId)
    const item = this.db.prepare('SELECT id FROM shopping_items WHERE cost_id = ?').get(row.id) as
      { id: string } | undefined
    this.db.prepare('DELETE FROM costs WHERE id = ?').run(row.id)
    this.changed(projectId)
    return item ? { ...toCost(row), shoppingItemId: item.id } : toCost(row)
  }

  /** Puts a deleted cost back with its id and times; a link to a task or milestone gone since is cleared. */
  restore(projectId: string, cost: unknown): Cost {
    this.requireProject(projectId)
    const value = (cost && typeof cost === 'object' ? cost : {}) as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id) throw new Refusal('Cost not found')
    const fields = this.parse(
      {
        date: value.date,
        amount: value.amount,
        description: value.description,
        category: value.category,
        state: value.state
      },
      false
    )
    const workItemId = this.linkOrNull('planning_work_items', projectId, value.workItemId)
    const milestoneId = this.linkOrNull('planning_milestones', projectId, value.milestoneId)
    const at = this.now()
    const time = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : at)
    this.db
      .prepare(
        `INSERT OR IGNORE INTO costs (id, project_id, date, amount, description, category,
           work_item_id, milestone_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        value.id,
        projectId,
        fields.date,
        fields.amount,
        fields.description,
        fields.category ?? '',
        workItemId,
        milestoneId,
        fields.state,
        time(value.createdAt),
        time(value.updatedAt)
      )
    // The shopping item it recorded, if that is still on the list and unticked.
    if (typeof value.shoppingItemId === 'string')
      this.db
        .prepare(
          `UPDATE shopping_items SET cost_id = ? WHERE id = ? AND project_id = ? AND cost_id IS NULL`
        )
        .run(value.id, value.shoppingItemId, projectId)
    this.changed(projectId)
    return this.get(projectId, value.id)
  }

  /** Writes costs from a project file or template into a new project, and returns their ids in order. Links are already mapped. */
  importCosts(projectId: string, costs: StoredCost[]): string[] {
    const insert = this.db.prepare(
      `INSERT INTO costs (id, project_id, date, amount, description, category, work_item_id,
         milestone_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const at = this.now()
    const ids = costs.map(() => uuidv4())
    this.db.transaction(() => {
      costs.forEach((cost, index) =>
        insert.run(
          ids[index],
          projectId,
          cost.date,
          cost.amount,
          cost.description,
          cost.category,
          cost.workItemId,
          cost.milestoneId,
          cost.state,
          at + index,
          at + index
        )
      )
    })()
    return ids
  }

  /** Writes a budget from a project file or template. */
  importBudget(projectId: string, budget: { amount: number | null; currency: string }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_budgets (project_id, amount, currency, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(projectId, budget.amount, budget.currency, this.now())
  }

  /** Whether the project has a budget row of its own (set, or imported). */
  hasBudget(projectId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM project_budgets WHERE project_id = ?').get(projectId) !==
      undefined
    )
  }

  private parse(input: unknown, partial: boolean): CostInput {
    try {
      return parseCostFields(input, partial)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }

  /** A task or milestone named must be this project's. */
  private checkLinks(projectId: string, fields: CostInput): void {
    if (fields.workItemId && !this.belongs('planning_work_items', projectId, fields.workItemId))
      throw new Refusal('Task not found in this project')
    if (fields.milestoneId && !this.belongs('planning_milestones', projectId, fields.milestoneId))
      throw new Refusal('Milestone not found in this project')
  }

  private linkOrNull(table: string, projectId: string, id: unknown): string | null {
    return typeof id === 'string' && this.belongs(table, projectId, id) ? id : null
  }

  private belongs(table: string, projectId: string, id: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM ${table} WHERE id = ? AND project_id = ?`)
        .get(id, projectId) !== undefined
    )
  }

  private requireProject(projectId: unknown): string {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId)) {
      throw new Refusal('Project not found')
    }
    return projectId
  }

  private row(projectId: string, costId: unknown): CostRow {
    this.requireProject(projectId)
    if (typeof costId !== 'string') throw new Refusal('Cost not found')
    const row = this.db
      .prepare('SELECT * FROM costs WHERE id = ? AND project_id = ?')
      .get(costId, projectId) as CostRow | undefined
    if (!row) throw new Refusal('Cost not found')
    return row
  }
}

function toCost(row: CostRow): Cost {
  return {
    id: row.id,
    projectId: row.project_id,
    date: row.date,
    amount: row.amount,
    description: row.description,
    category: row.category,
    workItemId: row.work_item_id,
    milestoneId: row.milestone_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
