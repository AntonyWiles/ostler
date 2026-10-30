import type { RoundComparison } from '../ostler-api'
import { csvHours } from '../time/duration'
import { csvRecord } from './task-csv'

/**
 * Compare rounds' table as CSV (N5.7b): a record per task, a column per
 * round, oldest first. Each cell is a plain number a spreadsheet can sum:
 * cycle time in days (one decimal) or time tracked in hours. Where there is
 * no number, the cell says why: "not in this round",
 * "won't do", "open", "not started". The same file shape as the other
 * exports (UTF-8 with a BOM, CRLF), and English headers like the Timesheet's.
 * The one writer, for the view's Export CSV and
 * `GET /milestones/:milestoneId/rounds?format=csv`.
 */

const UTF8_BOM = String.fromCharCode(0xfeff)
const DAY = 86_400_000

export type RoundMeasure = 'cycle' | 'time'

export function isRoundMeasure(value: unknown): value is RoundMeasure {
  return value === 'cycle' || value === 'time'
}

export function roundComparisonCsv(comparison: RoundComparison, measure: RoundMeasure): string {
  const unit = measure === 'cycle' ? 'cycle time, days' : 'time tracked, hours'
  const header = ['Task', ...comparison.rounds.map((round) => `${round.name} (${unit})`)]
  const records = comparison.tasks.map((row) =>
    csvRecord([
      row.title,
      ...row.cells.map((cell) => {
        if (!cell) return 'not in this round'
        if (measure === 'time') return csvHours(cell.timeTrackedSeconds)
        if (cell.outcome === 'wont-do') return 'won’t do'
        if (cell.outcome === 'open') return 'open'
        if (cell.cycleTimeMs === null) return 'not started'
        return String(Math.round((cell.cycleTimeMs / DAY) * 10) / 10)
      })
    ])
  )
  return `${UTF8_BOM}${[csvRecord(header), ...records].join('\r\n')}\r\n`
}
