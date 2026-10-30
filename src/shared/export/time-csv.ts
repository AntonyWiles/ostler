import type { TimeEntry } from '../ostler-api'
import { csvHours } from '../time/duration'
import { entryDay, entrySeconds } from '../time/timesheet'
import { csvRecord } from './task-csv'

/**
 * Time entries as CSV (R2.3, D33): date, project, task, person, duration and
 * note, one record per entry in start order. The duration is in hours as a
 * plain number (`1.5`), so a spreadsheet can sum the column. The same file
 * shape as the task export: UTF-8 with a BOM, CRLF. The one writer, for the
 * Timesheet's Export CSV and `GET /time-entries?format=csv`.
 */

const UTF8_BOM = String.fromCharCode(0xfeff)

export const TIME_CSV_HEADERS = ['Date', 'Project', 'Task', 'Person', 'Duration (hours)', 'Note']

export interface TimeCsvContext {
  projectName: (projectId: string) => string
  personName: (personId: string) => string | null
  now: number
}

export function timeEntriesToCsv(entries: readonly TimeEntry[], context: TimeCsvContext): string {
  const records = [...entries]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((entry) =>
      csvRecord([
        entryDay(entry),
        context.projectName(entry.projectId),
        entry.workItemTitle,
        entry.personId ? (context.personName(entry.personId) ?? '') : '',
        csvHours(entrySeconds(entry, context.now)),
        entry.note
      ])
    )
  return `${UTF8_BOM}${[csvRecord(TIME_CSV_HEADERS), ...records].join('\r\n')}\r\n`
}
