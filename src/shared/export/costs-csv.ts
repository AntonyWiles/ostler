import type { Cost, CurrencyCode } from '../money'
import { moneyPlainText } from '../money'
import { csvRecord } from './task-csv'

/**
 * Costs as CSV (N6.3a): the one writer for "Export costs to CSV" and
 * `GET /costs?format=csv`. UTF-8 with a BOM, RFC 4180 quoting and CRLF, as
 * the task export writes. The amount is a plain number with a dot (no
 * symbol, no grouping), so a spreadsheet adds it up; the currency has its
 * own column.
 */
export const COST_CSV_HEADER = [
  'Date',
  'Description',
  'Category',
  'Task',
  'Milestone',
  'State',
  'Amount',
  'Currency'
] as const

export interface CostCsvContext {
  currency: CurrencyCode
  taskTitle(id: string): string | null
  milestoneName(id: string): string | null
}

const STATE_WORDS = { planned: 'Planned', paid: 'Paid' } as const

export function costsToCsv(costs: readonly Cost[], context: CostCsvContext): string {
  const lines = [csvRecord([...COST_CSV_HEADER])]
  for (const cost of costs) {
    lines.push(
      csvRecord([
        cost.date,
        cost.description,
        cost.category,
        cost.workItemId ? (context.taskTitle(cost.workItemId) ?? '') : '',
        cost.milestoneId ? (context.milestoneName(cost.milestoneId) ?? '') : '',
        STATE_WORDS[cost.state],
        moneyPlainText(cost.amount, context.currency),
        context.currency
      ])
    )
  }
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`
}
