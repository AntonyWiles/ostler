import { useEffect, useState } from 'react'
import type { RoundComparison } from '@shared/ostler-api'
import type { RoundsPrintRoute } from '@shared/print-route'
import { formatDateTime } from '@shared/format'
import { RoundsTable } from '../planning/rounds/RoundsTable'
import '../planning/rounds/rounds.css'
import './PrintPage.css'
import { t } from '@shared/i18n'

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

/**
 * Print Compare rounds (N5.7b): each round's numbers in words, then the
 * table with every round and every task, from the call the view makes
 * (`getRoundComparison`). No controls, nothing scrolls.
 */
export function RoundsPrintPage({ route }: { route: RoundsPrintRoute }) {
  const [comparison, setComparison] = useState<RoundComparison | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.ostlerAPI.getRoundComparison(route.projectId, route.milestoneId).then((result) => {
      if (result.ok) setComparison(result.value)
      else {
        setError(result.error)
        markReady('error')
      }
    })
  }, [route])

  useEffect(() => {
    if (!comparison) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [comparison])

  if (error) return <p role="alert">{error}</p>
  if (!comparison) return null

  return (
    <div className="print-page compare-rounds--print">
      <header className="print-page__header">
        <h1>{t('views:compareRounds.title', { name: comparison.seriesName })}</h1>
        <p>{t('views:compareRounds.printedAt', { date: formatDateTime(Date.now()) })}</p>
      </header>
      <h2>{t('views:compareRounds.durations')}</h2>
      <ul>
        {comparison.rounds.map((round) => (
          <li key={round.milestoneId}>{round.summary}</li>
        ))}
      </ul>
      <h2>
        {t('views:compareRounds.tasksHeading')}:{' '}
        {route.measure === 'time'
          ? t('views:compareRounds.timeTracked')
          : t('views:compareRounds.cycleTime')}
      </h2>
      <RoundsTable comparison={comparison} measure={route.measure} />
    </div>
  )
}
