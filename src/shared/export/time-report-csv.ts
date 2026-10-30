import { moneyPlainText } from '../money'
import { toIsoDate } from '../dates'
import { csvHours } from '../time/duration'
import { entryDay } from '../time/timesheet'
import { entryAmount, type TimeReport } from '../time/billing'
import { csvRecord } from './task-csv'

/**
 * The Time report as CSV (N6.4): one record per finished entry in the range,
 * in start order, billed and unbilled alike. Hours are a plain number and the
 * amount a plain decimal with a dot in the project's currency, so a
 * spreadsheet can sum them; an entry's amount is for reading only (the
 * report's totals round once, at the end). Billed is the day its billing was
 * marked, empty when unbilled. UTF-8 with a BOM, CRLF, as every Ostler CSV.
 * The one writer, for the app's Export CSV and `GET /time-report?format=csv`.
 */

const UTF8_BOM = String.fromCharCode(0xfeff)

export const TIME_REPORT_CSV_HEADERS = [
  'Date',
  'Task',
  'Person',
  'Note',
  'Hours',
  'Billable',
  'Amount',
  'Billed'
]

export function timeReportToCsv(
  report: TimeReport,
  personName: (personId: string) => string | null
): string {
  const billings = new Map(report.billings.map((billing) => [billing.id, billing]))
  const entries = [...report.unbilled.tasks, ...report.billed.tasks]
    .flatMap((task) => task.entries)
    .sort((a, b) => a.startedAt - b.startedAt)
  const records = entries.map((entry) => {
    const amount = entryAmount(entry, report, billings)
    const billing = entry.billingId ? billings.get(entry.billingId) : undefined
    return csvRecord([
      entryDay(entry),
      entry.workItemTitle,
      entry.personId ? (personName(entry.personId) ?? '') : '',
      entry.note,
      csvHours(entry.durationSeconds ?? 0),
      entry.billable ? 'yes' : 'no',
      amount === null ? '' : moneyPlainText(amount, billing?.currency ?? report.currency),
      billing ? toIsoDate(new Date(billing.markedAt)) : ''
    ])
  })
  return `${UTF8_BOM}${[csvRecord(TIME_REPORT_CSV_HEADERS), ...records].join('\r\n')}\r\n`
}
