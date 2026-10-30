import { useState } from 'react'
import type { HomeProgress } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { useHomeFeed } from '../../hooks/useHomeFeed'
import { localeWeekStart } from '../../ui/calendar-layout'
import { BarChart } from '../../ui/charts'
import { Button, Section, Skeleton } from '../../ui'
import { CalendarDays } from '../../ui/icons'
import { YearInReviewDialog } from './YearInReviewDialog'
import './ProgressCard.css'
import { t } from '@shared/i18n'

function shortWeek(date: string): string {
  return formatIsoDate(date, { day: 'numeric', month: 'short' })
}

/** The card's plain sentence: "12 this week. 6 working days in a row." */
export function progressSentence(progress: HomeProgress): string {
  const parts = [t('views:progress.thisWeek', { count: progress.thisWeek })]
  if (progress.streak > 0) parts.push(t('views:progress.streak', { count: progress.streak }))
  return parts.join(' ')
}

/** Each bar's number in words, for screen readers. */
export function progressChartLabel(progress: HomeProgress): string {
  return t('views:progress.chartLabel', {
    weeks: progress.weeks
      .map((week) =>
        t('views:progress.bar', { date: shortWeek(week.weekStart), count: week.count })
      )
      .join('; ')
  })
}

/**
 * Home's progress card (N3.6, N30), shown only while Show my progress is on:
 * tasks finished this week, eight weeks of bars, and the working days in a
 * row with something finished. One call (`getHomeProgress`), read again
 * whenever Home's lists may have changed. It states counts; it never scores.
 */
export function ProgressCard({ today }: { today: string }) {
  const [choosing, setChoosing] = useState(false)
  const progress = useHomeFeed(
    () => window.ostlerAPI.getHomeProgress({ today, weekStart: localeWeekStart() }),
    [today],
    'home:progress'
  )
  return (
    <Section
      title={t('views:progress.title')}
      className="ostler-home-progress"
      actions={
        <Button size="sm" icon={CalendarDays} onClick={() => setChoosing(true)}>
          {t('views:progress.yourYear')}
        </Button>
      }
    >
      {progress.value === null ? (
        progress.error ? (
          <p className="ostler-home-quiet" role="alert">
            {t('views:progress.couldntLoad')}
          </p>
        ) : (
          <Skeleton lines={2} />
        )
      ) : (
        <div className="ostler-home-progress__body">
          <p className="ostler-home-progress__sentence">{progressSentence(progress.value)}</p>
          <div className="ostler-home-progress__chart">
            <BarChart
              height={96}
              categories={progress.value.weeks.map((week) => week.weekStart)}
              formatCategory={shortWeek}
              ariaLabel={progressChartLabel(progress.value)}
              series={[
                {
                  id: 'finished',
                  label: t('views:progress.chartTitle'),
                  color: 1,
                  values: progress.value.weeks.map((week) => week.count)
                }
              ]}
            />
          </div>
        </div>
      )}
      <YearInReviewDialog open={choosing} onClose={() => setChoosing(false)} />
    </Section>
  )
}
