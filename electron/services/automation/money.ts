import { COST_STATES, type CostQuery, type CostState } from '@shared/money'
import { Refusal } from '@shared/refusal'
import { buildCostsCsv, buildTimeReportCsv } from '../export-service'
import { respondJson } from '../loopback-http'
import { planningChanged, planningOf, respondCsv } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The budget with what has been planned and paid against it. */
function budgetWithSummary({ server, project }: RouteCall) {
  const costs = planningOf(server).costs
  return { ...costs.getBudget(project.id), summary: costs.summary(project.id) }
}

/**
 * Money (N6.3, N6.4, N7.4): the budget and costs, the shopping list,
 * baselines, and billable time (the rate and default, the Time report and
 * billings), each through the app's own service.
 */
export const MONEY_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/budget',
    description:
      "Read this project's budget: amount in whole minor units of its currency (pence, cents; a JPY amount has no decimals and a KWD one three), or null when no budget is set, and currency, an ISO 4217 code (the person's region's currency until one is chosen). summary carries what the Overview's Budget card shows: paid, planned, total (paid plus planned), left (budget minus total, null without a budget; negative is over budget), over, byCategory [{ category, paid, planned, total }] ('' is no category) and byMilestone { milestoneId: { paid, planned, total } }. Every amount is in the project's currency: Ostler never converts.",
    response:
      '{ ok: true, value: { projectId, amount: number | null, currency, summary: MoneySummary } }',
    handler: (call) => respondJson(call.res, 200, { ok: true, value: budgetWithSummary(call) })
  },
  {
    method: 'PUT',
    path: '/budget',
    description:
      'Set the budget, as Set a budget does in the app. A field left out keeps its value; amount null removes the budget (costs stay). Changing the currency relabels every amount; nothing is converted. A bad amount or currency is HTTP 400.',
    request: 'JSON body: { amount?: number | null (minor units), currency?: "GBP" | "EUR" | … }',
    response: '{ ok: true, value: { projectId, amount, currency, summary } }',
    exampleBody: { amount: 500000, currency: 'GBP' },
    handler: (call) => {
      planningOf(call.server).costs.setBudget(call.project.id, call.body)
      planningChanged(call, 'PUT budget', budgetWithSummary(call))
    }
  },
  {
    method: 'GET',
    path: '/costs',
    description:
      "List this project's costs, by date (then the order they were made). A cost is { id, projectId, date (YYYY-MM-DD), amount (minor units), description, category, workItemId, milestoneId, state: planned | paid, createdAt, updatedAt }. Filters: ?category= (exact; empty for no category), ?state=planned|paid, ?workItemId=, ?milestoneId=. ?format=csv returns the CSV the app's Export costs to CSV writes (UTF-8 with a BOM, RFC 4180 quoting, Content-Type text/csv): Date, Description, Category, Task, Milestone, State, Amount (a plain number with a dot), Currency, with the same filters.",
    response: '{ ok: true, value: Cost[] } (format=csv: text/csv)',
    handler: ({ server, res, project, query: params }) => {
      const state = params.get('state')
      if (state !== null && !COST_STATES.includes(state as CostState))
        throw new Refusal('state must be planned or paid')
      const query: CostQuery = {
        ...(params.has('category') ? { category: params.get('category') ?? '' } : {}),
        ...(state !== null ? { state: state as CostState } : {}),
        ...(params.get('workItemId') ? { workItemId: params.get('workItemId')! } : {}),
        ...(params.get('milestoneId') ? { milestoneId: params.get('milestoneId')! } : {})
      }
      const planning = planningOf(server)
      if (params.get('format') === 'csv')
        return respondCsv(res, buildCostsCsv(planning, project.id, query).text)
      respondJson(res, 200, { ok: true, value: planning.costs.list(project.id, query) })
    }
  },
  {
    method: 'POST',
    path: '/costs',
    description:
      "Add a cost, as the Costs view does. description is required (trimmed, at most 200 characters); category is free text (at most 60); workItemId and milestoneId, when given, must be this project's; state defaults to planned. A deleted task or milestone keeps its costs and clears the link.",
    request:
      'JSON body: { date: "YYYY-MM-DD", amount: number (minor units), description: string, category?: string, workItemId?: string | null, milestoneId?: string | null, state?: "planned" | "paid" }',
    response: '{ ok: true, value: Cost }',
    exampleBody: {
      date: '2026-11-02',
      amount: 12000,
      description: 'Venue deposit',
      category: 'Venue',
      state: 'planned'
    },
    handler: (call) =>
      planningChanged(
        call,
        'POST cost',
        planningOf(call.server).costs.create(call.project.id, call.body)
      )
  },
  {
    method: 'GET',
    path: '/costs/:costId',
    description: "One cost of this project. An unknown id, or another project's, is HTTP 400.",
    response: '{ ok: true, value: Cost }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).costs.get(project.id, params.costId!)
      })
  },
  {
    method: 'PATCH',
    path: '/costs/:costId',
    description:
      'Change a cost: only the fields given. Mark as paid is { state: "paid" }, with the paid date and amount when they differ from the plan.',
    request: 'JSON body: any of the POST fields',
    response: '{ ok: true, value: Cost }',
    exampleBody: { state: 'paid', date: '2026-11-04', amount: 11500 },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH cost',
        planningOf(call.server).costs.update(call.project.id, call.params.costId!, call.body).after
      )
  },
  {
    method: 'DELETE',
    path: '/costs/:costId',
    description:
      "Delete a cost. The app's Undo can bring it back; through the API it is gone from every list.",
    response: '{ ok: true, value: Cost } (what was deleted)',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE cost',
        planningOf(call.server).costs.delete(call.project.id, call.params.costId!)
      )
  },
  {
    method: 'GET',
    path: '/shopping',
    description:
      "List this project's shopping list in its order, bought items too. An item is { id, projectId, name, quantity (more than 0, may have decimals), unit ('' for none), estimate (minor units for the whole line, or null), contactId (the supplier, a contact; see GET /contacts) and supplierName, workItemId, orderKey, costId (the paid cost buying it made, or null while it is still to buy), boughtOn and pricePaid (that cost's date and amount, or null), createdAt, updatedAt }. The paid cost is the one record of the purchase: GET /budget's summary counts it, and its summary.stillToBuy is the unbought items' estimates, kept apart from planned costs.",
    response: '{ ok: true, value: ShoppingItem[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).shopping.list(project.id) })
  },
  {
    method: 'POST',
    path: '/shopping',
    description:
      "Add an item, as the Shopping list's Add item does, at the end unless afterId (null for first) or beforeId places it. name is required (trimmed, at most 200 characters); quantity defaults to 1; unit is free text (at most 20); contactId must be a contact and workItemId this project's task. A deleted task or contact clears the link and keeps the item.",
    request:
      'JSON body: { name: string, quantity?: number, unit?: string, estimate?: number | null (minor units), contactId?: string | null, workItemId?: string | null, afterId?: string | null, beforeId?: string }',
    response: '{ ok: true, value: ShoppingItem }',
    exampleBody: { name: 'Wall plugs', quantity: 3, unit: 'packs', estimate: 450 },
    handler: (call) =>
      planningChanged(
        call,
        'POST shopping item',
        planningOf(call.server).shopping.create(call.project.id, call.body)
      )
  },
  {
    method: 'PATCH',
    path: '/shopping/:itemId',
    description:
      'Change an item: only the fields given. afterId (null for first) or beforeId moves it. Renaming a bought item leaves its cost as it is; change the price paid on the cost (PATCH /costs/:costId).',
    request: 'JSON body: any of the POST fields',
    response: '{ ok: true, value: ShoppingItem }',
    exampleBody: { quantity: 4, afterId: null },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH shopping item',
        planningOf(call.server).shopping.update(call.project.id, call.params.itemId!, call.body)
          .after
      )
  },
  {
    method: 'DELETE',
    path: '/shopping/:itemId',
    description:
      "Delete an item. A bought item's paid cost stays: it is the record of what was spent.",
    response: '{ ok: true, value: ShoppingItem } (what was deleted)',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE shopping item',
        planningOf(call.server).shopping.delete(call.project.id, call.params.itemId!)
      )
  },
  {
    method: 'POST',
    path: '/shopping/:itemId/bought',
    description:
      "Tick an item as bought, as ticking it in the app does: in one transaction, a paid cost (POST /costs) with pricePaid and date, the item's name as its description, the category Shopping and the item's task, and the item pointing at it. An item already bought is HTTP 400.",
    request: 'JSON body: { pricePaid: number (minor units), date: "YYYY-MM-DD" }',
    response: '{ ok: true, value: { item: ShoppingItem, cost: Cost } }',
    exampleBody: { pricePaid: 425, date: '2026-10-18' },
    handler: (call) =>
      planningChanged(
        call,
        'POST shopping item',
        planningOf(call.server).shopping.buy(call.project.id, call.params.itemId!, call.body)
      )
  },
  {
    method: 'DELETE',
    path: '/shopping/:itemId/bought',
    description:
      'Untick an item: deletes the paid cost buying it made, so it is still to buy again. Deleting that cost through DELETE /costs/:costId unticks it too.',
    response: '{ ok: true, value: { item: ShoppingItem, cost: Cost } } (the cost deleted)',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE shopping item',
        planningOf(call.server).shopping.unbuy(call.project.id, call.params.itemId!)
      )
  },
  {
    method: 'GET',
    path: '/baselines',
    description:
      "List this project's baselines, newest first: named, dated snapshots of every live task's and milestone's dates, at most 10 per project. A baseline is { id, projectId, name (1 to 80 characters), savedAt (epoch ms), taskCount, milestoneCount }. A baseline is history: nothing later changes it, moving a task never changes it, and deleting a task or milestone keeps its entry.",
    response: '{ ok: true, value: Baseline[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).baselines.list(project.id) })
  },
  {
    method: 'POST',
    path: '/baselines',
    description:
      "Save a baseline, as the Timeline's Save a baseline does: in one transaction, every task's start and due date and every milestone's target date, archived and binned items left out. With 10 already, the save is HTTP 400 unless replaceId names the baseline to delete to make room.",
    request: 'JSON body: { name: string, replaceId?: string }',
    response: '{ ok: true, value: Baseline }',
    exampleBody: { name: 'Plan agreed 3 October' },
    handler: (call) =>
      planningChanged(
        call,
        'POST baseline',
        planningOf(call.server).baselines.create(call.project.id, call.body)
      )
  },
  {
    method: 'GET',
    path: '/baselines/:baselineId',
    description:
      "A baseline with its entries: [{ kind: 'task' | 'milestone', itemId, start (YYYY-MM-DD or null; always null for a milestone), due (the due or target date, or null) }], the dates as they were when it was saved.",
    response: '{ ok: true, value: Baseline & { entries: BaselineEntry[] } }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).baselines.get(project.id, params.baselineId!)
      })
  },
  {
    method: 'PATCH',
    path: '/baselines/:baselineId',
    description: 'Rename a baseline. Its dates never change.',
    request: 'JSON body: { name: string }',
    response: '{ ok: true, value: Baseline }',
    exampleBody: { name: 'Plan agreed with the client' },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH baseline',
        planningOf(call.server).baselines.rename(
          call.project.id,
          call.params.baselineId!,
          call.body
        ).after
      )
  },
  {
    method: 'DELETE',
    path: '/baselines/:baselineId',
    description: "Delete a baseline and its entries. The app's Undo can bring it back.",
    response: '{ ok: true, value: Baseline & { entries: BaselineEntry[] } } (what was deleted)',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE baseline',
        planningOf(call.server).baselines.delete(call.project.id, call.params.baselineId!)
      )
  },
  {
    method: 'GET',
    path: '/baselines/:baselineId/compare',
    description:
      "How today's live plan compares with a baseline, by the same rule the Timeline and milestone cards use. changes: [{ kind, itemId, baseline: { start, due }, current: { start, due }, startDays, dueDays }] for items in both, in calendar days, positive later, null when either side has no such date; added: items new since the baseline; gone: items in the baseline no longer in the plan (deleted, archived or binned); summary: { later, earlier, unchanged, added }, counting tasks only (a task moved by its due date, or its start when either side has no due date).",
    response:
      '{ ok: true, value: { baselineId, name, savedAt, changes: BaselineItemChange[], added: { kind, itemId }[], gone: { kind, itemId }[], summary: { later, earlier, unchanged, added } } }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).baselines.compare(project.id, params.baselineId!)
      })
  },
  {
    method: 'GET',
    path: '/billing-settings',
    description:
      "Read this project's billing settings: hourlyRate in whole minor units of the project's currency per hour (see GET /budget), or null for no rate, and newTimeBillable, whether new time entries (timer or by hand) start billable.",
    response:
      '{ ok: true, value: { projectId, hourlyRate: number | null, newTimeBillable, currency } }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).billing.getSettings(project.id) })
  },
  {
    method: 'PUT',
    path: '/billing-settings',
    description:
      'Set the hourly rate and the default, as Project settings does. A field left out keeps its value; hourlyRate null removes the rate. Changing newTimeBillable changes no existing entry; changing the rate changes unbilled amounts only (billings keep the totals they were marked with).',
    request:
      'JSON body: { hourlyRate?: number | null (minor units per hour), newTimeBillable?: boolean }',
    response: '{ ok: true, value: { projectId, hourlyRate, newTimeBillable, currency } }',
    exampleBody: { hourlyRate: 6500, newTimeBillable: true },
    handler: (call) =>
      planningChanged(
        call,
        'PUT billing settings',
        planningOf(call.server).billing.setSettings(call.project.id, call.body)
      )
  },
  {
    method: 'GET',
    path: '/time-report',
    description:
      "The Time report for local days from to to (inclusive, YYYY-MM-DD, both required); an entry counts on the day it started, as on the Timesheet. totals, unbilled and billed are { seconds, billableSeconds, amount } (amount in minor units: billable hours times the rate, rounded once at the end of each total, or null without a rate); unbilled and billed also have tasks [{ workItemId, title, seconds, billableSeconds, amount, entries: TimeEntry[] }]. Billed time is charged at its billing's rate. running lists a running timer's entry, never counted. billings lists every billing of the project, newest first. ?format=csv returns the report's CSV (UTF-8 with a BOM, Content-Type text/csv): Date, Task, Person, Note, Hours (a plain number), Billable (yes or no), Amount (a plain decimal with a dot), Billed (the day its billing was marked, or empty).",
    response: '{ ok: true, value: TimeReport } (format=csv: text/csv)',
    handler: ({ server, res, project, query }) => {
      const planning = planningOf(server)
      const from = query.get('from')
      const to = query.get('to')
      if (query.get('format') === 'csv')
        return respondCsv(res, buildTimeReportCsv(planning, project.id, from, to).text)
      respondJson(res, 200, { ok: true, value: planning.billing.report(project.id, from, to) })
    }
  },
  {
    method: 'GET',
    path: '/billings',
    description:
      "List this project's billings, newest first. A billing is { id, projectId, from, to (YYYY-MM-DD), markedAt (epoch ms), entryCount, billableSeconds, hourlyRate, amount (minor units or null), currency }: the totals when it was marked.",
    response: '{ ok: true, value: Billing[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).billing.listBillings(project.id)
      })
  },
  {
    method: 'POST',
    path: '/billings',
    description:
      "Mark as billed: the range's finished, billable, unbilled entries join a new billing, which keeps their hours and amount at today's rate, and they are locked until it is unmarked. A running timer is not billed. No such time in the range is HTTP 400.",
    request: 'JSON body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }',
    response: '{ ok: true, value: Billing }',
    exampleBody: { from: '2026-10-01', to: '2026-10-31' },
    handler: (call) =>
      planningChanged(
        call,
        'POST billing',
        planningOf(call.server).billing.markBilled(call.project.id, call.body)
      )
  },
  {
    method: 'GET',
    path: '/billings/:billingId',
    description:
      "One billing of this project, with the totals it kept when it was marked. An unknown id, or another project's, is HTTP 400.",
    response: '{ ok: true, value: Billing }',
    handler: ({ server, res, project, params }) =>
      respondJson(res, 200, {
        ok: true,
        value: planningOf(server).billing.getBilling(project.id, params.billingId!)
      })
  },
  {
    method: 'DELETE',
    path: '/billings/:billingId',
    description:
      'Unmark a billing: it goes, and its entries are unlocked. The response is { billing, entryIds }; POST it to /billings/restore to undo.',
    response: '{ ok: true, value: { billing: Billing, entryIds: string[] } }',
    handler: (call) =>
      planningChanged(
        call,
        'DELETE billing',
        planningOf(call.server).billing.unmark(call.project.id, call.params.billingId!)
      )
  },
  {
    method: 'POST',
    path: '/billings/restore',
    description:
      'Undo an unmark: the same billing with its kept totals, and those of its entries that are still unbilled and billable.',
    request: 'JSON body: the value DELETE /billings/:billingId returned.',
    response: '{ ok: true, value: Billing }',
    handler: (call) =>
      planningChanged(
        call,
        'POST billing',
        planningOf(call.server).billing.restore(call.project.id, call.body)
      )
  }
]
