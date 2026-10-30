import { useEffect, useState } from 'react'
import type { RoundComparison } from '@shared/ostler-api'
import { Button, Dialog, InlineAlert, SegmentedControl, Skeleton, useToast } from '../../../ui'
import { RoundsChart, RoundsTable, type RoundMeasure } from './RoundsTable'
import { t } from '@shared/i18n'
import './rounds.css'

/** The table shows this many rounds until earlier ones are asked for. */
export const LATEST_ROUNDS = 6

/**
 * Compare rounds (N5.7b, N42): a series' rounds side by side, from the same
 * numbers `GET /milestones/:milestoneId/rounds` returns. How long each round
 * took against its plan, then each task's cycle time (or time tracked, once
 * there is any) round by round. Read only: nothing here changes a round.
 */
export function CompareRoundsDialog({
  projectId,
  milestoneId,
  onClose
}: {
  projectId: string
  /** Any round of the series. */
  milestoneId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const [comparison, setComparison] = useState<RoundComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<RoundMeasure>('cycle')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getRoundComparison(projectId, milestoneId).then((result) => {
      if (!live) return
      if (result.ok) setComparison(result.value)
      else setError(result.error)
    })
    return () => {
      live = false
    }
  }, [projectId, milestoneId])

  const shownMeasure: RoundMeasure = comparison?.hasTimeTracked ? measure : 'cycle'
  const earlier = comparison ? Math.max(0, comparison.rounds.length - LATEST_ROUNDS) : 0
  const from = showAll ? 0 : earlier

  const print = async (output: 'pdf' | 'printer') => {
    setBusy(true)
    const result = await window.ostlerAPI.printRoundComparison({
      projectId,
      milestoneId,
      measure: shownMeasure,
      output
    })
    setBusy(false)
    if (!result.ok)
      toast({ title: t('views:compareRounds.couldntPrint'), body: result.error, tone: 'danger' })
    else if (result.value)
      toast({ title: t('views:compareRounds.savedPdf'), body: result.value, tone: 'success' })
  }

  const exportCsv = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.exportRoundComparisonCsv({
      projectId,
      milestoneId,
      measure: shownMeasure
    })
    setBusy(false)
    if (!result.ok)
      toast({ title: t('views:compareRounds.couldntExport'), body: result.error, tone: 'danger' })
    else if (result.value)
      toast({ title: t('views:compareRounds.savedCsv'), body: result.value, tone: 'success' })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={
        comparison
          ? t('views:compareRounds.title', { name: comparison.seriesName })
          : t('views:compareRounds.compare')
      }
      description={comparison?.summary}
      footer={
        <>
          <Button onClick={() => void exportCsv()} disabled={!comparison || busy}>
            {t('views:compareRounds.exportCsv')}
          </Button>
          <Button onClick={() => void print('pdf')} disabled={!comparison || busy}>
            {t('views:compareRounds.saveAsPdf')}
          </Button>
          <Button onClick={() => void print('printer')} disabled={!comparison || busy}>
            {t('views:compareRounds.print')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('views:compareRounds.close')}
          </Button>
        </>
      }
    >
      {error && (
        <InlineAlert tone="danger" title={t('views:compareRounds.couldntLoad')}>
          {error}
        </InlineAlert>
      )}
      {!comparison && !error && <Skeleton lines={4} />}
      {comparison && (
        <div className="compare-rounds">
          <section aria-labelledby="compare-rounds-durations">
            <h3 id="compare-rounds-durations" className="compare-rounds__heading">
              {t('views:compareRounds.durations')}
            </h3>
            <RoundsChart comparison={comparison} />
          </section>
          <section aria-labelledby="compare-rounds-tasks">
            <div className="compare-rounds__toolbar">
              <h3 id="compare-rounds-tasks" className="compare-rounds__heading">
                {t('views:compareRounds.tasksHeading')}
              </h3>
              {comparison.hasTimeTracked && (
                <SegmentedControl<RoundMeasure>
                  label={t('views:compareRounds.show')}
                  size="sm"
                  value={measure}
                  onChange={setMeasure}
                  options={[
                    { value: 'cycle', label: t('views:compareRounds.cycleTime') },
                    { value: 'time', label: t('views:compareRounds.timeTracked') }
                  ]}
                />
              )}
              {earlier > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                  {showAll
                    ? t('views:compareRounds.latestOnly')
                    : t('views:compareRounds.earlierRounds', { count: earlier })}
                </Button>
              )}
            </div>
            {comparison.tasks.length === 0 ? (
              <p className="compare-rounds__empty">{t('views:compareRounds.noTasks')}</p>
            ) : (
              <div
                className="compare-rounds__scroll"
                tabIndex={0}
                role="region"
                aria-labelledby="compare-rounds-tasks"
              >
                <RoundsTable comparison={comparison} measure={shownMeasure} from={from} />
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}
