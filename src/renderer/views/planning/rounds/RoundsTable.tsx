import type { RoundComparison, RoundComparisonCell } from '@shared/ostler-api'
import { formatHours } from '@shared/time/duration'
import { t } from '@shared/i18n'

export type RoundMeasure = 'cycle' | 'time'

const DAY = 86_400_000

/** A cell's number or the reason it has none, in words. */
export function roundCellText(cell: RoundComparisonCell | null, measure: RoundMeasure): string {
  if (!cell) return t('views:compareRounds.notInRound')
  if (measure === 'time')
    return cell.timeTrackedSeconds > 0
      ? formatHours(cell.timeTrackedSeconds)
      : t('views:compareRounds.noTime')
  if (cell.outcome === 'wont-do') return t('views:compareRounds.wontDo')
  if (cell.outcome === 'open') return t('views:compareRounds.open')
  if (cell.cycleTimeMs === null) return t('views:compareRounds.notStartedCell')
  const days = Math.round(cell.cycleTimeMs / DAY)
  return days < 1 ? t('views:report.underADay') : t('common:count.day', { count: days })
}

/**
 * Compare rounds' table (N5.7b): a row per task, a column per round (the
 * ones given, oldest first), each cell the task's cycle time or time tracked.
 * The slowest cell in a row says so in words and is drawn bold and outlined,
 * not by colour alone. The task column stays put while the rounds scroll.
 */
export function RoundsTable({
  comparison,
  measure,
  from = 0
}: {
  comparison: RoundComparison
  measure: RoundMeasure
  /** The first round shown (index into `comparison.rounds`). */
  from?: number
}) {
  const rounds = comparison.rounds.slice(from)
  return (
    <table className="compare-rounds__table">
      <thead>
        <tr>
          <th scope="col" className="compare-rounds__task">
            {t('views:compareRounds.taskHeader')}
          </th>
          {rounds.map((round) => (
            <th scope="col" key={round.milestoneId}>
              {round.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {comparison.tasks.map((row, rowIndex) => {
          const slowest = measure === 'cycle' ? row.slowestCycleRound : row.slowestTimeRound
          return (
            <tr key={rowIndex}>
              <th scope="row" className="compare-rounds__task">
                {row.title}
              </th>
              {rounds.map((round, offset) => {
                const index = from + offset
                const cell = row.cells[index]
                const text = roundCellText(cell, measure)
                return (
                  <td
                    key={round.milestoneId}
                    className={
                      index === slowest
                        ? 'compare-rounds__cell is-slowest'
                        : cell
                          ? 'compare-rounds__cell'
                          : 'compare-rounds__cell is-absent'
                    }
                  >
                    {index === slowest ? (
                      <>
                        <span>{text}</span>{' '}
                        <span className="compare-rounds__slowest">
                          {t('views:compareRounds.slowest')}
                        </span>
                      </>
                    ) : (
                      text
                    )}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Each round's days against its planned length, latest on the right, with
 * the numbers in words beside it. The bars are drawn for the eye only: the
 * sentences carry the numbers.
 */
export function RoundsChart({ comparison }: { comparison: RoundComparison }) {
  const largest = Math.max(
    1,
    ...comparison.rounds.flatMap((round) => [round.tookDays ?? 0, round.plannedDays ?? 0])
  )
  const height = (value: number | null) => `${((value ?? 0) / largest) * 100}%`
  return (
    <div className="compare-rounds__chart">
      <ol className="compare-rounds__bars" aria-hidden="true">
        {comparison.rounds.map((round) => (
          <li key={round.milestoneId} className="compare-rounds__round">
            <span className="compare-rounds__pair">
              <span
                className="compare-rounds__bar is-planned"
                style={{ height: height(round.plannedDays) }}
                title={t('views:compareRounds.plannedBar')}
              />
              <span
                className="compare-rounds__bar is-took"
                style={{ height: height(round.tookDays) }}
                title={t('views:compareRounds.tookBar')}
              />
            </span>
            <span className="compare-rounds__label">{round.name}</span>
          </li>
        ))}
      </ol>
      <ul className="compare-rounds__sentences">
        {comparison.rounds.map((round) => (
          <li key={round.milestoneId}>{round.summary}</li>
        ))}
      </ul>
    </div>
  )
}
