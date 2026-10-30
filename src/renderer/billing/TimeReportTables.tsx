import { Fragment } from 'react'
import type { TimeEntry } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { formatHours } from '@shared/time/duration'
import { entryDay } from '@shared/time/timesheet'
import type { TimeReport, TimeReportPart, TimeReportTotals } from '@shared/time/billing'
import { t } from '@shared/i18n'
import { usePeople } from '../context/PeopleContext'
import { IconButton } from '../ui'
import { chevronClass, ChevronRight } from '../ui/icons'
import './billing.css'

/** An amount in the report's currency, or a dash when there is no rate. */
export function reportAmount(amount: number | null, currency: string): string {
  return amount === null ? t('views:timeReport.noAmount') : formatMoney(amount, currency)
}

/** The three totals: hours, billable hours and amount. */
export function TimeReportTotalsList({ report }: { report: TimeReport }) {
  const items: Array<[string, string]> = [
    [t('views:timeReport.hours'), formatHours(report.totals.seconds)],
    [t('views:timeReport.billableHours'), formatHours(report.totals.billableSeconds)],
    [t('views:timeReport.amount'), reportAmount(report.totals.amount, report.currency)]
  ]
  return (
    <dl className="time-report__totals" aria-label={t('views:timeReport.totals')}>
      {items.map(([label, value]) => (
        <div key={label} className="time-report__total">
          <dt>{label}</dt>
          <dd className="time-report__number">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface TimeReportTablesProps {
  report: TimeReport
  /** Task keys (`unbilled:<id>`, `billed:<id>`) whose entries show; every one when printing. */
  expanded: ReadonlySet<string> | 'all'
  /** Shows or hides a task's entries; without it, there are no toggles (print). */
  onToggle?: (key: string) => void
  /** A person's name; the print page passes the people it loaded before it was ready. */
  personName?: (personId: string) => string | undefined
}

/**
 * The Time report's tables (N6.4): unbilled and billed time apart, each by
 * task with hours, billable hours and amount, and a task's entries beneath it
 * on request. The view and its print page draw the same tables.
 */
export function TimeReportTables({
  report,
  expanded,
  onToggle,
  personName
}: TimeReportTablesProps) {
  return (
    <>
      <TimeReportPartTable
        part="unbilled"
        title={t('views:timeReport.unbilled')}
        empty={t('views:timeReport.nothingUnbilled')}
        data={report.unbilled}
        report={report}
        expanded={expanded}
        onToggle={onToggle}
        personName={personName}
      />
      <TimeReportPartTable
        part="billed"
        title={t('views:timeReport.billed')}
        empty={t('views:timeReport.nothingBilled')}
        data={report.billed}
        report={report}
        expanded={expanded}
        onToggle={onToggle}
        personName={personName}
      />
    </>
  )
}

function TimeReportPartTable({
  part,
  title,
  empty,
  data,
  report,
  expanded,
  onToggle,
  personName
}: {
  part: 'unbilled' | 'billed'
  title: string
  empty: string
  data: TimeReportPart
} & TimeReportTablesProps) {
  const people = usePeople()
  const numbers = (totals: TimeReportTotals) => (
    <>
      <td className="time-report__number">{formatHours(totals.seconds)}</td>
      <td className="time-report__number">{formatHours(totals.billableSeconds)}</td>
      <td className="time-report__number">{reportAmount(totals.amount, report.currency)}</td>
    </>
  )
  const entryText = (entry: TimeEntry) =>
    [
      t('views:timeReport.entryLine', {
        date: formatIsoDate(entryDay(entry)),
        hours: formatHours(entry.durationSeconds ?? 0)
      }),
      entry.note,
      entry.personId ? (personName?.(entry.personId) ?? people.byId.get(entry.personId)?.name) : '',
      entry.billable ? '' : t('views:timeReport.notBillable')
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <section className="time-report__part" aria-label={title}>
      <h2 className="time-report__heading">{title}</h2>
      {data.tasks.length === 0 ? (
        <p className="time-report__muted">{empty}</p>
      ) : (
        <table className="time-report__table" aria-label={title}>
          <thead>
            <tr>
              <th scope="col">{t('views:timeReport.task')}</th>
              <th scope="col" className="time-report__number">
                {t('views:timeReport.hours')}
              </th>
              <th scope="col" className="time-report__number">
                {t('views:timeReport.billableHours')}
              </th>
              <th scope="col" className="time-report__number">
                {t('views:timeReport.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((task) => {
              const key = `${part}:${task.workItemId}`
              const open = expanded === 'all' || expanded.has(key)
              return (
                <Fragment key={key}>
                  <tr>
                    <th scope="row" className="time-report__task">
                      {onToggle && (
                        <IconButton
                          size="sm"
                          icon={ChevronRight}
                          iconClassName={chevronClass(open)}
                          aria-expanded={open}
                          label={
                            open
                              ? t('views:timeReport.hideEntries', { task: task.title })
                              : t('views:timeReport.showEntries', { task: task.title })
                          }
                          onClick={() => onToggle(key)}
                        />
                      )}
                      <span>{task.title}</span>
                    </th>
                    {numbers(task)}
                  </tr>
                  {open && (
                    <tr className="time-report__entries-row">
                      <td colSpan={4}>
                        <ul
                          className="time-report__entries"
                          aria-label={t('views:timeReport.entriesOf', { task: task.title })}
                        >
                          {task.entries.map((entry) => (
                            <li key={entry.id}>{entryText(entry)}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t('views:timeReport.total')}</th>
              {numbers(data)}
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}
