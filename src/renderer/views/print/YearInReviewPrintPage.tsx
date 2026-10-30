import { useEffect, useState } from 'react'
import type { YearInReview } from '@shared/ostler-api'
import type { YearInReviewPrintRoute } from '@shared/print-route'
import { formatIsoDate } from '@shared/dates'
import { formatDate, formatDateTime } from '@shared/format'
import { formatHours } from '@shared/time/duration'
import { BarChart } from '../../ui/charts'
import './PrintPage.css'
import './YearInReviewPrintPage.css'
import { t } from '@shared/i18n'

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

function monthName(year: number, month: number, style: 'long' | 'short' = 'long'): string {
  return formatDate(new Date(year, month - 1, 1), { month: style })
}

/**
 * Your year (N3.6, N30): a calendar year of finished work on A4 portrait,
 * from status history through `getYearInReview`, the call the progress card
 * offers. Black and white: every number is in a table as well as the chart,
 * and an approximate month is marked with an asterisk, not a colour. No
 * scores, no praise; it is the person's, and goes nowhere but this page.
 */
export function YearInReviewPrintPage({ route }: { route: YearInReviewPrintRoute }) {
  const [data, setData] = useState<YearInReview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.ostlerAPI
      .getYearInReview({ year: route.year, weekStart: route.weekStart })
      .then((result) => {
        if (result.ok) setData(result.value)
        else {
          setError(result.error)
          markReady('error')
        }
      })
  }, [route])

  useEffect(() => {
    if (!data) return
    const frame = requestAnimationFrame(() => markReady('1'))
    return () => cancelAnimationFrame(frame)
  }, [data])

  if (error) return <p role="alert">{error}</p>
  if (!data) return null

  const anyApproximate = data.months.some((month) => month.approximate)
  const time = data.time

  return (
    <div className="print-page year-review">
      <header className="print-page__header">
        <h1>{t('views:yearInReview.title', { year: data.year })}</h1>
        <p>{t('views:yearInReview.printedAt', { date: formatDateTime(Date.now()) })}</p>
      </header>

      <dl className="year-review__totals">
        <div>
          <dt>{t('views:yearInReview.tasksFinished')}</dt>
          <dd>{data.totalTasks}</dd>
        </div>
        <div>
          <dt>{t('views:yearInReview.milestonesFinished')}</dt>
          <dd>{data.totalMilestones}</dd>
        </div>
        {time && (
          <div>
            <dt>{t('views:yearInReview.time')}</dt>
            <dd>{formatHours(time.totalSeconds)}</dd>
          </div>
        )}
      </dl>

      <section className="year-review__section">
        <h2>{t('views:yearInReview.byMonth')}</h2>
        <BarChart
          height={160}
          categories={data.months.map((month) => String(month.month))}
          formatCategory={(month) => monthName(data.year, Number(month), 'short')}
          ariaLabel={t('views:yearInReview.chartLabel', {
            months: data.months
              .map((month) =>
                t('views:yearInReview.monthBar', {
                  month: monthName(data.year, month.month),
                  count: month.tasks
                })
              )
              .join('; ')
          })}
          series={[
            {
              id: 'tasks',
              label: t('views:yearInReview.tasks'),
              color: 1,
              values: data.months.map((month) => month.tasks)
            }
          ]}
        />
        <table className="year-review__table">
          <thead>
            <tr>
              <th scope="col">{t('views:yearInReview.month')}</th>
              <th scope="col" className="year-review__number">
                {t('views:yearInReview.tasks')}
              </th>
              <th scope="col" className="year-review__number">
                {t('views:yearInReview.milestones')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((month) => (
              <tr key={month.month}>
                <th scope="row">
                  {monthName(data.year, month.month)}
                  {month.approximate && (
                    <span title={t('views:yearInReview.approximate')}>
                      {' *'}
                      <span className="year-review__hidden">
                        {t('views:yearInReview.approximate')}
                      </span>
                    </span>
                  )}
                </th>
                <td className="year-review__number">{month.tasks}</td>
                <td className="year-review__number">{month.milestones}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {anyApproximate && (
          <p className="year-review__note">{t('views:yearInReview.approximateNote')}</p>
        )}
      </section>

      <section className="year-review__section">
        <h2>{t('views:yearInReview.busiestWeek')}</h2>
        <p>
          {data.busiestWeek
            ? t('views:yearInReview.busiestWeekText', {
                date: formatIsoDate(data.busiestWeek.weekStart, {
                  day: 'numeric',
                  month: 'long'
                }),
                count: data.busiestWeek.count
              })
            : t('views:yearInReview.noBusiestWeek')}
        </p>
      </section>

      <section className="year-review__section">
        <h2>{t('views:yearInReview.projectsFinished')}</h2>
        {data.projectsFinished.length === 0 ? (
          <p>{t('views:yearInReview.noProjectsFinished')}</p>
        ) : (
          <table className="year-review__table">
            <thead>
              <tr>
                <th scope="col">{t('views:yearInReview.project')}</th>
                <th scope="col">{t('views:yearInReview.finishedOn')}</th>
              </tr>
            </thead>
            <tbody>
              {data.projectsFinished.map((project) => (
                <tr key={project.projectId}>
                  <th scope="row">{project.projectName}</th>
                  <td>{formatIsoDate(project.finishedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.topProjects.length > 0 && (
        <section className="year-review__section">
          <h2>{t('views:yearInReview.topProjects')}</h2>
          <table className="year-review__table">
            <thead>
              <tr>
                <th scope="col">{t('views:yearInReview.project')}</th>
                <th scope="col" className="year-review__number">
                  {t('views:yearInReview.tasks')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topProjects.map((project) => (
                <tr key={project.projectId}>
                  <th scope="row">{project.projectName}</th>
                  <td className="year-review__number">{project.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {time && (
        <section className="year-review__section">
          <h2>{t('views:yearInReview.time')}</h2>
          <p>{t('views:yearInReview.timeTotal', { hours: formatHours(time.totalSeconds) })}</p>
          <div className="year-review__columns">
            <table className="year-review__table">
              <caption>{t('views:yearInReview.timeByMonth')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('views:yearInReview.month')}</th>
                  <th scope="col" className="year-review__number">
                    {t('views:yearInReview.hours')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {time.byMonth.map((seconds, index) => (
                  <tr key={index}>
                    <th scope="row">{monthName(data.year, index + 1)}</th>
                    <td className="year-review__number">{formatHours(seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="year-review__table">
              <caption>{t('views:yearInReview.timeByProject')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('views:yearInReview.project')}</th>
                  <th scope="col" className="year-review__number">
                    {t('views:yearInReview.hours')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {time.byProject.map((project) => (
                  <tr key={project.projectId}>
                    <th scope="row">{project.projectName}</th>
                    <td className="year-review__number">{formatHours(project.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="print-page__footer">{t('views:printPage.printed')}</footer>
    </div>
  )
}
