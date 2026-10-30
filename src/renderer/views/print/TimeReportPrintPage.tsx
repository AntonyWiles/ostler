import { useEffect, useState } from 'react'
import type { TimeReportPrintRoute } from '@shared/print-route'
import { formatIsoDate } from '@shared/dates'
import { formatDateTime } from '@shared/format'
import { formatMoney } from '@shared/money'
import type { TimeReport } from '@shared/time/billing'
import { TimeReportTables, TimeReportTotalsList } from '../../billing/TimeReportTables'
import './PrintPage.css'
import { t } from '@shared/i18n'

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

/**
 * Print the Time report (N6.4): the dates, the rate, the totals, and both
 * tables with every task's entries, from the call the view makes
 * (`getTimeReport`). No controls; main prints it on A4.
 */
export function TimeReportPrintPage({ route }: { route: TimeReportPrintRoute }) {
  const [report, setReport] = useState<TimeReport | null>(null)
  const [title, setTitle] = useState('')
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      window.ostlerAPI.getTimeReport(route.projectId, route.from, route.to),
      window.ostlerAPI.getConfig(),
      window.ostlerAPI.getPeople({ includeArchived: true })
    ]).then(([result, config, people]) => {
      if (people.ok) setNames(new Map(people.value.map((person) => [person.id, person.name])))
      if (config.ok)
        setTitle(
          config.value.projects.find((project) => project.id === route.projectId)?.name ?? ''
        )
      if (result.ok) setReport(result.value)
      else {
        setError(result.error)
        markReady('error')
      }
    })
  }, [route])

  useEffect(() => {
    if (!report) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [report])

  if (error) return <p role="alert">{error}</p>
  if (!report) return null

  return (
    <div className="print-page time-report time-report--print">
      <header className="print-page__header">
        <h1>{[title, t('views:timeReport.title')].filter(Boolean).join(' · ')}</h1>
        <p>
          {t('views:timeReport.printedAt', {
            from: formatIsoDate(report.from),
            to: formatIsoDate(report.to),
            date: formatDateTime(Date.now())
          })}
        </p>
        <p>
          {report.hourlyRate === null
            ? t('views:timeReport.noRate')
            : t('views:timeReport.rate', {
                rate: formatMoney(report.hourlyRate, report.currency)
              })}
        </p>
      </header>
      <TimeReportTotalsList report={report} />
      <TimeReportTables
        report={report}
        expanded="all"
        personName={(personId) => names.get(personId)}
      />
    </div>
  )
}
